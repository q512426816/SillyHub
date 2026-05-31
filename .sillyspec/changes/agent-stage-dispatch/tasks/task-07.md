---
id: task-07
title: 新建 SillySpecStageDispatchService.dispatch_next_step()
priority: P0
estimated_hours: 4
depends_on: [task-05, task-06]
blocks: [task-08, task-09]
allowed_paths:
  - backend/app/modules/change/dispatch.py
author: qinyi
created_at: 2026-06-01 06:55:59
---

## 修改文件

- `backend/app/modules/change/dispatch.py` — 新增 `SillySpecStageDispatchService` 类，保留现有 `dispatch()` 函数不删除

## 实现要求

根据 design.md Phase 1 "新建 SillySpecStageDispatchService" 章节，在现有 `dispatch.py` 模块中新增 `SillySpecStageDispatchService` 类。该类是统一调度入口，负责创建 AgentRun 并启动 Agent 执行。

### 1. 新增 SillySpecStageDispatchService 类

在 `dispatch.py` 文件中（`dispatch()` 函数之后），新增以下类：

```python
class SillySpecStageDispatchService:
    """统一调度入口：创建 AgentRun + 构造 agent 指令。

    替代旧 dispatch() 函数，作为所有阶段调度的唯一入口。
    调用方包括：
    - ChangeService.transition_with_dispatch()
    - POST /changes/{id}/dispatch 路由
    - sync_stage_status() 内部自动调度
    """

    def __init__(self, session: AsyncSession) -> None:
        self._session = session
```

### 2. dispatch_next_step 方法签名与返回值

```python
async def dispatch_next_step(
    self,
    session: AsyncSession,
    workspace_id: UUID,
    change_id: UUID,
    user_id: UUID,
    target_stage: str,
) -> dict[str, Any]:
```

**返回值约定**：
- 成功调度：`{"dispatched": True, "agent_run_id": "<uuid>", "stage": "<stage>"}`
- 未调度（阶段未配置）：`{"dispatched": False, "reason": "stage_not_configured", "stage": "<stage>"}`
- 未调度（已有活跃 run）：`{"dispatched": False, "reason": "active_run_exists", "stage": "<stage>"}`
- 未调度（Change 不存在）：抛出 `ChangeNotFound`
- 未调度（build_stage_bundle 失败）：`{"dispatched": False, "reason": "bundle_build_error", "stage": "<stage>"}`

### 3. _build_stage_bundle 方法签名

```python
async def _build_stage_bundle(
    self,
    session: AsyncSession,
    change_id: UUID,
    stage: str,
    workspace_id: UUID,
) -> AgentSpecBundle:
```

调用 task-05 新增的 `build_stage_bundle()` 函数（位于 `backend/app/modules/agent/context_builder.py`）。如果该函数尚未实现，则本地构造一个包含 `stage_dispatch=True` 的最小 bundle 作为 fallback。

### 4. dispatch_next_step 完整控制流伪代码

