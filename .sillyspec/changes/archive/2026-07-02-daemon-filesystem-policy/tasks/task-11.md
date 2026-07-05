---
id: task-11
title: Daemon 构造注入 PolicyEngine/AuditSink/PolicyCache
author: WhaleFall
created_at: 2026-07-02T15:12:00
priority: P0
depends_on: [task-05]
blocks: [task-12, task-13, task-14, task-16, task-17, task-18]
allowed_paths:
  - sillyhub-daemon/src/daemon.ts
  - sillyhub-daemon/src/cli.ts
  - sillyhub-daemon/tests/
change: 2026-07-02-daemon-filesystem-policy
goal: "(见 body)"
implementation: "(见 body)"
acceptance: "(见 body)"
verify: "(见 body)"
constraints: "(见 body)"
---

# task-11

> goal: Daemon 构造新增 3 个依赖字段 + cli.ts 生产装配注入。

## implementation
- `daemon.ts:405` DaemonOptions 新增 `policyEngine?/auditSink?/policyCache?` 字段
- `cli.ts:544` new Daemon 实例化 PolicyCache/AuditSink/PolicyEngine 注入
- 19 个测试构造点评估：多数传 null/mock 向后兼容（字段 optional）
- ⚠️ 判断是否需要 `policy_engine_enabled` 回退开关（design §9 自审存疑），YAGNI 则不留

## 验收标准
- Daemon 持有 policyEngine/auditSink/policyCache 引用
- 生产 cli.ts 装配完整实例
- 现有测试不传新字段也能构造（向后兼容）

## 验证
- `cd sillyhub-daemon && pnpm test daemon`

## constraints
- 字段 optional，不破坏现有 19 个测试构造
- PolicyEngine 依赖 PolicyCache + AuditSink，构造顺序：cache → auditSink → engine
- 回退开关 YAGNI 判断记录到 quicklog
