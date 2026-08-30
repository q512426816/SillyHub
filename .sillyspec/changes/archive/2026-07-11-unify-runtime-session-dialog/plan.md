---
plan_level: full
author: qinyi
created_at: 2026-07-11 23:42:00
---

# 实现计划（Plan）

## Spike 前置验证

| Spike | 验证内容 | 通过标准 | 不通过后果 |
|---|---|---|---|
| spike-01 | attach 历史会话内容重复根因（`logsToTurns` 预填 vs daemon SSE 重放去重） | 真实会话复现，定位是 seenLogIds 不同源还是 logsToTurns 自身重复拼接 | task-12 就地按真实根因修复，不阻塞其他任务 |

> spike-01 在 Wave 3 task-12 内执行（开 task-12 第一步先复现），不单独成 Wave。

## Wave 1（后端基础，并行无内部依赖）

- [ ] task-01: AgentSession 加 deleted_at 字段 + 索引（覆盖：FR-05, D-003）
- [ ] task-02: Alembic migration add_agent_sessions_deleted_at（覆盖：FR-05, R-1）
- [ ] task-03: delete_agent_session 改 UPDATE 软删 + 移除断 agent_runs 外键代码（覆盖：FR-06, D-003, R-4）
- [ ] task-04: list_agent_sessions/list_change_sessions/get_agent_session 过滤 deleted_at IS NULL（覆盖：FR-07）
- [ ] task-05: list_agent_sessions 补 title + AgentSessionRead 加 title/deleted_at（覆盖：FR-08, D-006, 前端 lib/daemon.ts 同步）
- [ ] task-06: 后端测试（test_session_delete_active 软删断言 + list 软删过滤 + list title）（覆盖：FR-05/06/07/08）

## Wave 2（前端公共件，依赖 Wave 1 task-05 的 title 类型）

- [ ] task-07: 新增 SessionListLayout + SessionListEntry 类型（覆盖：FR-01, D-001）
- [ ] task-08: 抽 sanitizeSessionLogContent 共享纯函数；renderLogContent + logsToTurns 改调它（覆盖：FR-04, D-004）
- [ ] task-09: SessionListLayout 单测 + logsToTurns 标记过滤单测（覆盖：FR-01, FR-04）

## Wave 3（前端重构，依赖 Wave 2）

- [ ] task-10: RuntimeSessionDialog 重构（左侧 SessionListLayout + 右侧去返回栏直接 panel + 删只读回看 + ended/failed 先 reopen 再 attach）（覆盖：FR-02, D-002, D-005）
- [ ] task-11: ChangeSessionSection 改用 SessionListLayout + ended/failed 先 reopen 再 attach（覆盖：FR-03, R-6）
- [ ] task-12: logsToTurns 内容重复修复（含 spike-01 复现）（覆盖：FR-04, R-3）
- [ ] task-13: runtime-session-dialog 交互测试 + change-session-section 回归（覆盖：FR-02, FR-03）

## Wave 4（端到端验证，依赖全部）

- [ ] task-14: 前端全量 pnpm test + tsc --noEmit；后端 ruff check + mypy app + pytest（覆盖：全局质量门）
- [ ] task-15: playwright 端到端（attach BUG 消失 + 软删 deleted_at 非空 + 样式一致 + ended/failed 续聊）（覆盖：成功标准）

## 任务总表

