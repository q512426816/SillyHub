---
schema_version: 1
doc_type: module-card
module_id: lib-audit
source_commit: ba87eec
author: qinyi
created_at: 2026-06-24T01:02:25
---
# lib-audit

## 定位
工作空间级"审计日志"前端只读 API 客户端。仅暴露一个查询入口，供审计页展示工作空间内的操作流水。对应后端 `/api/workspaces/{id}/audit`（注意：是 workspace 域，非全局 `/api/audit`）。

## 契约摘要
| 函数 | 语义 | HTTP |
|---|---|---|
| `listAuditLogs(workspaceId, params?)` | 分页/过滤查询审计日志 | GET `/api/workspaces/{ws}/audit[?resource_type=&limit=]` |

参数 `params`：可选 `resource_type`（按资源类型过滤）、`limit`（条数上限）。返回 `AuditLogEntry[]`。

`AuditLogEntry` 接口字段由后端决定（resource_type/action/actor/timestamp 等审计通用字段，具体见后端）。

## 关键逻辑
```
用 URLSearchParams 拼 query：
  有 resource_type → set("resource_type", v)
  有 limit        → set("limit", String(v))
qs 非空才追加 ?，避免产生空 query
```

## 注意事项
- 该模块极简，单一只读端点，无写入/更新。
- `resource_type` 取值与后端枚举对齐（如 workspace/change/task/release 等），UI 文案映射见 `lib-utils` 的 `AUDIT_RESOURCE_TYPE_LABELS`。
- `limit` 未传时由后端默认值控制。
- 必须传 workspaceId，不支持全局审计（全局审计另有 admin 模块）。
- 仅依赖 `lib-api`。

## 人工备注
<!-- MANUAL_NOTES_START -->
<!-- MANUAL_NOTES_END -->
