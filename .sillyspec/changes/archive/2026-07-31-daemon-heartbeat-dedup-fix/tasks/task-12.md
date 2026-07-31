---
id: task-12
title: assistant override 删 partial 测试（daemon + backend）
title_zh: assistant 覆盖撤回半截去重测试对齐 thinking
author: WhaleFall
created_at: 2026-07-30 16:36:00
priority: P0
depends_on: [task-07, task-08]
blocks: [task-13]
requirement_ids: [FR-02]
decision_ids: [D-002@v1]
allowed_paths:
  - sillyhub-daemon/tests/interactive/session-manager.test.ts
  - backend/tests/modules/daemon/test_run_sync_assistant_override.py
provides:
  - contract: AssistantOverrideDedupTest
    fields: [daemon_emit, backend_delete, no_duplicate]
expects_from:
  task-07:
    - contract: AssistantOverrideSignal
      needs: [signal_prefix, segmentId, metadata_no_thinking_flag]
  task-08:
    - contract: AssistantOverrideDedup
      needs: [recognize_signal, delete_partial, segmentId_metadata]
goal: >
  assistant override 删 partial 端到端去重测试（daemon emit [ASSISTANT_OVERRIDE] + backend 删同 segmentId partial），对齐 thinking 机制，验证 #35 双发消除。
implementation:
  - daemon session-manager.test.ts：断言 assistant 完整 message 到达 emit [ASSISTANT_OVERRIDE] <segmentId>、metadata 不含 thinking:true
  - backend test_run_sync_assistant_override.py：构造 assistant partial（带 segmentId）+ [ASSISTANT_OVERRIDE] 信号，断言 partial 被 expunge 回滚、不重复落库、override 信号不落库；对照 thinking override 用例保持一致
  - 覆盖 segmentId 透传一致性（daemon 与 backend 同格式）
acceptance:
  - daemon emit [ASSISTANT_OVERRIDE] 信号正确
  - backend 删同 segmentId assistant partial（expunge），无重复落库
  - 对齐 thinking override 行为
  - daemon pnpm test + backend pytest 通过
verify:
  - cd sillyhub-daemon && pnpm test tests/interactive/session-manager.test.ts
  - cd backend && uv run pytest tests/modules/daemon/test_run_sync_assistant_override.py -q --no-cov
constraints:
  - segmentId 跨 daemon/backend 一致（R-3）
  - 对齐 thinking 现有 override 测试（不发明新断言模式）
  - 测试逻辑有误改实现不改测试（CLAUDE.md #9）
---
