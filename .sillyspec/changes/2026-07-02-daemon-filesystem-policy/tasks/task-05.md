---
id: task-05
title: policy/filesystem-policy.ts PolicyEngine 核心
author: WhaleFall
created_at: 2026-07-02T15:12:00
priority: P0
depends_on: [task-01, task-02, task-03, task-04]
blocks: [task-11, task-14, task-17, task-18]
allowed_paths:
  - sillyhub-daemon/src/policy/filesystem-policy.ts
  - sillyhub-daemon/tests/policy/filesystem-policy.test.ts
change: 2026-07-02-daemon-filesystem-policy
goal: "(见 body)"
implementation: "(见 body)"
acceptance: "(见 body)"
verify: "(见 body)"
constraints: "(见 body)"
---

# task-05

> goal: PolicyEngine 统一权限中心，canRead 全 allow 不 audit，写类校验 + 记 audit（D-001/D-008）。

## implementation
- `PolicyDecision { allowed: boolean; reason: string; normalizedPath: string }`
- `PolicyEngine(cache, auditSink)`
- `canRead(rid, path)`: 默认全 allow，不调 auditSink
- `canWrite/canCreate/canDelete(rid, path)`: path-utils.resolveRealPath → cache.get(rid) → isPathUnderAnyRoot → 产出 decision → auditSink.record
- `canRename(rid, oldPath, newPath)`: 两者皆需 allow
- deny reason 用统一中文文案（design §7）

## 验收标准
- canRead 任意路径返回 allowed=true，不产 audit
- canWrite 白名单内 allow + 记 ALLOW；越界 deny + 记 DENY + 中文 reason
- PolicyCache 未命中 fallback（调用方处理）

## 验证
- `cd sillyhub-daemon && pnpm test filesystem-policy`

## constraints
- 脚本内部 open() 不经此引擎（D-001 接受）
- 每次 canWrite 一次 realpath IO（R-08，path-utils 内部 LRU 缓存）
- 统一错误文案：`Runtime Policy 拒绝本次写入。\nAgent：<provider>\n目标路径：<path>\n原因：目标目录未配置为可写目录。`
