---
id: task-08
title: backend 给 assistant text block 打 segmentId + 识别 ASSISTANT_OVERRIDE 删 partial
title_zh: 后端 assistant 文本块打 segmentId 并识别覆盖信号删除半截
author: WhaleFall
created_at: 2026-07-30 16:36:00
priority: P0
depends_on: [task-07]
blocks: [task-12]
requirement_ids: [FR-02]
decision_ids: [D-002@v1]
allowed_paths:
  - backend/app/modules/daemon/run_sync/service.py
provides:
  - contract: AssistantOverrideDedup
    fields: [recognize_signal, delete_partial, segmentId_metadata, expunge_rollback]
expects_from:
  task-07:
    - contract: AssistantOverrideSignal
      needs: [signal_prefix, segmentId, metadata_no_thinking_flag]
goal: >
  backend _extract_sdk_messages 给 assistant text block 打 segmentId，并识别 [ASSISTANT_OVERRIDE] 信号删除同 segmentId 的 assistant partial 行（对齐 thinking flushed_partials :374-394/:432-448），消除 #35 双发。
implementation:
  - service.py:1834-1845 _extract_sdk_messages 的 btype=='text' 分支，给 assistant text block 加 metadata（segmentId 用 f'{msg_id}:{idx}'、isComplete: True），对齐 thinking :1847-1866 的 segmentId 打法
  - service.py:374-394 新增识别 [ASSISTANT_OVERRIDE] <segmentId>（对齐 [THINKING_OVERRIDE] 识别模板）：completed_segments.add(segment_id) + flushed_partials.pop + expunge 回滚 + 从 published_logs 过滤 + continue 不落库
  - 复用现有去重判定 1/2（:432-448），assistant 走同一 segment_id 机制
acceptance:
  - assistant text block 含 metadata.segmentId（与 daemon task-05/06/07 segmentId 格式对齐）
  - 识别 [ASSISTANT_OVERRIDE] 删同 segmentId 的 assistant partial（expunge 回滚，不 session.delete）
  - override 信号本身不落库（continue）
  - thinking override 链路不变
  - cd backend && uv run pytest tests/modules/daemon -q --no-cov 通过
verify:
  - cd backend && uv run pytest tests/modules/daemon -q --no-cov
  - cd backend && uv run mypy app/modules/daemon
constraints:
  - 回滚用 self._session.expunge（pending 未 flush，session.delete 会 InvalidRequestError），对齐 thinking 模板
  - segmentId 格式必须与 daemon task-05/06/07 完全一致（R-3，否则漏删）
  - 不改 [THINKING_OVERRIDE] 识别（:374-394 现有逻辑保留，新增 [ASSISTANT_OVERRIDE] 分支）
---
