---
author: WhaleFall
created_at: 2026-06-04 10:50:53
task: task-07
title: auto_dispatch_next_step gate 检查 + intake 路由
wave: W2
priority: P1
estimate: 3h
depends_on: [task-04]
---

# task-07: auto_dispatch_next_step gate 检查 + intake 路由

## 目标

在 `dispatch.py` 的 `auto_dispatch_next_step()` 和 `SillySpecStageDispatchService` 中增加两个核心逻辑：

1. **AgentRun 完成后的 gate 检查** — Agent 完成 stage 后，根据 stage 类型和产出决定是否设置 `human_gate`（暂停等人）还是继续自动推进。
2. **brainstorm agent 完成后的 intake 路由** — 分析 brainstorm 结果判断需求是否明确，决定进入 `propose`（需求明确）还是 `need_requirement_input`（等人补充）。

## 不在范围

- 不修改 `Change` 模型字段（human_gate 列由 task-03 迁移添加）
- 不修改 `HumanGate` 枚举定义（由 task-01 定义）
- 不修改 `transition()` 方法的 human_gate 联动（由 task-04 处理）
- 不处理 proposal-review / plan-review / human-test 的 review API（task-08/09/10）
- 不处理 verify 自动修复闭环（task-11）

## 输入

- `backend/app/modules/change/dispatch.py` — 现有 `auto_dispatch_next_step()` 和 `SillySpecStageDispatchService.sync_stage_status()`
- `backend/app/modules/change/model.py` — `StageEnum`（task-01 后）、`HumanGate`（task-01 后）、`Change` 模型
- `.sillyspec/changes/agent-driven-change-center/design.md` — 状态组合矩阵、gate 检查语义
- `.sillyspec/changes/agent-driven-change-center/plan.md` — task-07 定义

## 产出

- `backend/app/modules/change/dispatch.py` — 修改 `auto_dispatch_next_step()` 和 `sync_stage_status()`，新增 gate 检查函数和 intake 路由函数

## 实现步骤

### 步骤 1：定义 gate 检查映射表

在 `dispatch.py` 中新增一个 `STAGE_GATE_MAP` 字典，定义每个 stage 完成后应该设置什么 `human_gate`：

```python
# Stage completed -> human_gate to set (None = auto-advance, no gate)
STAGE_GATE_MAP: dict[str, str | None] = {
    "scan": None,                       # scan 完成后自动推进到 brainstorm
    "brainstorm": None,                  # brainstorm 由 intake 路由单独处理（步骤 3）
    "propose": "need_proposal_review",   # 等人确认四件套
    "plan": "need_plan_review",          # 等人确认计划
    "execute": None,                     # 执行完成后自动进入 verify
    "verify": "need_human_test",         # 等人测试
    "quick": None,                       # quick 完成后自动回到 verify
    "archive": "need_archive_confirm",   # 等人确认归档
}
```

设计要点：
- `brainstorm` 特殊处理：不直接设 gate，而是走 intake 路由逻辑（步骤 3）
- `execute` 和 `quick` 不设 gate：agent 自动推进到下一个 stage
- `scan` 不设 gate：自动推进到 brainstorm

### 步骤 2：修改 `sync_stage_status()` — stage completed 时设置 human_gate

在 `SillySpecStageDispatchService.sync_stage_status()` 的 **Step 4 之后**（同步 current_stage 到 Change 记录之后），新增 gate 设置逻辑：

```python
# Step 4b: Set human_gate based on stage completion
if stage_completed:
    gate = STAGE_GATE_MAP.get(db_current_stage)
    if gate is not None:
        # gate 非空：设置 human_gate，暂停等待人工
        change.human_gate = gate
        log.info(
            "sync_stage_status.gate_set",
            change_id=str(change_id),
            stage=db_current_stage,
            human_gate=gate,
        )
    elif db_current_stage == "brainstorm":
        # brainstorm 完成走 intake 路由（步骤 3）
        gate = await _resolve_intake_gate(session, change)
        change.human_gate = gate
        log.info(
            "sync_stage_status.intake_resolved",
            change_id=str(change_id),
            human_gate=gate,
        )
    else:
        # gate 为空且非 brainstorm：不需要 gate，保持 human_gate=none
        change.human_gate = "none"
else:
    # stage 未完成：agent 还在工作，gate 保持 none
    change.human_gate = "none"
```

