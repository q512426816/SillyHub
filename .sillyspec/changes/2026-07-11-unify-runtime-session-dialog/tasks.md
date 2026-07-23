---
author: qinyi
created_at: 2026-07-11 23:37:00
---

# 任务清单（Tasks，brainstorm 粗粒度 — plan 阶段细化为 Wave）

> 以下为 brainstorm 产出的粗任务清单，按 Phase 分组。`sillyspec run plan` 会据此拆解为可执行的 Wave/TaskCard（含依赖、验收标准）。

## Phase 1 — 后端：软删 + list title

- **T1**：`AgentSession` 加 `deleted_at` 字段 + 索引（`backend/app/modules/agent/model.py`）
- **T2**：Alembic migration（`down_revision = 419d34f8e33f`，开工前 `alembic heads` 复核；upgrade 加列+索引，downgrade 删）
- **T3**：`delete_agent_session` 改 `UPDATE deleted_at`；删除 service.py:1560-1564 断 `agent_runs.agent_session_id` 外键代码（C-7）
- **T4**：`list_agent_sessions` / `list_change_sessions` / `get_agent_session` 过滤 `deleted_at IS NULL`
- **T5**：`list_agent_sessions` 返回值补 `title`（首条 user_input 摘要前 30 字，复用 `list_change_sessions` 逻辑，抽共享 helper）；`AgentSessionRead` schema + 前端 `lib/daemon.ts` 加 `title`/`deleted_at`
- **T6**：后端测试：`test_session_delete_active.py` 断言改软删（行在 + deleted_at 非空 + agent_runs 外键未断）；list 软删过滤用例；list title 用例

## Phase 2 — 前端公共件

- **T7**：新增 `session-list-layout.tsx`（`SessionListLayout` + `SessionListEntry` 类型，圆角卡片/选中/可选删除）
- **T8**：抽 `sanitizeSessionLogContent(content, channel)` 到 `runtime-session-helpers.tsx`；`renderLogContent`（interactive-session-panel）+ `logsToTurns` 改调它
- **T9**：`SessionListLayout` 单测（选中/删除回调/空态/error 重试）

## Phase 3 — 前端重构

- **T10**：`RuntimeSessionDialog` 重构：左侧换 `SessionListLayout`（带 onDelete）、右侧去「返回历史」栏直接挂 panel、删 `SessionHistoryView` 分支、`handleSelect` 对 ended/failed 先 reopen 再 attach
- **T11**：`ChangeSessionSection` 改用 `SessionListLayout`（不传 onDelete）+ ended/failed 先 reopen 再 attach
- **T12**：`logsToTurns` 内容重复修复（execute 时真实会话复现定位根因，C-4/F-3）
- **T13**：`runtime-session-dialog` 交互测试（点 ended 直接续聊/删除回调/新建切 idle）；`change-session-section` 回归

## Phase 4 — 验证

- **T14**：前端全量 `pnpm test` + `tsc --noEmit`；后端 `ruff check && mypy app && pytest`
- **T15**：playwright 端到端（attach 历史 BUG 消失 + 删除软删 deleted_at 非空 + 样式与变更会话一致 + ended/failed 直接续聊）

## 依赖

- T10/T11 依赖 T7（SessionListLayout）
- T10/T11 依赖 T5（title 字段）
- T8 是 T12 前置（共享 sanitize）
- T2 依赖 alembic head 复核（C-1）
- T15 是全链路验收，依赖 T1-T13 全完成
