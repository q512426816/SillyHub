---
author: qinyi
created_at: 2026-07-13T16:30:42
---

# 任务列表 — 修复交互式会话僵尸状态

> 详细技术设计见 design.md（§5 总体方案 / §7 接口定义 / §7.5 生命周期契约表）。决策见 decisions.md D-001~D-009。实现遵循 CLAUDE.md 执行顺序：文档 → 读代码 → 写测试 → 写实现 → 跑测试 → 验收 → 更新文档。

## W1 — 病灶B 核心：close_interactive_run 回写 session 终态

- **task-01 辅助函数 `_apply_session_terminal_status` + 测试**：design §7.1 / D-002@v2。
  - 在 `backend/app/modules/daemon/session/service.py` 新增函数：`is_multi_turn = run.spec_strategy=='interactive' and run.change_id is None`；多轮→`active`，其余→run.completed→`ended`/run.failed→`failed`；幂等（session 已 ended/failed 返回 None，D-005）。
  - **先写测试** `test_apply_session_terminal_status.py`：5 类 spec_strategy×change_id case（interactive+无change→active / interactive+有change→ended / platform-managed→ended / sillyspec→ended / quick-chat→ended）+ 幂等 case（已 ended/failed 返回 None）。
  - 守护：**不得**用 `getattr(run,'ask_user_only',False)`（AgentRun 无此字段，D-002@v2 推翻 v1）。

- **task-02 close_interactive_run 接入回写 + 测试**：design §7.2 / D-009。
  - `run_sync/service.py:730` close_interactive_run 在 `:929` commit **之前**新 query `AgentSession`（`agent_run.agent_session_id` 非空时），调 task-01 函数回写 status + ended_at/last_active_at，同事务 commit。
  - **先写测试** `test_close_interactive_run_session_status.py`：4 case（单轮 completed→session ended / 单轮 failed→session failed / 多轮→session active 保持 / session 已 ended 幂等不覆盖）。
  - 守护：:1039 的 session query 属 `_resolve_gate_workspace_id`（commit 后），**不可复用**（D-009）。

## W2 — 病灶C：cancel_lease + MissionControl.cancel 收口（依赖 W1 task-01）

- **task-03 cancel_lease interactive 分支收口 + 测试**：design §7.3 / D-003 / D-008。
  - `lease_service.py:281` cancel_lease 在 set `run=killed` + `lease=cancelled`（+ WS SESSION_INTERRUPT）之后，门控 `lease.kind=='interactive' AND agent_run.agent_session_id is not None AND session.status in ('pending','active','reconnecting')`，UPDATE `session.status='ended'` + `ended_at`。
  - 覆盖所有 interactive-kind lease（含 stage/scan/quick-chat，D-008），不额外排除批量路径。
  - **先写测试** `test_cancel_lease_session.py`：interactive 收口 session=ended / session 已 ended 幂等 / **stage cancel 回归**（session 收口但不破坏 stage 生命周期）/ **scan cancel 回归**。
  - MissionControl.cancel（control.py:108）经 cancel_lease 自动覆盖，无需单独改（D-006 证实），加 1 个 mission cancel 集成 case。

## W3 — 历史僵尸数据迁移

- **task-04 alembic data migration + 测试**：design §5 Wave3 / D-004。
  - 新建 `backend/migrations/versions/20260713_fix_session_zombie.py`，revision id 唯一化，`down_revision='20260712_team_orch'`。
  - **execute 前先 `cd backend && uv run alembic heads` 实测确认单 head**（R-04；Design Grill 已核实当前单 head，但防并行变更偏移）。
  - upgrade：4 类 run 终态映射 UPDATE（completed→ended / failed→failed / killed→ended / 无 run→ended）+ ended_at=COALESCE(run.finished_at, now)。
  - down：标注不可逆（附 status 快照注释，不写回滚 SQL）。
  - **先写测试** `test_session_zombie_migration.py`：构造 4 类 pending 僵尸 fixture，跑 upgrade 断言映射正确。

## W4 — 前端 + 回归验收

- **task-05 前端 pending 文案（P2 可选）**：design §6 / FR-4。
  - `session-list-layout.tsx:67` `pending: "待处理"` → `pending: "启动中"`。`isActiveBadge` 不变。
  - 同步 `__tests__` 快照（若有）。

- **task-06 全量回归 + verify**：AC-1~AC-5。
  - `cd backend && uv run pytest -q --cov=app --cov-fail-under=60` 全绿。
  - （task-05 做则）`cd frontend && pnpm test` 全绿。
  - verify DB 实测：重跑场景后 `SELECT count(*) FROM agent_sessions WHERE status='pending' AND deleted_at IS NULL` 仅含真正 dispatch 中瞬时行（AC-1）。
  - 守护 test_interactive_lifecycle_patch / test_interactive_session_placement / change-detail-session 测试零回归。

## 共改文件协调

- `backend/app/modules/daemon/session/service.py`：task-01 新增辅助函数（W1 先行，task-02/03 依赖）。
- `run_sync/service.py`（task-02）/ `lease_service.py`（task-03）/ migration（task-04）各自独立文件，W1→W2→W3 串行避免冲突。
- 全部依赖 task-01 的 `_apply_session_terminal_status`，W1 必须先行完成。