**关键决策**：在 `sync_stage_status` 中设置 gate 而非 `auto_dispatch_next_step`，因为 gate 是 stage 完成后的状态属性，应在同步时确定。`auto_dispatch_next_step` 只需检查 gate 是否阻塞自动推进。

### 步骤 3：新增 `_resolve_intake_gate()` — brainstorm 完成后的 intake 路由判断

新增独立函数，brainstorm agent 完成后判断需求明确度：

```python
async def _resolve_intake_gate(
    session: AsyncSession,
    change: Change,
) -> str:
    """brainstorm agent 完成后判断 intake 路由。

    读取 sillyspec.db 中 brainstorm stage 的产出和 sillyspec.db changes 表的
    status/progress 数据，判断需求是否足够明确。

    Returns:
        HumanGate 值：
        - "none" → 需求明确，自动进入 propose
        - "need_requirement_input" → 需求不明确，等人补充
    """
    # 策略 1：检查 sillyspec.db 中 brainstorm stage 是否有明确的 "need_input" 标记
    db_path = await _resolve_db_path_for_change(session, change)
    if db_path and db_path.is_file():
        conn = None
        try:
            conn = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
            conn.row_factory = sqlite3.Row

            # 检查 changes 表的 metadata JSON 中是否有 intake_decision
            row = conn.execute(
                "SELECT metadata FROM changes WHERE name = ?",
                (change.change_key,),
            ).fetchone()

            if row and row["metadata"]:
                import json
                metadata = json.loads(row["metadata"]) if isinstance(row["metadata"], str) else row["metadata"]
                intake_decision = metadata.get("intake_decision")
                if intake_decision == "need_input":
                    return "need_requirement_input"
                elif intake_decision == "ready":
                    return "none"
        except Exception as exc:
            log.warning("intake_gate_db_read_failed", error=str(exc))
        finally:
            if conn:
                conn.close()

    # 策略 2（fallback）：检查 brainstorm 产出的 requirements.md 是否存在且足够长
    # 如果 requirements.md 存在且内容 > 200 字符，认为需求足够明确
    from pathlib import Path
    from app.core.spec_paths import SpecPathResolver

    try:
        workspace_root = await _get_workspace_root(session, change.workspace_id)
        if workspace_root:
            req_path = Path(workspace_root) / change.path / "requirements.md"
            if req_path.is_file():
                content = req_path.read_text(encoding="utf-8", errors="replace").strip()
                if len(content) > 200:
                    return "none"
            # requirements.md 不存在或内容太短
            return "need_requirement_input"
    except Exception as exc:
        log.warning("intake_gate_fallback_failed", error=str(exc))

    # 策略 3（默认保守）：无法判断时暂停等人确认
    return "need_requirement_input"
```

**路由决策链**：

```
brainstorm 完成
  ├─ sillyspec.db metadata.intake_decision == "ready"
  │     → human_gate = "none"（自动进入 propose）
  ├─ sillyspec.db metadata.intake_decision == "need_input"
  │     → human_gate = "need_requirement_input"
  ├─ requirements.md 存在且 > 200 字符
  │     → human_gate = "none"（自动进入 propose）
  ├─ requirements.md 不存在或太短
  │     → human_gate = "need_requirement_input"
  └─ 无法判断（异常兜底）
        → human_gate = "need_requirement_input"（保守策略）
```

### 步骤 4：修改 `auto_dispatch_next_step()` — 检查 human_gate 阻塞

在现有 `auto_dispatch_next_step()` 函数中，**在步骤 2（stage completed）之前**插入 gate 检查：

