---
schema_version: 1
doc_type: module-card
module_id: incident
author: qinyi
created_at: 2026-08-18 01:45:00
---

# 事件与复盘管理（incident）

## 定位
后端「事件与复盘（postmortem）」：工作区维度记录生产事件（severity/status/受影响组件/关联 release），事件解决后写一对一复盘报告（时间线/影响/根因/行动项/经验教训）。独立运营域，与 SillySpec 变更工作流解耦；状态机复用 ppm 的通用 FSM 工具。

## 契约摘要
- 端点（tag=incidents，写操作要求部署级权限、读要求 INCIDENT_READ）：
  - `POST /workspaces/{workspace_id}/incidents` — 创建（201，DEPLOY_STAGING）
  - `GET /workspaces/{workspace_id}/incidents` — 列表（status 过滤，默认 limit 50，创建时间倒序）
  - `GET /incidents/{id}` / `PATCH /incidents/{id}` — 详情 / 更新（PATCH 要求 DEPLOY_PRODUCTION）
  - `POST /incidents/{id}/postmortem` — 创建复盘（201，DEPLOY_PRODUCTION）
  - `GET /incidents/{id}/postmortem` — 读取复盘
- `IncidentService`：create / list_incidents / get / update / create_postmortem / get_postmortem。
- `Incident`：workspace_id / title / severity（low/medium/high/critical）/ status / description / affected_components / reporter_id / release_id / root_cause / resolution / resolved_at / resolved_by。
- `Postmortem`：与 Incident 一对一；timeline / impact / root_cause_analysis / action_items / lessons_learned / author_id。
- 错误：IncidentError（400）/ IncidentNotFound（404）/ PostmortemNotFound（404）。

## 关键逻辑
状态机 `INCIDENT_TRANSITIONS`（复用 ppm.common.fsm.assert_transition）：
```
open → {investigating, resolved}      # 排查 / 误报直关
investigating → {mitigated, open, resolved}
mitigated → {resolved, investigating}
resolved → {investigating}            # 仅可重开
update 校验顺序（固定）：值非法 400 → 同态幂等跳过 → 非法转换 422
  → resolved 字段维护：进 resolved 设 resolved_at/by，离 resolved 清空
create_postmortem：仅 status=="resolved" 可建；已存在则拒绝（严格一对一）
```

## 注意事项
- 校验顺序是设计决策（D-006），改动会改变错误码语义：先值校验、同态幂等、再转换校验（422 由 fsm 内部抛）。
- 离开终态 resolved 仅允许重开→investigating，且清空解决记录（D-002）——回查数据完整性依赖此清理。
- Postmortem 严格一对一，重复创建 400；无覆盖/先删后建入口。
- 依赖 ppm.common.fsm（assert_transition）：ppm 模块重构 FSM 工具时本模块受影响。
- 事件与 release 关联（release_id 可空），删除 release 需考虑悬挂引用。
- 权限点写操作挂在部署权限（DEPLOY_STAGING/PRODUCTION）而非独立 incident 写权限，扩展时注意与权限组对齐。

## 人工备注

<!-- MANUAL_NOTES_START -->

<!-- MANUAL_NOTES_END -->
