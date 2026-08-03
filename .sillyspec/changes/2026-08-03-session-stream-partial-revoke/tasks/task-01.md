---
id: task-01
title: service.py published_logs(:595)+session_payload(:164) 加 segment_id 字段，取 log_entry.segment_id（complete 行 None）
title_zh: SSE envelope 透传 segment_id 字段
author: WhaleFall
created_at: 2026-08-03 10:23:11
priority: P0
depends_on: []
blocks: [task-02, task-03]
requirement_ids: [FR-01]
decision_ids: [D-001@v1, D-003@v1]
allowed_paths:
  - backend/app/modules/daemon/run_sync/service.py
provides:
  - contract: SessionStreamEnvelope(SSE) / published_logs entry
    fields: [segment_id, stale]
expects_from: []
goal: >
  让 SSE session envelope 和 run channel published_logs 都带上 segment_id 字段，前端可据此识别「哪条是半截」。
implementation:
  - service.py:595 published_logs.append({...}) 字典里追加 "segment_id": log_entry.segment_id（取 log_entry 实例字段，complete 行为 None）。
  - service.py:164-180 publish_submitted_messages 的 session_payload 同步追加 "segment_id": log_payload.get("segment_id")（.get() 兼容 override envelope 与历史 payload）。
  - 确认完整链路：submit_messages 返回 SubmittedMessages（含 published_logs）→ router.py:1033 commit 后调 publish_submitted_messages → 两路 Redis publish（agent_run channel 整 payload + session channel session_payload）都带上 segment_id。
  - 不动 log_entry 构造（:591 已写 segment_id=segment_id if is_partial else None），仅补 SSE 透传字段。
acceptance:
  - published_logs 字典含 "segment_id" 键，值为 log_entry.segment_id（partial 行非空 "main:msg_xxx:N" / complete 行 None）。
  - session_payload 含 "segment_id" 键，与 published_logs 对齐。
  - complete 行 segment_id 为 None，partial 行非空。
verify:
  - cd backend && pytest app/modules/daemon/tests/test_run_sync_assistant_override.py -v
  - cd backend && ruff check app/modules/daemon/run_sync/service.py
  - cd backend && mypy app/modules/daemon/run_sync/service.py
constraints:
  - "D-003：segment_id 透传必须取 log_entry.segment_id（complete 行 None），切勿用循环顶部局部变量 segment_id（其值来自 metadata.segmentId，complete 行也非 None，会让前端误判 complete 为半截）。"
  - 不改 schema、不改 daemon emit、不改 AgentRunLogEntry DTO（历史 GET 不返回该字段，design §3/§2.4）。
  - 向下兼容：旧前端忽略新字段无副作用（design §9）。
---
