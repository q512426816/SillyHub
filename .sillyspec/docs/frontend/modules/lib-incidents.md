---
schema_version: 1
doc_type: module-card
module_id: lib-incidents
author: qinyi
created_at: 2026-06-10T16:55:00
---

# lib-incidents

## 定位
Incident（事件）API 客户端。

## 契约摘要
- `listIncidents(workspaceId, status?)` — 列出事件
- `createIncident(workspaceId, data)` — 创建事件
- `getIncident(incidentId)` — 获取事件详情
- `updateIncident(incidentId, data)` — 更新事件
- `createPostmortem(incidentId, data)` — 创建复盘
- `getPostmortem(incidentId)` — 获取复盘

## 关键逻辑
- 事件管理 + 复盘（Postmortem）子资源
- createPostmortem 和 getPostmortem 使用 incidentId 而非 workspaceId

## 注意事项
- 无特殊注意点

## 人工备注

<!-- MANUAL_NOTES_START -->

<!-- MANUAL_NOTES_END -->
