---
schema_version: 1
doc_type: module-card
module_id: release
author: qinyi
created_at: 2026-08-18 01:45:00
---

# 发布审批与部署（release）

## 定位
发布单 + 多人审批 + 部署状态机（workspace 级）。记录版本、目标环境、审批投票与部署/回滚状态；**部署本身是模拟动作**——`deploy` 写固定占位 `deploy_output`，不执行真实部署。依赖极简（core/models/auth），release↔incident 通过 `incident.release_id` 单向关联，release 侧无感知。

## 契约摘要
- `POST /api/workspaces/{workspace_id}/releases` 创建（draft）；列表 / 详情；子路由 approve / list-approvals / promote / deploy / rollback。
- 状态集：draft / staging / approved / deploying / deployed / rolled_back。`deploying` 在 VALID_STATUSES 中定义但 deploy 直落 deployed，当前无中间停留点。
- 环境集：staging / production。`deploy_policy`（JSON）：`min_approvers`（默认 2）+ 部署窗口（默认周一~周五 10:00-18:00 **UTC**，`DEFAULT_DEPLOY_WINDOW`）。
- Release 字段：version / title / status / target_environment / change_ids(JSON) / deploy_policy / pre_check_result / post_check_result / deploy_output / creator_id / deployed_at / rolled_back_at；索引 `ix_releases_workspace_status`。
- ReleaseApproval：release_id + approver_id + verdict ∈ {approve, reject} + comment。约束：创建人不能审批自己（ReleaseNotAllowed）；同一 approver 一 release 只能投一票。

## 关键逻辑
```
promote_to_staging: draft → staging（其它状态拒绝）
approve: 投票行落库; verdict=approve 且 approve 票数 ≥ min_approvers
         且 status ∈ {draft, staging} → 自动升 approved（同事务 commit）
deploy: status ∈ {staging, approved} 才可发
        staging 环境 → 免审批直接发
        production 环境 → _require_approvals(approve 票达标) + check_deploy_window
        → status=deployed + deployed_at + deploy_output=占位串
rollback: 仅 deployed → rolled_back + rolled_back_at
```

## 注意事项
- **reject 现状不阻断**（如实记录，已知设计现状非 bug）：`approve()` 对 reject 只落投票行；阈值判断与 `_require_approvals` 都只统计 `verdict=="approve"`，reject 既不否决也不计入分母——凑够 approve 票即可 deploy。要「一票否决」语义需显式改逻辑。
- 票数与状态推进同事务：`_check_approval_threshold` 改 status 后与投票行一起 commit，不存在票到但状态漏升的中间态。
- 部署窗口只挡 production，staging 恒放行；窗口判定用 UTC 小时（非本地时区），排障注意时差。
- `pre_check_result` / `post_check_result` 字段预留未接线；对接真实 CI/CD 时 deploy/rollback 是挂点（当前 deploy_output 占位串是判定「模拟部署」的指纹）。
- 创建人自批与重复投票分别抛 ReleaseNotAllowed / ReleaseError（400 语义），前端表单依赖这两种文案分流。

## 人工备注

<!-- MANUAL_NOTES_START -->

<!-- MANUAL_NOTES_END -->