```python
async def auto_dispatch_next_step(
    session: AsyncSession,
    workspace_id: uuid.UUID,
    change_id: uuid.UUID,
    user_id: uuid.UUID,
    sync_result: StageSyncResult,
) -> dict[str, Any]:
    # ... 现有参数和 docstring ...

    # 1. sync failed (现有逻辑不变)
    if not sync_result.synced:
        ...

    # 1b. CHECK HUMAN GATE — 如果 stage 完成且 human_gate 非 none，不自动推进
    if sync_result.stage_completed:
        change = await session.get(Change, change_id)
        if change and change.human_gate and change.human_gate != "none":
            log.info(
                "auto_dispatch_blocked_by_gate",
                change_id=str(change_id),
                human_gate=change.human_gate,
                stage=sync_result.current_stage,
            )
            return {
                "dispatched": False,
                "reason": "human_gate_active",
                "human_gate": change.human_gate,
                "stage": sync_result.current_stage,
            }

    # 2. stage completed — 如果到这里说明 gate=none，可以走后续的 stage 转移逻辑
    # 注意：现有逻辑在 stage_completed 时直接返回 {"dispatched": False, "reason": "stage_completed"}
    # 需要修改为：stage_completed 时先做 stage 转移，再 dispatch 新 stage
    if sync_result.stage_completed:
        # stage 完成且无 gate 阻塞 → 自动转移到下一个 stage 并 dispatch
        next_stage = _resolve_next_stage(sync_result.current_stage)
        if next_stage is None:
            log.info(
                "auto_dispatch_no_next_stage",
                change_id=str(change_id),
                stage=sync_result.current_stage,
            )
            return {"dispatched": False, "reason": "stage_completed"}

        # 执行 transition 到下一个 stage
        try:
            from app.modules.change.service import ChangeService
            svc = ChangeService(session)
            await svc.transition(
                workspace_id=workspace_id,
                change_id=change_id,
                target_stage=next_stage,
                user_role="agent",
                reason="auto_dispatch_next_stage",
            )
        except Exception as exc:
            log.warning(
                "auto_dispatch_transition_failed",
                change_id=str(change_id),
                next_stage=next_stage,
                error=str(exc),
            )
            return {"dispatched": False, "reason": "transition_failed"}

        # dispatch 新 stage 的 agent
        # ... 后续 chain count 检查和 dispatch 逻辑 ...
```

### 步骤 5：新增 `_resolve_next_stage()` — 根据 TRANSITIONS 自动推断下一个 stage

```python
def _resolve_next_stage(current_stage: str) -> str | None:
    """根据 TRANSITIONS 推断 stage 完成后的自动推进目标。

    规则：
    - 如果当前 stage 在 TRANSITIONS 中只有 1 个 agent 可达的出口，自动选择
    - 如果有多个出口，返回 None（需要人工决策）
    - 如果没有出口，返回 None（终态）

    Returns:
        下一个 stage 名称，或 None 表示无法自动推断。
    """
    from app.modules.change.model import StageEnum, TRANSITIONS

    try:
        current_key = StageEnum(current_stage)
    except ValueError:
        return None

    targets = TRANSITIONS.get(current_key, {})
    agent_targets = [t.value for t, roles in targets.items() if "agent" in roles]

    if len(agent_targets) == 1:
        return agent_targets[0]
    return None
```

自动推断规则：
- `scan` → `brainstorm`（唯一 agent 出口）
- `brainstorm` → `propose`（唯一 agent 出口）
- `execute` → `verify`（唯一 agent 出口）
- `quick` → `verify`（唯一 agent 出口）
- `verify` → 有 3 个出口（quick/archive/blocked），无法自动推断 → 返回 None，由 task-11 的 verify 闭环逻辑处理
- `propose` / `plan` → 有多个出口，但它们在 stage completed 时已设 gate，不会走到这里
- `archive` → `archived`（system 角色，不由 agent 推进）→ 返回 None

## 完整的 auto_dispatch_next_step 流程图

```
sync_stage_status() 返回
  │
  ├─ synced=False → 不 dispatch（现有逻辑）
  │
  ├─ synced=True, stage_completed=True
  │     │
  │     ├─ human_gate != "none"
  │     │     → 不 dispatch，返回 human_gate_active
  │     │
  │     └─ human_gate == "none"
  │           │
  │           ├─ _resolve_next_stage() 返回 None
  │           │     → 不 dispatch，返回 stage_completed
  │           │
  │           └─ _resolve_next_stage() 返回 next_stage
  │                 → transition 到 next_stage
  │                 → dispatch 新 stage agent
  │
  └─ synced=True, stage_completed=False
        │
        ├─ has_pending_step=True → dispatch 同 stage 的下一步（现有逻辑）
        │
        └─ has_pending_step=False → 不 dispatch（现有逻辑）
```

