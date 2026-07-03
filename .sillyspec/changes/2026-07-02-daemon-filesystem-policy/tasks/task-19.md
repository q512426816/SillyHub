---
id: task-19
title: frontend lib/daemon-audit.ts API client
author: WhaleFall
created_at: 2026-07-02T15:12:00
priority: P1
depends_on: [task-10]
blocks: [task-20]
allowed_paths:
  - frontend/src/lib/daemon-audit.ts
  - frontend/src/lib/__tests__/daemon-audit.test.ts
change: 2026-07-02-daemon-filesystem-policy
goal: "(见 body)"
implementation: "(见 body)"
acceptance: "(见 body)"
verify: "(见 body)"
constraints: "(见 body)"
---

# task-19

> goal: 审计查询 API client（D-006）。

## implementation
- `lib/daemon-audit.ts`: `fetchPolicyAudit(rid, { decision?, provider?, tool?, path?, timeRange?, page, pageSize })` → GET `/workspaces/{wid}/runtimes/{rid}/policy-audit`
- TanStack Query 用法对齐现有 `lib/daemon.ts` 风格
- 返回 AuditLogRead 列表 + 分页元数据

## 验收标准
- fetchPolicyAudit 支持筛选 + 分页参数
- 返回类型对齐 backend AuditLogRead schema
- 错误处理对齐现有 lib 风格

## 验证
- `cd frontend && pnpm test daemon-audit`
- `cd frontend && pnpm lint`

## constraints
- 路径别名 `@/` 引用
- 中文 UI 文案
- 对齐现有 lib/daemon.ts fetch 封装风格
