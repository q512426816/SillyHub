---
id: task-14
title: backend 持久化 segment_id + 跨 submit_messages 调用 override DELETE 已落库 partial
title_zh: 后端持久化 segmentId 并跨调用按覆盖信号删除已落库的半截行
author: WhaleFall
created_at: 2026-07-31T09:08:42
priority: P0
depends_on: [task-08]
blocks: []
requirement_ids: [FR-02]
decision_ids: [D-002@v1]
allowed_paths:
  - backend/app/modules/agent/model.py
  - backend/app/modules/daemon/run_sync/service.py
  - backend/migrations/versions/202608310900_agent_run_log_segment_id.py
  - backend/app/modules/daemon/tests/test_run_sync_assistant_override.py
provides:
  - contract: CrossCallOverrideDelete
    fields: [segment_id_column, partial_persists_segment_id, override_db_delete, complete_row_preserved]
goal: >
  task-08 的 override 回退只在单次 submit_messages 调用内生效（expunge 撤销 pending）。
  实跑发现：daemon 流式 partial（半截）与完整 message + override 信号是分两次 submit_messages
  到达——partial 在第一次调用已 commit 落库，override 在第二次调用到达时，flushed_partials
  是函数内局部变量跨调用不共享、且 partial 已 persisted 无法 expunge（session.delete 需
  re-load），AgentRunLog 又无 segment_id 列定位已落库行 → override 删不掉已落库半截 →
  回复仍重复。本任务持久化 segment_id 并在 override 信号到达时跨调用 DB DELETE 已落库
  partial，让 DB 只剩完整行（#35 累积重复消除）。
implementation:
  - model.py AgentRunLog 加 segment_id 列（String(200), nullable, sa_column + __table_args__ 加
    Index("ix_agent_run_logs_segment_id", "segment_id")）。只 partial 行写值，complete 行 NULL。
  - 新增 alembic migration 202608310900_agent_run_log_segment_id.py，down_revision='202607301000'
    （当前真实 head），op.add_column + op.create_index，downgrade 反向。
  - service.py submit_messages 写入循环：log_entry 加 segment_id=segment_id if is_partial else None
    （complete 行不存，DELETE by segment_id 天然只命中 partial）。
  - service.py 新增私有 async helper _revoke_committed_partials(agent_run_id, segment_id)：select
    同 segment_id 已落库 partial 行 + session.delete（ORM 级，正确同步 identity map，非 bulk delete），
    记 info 日志含 deleted 行数。
  - [ASSISTANT_OVERRIDE]（service.py:405-419）与 [THINKING_OVERRIDE]（:378-394）两块在现有
    同调用 expunge 之后，均调 _revoke_committed_partials 跨调用删已 commit partial（对齐 thinking，
    assistant 与 thinking 共享同 segmentId 去重空间，daemon 保证两者 segmentId 不撞）。
acceptance:
  - AgentRunLog 有 segment_id 列；partial 行落库时 segment_id = metadata.segmentId，complete 行 NULL
  - [ASSISTANT_OVERRIDE]/[THINKING_OVERRIDE] 信号到达时，跨 submit_messages 调用 DELETE 已落库同
    segmentId partial（partial 在调用 A commit，override 在调用 B 到达 → 调用 B 后 DB 无该 partial）
  - complete 行（segment_id NULL）不被误删（override 只命中 segment_id 非空 = partial 行）
  - 现有单调用内用例（expunge 回退、late partial 丢弃、override 不落库、不串扰）不回归
  - cd backend && uv run pytest tests/modules/daemon -q --no-cov 通过；uv run mypy app/modules/daemon 通过
verify:
  - cd backend && uv run pytest tests/modules/daemon -q --no-cov
  - cd backend && uv run alembic heads（确认新 migration 为唯一 head）
constraints:
  - 跨调用删除用 select + session.delete（非 bulk delete()），保证同 session 跨调用 identity map 一致
  - segment_id 只在 partial 行写值（complete 行 NULL），DELETE by segment_id 无需 is_partial 列、不误删完整行
  - 不改 [THINKING_OVERRIDE]/[ASSISTANT_OVERRIDE] 现有同调用 expunge 逻辑（只新增跨调用 DELETE）
  - 不改前端（live SSE 已 push 的旧 partial 无法 unpublish，靠 DB 真相 + 重新拉取收敛，本轮范围 backend DELETE）
---

## 实现说明

### 根因（task-08 不彻底的原因）

service.py 的 override 回退（:378-394 thinking / :405-419 assistant）用 `flushed_partials.pop` +
`self._session.expunge(stale)`。两个限制：

1. **局部变量跨调用不共享**：`flushed_partials`（service.py:346）是 submit_messages 函数内局部 dict。
   partial 在调用 A 落库后 dict 就销毁；override 在调用 B 到达时 pop 不到。
2. **expunge 只撤 pending**：调用 A 的 partial 已 commit（persisted），expunge 无效；session.delete 需
   先 re-load 对象。且 AgentRunLog 无 segment_id 列，调用 B 根本找不到调用 A 落库的 partial。

### 方案

持久化 segment_id 列（只 partial 行写值），override 信号到达时按 segment_id select + session.delete
已落库 partial。complete 行 segment_id=None 不受影响。

### 调用时序验证（设计推演）

- 同调用（partial + override 一次到达）：partial pending → expunge 撤销 → DELETE 查不到（未 commit）→ 无副作用。
- 跨调用（partial 调用 A commit，complete+override 调用 B）：调用 B override 触发 DELETE → 命中调用 A 的
  已 commit partial（segment_id=X）→ 删除；complete 行（segment_id=None）保留。DB 只剩完整行。
- 跨调用（complete 调用 B，override 调用 C）：调用 C override DELETE → 命中调用 A partial；complete（B）保留。