```
dispatch_next_step(session, workspace_id, change_id, user_id, target_stage):

    # Step 1: 检查 STAGE_AGENT_CONFIG
    config = STAGE_AGENT_CONFIG.get(target_stage)
    if config is None:
        return {"dispatched": False, "reason": "stage_not_configured", "stage": target_stage}
    if not config.enabled:
        return {"dispatched": False, "reason": "stage_not_enabled", "stage": target_stage}

    # Step 2: 检查 Change 存在性
    change = await session.get(Change, change_id)
    if change is None:
        raise ChangeNotFound(change_id=change_id)

    # Step 3: 检查活跃 AgentRun（防重复 dispatch）
    if await has_active_run(session, change_id):
        return {"dispatched": False, "reason": "active_run_exists", "stage": target_stage}

    # Step 4: 构造 AgentSpecBundle
    try:
        bundle = await self._build_stage_bundle(session, change_id, target_stage, workspace_id)
    except Exception as exc:
        log.warning("bundle_build_failed", change_id=str(change_id), stage=target_stage, error=str(exc))
        return {"dispatched": False, "reason": "bundle_build_error", "stage": target_stage}

    # Step 5: 创建 AgentRun 记录
    run = AgentRun(
        id=uuid4(),
        task_id=None,              # 阶段级调度，无 task 关联
        lease_id=None,             # 由 AgentService 根据 config 决定
        change_id=change_id,
        agent_type="claude_code",
        status="pending",
        spec_strategy="sillyspec",
    )
    session.add(run)

    # Step 6: 创建 M:N workspace 关联
    session.add(AgentRunWorkspace(
        agent_run_id=run.id,
        workspace_id=workspace_id,
    ))
    await session.commit()
    await session.refresh(run)

    # Step 7: 记录 last_dispatch 到 change.stages JSON
    stages = change.stages or {}
    stages["last_dispatch"] = {
        "stage": target_stage,
        "user_id": str(user_id),
        "at": datetime.now(timezone.utc).isoformat(),
        "run_id": str(run.id),
        "config": {
            "phase": config.phase,
            "requires_worktree": config.requires_worktree,
            "read_only": config.read_only,
        },
    }
    change.stages = stages
    session.add(change)
    await session.commit()

    # Step 8: 启动 Agent 执行（调用 AgentService.start_stage_dispatch）
    try:
        agent_service = AgentService(session)
        await agent_service.start_stage_dispatch(
            workspace_id=workspace_id,
            change_id=change_id,
            user_id=user_id,
            stage=target_stage,
            prompt_template=config.prompt_template,
            requires_worktree=config.requires_worktree,
            read_only=config.read_only,
        )
    except Exception as exc:
        log.warning("agent_start_failed", run_id=str(run.id), error=str(exc))
        # 不删除已创建的 run 记录，保留供排查
        run.status = "failed"
        run.output_redacted = f"Agent start failed: {exc}"
        session.add(run)
        await session.commit()
        return {"dispatched": False, "reason": "agent_start_error", "stage": target_stage}

    # Step 9: 返回成功结果
    return {
        "dispatched": True,
        "agent_run_id": str(run.id),
        "stage": target_stage,
    }
```

### 5. _build_stage_bundle 控制流伪代码

```
_build_stage_bundle(session, change_id, stage, workspace_id):

    # 尝试调用 task-05 的 build_stage_bundle
    try:
        from app.modules.agent.context_builder import build_stage_bundle
        bundle = await build_stage_bundle(
            session=session,
            change_id=change_id,
            stage=stage,
            workspace_id=workspace_id,
        )
        return bundle
    except ImportError:
        log.info("build_stage_bundle_not_available, using fallback")
    except Exception as exc:
        log.warning("build_stage_bundle_failed", error=str(exc))

    # Fallback: 构造最小 bundle
    change = await session.get(Change, change_id)
    return AgentSpecBundle(
        change_summary=change.title or f"Stage dispatch: {stage}",
        task_key=f"stage:{stage}",
        task_title=f"Stage dispatch: {stage}",
        stage_dispatch=True,
        change_key=change.change_key if change else None,
        stage=stage,
        spec_root=None,
        read_only=False,
    )
```

注意：`AgentSpecBundle` 的 `stage_dispatch`、`change_key`、`stage`、`spec_root`、`read_only` 字段由 task-02 添加，此处直接使用。

## 接口定义

### 类定义

```python
class SillySpecStageDispatchService:
    """统一调度入口：创建 AgentRun + 构造 agent 指令。"""

    def __init__(self, session: AsyncSession) -> None:
        """初始化调度服务。

        Args:
            session: 异步数据库会话。
        """
        self._session = session

    async def dispatch_next_step(
        self,
        session: AsyncSession,
        workspace_id: UUID,
        change_id: UUID,
        user_id: UUID,
        target_stage: str,
    ) -> dict[str, Any]:
        """为指定变更的阶段调度下一个 step。

        检查阶段配置 -> 检查活跃 run -> 构建 bundle -> 创建 AgentRun
        -> 启动执行 -> 返回结果。

        Args:
            session: 异步数据库会话。
            workspace_id: Workspace UUID。
            change_id: Change UUID。
            user_id: 触发调度的用户 UUID。
            target_stage: 目标 SillySpec 阶段名（如 "propose"）。

        Returns:
            dict 包含 dispatched, agent_run_id, stage, reason 等字段。

        Raises:
            ChangeNotFound: change_id 对应的 Change 记录不存在。
        """

    async def _build_stage_bundle(
        self,
        session: AsyncSession,
        change_id: UUID,
        stage: str,
        workspace_id: UUID,
    ) -> AgentSpecBundle:
        """构造阶段级 AgentSpecBundle。

        优先调用 context_builder.build_stage_bundle()，如果不可用则
        构造最小 bundle 作为 fallback。

        Args:
            session: 异步数据库会话。
            change_id: Change UUID。
            stage: 目标阶段名。
            workspace_id: Workspace UUID。

        Returns:
            配置了 stage_dispatch=True 的 AgentSpecBundle。
        """
```

