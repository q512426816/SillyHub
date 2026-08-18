---
schema_version: 1
doc_type: module-card
module_id: release
author: qinyi
created_at: 2026-08-18 01:45:00
---

# 发布与审批管理（release）

## 定位
后端「发布与审批」功能域：管理一次发布（Release）从创建、多人审批、预发布晋升、部署到回滚的全生命周期，并对生产部署强制「审批阈值 + 部署窗口」双门禁。发布单挂 workspace 维度，属于运营发布域；前端有对应发布管理界面。

## 契约摘要
- 路由（tag=releases，7 端点，无统一 prefix）：
  - `POST /workspaces/{wid}/releases` 创建（权限 `DEPLOY_STAGING`），创建后 status=draft
  - `GET /workspaces/{wid}/releases` 列表（登录即可，`status` Query 过滤，created_at 倒序）
  - `POST /releases/{id}/approve` 提交审批（权限 `DEPLOY_PRODUCTION`，verdict=approve/reject + comment）
  - `GET /releases/{id}/approvals` 审批记录列表（登录即可）
  - `POST /releases/{id}/promote` 晋升 staging（`DEPLOY_STAGING`）
  - `POST /releases/{id}/deploy` 部署（`DEPLOY_PRODUCTION`）
  - `POST /releases/{id}/rollback` 回滚（`DEPLOY_PRODUCTION`）
- `ReleaseService`：
  - `create / list_releases / get / approve / list_approvals / promote_to_staging / deploy / rollback`
  - 门禁辅助：模块级 `check_deploy_window(policy)` + `_check_approval_threshold(release)` / `_require_approvals(release)`
- 数据模型：
  - `Release`：status、target_environment、change_ids、deploy_policy（JSON）、creator_id、deployed_at / rolled_back_at / deploy_output
  - `ReleaseApproval`：release_id、approver_id、verdict（approve/reject）、comment
- 状态集（`VALID_STATUSES`）：draft / staging / approved / deploying / deployed / rolled_back；环境仅 staging / production（其余拒绝创建）
- 错误：`ReleaseError`(400) / `ReleaseNotAllowed`(403) / `ReleaseNotFound`(404)；用户面文案已中文化

## 关键逻辑
```
create(draft) → promote(draft→staging) → deploy(staging/approved→deployed)
deploy 到 production:
  approve 票数 ≥ deploy_policy.min_approvers（默认 2）   # _require_approvals
  且 check_deploy_window（默认周一~五 10:00-18:00 UTC）   # 窗口外 ReleaseNotAllowed
  staging 目标环境免两道门禁直接放行
approve(approve票) → _check_approval_threshold: draft/staging 且达标 → approved
rollback: 仅 deployed → rolled_back
```

## 注意事项
- 审批防弊三条：创建人不能审批自己的发布单；同一人重复投票抛错；投 approve 时才检查阈值并推进状态
- 审批阈值与部署窗口都读 `release.deploy_policy` JSON，键 `min_approvers` / `deploy_window`，缺省用模块默认值
- 状态推进在 service 内逐分支硬校验（非 draft 不能 promote、非 staging/approved 不能 deploy、非 deployed 不能 rollback），没有 FSM 库参与
- `deploy` 是记账式实现：直接置 deployed + 写 deploy_output 占位文案，不触发真实部署动作；接真实流水线时在 deploy 分支扩展
- `deploying` 在状态集合里但当前代码没有置该状态的路径（deploy 一步到位）

## 人工备注

<!-- MANUAL_NOTES_START -->

<!-- MANUAL_NOTES_END -->
