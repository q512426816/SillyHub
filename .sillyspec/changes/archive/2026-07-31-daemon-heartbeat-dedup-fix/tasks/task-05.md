---
id: task-05
title: partial flush assistant 带 segmentId
title_zh: assistant 流式半截 flush 携带 segmentId 对齐 thinking
author: WhaleFall
created_at: 2026-07-30 16:36:00
priority: P0
depends_on: []
blocks: [task-07, task-12]
requirement_ids: [FR-02]
decision_ids: [D-002@v1]
allowed_paths:
  - sillyhub-daemon/src/interactive/session-manager.ts
provides:
  - contract: AssistantPartialSegmentId
    fields: [segmentId, isPartial, flushedSegments_push, metadata_shape]
goal: >
  partial flush 的 assistant 行带 segmentId（对齐 thinking :2697-2712），使其能被 override 撤回，消除已 flush 半截 + 完整全文双发。
implementation:
  - session-manager.ts:2714-2722 partial flush assistant 分支，给 formatted 加 metadata（segmentId + isPartial: true），对齐 thinking 分支 :2697-2712 的 metadata 结构
  - assistant segmentId 格式与 task-06 _extractCompletedSegments 对齐（同 message 的 assistant text block segmentId），保证 override 能命中
  - push 到 buf.flushedSegments（对齐 thinking），供 _emitOverrideSignals 撤回
  - 不加 thinking:true（assistant 不是 thinking，B2）
acceptance:
  - partial flush assistant 行含 metadata.segmentId + isPartial:true
  - segmentId 与完整 message 的 assistant text block segmentId（task-06）一致
  - push flushedSegments
  - cd sillyhub-daemon && pnpm typecheck 通过
verify:
  - cd sillyhub-daemon && pnpm typecheck
constraints:
  - segmentId 格式必须与 task-06 _extractCompletedSegments 一致（跨 task 契约，task-07 依赖）
  - 不加 thinking:true（B2，否则被 thinking override 误撤）
  - 不改 thinking partial 分支（:2697-2712）
---
