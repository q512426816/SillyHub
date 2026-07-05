---
id: task-16
title: batch Claude spawn 改用 PolicyCache per-runtime 快照
author: WhaleFall
created_at: 2026-07-02T15:12:00
priority: P0
depends_on: [task-02, task-11]
blocks: [task-22]
allowed_paths:
  - sillyhub-daemon/src/task-runner.ts
  - sillyhub-daemon/src/adapters/stream-json.ts
  - sillyhub-daemon/src/permission-rules.ts
  - sillyhub-daemon/tests/
change: 2026-07-02-daemon-filesystem-policy
goal: "(见 body)"
implementation: "(见 body)"
acceptance: "(见 body)"
verify: "(见 body)"
constraints: "(见 body)"
---

# task-16

> goal: batch Claude spawn 改用 PolicyCache.get(task.runtimeId) 快照生成 CC --settings（D-002）。

## implementation
- `task-runner.ts:455` buildArgs 调用改用 `policyCache.get(task.runtimeId)?.allowedRoots` 而非全局 `config.allowed_roots`
- `stream-json.ts:308` 保持 `--settings buildCcSettingsJson(allowedRoots)`（CC 侧逻辑不变，数据源改）
- `permission-rules.ts` 保持生成 rules 逻辑
- spawn 后 --settings 冻结至任务结束（D-003）

## 验收标准
- batch Claude 任务 spawn 时按 task.runtimeId 取 allowed_roots
- claude/codex batch 各用各的 roots
- 在跑 batch 保持旧配置至跑完（D-003）

## 验证
- `cd sillyhub-daemon && pnpm test task-runner`
- `cd sillyhub-daemon && pnpm test permission-rules`

## constraints
- spawn 后 --settings 冻结（D-003，不杀在跑任务）
- 新起 batch 读 PolicyCache 最新值
- 不改 CC permission rules 生成逻辑
