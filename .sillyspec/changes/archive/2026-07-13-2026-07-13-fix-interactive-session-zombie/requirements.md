---
author: qinyi
created_at: 2026-07-13T16:30:42
---

# 需求规格 — 修复交互式会话僵尸状态

## 角色与场景

| 角色 | 说明 |
|---|---|
| 平台用户 | 在 runtimes / 变更详情页发起交互式会话，期望会话状态准确反映"启动中/进行中/已结束/失败"，不被僵尸 pending 误导 |
| 系统任务 | stage/scan/mission worker/quick-chat 经批量路径创建单轮会话，turn 完成应自动收口 ended/failed |
| daemon | 本机守护进程，回传 run 终态（notifyRunResult），本次零改动 |

## 功能需求

### FR-1 close_interactive_run 回写 session 终态（病灶B，含A）

`close_interactive_run`（run_sync/service.py:730）收到 daemon run 终态通知后，在 run 终态 commit（:929）同事务内回写所属 `AgentSession.status`（D-009 commit 前新 query，非复用 :1039）：

- **多轮对话**（`spec_strategy=='interactive' AND change_id is None`）→ `active`（保持，等下一个 AgentRun）
- **单轮任务**（其余全部：stage/scan/mission worker/quick-chat/oneshot）→ run.completed=`ended` / run.failed=`failed`
- **幂等**（D-005）：`session.status in ('ended','failed')` 不覆盖

判定依据 D-002@v2 反向判定表（design §7.1）。

### FR-2 cancel_lease + MissionControl.cancel 收口 session（病灶C）

`cancel_lease`（lease_service.py:281）interactive 分支 set `run=killed` + `lease=cancelled` 后，UPDATE `session.status='ended'` + `ended_at`（D-003 kill=正常终止）。`MissionControl.cancel`（control.py:108）经 cancel_lease 自动覆盖。

门控 `lease.kind=='interactive'` 覆盖**所有 interactive-kind lease**（含 stage/scan/quick-chat 批量路径，D-008），语义正确（取消即结束 session）。

### FR-3 历史僵尸数据迁移（数据清理）

alembic data migration（`down_revision='20260712_team_orch'`，官方 `alembic heads` 核实单 head）按映射清理 `status='pending' AND deleted_at IS NULL`：

| run.status | → session.status |
|---|---|
| completed | ended |
| failed | failed |
| killed | ended（D-003） |
| 无 run（孤儿） | ended |

同步 `ended_at = COALESCE(run.finished_at, now)`。down 标注不可逆。

### FR-4 前端 pending 徽标文案（P2 可选）

`session-list-layout.tsx:67` pending 文案"待处理"→"启动中"。`isActiveBadge` 逻辑保留（瞬时态合理）。同步快照测试。

## 非功能需求

- **NFR-1**：sillyhub-daemon 零改动（D-006）。
- **NFR-2**：Windows/Linux/macOS 兼容（CLAUDE.md 规则 13）。
- **NFR-3**：零回归——现有 interactive lifecycle / change-detail-session / placement 测试全绿。
- **NFR-4**：backend 测试覆盖率 ≥ 60%（CONVENTIONS）。

## 验收标准（AC）

- **AC-1**：DB 实测 `SELECT count(*) FROM agent_sessions WHERE status='pending' AND deleted_at IS NULL` 仅含真正 dispatch 中的瞬时行（背后 run 为 running/pending），无僵尸。
- **AC-2**：close_interactive_run 回写 4 case 单测通过（单轮 ended / 单轮 failed / 多轮 active 保持 / 幂等不覆盖已 ended）。
- **AC-3**：cancel_lease interactive 收口 session=ended；stage cancel / scan cancel 回归不破坏现有生命周期。
- **AC-4**：data migration 映射正确性测试通过（4 类 run 终态 + 孤儿）。
- **AC-5**：现有测试零回归（test_interactive_lifecycle_patch / test_interactive_session_placement / change-detail-session 全绿）。
