---
author: qinyi
created_at: 2026-07-04T19:05:30
---

# Tasks — 修复前端类型对齐 5 处分叉

> 任务步骤/测试细节在 plan 阶段展开。本文件只列名称 + 文件 + 覆盖。

## W1 后端契约修正
- [ ] **task-01 runtime 删 alias** — `runtime/schema.py` + `runtime/router.py` + `runtime/service.py:178-185` — FR-003 / D-002@v1
- [ ] **task-02 scan-docs schema 补字段** — `scan_docs/schema.py`（ScanDocSummary/Read 加 source_*/content_hash/conflict_count + 新建 ScanDocConflictRead）— FR-001 / D-001@v1
- [ ] **task-03 scan-docs conflict_count 聚合** — `scan_docs/service.py`（list_ group by + get 单查 + 新增 list_conflicts）— FR-001 / FR-002 / D-001@v1
- [ ] **task-04 scan-docs conflicts 端点** — `scan_docs/router.py`（GET /scan-docs/{doc_id}/conflicts）— FR-002 / D-001@v1
- [ ] **task-05 workspace-binding response_model** — `member_runtimes/router.py`（三端点加 response_model + 删 try/except）— FR-005 / D-004@v1

## W2 重生 api-types
- [ ] **task-06 重生 api-types** — `cd frontend && pnpm gen:types`（dump openapi.json + 生成）— 全 FR

## W3 前端迁移
- [ ] **task-07 scan-docs 前端迁移** — `lib/scan-docs.ts` + `scan-docs/page.tsx` — FR-007 / D-001@v1
- [ ] **task-08 runtime 前端迁移** — `lib/runtime.ts` — FR-003 / D-002@v1
- [ ] **task-09 audit 前端修复** — `lib/audit.ts` + `audit/page.tsx`（JSON.parse 兜底）— FR-004 / D-003@v1
- [ ] **task-10 workspace-binding 前端迁移** — `lib/workspace-binding.ts` — FR-005 / D-004@v1
- [ ] **task-11 workspaces 前端迁移** — `lib/workspaces.ts` + ~10 import 文件 — FR-006 / D-005@v1

## 测试与门禁
- [ ] **task-12 后端测试** — scan-docs 字段/conflicts、runtime snake 响应、binding response_model — 全 FR
- [ ] **task-13 前端测试+门禁** — vitest 不回归、typecheck、gen:types:check — 全 FR