## 辅助函数

### `_resolve_db_path_for_change()`

从 `SillySpecStageDispatchService._resolve_db_path()` 提取为模块级函数，供 `_resolve_intake_gate` 复用：

```python
async def _resolve_db_path_for_change(
    session: AsyncSession,
    change: Change,
) -> Path | None:
    """解析 sillyspec.db 文件路径（模块级辅助函数）。"""
    from app.core.spec_paths import SpecPathResolver

    try:
        from app.modules.spec_workspace.model import SpecWorkspace
        stmt = select(SpecWorkspace).where(SpecWorkspace.workspace_id == change.workspace_id)
        spec_ws = (await session.execute(stmt)).scalars().first()
        if spec_ws and spec_ws.strategy != "repo-native":
            return SpecPathResolver(spec_ws.spec_root).db_path()
    except Exception:
        pass

    from app.modules.workspace.model import Workspace
    ws_stmt = select(Workspace).where(Workspace.id == change.workspace_id)
    workspace = (await session.execute(ws_stmt)).scalars().first()
    if not workspace or not workspace.root_path:
        return None
    return SpecPathResolver(workspace.root_path).db_path()
```

### `_get_workspace_root()`

```python
async def _get_workspace_root(session: AsyncSession, workspace_id: uuid.UUID) -> str | None:
    """获取 workspace 的 root_path。"""
    from app.modules.workspace.model import Workspace
    stmt = select(Workspace).where(Workspace.id == workspace_id)
    ws = (await session.execute(stmt)).scalars().first()
    return ws.root_path if ws else None
```

## 验收标准

- [ ] `STAGE_GATE_MAP` 定义了所有 spec_stages 的 gate 映射
- [ ] `sync_stage_status()` 在 stage_completed 时正确设置 `change.human_gate`
- [ ] `sync_stage_status()` 对 brainstorm stage 调用 `_resolve_intake_gate()` 进行 intake 路由
- [ ] `_resolve_intake_gate()` 能从 sillyspec.db metadata 读取 intake_decision
- [ ] `_resolve_intake_gate()` fallback 检查 requirements.md 的存在和长度
- [ ] `_resolve_intake_gate()` 默认保守返回 `need_requirement_input`
- [ ] `auto_dispatch_next_step()` 在 human_gate 非 none 时阻止自动 dispatch
- [ ] `auto_dispatch_next_step()` 在 stage_completed 且 gate=none 时自动 transition 到下一 stage
- [ ] `_resolve_next_stage()` 正确推断单出口 stage 的自动推进目标
- [ ] `_resolve_next_stage()` 对多出口或无出口 stage 返回 None
- [ ] `_resolve_db_path_for_change()` 和 `_get_workspace_root()` 辅助函数可复用
- [ ] 所有新函数有类型标注和 docstring
- [ ] 不引入新的外部依赖

## 风险

| 风险 | 等级 | 对策 |
|---|---|---|
| brainstorm agent 未写入 metadata.intake_decision | 中 | fallback 到 requirements.md 检查，最终保守策略 |
| sillyspec.db 中 changes 表无 metadata 列 | 中 | try-except 包裹，fallback 到文件检查 |
| `auto_dispatch_next_step` 中 transition 失败导致状态不一致 | 中 | transition 失败不 dispatch，返回 transition_failed，stage 保持原状 |
| `_resolve_next_stage` 的单出口推断在 TRANSITIONS 变更后失效 | 低 | task-01 的 TRANSITIONS 已固定，后续变更需同步更新 |
| `_resolve_db_path_for_change` 与 `_resolve_db_path` 逻辑重复 | 低 | 后续重构可统一，当前分离避免对 SillySpecStageDispatchService 的影响 |

## DoD

- [ ] 代码修改完成
- [ ] 类型检查通过
- [ ] 无 lint 错误
