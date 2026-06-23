---
schema_version: 1
doc_type: module-card
module_id: incident
source_commit: ba87eec
author: qinyi
created_at: 2026-06-24T01:09:00
---
# incident

## 定位
事件追踪与复盘域。管理生产事件全生命周期（创建→调查→缓解→解决），支持严重性分级、关联 release、受影响组件追踪；解决后可创建复盘文档（Postmortem）记录时间线/影响/根因/行动项。

## 契约摘要
- `POST /api/workspaces/{workspace_id}/incidents` — 创建事件（校验 severity 合法）
- `GET .../incidents` — 列表（?status= 过滤，按创建时间倒序）
- `GET .../incidents/{id}` — 详情
- `PATCH .../incidents/{id}` — 更新（状态/severity/描述/根因/解决方案）
- `POST .../incidents/{id}/postmortem` — 创建复盘（仅 resolved 可建，每事件最多一个）
- `GET .../incidents/{id}/postmortem` — 查询复盘
- `IncidentService.create/list_incidents/get/update/create_postmortem/get_postmortem`
- 错误：`IncidentError`/`IncidentNotFound`/`PostmortemNotFound`

## 关键逻辑
```
update(incident_id, payload):
  inc = get(incident_id)
  apply fields (status/severity/root_cause/resolution)
  if status == 'resolved':
      inc.resolved_at = now; inc.resolved_by = actor
  commit; return inc

create_postmortem(incident_id, ...):
  inc = get(incident_id)
  if inc.status != 'resolved': raise IncidentError
  if exists(inc): raise duplicate    # 1:1 唯一约束
  insert Postmortem; commit
```

## 注意事项
- 事件状态机为白名单校验而非强制 FSM，理论上 open 可直跳 resolved（`open→investigating→mitigated→resolved`）
- severity 限定 `low/medium/high/critical`；resolved 时自动写 `resolved_at` + `resolved_by`
- Postmortem 与 incident 为 1:1（`incident_id` 唯一索引），仅 resolved 状态可创建
- `release_id` 外键指向 releases 表但无 ondelete 策略，删发布可能产生孤立引用
- `affected_components` 用 JSON 数组存，无关联表；action_items 同理为 JSON 数组，不支持单条追踪
- `ix_incidents_workspace_status` 复合索引支撑按 workspace + 状态过滤

## 人工备注
<!-- MANUAL_NOTES_START -->
<!-- MANUAL_NOTES_END -->
