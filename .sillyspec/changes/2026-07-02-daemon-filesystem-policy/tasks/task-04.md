---
id: task-04
title: policy/audit-sink.ts Audit 批量上报
author: WhaleFall
created_at: 2026-07-02T15:12:00
priority: P0
depends_on: []
blocks: [task-05]
allowed_paths:
  - sillyhub-daemon/src/policy/audit-sink.ts
  - sillyhub-daemon/tests/policy/audit-sink.test.ts
change: 2026-07-02-daemon-filesystem-policy
goal: "(见 body)"
implementation: "(见 body)"
acceptance: "(见 body)"
verify: "(见 body)"
constraints: "(见 body)"
---

# task-04

> goal: Audit 批量上报 + 限流 + 失败落盘（D-006/D-008）。

## implementation
- `AuditEvent { decision, runtimeId, provider, tool, path, reason, ts }`
- `AuditSink.record(e)`: 入 buffer，满 maxSize(100) 或 flushIntervalMs(5000) 触发 flush
- `flush()`: POST `/daemon/audit/batch`，失败指数退避重试，连续失败降级追加写 `~/.sillyhub/daemon/audit-failed.jsonl`

## 验收标准
- 攒批触发条件：满 100 条或 5s 定时
- 失败重试不丢事件，连续失败落盘防 OOM
- canRead 不调 record（D-008，仅写类决策记）

## 验证
- `cd sillyhub-daemon && pnpm test audit-sink`

## constraints
- 仅 canWrite/canCreate/canDelete/canRename 产 AuditEvent（D-008）
- ts 由调用方传入（脚本禁 Date.now，见 workflow 约束；daemon 运行时可用 Date.now）
- flush 失败不阻断 agent 执行
