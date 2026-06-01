---
author: qinyi
created_at: 2026-05-31T23:30:00
---

# incident

> 最后更新：2026-05-31
> 最近变更：`bead9ea` fix: QA round 1 — 6 issues from test report
> 模块路径：`app/modules/incident/**`

## 职责

事件追踪与复盘模块。管理生产事件的全生命周期：创建 → 调查 → 缓解 → 解决。支持严重性分级（low / medium / high / critical）、关联发布版本、受影响组件追踪。解决后可创建复盘文档（Postmortem），记录时间线、影响范围、根因分析和行动项。

## 当前设计（架构 + 关键逻辑）

**事件状态机**：`open → investigating → mitigated → resolved`

- **IncidentService**：
  - `create()`：验证 severity 合法性，创建事件记录，可关联 release_id
  - `list_incidents()`：按 workspace 过滤，支持 status 筛选，按创建时间倒序
  - `update()`：更新状态/严重性/描述/根因/解决方案；状态变更为 resolved 时自动记录 resolved_at 和 resolved_by
  - `create_postmortem()`：仅 resolved 状态可创建，每个 incident 最多一个 postmortem（唯一约束）
  - `get_postmortem()`：查询指定事件的复盘文档

**严重性等级**：low / medium / high / critical

**Postmortem 结构**：timeline（时间线）、impact（影响范围）、root_cause_analysis（根因分析）、action_items（行动项列表）、lessons_learned（经验教训）

## 对外接口

| 方法 | 路径 | 说明 | 权限 |
|------|------|------|------|
| POST | `/workspaces/{ws_id}/incidents` | 创建事件 | DEPLOY_STAGING |
| GET | `/workspaces/{ws_id}/incidents` | 列出事件（支持 ?status= 过滤） | 登录用户 |
| GET | `/incidents/{inc_id}` | 获取事件详情 | 登录用户 |
| PATCH | `/incidents/{inc_id}` | 更新事件 | DEPLOY_PRODUCTION |
| POST | `/incidents/{inc_id}/postmortem` | 创建复盘 | DEPLOY_PRODUCTION |
| GET | `/incidents/{inc_id}/postmortem` | 获取复盘 | 登录用户 |

## 关键数据流

```
POST /workspaces/{ws_id}/incidents
  → IncidentService.create() → status="open"

PATCH /incidents/{inc_id} {status: "resolved", root_cause: "...", resolution: "..."}
  → IncidentService.update()
    → 状态校验 → 更新字段
    → status="resolved" → 自动设置 resolved_at + resolved_by

POST /incidents/{inc_id}/postmortem
  → IncidentService.create_postmortem()
    → 检查 incident 状态 == "resolved"
    → 检查 postmortem 不已存在
    → 创建 Postmortem 记录
```

## 设计决策

| 决策 | 原因 |
|------|------|
| 复盘仅限 resolved 状态创建 | 确保事件已充分调查后再复盘，避免 premature postmortem |
| 每个 incident 最多一个 postmortem | 数据库唯一约束 `incident_id`，保持 1:1 关系 |
| release_id 可选关联 | 并非所有事件都由发布引起，但关联后便于追溯 |
| affected_components 用 JSON 数组 | 灵活存储，无需额外关联表 |
| resolved_by 作为单独字段 | 区分事件报告者（reporter_id）和解决者 |

## 依赖关系

- **上游**：workspace（workspace_id）、auth（User：reporter_id / resolved_by / author_id）、release（release_id 可选关联）
- **模型**：Incident（incidents 表）、Postmortem（postmortems 表）
- **索引**：`ix_incidents_workspace_status`（workspace_id + status 复合索引）

## 注意事项

- 事件状态流转无强制状态机（仅白名单校验），理论上可以从 open 直接跳到 resolved
- `resolved_by` 在 IncidentUpdate 中为 string（UUID 字符串），Service 层手动转 UUID
- `release_id` 外键指向 releases 表但无 ondelete 策略，发布被删除可能导致事件引用失效
- Postmortem 的 action_items 为 JSON 数组，适合轻量使用但不支持单条追踪

## 变更索引

| 日期 | 变更 |
|------|------|
| 2026-05-31 | 初始归档文档 |
