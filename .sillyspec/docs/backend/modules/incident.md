---
schema_version: 1
doc_type: module-card
module_id: incident
author: qinyi
created_at: 2026-08-18 01:45:00
---

# 故障单与复盘（incident）

## 定位
故障单与复盘报告（workspace 级）：Incident 状态机生命周期 + resolved 后的一对一 Postmortem 复盘。security-backend-guardrails change 落地的 FSM 化模块，替代早期自由文本状态；含独立 tests/ 目录。

## 契约摘要
- `POST /api/workspaces/{workspace_id}/incidents` 创建（reporter_id=当前用户）；`GET` 列表（workspace 过滤）；`GET /{incident_id}` 详情；`PATCH /{incident_id}` 部分更新（status / severity / description / root_cause / resolution）。
- postmortem 子路由：`POST /{incident_id}/postmortem` 创建（仅 `resolved` 状态可建；每 incident 至多一份，重复创建抛 IncidentError）；`GET /{incident_id}/postmortem` 查询（缺失抛 PostmortemNotFound）。
- Incident 字段：severity ∈ {low, medium, high, critical}；status FSM 四态；`affected_components` JSON 列表；`release_id` 可空外键关联发布单；`resolved_at` / `resolved_by` 由状态机维护（不由客户端直填）；索引 `ix_incidents_workspace_status`。
- Postmortem 字段：timeline / impact / root_cause_analysis / action_items(JSON) / lessons_learned / author_id。

## 关键逻辑
```
INCIDENT_TRANSITIONS（放宽版, design §5 A1 / D-001）:
  open:          {investigating, resolved}    # 排查 / 误报直关
  investigating: {mitigated, open, resolved}  # 退回 / 控制 / 直收
  mitigated:     {resolved, investigating}    # 收尾 / 回查
  resolved:      {investigating}              # 仅可重开
进 resolved → 设 resolved_at（+resolved_by 若传）
离开 resolved → 清空 resolved_at/by（D-002）
update 校验顺序（D-006 定死）: 非法值 400 → 同态幂等跳过 → 非法转换 422 → 字段维护 → 赋值
```

## 注意事项
- FSM 校验复用 **`ppm.common.fsm.assert_transition`**（incident → ppm 的真实依赖点）：这是跨域借公共状态机 helper，不是业务耦合；ppm 改 fsm helper 的错误类型/签名会波及本模块 422 语义。
- 校验顺序改变会改变 API 错误码语义（400 vs 422 vs 静默幂等），客户端依赖该顺序，调整须当契约变更对待。
- 「离开 resolved 清解决记录」依赖「合法离场边只有 resolved→investigating」这一前提；扩状态图须重审清理逻辑完备性。
- 复盘报告没有编辑/删除端点，创建即终稿（刻意从简）；要迭代内容走重开→再 resolved→重建路径，不要顺手加 PATCH 而不评估一份约束。
- 同状态重复提交幂等跳过（不抛 422）是 D-006 的显式决策，前端轮询/重试依赖它。

## 人工备注

<!-- MANUAL_NOTES_START -->

<!-- MANUAL_NOTES_END -->
