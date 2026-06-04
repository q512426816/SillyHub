---
author: qinyi
created_at: 2026-06-01T12:00:00
---

# release
> 最后更新：2026-06-01
> 最近变更：scan（初始生成）
> 模块路径：backend/app/modules/release/**

## 职责

release 模块管理发布生命周期，负责：

- **发布创建**：创建 staging / production 环境的发布记录
- **审批流程**：多角色审批（创建者不能自审、双审批门控）
- **部署执行**：staging 和 production 环境的部署（含部署窗口检查）
- **回滚**：从 deployed 状态回滚发布
- **Promote**：将发布从 staging 推进到 production
- **部署策略**：支持 deploy_policy（部署窗口、审批阈值等）

## 当前设计

```
router.py              HTTP 入口，7 个端点
  |
service.py             ReleaseService — 核心业务逻辑
  |                      - create()                  创建发布
  |                      - list_releases()           列出发布（支持状态过滤）
  |                      - approve()                 审批发布
  |                      - list_approvals()          列出审批记录
  |                      - promote_to_staging()      推进到 staging
  |                      - deploy()                  部署
  |                      - rollback()                回滚
  |                      - check_deploy_window()     部署窗口校验
  |
model.py               Release + ReleaseApproval (SQLModel 表)
schema.py              请求/响应 schema
```

### 数据模型

**Release**:
- 关联 workspace（`workspace_id`）、creator（`creator_id`）
- 关联 change 列表（`change_ids` 为 UUID JSON 数组）
- 状态：pending → approved → deploying → deployed / failed → rolled_back
- `target_environment`：staging / production
- `deploy_policy`：JSON 对象，定义部署窗口（allowed_days、allowed_hours_start/end）和审批阈值
- `pre_check_result` / `post_check_result`：部署前后检查结果

**ReleaseApproval**:
- 关联 release（`release_id`）、approver（`approver_id`）
- `verdict`：approved / rejected
- 支持审批评论（`comment`）

### 审批门控

- 创建者不能审批自己的发布（`creator_id != approver_id`）
- 每人只能审批一次（`approver_id` UNIQUE per release）
- production 部署需要满足审批阈值（`deploy_policy.approval_threshold`，默认 1）
- 达到审批阈值后自动将 status 从 pending 推进到 approved

### 部署窗口

`check_deploy_window(policy)` 校验当前时间是否在允许的部署时段内：
- `allowed_days`：允许的星期几（0=周一 ... 6=周日）
- `allowed_hours_start` / `allowed_hours_end`：允许的时间范围

## 对外接口

| 方法 | 路径 | 说明 | 认证/权限 |
|------|------|------|-----------|
| POST | `/workspaces/{workspace_id}/releases` | 创建发布 | require_permission(DEPLOY_STAGING) |
| GET | `/workspaces/{workspace_id}/releases` | 列出发布（支持 status 过滤） | get_current_user |
| POST | `/releases/{release_id}/approve` | 审批发布 | require_permission_any(DEPLOY_PRODUCTION) |
| GET | `/releases/{release_id}/approvals` | 列出审批记录 | get_current_user |
| POST | `/releases/{release_id}/deploy` | 部署发布 | require_permission_any(DEPLOY_PRODUCTION) |
| POST | `/releases/{release_id}/promote` | 推进到 staging | require_permission(DEPLOY_STAGING) |
| POST | `/releases/{release_id}/rollback` | 回滚发布 | require_permission_any(DEPLOY_ROLLBACK) |

## 关键数据流

### 发布生命周期

```
Client → POST /workspaces/{ws_id}/releases
  → ReleaseCreate(version, target_environment, change_ids, deploy_policy)
  → ReleaseService.create()
  → Release 写入数据库（status=pending）

Client → POST /releases/{id}/approve
  → ReleaseApprovalCreate(verdict, comment)
  → 校验 creator_id != approver_id
  → 校验 approver 未重复审批
  → ReleaseApproval 写入数据库
  → _check_approval_threshold() — 达到阈值后 status → approved

Client → POST /releases/{id}/deploy
  → _require_approvals() — production 需要审批通过
  → check_deploy_window(policy) — 检查部署窗口
  → status → deploying
  → （部署执行，记录 pre_check/post_check/deploy_output）
  → status → deployed / failed

Client → POST /releases/{id}/rollback
  → 校验 status == deployed
  → status → rolled_back
```

## 设计决策

| 决策 | 原因 |
|------|------|
| change_ids 为 JSON 数组 | 一个发布可以包含多个变更，灵活关联 |
| 创建者不能自审 | 四眼原则，防止单人控制发布全流程 |
| 审批阈值可配置 | 不同环境/项目可设定不同审批要求 |
| 部署窗口检查 | 降低高风险时段部署的风险 |
| 回滚仅限 deployed 状态 | 只有成功部署的发布才能回滚，避免状态混乱 |
| 不同操作使用不同权限 | 细粒度权限控制：创建(DEPLOY_STAGING)、审批(DEPLOY_PRODUCTION)、回滚(DEPLOY_ROLLBACK) |

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

- `deploy_policy` 为可选字段，未配置时跳过部署窗口检查和自定义审批阈值
- `deploy_output`、`pre_check_result`、`post_check_result` 目前由 service 层设置占位值，实际部署逻辑待接入
- `promote_to_staging()` 将 staging 环境的发布推进到下一阶段
- Release model 的 `release_id` 字段同时出现在 Incident model 中，用于关联事故与发布
- approval_threshold 默认为 1，即只需一个非创建者的审批即可推进状态

## 变更索引

| 日期 | 变更 | 摘要 |
|------|------|------|
| | | （初始生成，暂无变更记录） |
