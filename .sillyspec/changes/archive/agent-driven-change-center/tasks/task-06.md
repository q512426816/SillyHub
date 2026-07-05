---
author: WhaleFall
created_at: 2026-06-04 10:50:53
task: task-06
title: 创建后自动 dispatch brainstorm agent
wave: W2
priority: P0
estimate: 2h
depends_on: [task-04, task-05]
---

# task-06: 创建后自动 dispatch brainstorm agent

## 目标

创建 Change 后，自动 dispatch 一个 `brainstorm` stage 的 AgentRun（intake 路由），实现「提交需求后 Agent 自动分析」的体验。用户只需填写需求描述，Agent 立刻开始 brainstorm 分析。

## 不在范围

- 不修改 brainstorm agent 的 prompt 或执行逻辑
- 不修改 brainstorm 完成后的自动路由逻辑（task-07: auto_dispatch_next_step gate 检查 + intake 路由）
- 不修改前端表单（task-14）
- 不修改 StageEnum / HumanGate 枚举（task-01）

## 输入

- `backend/app/modules/change_writer/service.py` — `ChangeWriterService.create_change()` 是创建 Change 的入口
- `backend/app/modules/change_writer/router.py` — `POST /workspaces/{ws}/changes/create` 路由
- `backend/app/modules/change/dispatch.py` — `dispatch()` 函数和 `STAGE_AGENT_CONFIG["brainstorm"]` 配置
- `backend/app/modules/change/service.py` — `transition_with_dispatch()` 封装 transition + dispatch
- `backend/app/modules/agent/service.py` — `AgentService.start_stage_dispatch()` 实际创建 AgentRun 并执行
- `backend/app/modules/change/model.py` — `TRANSITIONS` 邻接表

## 调用链路（当前）

当前创建 Change 后无任何 dispatch 调用：

```
用户 POST /workspaces/{ws}/changes/create
  -> router.create_change()
    -> ChangeWriterService.create_change()
      -> 创建 .sillyspec/changes/{key}/ 目录 + MASTER.md + proposal.md
      -> 创建 Change DB 记录 (current_stage="draft")
      -> 创建 ChangeDocument DB 记录
      -> commit + refresh
      -> 返回 Change
  -> 返回 ChangeCreateResponse
```

## 调用链路（目标）

创建 Change 后自动 dispatch brainstorm：

```
用户 POST /workspaces/{ws}/changes/create
  -> router.create_change()
    -> ChangeWriterService.create_change()
      -> 创建 .sillyspec/changes/{key}/ 目录 + MASTER.md + proposal.md
      -> 创建 Change DB 记录 (current_stage="draft")
      -> 创建 ChangeDocument DB 记录
      -> commit + refresh
      -> 返回 Change
    -> [新增] 自动 dispatch brainstorm（best-effort，不阻塞响应）
      -> change.current_stage = "brainstorm"
      -> session.commit()
      -> dispatch(session, workspace_id, change_id, target_stage="brainstorm", user_id)
        -> get_config_for_stage("brainstorm") -> StageAgentConfig(enabled=True, ...)
        -> has_active_run(session, change_id) -> False（刚创建）
        -> 更新 change.stages["last_dispatch"]
        -> AgentService.start_stage_dispatch(stage="brainstorm", ...)
          -> 创建 AgentRun (status="pending")
          -> 创建 AgentRunWorkspace M:N 关联
          -> asyncio.create_task(_execute_stage_run(...))  # fire-and-forget
          -> 返回 AgentRun
        -> 返回 {dispatched: True, agent_run_id, stage: "brainstorm"}
  -> 返回 ChangeCreateResponse（新增 agent_dispatch 信息）
```

## 方案选择：router 层 dispatch（不经过 transition）

选择在 router 层直接调用 `dispatch()` 而不经过 `transition()`，原因：

1. **TRANSITIONS 表不包含 draft->brainstorm 边**：当前 `TRANSITIONS[StageEnum.DRAFT]` 只有 `propose/quick/execute/scan`，没有 `brainstorm`。虽然 task-01 可能添加这条边，但 dispatch() 本身不检查 TRANSITIONS 合法性。
2. **dispatch() 是 best-effort**：dispatch() 内部 catch 所有异常，不阻塞创建流程。
3. **brainstorm 是 intake 路由**：语义上是「创建后的自动分析」，不需要 transition 校验。
4. **保持 create_change() 纯粹**：service 层只做创建，dispatch 逻辑在 router 层组装。这符合 `transition_with_dispatch()` 的设计模式。

## 关键代码引用

### dispatch() 函数入口（dispatch.py:267）

```python
async def dispatch(
    session: AsyncSession,
    workspace_id: uuid.UUID,
    change_id: uuid.UUID,
    target_stage: str,
    user_id: uuid.UUID,
) -> dict[str, Any]:
```

### brainstorm stage 配置（dispatch.py:70-77）

