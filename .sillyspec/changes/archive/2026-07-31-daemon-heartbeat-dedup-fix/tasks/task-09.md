---
id: task-09
title: interactive 转发 dedup_key 补 seq
title_zh: interactive 消息转发 dedup_key 用确定性 seq 兜底
author: WhaleFall
created_at: 2026-07-30 16:36:00
priority: P0
depends_on: []
blocks: []
requirement_ids: [FR-02]
decision_ids: [D-002@v1]
allowed_paths:
  - sillyhub-daemon/src/daemon.ts
  - sillyhub-daemon/src/resilience/error-classify.ts
provides:
  - contract: DeterministicDedupKey
    fields: [seq_based, deterministic, no_timestamp_fallback]
goal: >
  interactive 转发的 dedup_key 补 seq（确定性），不退化 timestamp，双保险防重发不能命中 backend ON CONFLICT 去重。
implementation:
  - daemon.ts:1605 调用 dedupKeyFor 时补传 turnSeq/flatSeq（或在 interactive 转发处维护一个确定性 seq 计数），使其走 runId:turnSeq:flatSeq 分支而非退化 runId:timestamp
  - error-classify.ts:88-101 dedupKeyFor 保留现有优先级（msg.id 优先 → seq → timestamp 兜底），确认调用方传入 seq
  - 与 backend dedup_key ON CONFLICT 机制对齐（重发同 key 命中去重）
acceptance:
  - interactive 转发的 dedup_key 在无 msg.id 时走 seq 分支（确定性），不退化 timestamp
  - 相同消息重发产生相同 dedup_key
  - cd sillyhub-daemon && pnpm typecheck 通过
verify:
  - cd sillyhub-daemon && pnpm typecheck
constraints:
  - 双保险：assistant override（task-07/08）是主修复，dedup_key seq 是辅助兜底
  - daemon.ts 与 task-03/04 同文件改不同位置（:1605 vs :1930/:2010），Wave2 在 Wave1 之后顺序执行不冲突
  - msg.id 优先级保留（Claude message id 仍是最优 dedup_key）
---