### 返回数据结构

```python
# 成功调度
DispatchSuccess = TypedDict("DispatchSuccess", {
    "dispatched": Literal[True],
    "agent_run_id": str,    # AgentRun UUID 字符串
    "stage": str,           # 目标阶段名
})

# 未调度
DispatchSkipped = TypedDict("DispatchSkipped", {
    "dispatched": Literal[False],
    "reason": str,   # "stage_not_configured" | "stage_not_enabled" |
                     # "active_run_exists" | "bundle_build_error" |
                     # "agent_start_error"
    "stage": str,    # 目标阶段名（如果有）
})
```

## 边界处理（8 条）

1. **target_stage 不在 STAGE_AGENT_CONFIG 中**：返回 `dispatched=False, reason="stage_not_configured"`。例如传入 `"unknown_stage"` 或 Hub 扩展阶段 `"draft"` 时命中此分支。

2. **target_stage 在 STAGE_AGENT_CONFIG 中但 enabled=False**：返回 `dispatched=False, reason="stage_not_enabled"`。预留将来可以禁用特定阶段。

3. **已有 active AgentRun（pending/running 状态）**：返回 `dispatched=False, reason="active_run_exists"`。复用现有 `has_active_run()` 函数查询 `AgentRun` 表，`WHERE change_id = :cid AND status IN ('pending', 'running')`。

4. **Change 不存在**：抛出 `ChangeNotFound` 异常（从 `app.core.errors` 导入），不吞掉异常，让调用方处理。

5. **build_stage_bundle 失败**（task-05 未完成或抛异常）：捕获异常，记录 warning 日志，返回 `dispatched=False, reason="bundle_build_error"`。不中断主流程。

6. **AgentService.start_stage_dispatch 抛异常**：捕获异常，将已创建的 AgentRun 标记为 `status="failed"`，返回 `dispatched=False, reason="agent_start_error"`。不删除 run 记录，保留排查依据。

7. **workspace 无 git identity 但阶段 requires_worktree=True**：由 `AgentService.start_stage_dispatch` 内部的 `_try_acquire_lease` 返回 None 并抛出 `AgentRunError`。本方法在 Step 8 捕获该异常，标记 run 为 failed，返回 `dispatched=False, reason="agent_start_error"`。审计记录保留在 `last_dispatch` 中。

8. **session 冲突 / commit 失败**：如果 Step 5-7 中任意 commit 失败，异常向上传播不做吞掉。调用方（如 `transition_with_dispatch`）使用独立 session 时不会影响主事务。

## 非目标

- **不实现 sync_stage_status**：由 task-09 负责，该方法在 AgentRun 完成后从 sillyspec.db 同步状态
- **不实现自动调度下一个 step**：由 task-10 负责，在 sync_stage_status 内部判断 pending step 后自动 dispatch
- **不修改 ChangeService.transition_with_dispatch**：由 task-08 负责将旧 `dispatch()` 调用替换为 `SillySpecStageDispatchService.dispatch_next_step()`
- **不修改 AgentService.start_stage_dispatch**：保持现有实现不变，task-04 负责修复其 CLAUDE.md 覆盖问题
- **不删除旧 `dispatch()` 函数**：保留旧函数，task-08 迁移完成后再决定是否废弃

## 参考

