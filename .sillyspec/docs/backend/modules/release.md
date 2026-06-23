---
schema_version: 1
doc_type: module-card
module_id: release
source_commit: ba87eec
author: qinyi
created_at: 2026-06-24T01:09:00
---
# release

## 定位
发布管理域：覆盖 release 的创建、审批（多审批 + 阈值）、晋升 staging、部署、回滚全流程，并强制部署窗口（deploy window）与审批门槛校验。生命周期：`draft → staging → approved → deploying → deployed → rolled_back`。

## 契约摘要
- `POST /api/workspaces/{workspace_id}/releases` — 创建 release
- `GET .../releases` — 列表（支持 ?status= 过滤）
- `POST .../releases/{id}/approve` — 提交审批投票（每人一票，创建者不可自审）
- `GET .../releases/{id}/approvals` — 审批记录
- `POST .../releases/{id}/deploy` — 部署（强制 deploy window + 审批阈值）
- `POST .../releases/{id}/promote` — 晋升到 staging（仅 draft 可晋升）
- `POST .../releases/{id}/rollback` — 回滚（仅 deployed 可回滚）
- `ReleaseService.create/list_releases/get/approve/list_approvals/promote_to_staging/deploy/rollback`
- 错误：`ReleaseError`/`ReleaseNotAllowed`/`ReleaseNotFound`

## 关键逻辑
```
deploy(release_id):
  release = get(release_id)
  _require_approvals(release)        # 必须有审批
  _check_approval_threshold(release) # 审批通过数 ≥ min_approvers（默认2）
  check_deploy_window(policy)        # 时间窗校外（默认工作日10-18 UTC）
  release.status = 'deployed'
  commit; return release
```

## 注意事项
- `check_deploy_window(policy)` 读策略允许的 days/start_hour/end_hour，窗口外直接 `ReleaseNotAllowed`；时区为 UTC
- 审批达阈值（`min_approvers`，默认 2）时 `approve()` 自动把状态置为 approved，无需额外调用
- `Release.status` 建了 `(workspace_id, status)` 联合索引 `ix_releases_workspace_status`，按状态过滤走索引
- `release_approvals` 表有 `(release_id, user_id)` 唯一索引，DB 层保证每人一票
- 回滚仅置状态 + 记录时间，不实际回退代码/数据（`deploy_output` 当前为硬编码），真正回滚交由外部 CI
- `change_ids` 以 JSON 数组存关联变更，无外键约束，删变更可能产生孤立引用
- `deploying` 状态在合法集合内但当前代码未实际使用（直接跳到 deployed）

## 人工备注
<!-- MANUAL_NOTES_START -->
<!-- MANUAL_NOTES_END -->
