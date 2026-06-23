---
schema_version: 1
doc_type: module-card
module_id: release
source_commit: ba87eec
author: qinyi
created_at: 2026-06-24T01:16:33
---
# release

## 定位
后端「发布与审批」功能域：管理一次发布（release）的创建、多角色审批、环境晋升（promote to staging）、部署（deploy）、回滚（rollback），含部署窗口策略校验。属于运营发布域，前端有对应发布管理界面，也被工作流（workflow）引用。

## 契约摘要
- API（tag=releases）：Release CRUD（create/list/get）、审批 `POST /releases/{id}/approvals`、晋升 `POST /releases/{id}/promote`、部署 `POST /releases/{id}/deploy`、回滚 `POST /releases/{id}/rollback`。
- `ReleaseService`：`create / list_releases / get / approve / list_approvals / promote_to_staging / deploy / rollback`；`_require_approvals` / `_check_approval_threshold`（满足审批阈值才放行）；`check_deploy_window(policy)`（部署窗口策略）。
- `Release(BaseModel, table=True)`：发布实体（状态、目标环境、关联变更/版本）；`ReleaseApproval(BaseModel, table=True)`：审批记录（审批人、决策、时间）。
- 错误：`ReleaseError`（基类）、`ReleaseNotAllowed`（窗口/审批未满足）、`ReleaseNotFound`。

## 关键逻辑
```
create → approve 累计 → _check_approval_threshold 达标
→ promote_to_staging → deploy（check_deploy_window 校验窗口）→ 可 rollback
# 审批放行
_require_approvals(release) → 未达阈值 → ReleaseNotAllowed
```

## 注意事项
- `deploy` 前强制 `_require_approvals`，审批阈值由策略配置；未满足抛 `ReleaseNotAllowed`。
- `check_deploy_window` 是发布窗口策略，窗口外部署被拒（运营合规）。
- 状态机推进（created→approved→staging→deployed/rolled-back）需保持单调，回滚后通常不可再部署。
- 审批记录与用户绑定，重复审批应幂等或显式拒绝。

## 人工备注
<!-- MANUAL_NOTES_START -->
<!-- MANUAL_NOTES_END -->