- design.md Phase 1 "新建 SillySpecStageDispatchService"（完整类和方法定义）
- requirements.md FR-01 "统一调度入口"
- 现有 `dispatch()` 函数（`backend/app/modules/change/dispatch.py:114-192`）— 参考其检查逻辑和返回值结构
- 现有 `AgentService.start_stage_dispatch()`（`backend/app/modules/agent/service.py:489-602`）— 本方法在 Step 8 调用它
- 现有 `has_active_run()`（`backend/app/modules/change/dispatch.py:104-111`）— 复用此函数检查活跃 run
- `STAGE_AGENT_CONFIG`（`backend/app/modules/change/dispatch.py:42-91`）— 阶段配置字典

## TDD 步骤

1. **写测试：dispatch 创建 AgentRun**
   - 测试文件：`backend/tests/modules/change/test_dispatch.py`
   - 准备：创建 workspace + change + STAGE_AGENT_CONFIG 中存在的 stage
   - 调用 `SillySpecStageDispatchService.dispatch_next_step()`
   - 断言返回 `dispatched=True`，`agent_run_id` 不为 None
   - **预期：测试失败**（类尚未实现）

2. **写测试：prompt 包含 sillyspec 命令**
   - Mock `AgentService.start_stage_dispatch` 返回 AgentRun
   - 验证传入的 `prompt_template` 参数与 STAGE_AGENT_CONFIG 配置一致
   - 验证 `stage` 参数正确传递
   - **预期：测试失败**

3. **写测试：未配置阶段**
   - 传入 `target_stage="unknown"`
   - 断言返回 `dispatched=False, reason="stage_not_configured"`
   - **预期：测试失败**

4. **写测试：已有活跃 run**
   - 预先创建一个 status="pending" 的 AgentRun
   - 再次调用 dispatch_next_step
   - 断言返回 `dispatched=False, reason="active_run_exists"`
   - **预期：测试失败**

5. **写测试：Change 不存在**
   - 传入不存在的 change_id
   - 断言抛出 ChangeNotFound
   - **预期：测试失败**

6. **实现 dispatch_next_step + _build_stage_bundle**
   - 在 dispatch.py 中新增 `SillySpecStageDispatchService` 类
   - 实现上述两个方法
   - **预期：测试 1-5 全部通过**

7. **写测试：幂等性验证**
   - 同一个 change 连续调用两次 dispatch_next_step
   - 第一次返回 dispatched=True
   - 第二次返回 dispatched=False, reason="active_run_exists"
   - **预期：通过**

## 验收标准

| # | 验证步骤 | 通过标准 |
|---|---------|---------|
| AC-01 | 对 propose 阶段调用 dispatch_next_step（Change 存在，无活跃 run） | 返回 `dispatched=True`，`agent_run_id` 不为 None，长度为 UUID 格式 |
| AC-02 | 验证 AgentRun 的 prompt_template 传递 | `AgentService.start_stage_dispatch` 收到的 `stage` 参数为 `"propose"`，`prompt_template` 为 STAGE_AGENT_CONFIG 中 propose 的 `clarifying.md` |
| AC-03 | 传入未配置的 target_stage（如 `"draft"`） | 返回 `dispatched=False`，`reason="stage_not_configured"` |
| AC-04 | 已有 pending/running AgentRun 时调用 | 返回 `dispatched=False`，`reason="active_run_exists"` |
| AC-05 | 传入不存在的 change_id | 抛出 `ChangeNotFound` 异常 |
| AC-06 | build_stage_bundle 抛异常时（Mock 抛 RuntimeError） | 返回 `dispatched=False`，`reason="bundle_build_error"`，不抛异常 |
| AC-07 | AgentService.start_stage_dispatch 抛异常时 | 返回 `dispatched=False`，`reason="agent_start_error"`，已创建的 AgentRun 状态为 `"failed"` |
| AC-08 | dispatch 成功后 change.stages.last_dispatch 记录 | `change.stages["last_dispatch"]["stage"] == "propose"`，`run_id` 不为空 |
| AC-09 | 幂等性：连续两次 dispatch 同一 change | 第一次 dispatched=True，第二次 dispatched=False |
| AC-10 | dispatch 成功后 session 中存在 AgentRunWorkspace 关联 | `AgentRunWorkspace` 表中有 `agent_run_id=run.id, workspace_id=workspace_id` 的记录 |
