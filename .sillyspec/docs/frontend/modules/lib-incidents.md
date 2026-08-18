---
schema_version: 1
doc_type: module-card
module_id: lib-incidents
author: qinyi
created_at: 2026-08-18 01:45:00
---

# 事故管理客户端（lib-incidents）

## 定位
工作空间级「事故（Incident）」管理的浏览器侧 API 客户端。封装事故增改查与事后复盘（Postmortem）读写，两组端点：workspace 域 `/api/workspaces/{id}/incidents`（列表/新建）与全局事故域 `/api/incidents/{id}`（详情/更新/复盘）。消费方为工作区 incidents 列表页与详情页。

## 契约摘要
| 函数 | 语义 | HTTP |
|---|---|---|
| `listIncidents(workspaceId, status?)` | 列出工作空间事故，可按状态过滤 | GET `/api/workspaces/{ws}/incidents[?status=]` |
| `createIncident(workspaceId, input)` | 新建事故（仅 title 必填） | POST `/api/workspaces/{ws}/incidents` |
| `getIncident(incidentId)` | 取单个事故 | GET `/api/incidents/{id}` |
| `updateIncident(incidentId, input)` | 部分字段更新（PATCH） | PATCH `/api/incidents/{id}` |
| `createPostmortem(incidentId, input)` | 为事故创建复盘 | POST `/api/incidents/{id}/postmortem` |
| `getPostmortem(incidentId)` | 读取复盘 | GET `/api/incidents/{id}/postmortem` |

类型（本模块手写 interface，未迁 api-types）：`IncidentSeverity`（low/medium/high/critical）、`IncidentStatus`（open/investigating/mitigated/resolved）、`Incident`、`Postmortem`、`CreateIncidentInput` / `UpdateIncidentInput` / `CreatePostmortemInput`。

## 关键逻辑
```
listIncidents: 仅当传 status 才拼 ?status=（encodeURIComponent）
updateIncident: CreateIncidentInput/UpdateIncidentInput 全可选字段直传 json，后端按字段更新
状态流转语义在 backend：open → investigating → mitigated → resolved（前端只发目标值）
```

## 注意事项
- URL 前缀差异：列表/新建带 workspaceId，其余四函数走 `/api/incidents/{id}` 全局事故域，不带 workspace。
- `Incident.affected_components` 是字符串数组（组件标识）；可关联回滚/部署来源 `release_id`（可空）。
- `Postmortem.action_items` 为字符串数组；`timeline/impact/root_cause_analysis/lessons_learned` 均可空。
- resolve 语义靠 `updateIncident` 传 status/resolution/resolved_by，resolved_at 由后端置位。
- 类型为手写 interface：后端 schema 若变化不会在 gen:types 时自动暴露，属已知债务；改动事故端点时须对照后端 incident schema 手工核对。

## 人工备注

<!-- MANUAL_NOTES_START -->

<!-- MANUAL_NOTES_END -->
