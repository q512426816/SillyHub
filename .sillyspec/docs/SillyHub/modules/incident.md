---
author: qinyi
created_at: 2026-06-01T12:00:00
---

# incident
> 最后更新：2026-06-01
> 最近变更：scan（初始生成）
> 模块路径：backend/app/modules/incident/**

## 职责

incident 模块管理生产事故的生命周期，负责：

- **事故创建与跟踪**：记录事故标题、严重程度、状态、受影响组件等
- **状态流转**：open → investigating → mitigated → resolved
- **Postmortem（复盘）**：事故解决后创建复盘报告（时间线、影响、根因分析、改进项、经验教训）
- **工作区隔离**：事故按 workspace 归属

## 当前设计

```
router.py              HTTP 入口，6 个端点
  |
service.py             IncidentService — 核心业务逻辑
  |                      - create()              创建事故
  |                      - list_incidents()      列出事故（支持状态过滤）
  |                      - get()                 获取事故详情
  |                      - update()              更新事故（含状态流转）
  |                      - create_postmortem()   创建复盘
  |                      - get_postmortem()      获取复盘
  |
model.py               Incident + Postmortem (SQLModel 表)
schema.py              请求/响应 schema
```

### 数据模型

**Incident**:
- 关联 workspace（`workspace_id`）、reporter（`reporter_id`）
- 可关联 release（`release_id`）
- 状态：open / investigating / mitigated / resolved
- 严重程度：low / medium / high / critical
- `affected_components` 为 JSON 数组

**Postmortem**:
- 与 Incident 一对一关系（`incident_id` UNIQUE）
- 包含 timeline、impact、root_cause_analysis、action_items、lessons_learned
- 仅在事故状态为 resolved 后可创建

### 状态流转验证

service 层在 `update()` 中校验：
- 严重程度只能是预定义值之一
- 状态只能按合法路径流转
- 设置 resolved 状态时自动记录 `resolved_at` 和 `resolved_by`
- postmortem 只能在事故 resolved 后创建，且每个事故只允许一份

## 对外接口

| 方法 | 路径 | 说明 | 认证/权限 |
|------|------|------|-----------|
| POST | `/workspaces/{workspace_id}/incidents` | 创建事故 | require_permission(DEPLOY_STAGING) |
| GET | `/workspaces/{workspace_id}/incidents` | 列出事故（支持 status 过滤） | get_current_user |
| GET | `/incidents/{incident_id}` | 获取事故详情 | get_current_user |
| PATCH | `/incidents/{incident_id}` | 更新事故（状态、根因等） | require_permission_any(DEPLOY_PRODUCTION) |
| POST | `/incidents/{incident_id}/postmortem` | 创建复盘 | require_permission_any(DEPLOY_PRODUCTION) |
| GET | `/incidents/{incident_id}/postmortem` | 获取复盘 | get_current_user |

## 关键数据流

### 事故生命周期

```
Client → POST /workspaces/{ws_id}/incidents
  → IncidentCreate(severity, title, ...)
  → IncidentService.create()
  → Incident 记录写入数据库（status=open）

Client → PATCH /incidents/{id}
  → IncidentUpdate(status="investigating")
  → IncidentService.update() — 校验状态流转合法性

Client → PATCH /incidents/{id}
  → IncidentUpdate(status="resolved")
  → 记录 resolved_at / resolved_by

Client → POST /incidents/{id}/postmortem
  → PostmortemCreate(timeline, root_cause_analysis, action_items, ...)
  → 校验 incident.status == "resolved"
  → Postmortem 写入数据库
```

## 设计决策

| 决策 | 原因 |
|------|------|
| Postmortem 与 Incident 一对一 | 每个事故只允许一份复盘，避免多版本混淆 |
| resolved 前置校验 | 强制先解决事故再做复盘，符合 SRE 实践 |
| affected_components 用 JSON 数组 | 灵活记录受影响组件，无需预定义枚举 |
| 关联 release_id | 将事故与导致问题的发布关联，支持发布质量回溯 |
| 创建事故需要 DEPLOY_STAGING 权限 | 确保只有有权限的用户可以报告事故 |

## 依赖关系

### 内部依赖

- `app.core.auth_deps` — get_current_user, require_permission, require_permission_any
- `app.core.db` — get_session
- `app.core.errors` — AppError
- `app.core.logging` — get_logger
- `app.models.base` — BaseModel
- `app.modules.auth.model` — User
- `app.modules.auth.permissions` — Permission

### 外部依赖

- 无特殊外部依赖

## 注意事项

- `severity` 和 `status` 字段使用字符串而非枚举，service 层做合法性校验
- `resolved_by` 记录的是执行 resolve 操作的用户，可能与 reporter 不同
- Postmortem 的 `action_items` 是 JSON 数组，格式由调用方约定
- 事故创建和更新使用不同的权限级别：创建仅需 DEPLOY_STAGING，更新/复盘需 DEPLOY_PRODUCTION

## 变更索引

| 日期 | 变更 | 摘要 |
|------|------|------|
| | | （初始生成，暂无变更记录） |