| 编号 | 任务 | Wave | 优先级 | 依赖 | 覆盖 FR/D | 说明 |
|---|---|---|---|---|---|---|
| task-01 | AgentSession.deleted_at 模型字段 | W1 | P0 | — | FR-05, D-003 | agent/model.py + 索引 |
| task-02 | Alembic migration | W1 | P0 | task-01 | FR-05, R-1 | down_revision=419d34f8e33f，开工前 alembic heads 复核 |
| task-03 | delete 改软删 + 清断外键代码 | W1 | P0 | task-01 | FR-06, D-003, R-4 | service.py:1513；删 1560-1564 |
| task-04 | list/get 过滤软删 | W1 | P0 | task-01 | FR-07 | service.py + change/router.py |
| task-05 | list 补 title + schema | W1 | P0 | — | FR-08, D-006 | 抽共享 title helper；前端 daemon.ts |
| task-06 | 后端测试 | W1 | P0 | task-01~05 | FR-05~08 | test_session_delete_active + list 用例 |
| task-07 | SessionListLayout 公共组件 | W2 | P0 | task-05 | FR-01, D-001 | session-list-layout.tsx |
| task-08 | sanitizeSessionLogContent 共享 | W2 | P0 | — | FR-04, D-004 | runtime-session-helpers + panel |
| task-09 | 公共件单测 | W2 | P0 | task-07,08 | FR-01, FR-04 | session-list-layout + logsToTurns |
| task-10 | RuntimeSessionDialog 重构 | W3 | P0 | task-05,07,08 | FR-02, D-002, D-005 | 二态化 + reopen |
| task-11 | ChangeSessionSection 改造 | W3 | P0 | task-05,07 | FR-03, R-6 | 改用公共组件 + reopen |
| task-12 | logsToTurns 重复修复（含 spike-01） | W3 | P0 | task-08 | FR-04, R-3 | 先复现再改 |
| task-13 | dialog 测试 + change-section 回归 | W3 | P0 | task-10,11 | FR-02, FR-03 | runtime-session-dialog 交互测试新增 |
| task-14 | 全量类型/单测/lint | W4 | P0 | task-01~13 | 质量门 | tsc/ruff/mypy/vitest/pytest |
| task-15 | playwright 端到端 | W4 | P0 | task-14 | 成功标准 | 4 项 e2e 验收 |

## 关键路径

task-02（migration）→ task-05（title/schema）→ task-07（公共组件）→ task-10（dialog 重构）→ task-14（全量门）→ task-15（e2e）

最长路径决定交付周期。task-03/04/06/08/09/11/12/13 可与关键路径并行（同 Wave 内或依赖前置完成后即可起）。

## 全局验收标准

- [ ] 后端 `uv run ruff check && uv run ruff format --check && uv run mypy app` 通过
- [ ] 后端 `uv run pytest`（daemon session + change 用例）全绿，覆盖率 ≥60%
- [ ] 前端 `pnpm tsc --noEmit` 通过
- [ ] 前端 `pnpm test`（SessionListLayout/runtime-session-dialog/logsToTurns/change-session-section/interactive-session-panel）全绿
- [ ] Alembic `upgrade head` + `downgrade -1` 均成功（可逆）
- [ ] playwright：`/runtimes?session=<active>` attach 历史，消息区无 `[SYSTEM:thinking_tokens]`/`[THINKING]`、无重复内容
- [ ] playwright：点 ended/failed 会话直接进续聊面板（无返回栏、无只读回看）
- [ ] playwright：点删除后会话从列表消失；DB `agent_sessions.deleted_at` 非空、行在、`agent_runs.agent_session_id` 未断
- [ ] playwright：runtimes 弹窗列表样式与变更会话区块视觉一致
- [ ] 变更会话区块零回归（除 ended/failed 现支持直接续聊）

## 覆盖矩阵

| ID | 覆盖任务 | 验收证据 |
|---|---|---|
| D-001（抽 SessionListLayout） | task-07, task-10, task-11 | SessionListLayout 单测 + 两处接线 |
| D-002（ended/failed 先 reopen） | task-10, task-11 | dialog 测试断言 reopen 被调 |
| D-003（deleted_at 软删） | task-01, task-02, task-03, task-04, task-06 | migration + 软删断言 |
| D-004（共享 sanitize） | task-08, task-09 | logsToTurns 标记过滤单测 |
| D-005（列表字段无作者） | task-10 | dialog secondaryText=提供方·轮数 |
| D-006（list title 复用） | task-05 | 共享 title helper 两端点共用 |
| FR-01 | task-07, task-09 | SessionListLayout |
| FR-02 | task-10, task-13 | dialog 二态化 |
| FR-03 | task-11, task-13 | change-section 改造 |
| FR-04 | task-08, task-09, task-12 | sanitize + 重复修复 |
| FR-05 | task-01, task-02, task-06 | deleted_at 字段 |
| FR-06 | task-03, task-06 | 软删 + 清断外键 |
| FR-07 | task-04, task-06 | list/get 过滤 |
| FR-08 | task-05, task-06 | title 字段 |