```python
StageEnum.BRAINSTORM.value: StageAgentConfig(
    enabled=True,
    prompt_template="brainstorm.md",
    phase="Brainstorm",
    requires_worktree=True,
    read_only=False,
),
```

- `requires_worktree=True`：dispatch 时会尝试获取 worktree lease，失败则 fallback 到 workspace root
- `read_only=False`：brainstorm agent 会写文件（问题清单、决策记录等）

### create_change 创建记录（change_writer/service.py:106-119）

```python
change = Change(
    ...
    current_stage="draft",
    stages={"draft": {"status": "done", "at": now.isoformat()}},
)
```

### transition_with_dispatch 模式参考（change/service.py:397-452）

这是现有的 transition + dispatch 模式，使用独立 session（`get_session_factory()`）避免与主事务冲突：

```python
factory = get_session_factory()
async with factory() as dispatch_session:
    dispatch_result = await dispatch(
        session=dispatch_session,
        workspace_id=workspace_id,
        change_id=change_id,
        target_stage=target_stage,
        user_id=user_id,
    )
```

## 实现步骤

1. **在 `change_writer/router.py` 的 `create_change()` 路由中**，service.create_change() 成功后，新增 dispatch 调用：

   ```python
   @router.post("/changes/create", ...)
   async def create_change(...) -> ChangeCreateResponse:
       service = ChangeWriterService(session)
       change = await service.create_change(...)

       # Auto-dispatch brainstorm agent (best-effort, non-blocking)
       dispatch_info = None
       try:
           from app.core.db import get_session_factory
           from app.modules.change.dispatch import dispatch

           # Update stage to brainstorm
           change.current_stage = "brainstorm"
           session.add(change)
           await session.commit()

           factory = get_session_factory()
           async with factory() as dispatch_session:
               dispatch_info = await dispatch(
                   session=dispatch_session,
                   workspace_id=workspace_id,
                   change_id=change.id,
                   target_stage="brainstorm",
                   user_id=user.id,
               )
       except Exception as exc:
           log.warning("auto_brainstorm_dispatch_failed", ...)

       response = ChangeCreateResponse.model_validate(change)
       response.agent_dispatch = dispatch_info
       return response
   ```

2. **更新 `ChangeCreateResponse` schema**（`change_writer/schema.py`），新增可选字段：

   ```python
   class ChangeCreateResponse(BaseModel):
       # ... 现有字段 ...
       agent_dispatch: dict | None = None  # 新增
   ```

## 关键文件

| 文件 | 变更 | 说明 |
|---|---|---|
| `backend/app/modules/change_writer/router.py` | 改 | 创建成功后调用 dispatch brainstorm |
| `backend/app/modules/change_writer/schema.py` | 改 | ChangeCreateResponse 新增 agent_dispatch 字段 |
| `backend/app/modules/change/dispatch.py` | 不改 | dispatch() 已支持 brainstorm stage |
| `backend/app/modules/agent/service.py` | 不改 | start_stage_dispatch() 已支持 |

## 验收标准

- [ ] 创建 Change 后自动 dispatch brainstorm AgentRun
- [ ] Change.current_stage 从 draft 更新为 brainstorm
- [ ] dispatch 失败不阻塞创建流程（best-effort）
- [ ] ChangeCreateResponse 返回 agent_dispatch 信息
- [ ] 已有活跃 AgentRun 时不重复 dispatch（dispatch 内部 has_active_run 检查）
- [ ] 无 worktree lease 时仍能 dispatch（dispatch 内部 fallback 到 workspace root）

## 风险

| 风险 | 等级 | 缓解 |
|---|---|---|
| draft->brainstorm 不在 TRANSITIONS 中，直接改 current_stage 绕过了状态机校验 | 中 | brainstorm 是 intake 路由，语义上不需要 transition 校验；task-01 应在 TRANSITIONS 中添加 draft->brainstorm 边作为正式支持 |
| create_change 使用新 session dispatch 可能导致 race condition | 低 | dispatch() 使用独立 session（get_session_factory()），不与创建事务冲突 |
| brainstorm agent 需要 .sillyspec/changes/{key}/ 目录存在 | 低 | create_change 已创建目录，dispatch 不会在此之前执行 |
| prompt 模板中引用 request.md 但 task-05 可能未完成 | 中 | 需确认 task-05 先完成，或 brainstorm prompt 能容忍 request.md 不存在 |
| brainstorm requires_worktree=True，无可用 worktree 时 fallback 到 workspace root | 低 | dispatch -> start_stage_dispatch -> _try_acquire_lease 返回 None 时 fallback 到 workspace root，会记录 warning 但不阻塞 |

## DoD

- [ ] 代码修改完成
- [ ] 手工创建 Change 验证 brainstorm AgentRun 自动触发
- [ ] dispatch 失败场景验证创建流程不受影响
