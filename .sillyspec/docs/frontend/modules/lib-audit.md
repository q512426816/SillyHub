---
schema_version: 1
doc_type: module-card
module_id: lib-audit
author: qinyi
created_at: 2026-08-18 01:45:00
---

# 工作区审计客户端（lib-audit）

## 定位
工作空间级审计日志前端只读 API 客户端（`frontend/src/lib/audit.ts`，21 行）。单一只读查询入口，供 `/workspaces/[id]/audit` 页展示操作流水。注意是 workspace 域（`/api/workspaces/{id}/audit`），非全局审计（全局另有 `lib-admin.listUserAudit` 与 `lib-daemon-audit` 策略审计）。

## 契约摘要
- `listAuditLogs(workspaceId, params?)` → GET `/api/workspaces/{ws}/audit[?resource_type=&limit=]`，返回 `AuditLogEntry[]`。
  - `params.resource_type?` — 按资源类型过滤（取值与后端枚举对齐：workspace/change/task/release 等）。
  - `params.limit?` — 条数上限，未传由后端默认值控制。
- `AuditLogEntry = components["schemas"]["AuditLogEntry"]` — 直接复用 OpenAPI 生成类型。

## 关键逻辑
```
用 URLSearchParams 拼 query：有值才 set；qs 非空才追加 ?，避免空 query
```

## 注意事项
- `details_json` 后端是 JSON **字符串**（Text 列），生成类型为 `string | null`——曾手写误标 `Record<string, unknown> | null` 导致前端二次序列化，迁移生成类型时已修正；UI 若要结构化展示需自行 `JSON.parse` 并容错。
- 极简模块：单一端点、无写入、无缓存，仅依赖 `lib-api`。
- 必须传 workspaceId，不支持全局查询。

## 人工备注

<!-- MANUAL_NOTES_START -->

<!-- MANUAL_NOTES_END -->
