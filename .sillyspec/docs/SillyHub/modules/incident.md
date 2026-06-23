---
schema_version: 1
doc_type: module-card
module_id: incident
source_commit: ba87eec
author: qinyi
created_at: 2026-06-24T01:16:33
---
# incident

## 定位
后端「事件与复盘（postmortem）」功能域：记录生产事件（incident）及其事后复盘文档，供运营侧追踪与改进。属于独立运营域，与 SillySpec 变更工作流解耦，仅依赖 core/models 基础设施。

## 契约摘要
- API（tag=incidents）：事件 CRUD（create/list/get/update）、复盘 `POST /incidents/{id}/postmortem`（创建）、`GET /incidents/{id}/postmortem`（读取）。
- `IncidentService`：`create / list_incidents / get / update / create_postmortem / get_postmortem`。
- `Incident(BaseModel, table=True)`：事件实体（标题、严重度、状态、时间线等）；`Postmortem(BaseModel, table=True)`：复盘文档（原因、影响、改进项），与 Incident 一对一。
- 错误：`IncidentError`（基类）、`IncidentNotFound`、`PostmortemNotFound`。

## 关键逻辑
```
create 事件 → list/get/update 事件流转
→ 事件关闭后 create_postmortem（一个事件一份复盘）
→ get_postmortem 查阅复盘与改进项
```

## 注意事项
- Incident 与 Postmortem 一对一：一个事件至多一份复盘，重复创建需显式覆盖或先删后建。
- 该模块独立于变更工作流，权限点归属审计/运营组，不要与 change 模块耦合。
- 事件时间线与改进项是后续运营回顾的数据来源，删除需谨慎（建议软删）。

## 人工备注
<!-- MANUAL_NOTES_START -->
<!-- MANUAL_NOTES_END -->
