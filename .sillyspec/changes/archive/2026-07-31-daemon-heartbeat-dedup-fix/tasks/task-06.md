---
id: task-06
title: _extractCompletedSegments 扩 assistant text block
title_zh: 提取已完成段扩展处理 assistant 文本块
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
  - contract: AssistantCompletedSegmentId
    fields: [text_block_segmentId, format, block_type_text]
goal: >
  _extractCompletedSegments 不再只处理 block.type==='thinking'，扩展处理 assistant text block，为完整 message 到达时 emit override 提供 segmentId。
implementation:
  - session-manager.ts:2469-2491 _extractCompletedSegments，循环 content 时增加 block.type==='text' 分支，拼 assistant segmentId
  - assistant text block segmentId 格式与 task-05 partial flush 对齐（同 message 同 block 索引），保证 partial 与 complete 同 segmentId
  - 参考现有 thinking segmentId 拼法（mid ? parentKey:mid:i : ...）对 assistant text 用同结构
acceptance:
  - assistant text block 被提取为 completed segment（segmentId）
  - segmentId 与 task-05 partial flush 的 assistant segmentId 一致
  - thinking 分支不变
  - cd sillyhub-daemon && pnpm typecheck 通过
verify:
  - cd sillyhub-daemon && pnpm typecheck
constraints:
  - segmentId 格式与 task-05 严格一致（override 命中前提）
  - 不改 thinking 分支
  - 同文件与 task-05 改不同方法（:2469 vs :2714），由 task-07 汇合依赖保证顺序
---
