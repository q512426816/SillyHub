---
schema_version: 1
doc_type: module-card
module_id: lib-incidents
source_commit: ba87eec
author: qinyi
created_at: 2026-06-24T01:02:25
---
# lib-incidents

## 定位
工作空间级"事故（Incident）"管理的前端 API 客户端。封装事故的增改查与事后总结（Postmortem）读写，对应后端 `/api/workspaces/{id}/incidents` 与 `/api/incidents/{id}` 两组端点。事故用于记录 release 引发或运行中的线上问题，并关联复盘文档。

## 契约摘要
对外全部为 `apiFetch` 封装的异步函数，返回强类型对象；调用方无需关心鉴权头与 JSON 序列化。

| 函数 | 语义 | HTTP |
|---|---|---|
| `listIncidents(workspaceId, status?)` | 列出工作空间事故，可按 `IncidentStatus` 过滤 | GET `/api/workspaces/{ws}/incidents[?status=]` |
| `createIncident(workspaceId, input)` | 新建事故（标题必填，可带 severity/description/affected_components/release_id） | POST `/api/workspaces/{ws}/incidents` |
| `getIncident(incidentId)` | 取单个事故详情 | GET `/api/incidents/{id}` |
| `updateIncident(incidentId, input)` | 更新事故字段（状态/严重度/根因/解决方案等） | PATCH `/api/incidents/{id}` |
| `createPostmortem(incidentId, input)` | 为事故创建/覆盖复盘文档 | POST `/api/incidents/{id}/postmortem` |
| `getPostmortem(incidentId)` | 读取复盘文档 | GET `/api/incidents/{id}/postmortem` |

核心类型：`IncidentSeverity`（low/medium/high/critical）、`IncidentStatus`（open/investigating/mitigated/resolved）、`Incident`、`Postmortem`。

## 关键逻辑
```
listIncidents: 拼 query string，仅当传 status 才附加 ?status=
updateIncident: PATCH 部分字段，后端按字段更新
postmortem 端点走 /api/incidents/{id}（非 workspace 域），注意 URL 前缀差异
```

## 注意事项
- `createIncident` 入参 `CreateIncidentInput` 仅 `title` 必填，其余可选；`affected_components` 为组件 id 数组。
- `updateIncident`/`getIncident` 用事故全局 id（`/api/incidents/{id}`），不带 workspaceId。
- `Postmortem.action_items` 为字符串数组；`timeline/impact/root_cause_analysis` 均可空。
- 事故可关联回滚/部署的 `release_id`（可选）。
- 仅依赖 `lib-api`，无前端状态缓存，调用方自行管理列表刷新。

## 人工备注
<!-- MANUAL_NOTES_START -->
<!-- MANUAL_NOTES_END -->
