---
id: task-07
title: _emitOverrideSignals 扩 emit ASSISTANT_OVERRIDE
title_zh: override 信号扩展撤回 assistant 完整消息
author: WhaleFall
created_at: 2026-07-30 16:36:00
priority: P0
depends_on: [task-05, task-06]
blocks: [task-08, task-12]
requirement_ids: [FR-02]
decision_ids: [D-002@v1]
allowed_paths:
  - sillyhub-daemon/src/interactive/session-manager.ts
provides:
  - contract: AssistantOverrideSignal
    fields: [signal_prefix, segmentId, metadata_no_thinking_flag, channel_stdout]
expects_from:
  task-05:
    - contract: AssistantPartialSegmentId
      needs: [segmentId, isPartial, flushedSegments_push]
  task-06:
    - contract: AssistantCompletedSegmentId
      needs: [text_block_segmentId, format]
goal: >
  _emitOverrideSignals 扩展：assistant 完整 message 到达时 emit [ASSISTANT_OVERRIDE] <segmentId>（对齐 [THINKING_OVERRIDE]），让 backend 撤回同 segmentId 的 assistant partial 半截，metadata 不误打 thinking:true。
implementation:
  - session-manager.ts:2828-2849 _emitOverrideSignals，对 assistant completed segments（task-06）emit [ASSISTANT_OVERRIDE] ${segmentId}
  - 对齐现有 [THINKING_OVERRIDE] 的 emit 结构（onTurnMessage + content 前缀 + channel stdout）
  - metadata 不加 thinking:true（assistant override 用 assistant 语义，B2：避免被 thinking 链路误处理）
  - assistant override 的 segmentId 来自 task-06 提取 + task-05 flushedSegments
acceptance:
  - assistant 完整 message 到达 emit [ASSISTANT_OVERRIDE] <segmentId>
  - metadata 不含 thinking:true
  - thinking override 分支不变
  - cd sillyhub-daemon && pnpm typecheck 通过
verify:
  - cd sillyhub-daemon && pnpm typecheck
constraints:
  - **B2**：metadata 严禁 thinking:true（否则 backend thinking 链路误撤）
  - 信号格式 [ASSISTANT_OVERRIDE] <segmentId> 必须与 task-08 backend 识别一致（R-3 跨层契约）
  - 不改 [THINKING_OVERRIDE] 既有逻辑
---
