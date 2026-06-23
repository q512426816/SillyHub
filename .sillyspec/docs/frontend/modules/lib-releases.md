---
schema_version: 1
doc_type: module-card
module_id: lib-releases
source_commit: ba87eec
author: qinyi
created_at: 2026-06-24T01:01:57+08:00
---
# lib-releases

## 定位
发布（Release）领域 API 客户端（`frontend/src/lib/releases.ts`，约 94 行）。封装发布的创建、审批、部署、提升与回滚，覆盖发布完整生命周期。供发布页面消费。

## 契约摘要
- `listReleases(workspaceId, status?): Promise<Release[]>` — 列出工作空间下发布（可按 status 过滤）。
- `createRelease(workspaceId, input: CreateReleaseInput): Promise<Release>` — 创建发布。
- `approveRelease(releaseId, data): Promise<ReleaseApproval>` — 审批发布（verdict: approve/reject）。
- `listApprovals(releaseId): Promise<ReleaseApproval[]>` — 列审批记录。
- `deployRelease(releaseId): Promise<Release>` — 部署到目标环境。
- `promoteRelease(releaseId): Promise<Release>` — 提升（如 staging→production）。
- `rollbackRelease(releaseId): Promise<Release>` — 回滚。
- 类型：`Release`（version/status/target_environment/change_ids/deploy_policy/pre_check_result/post_check_result/deploy_output 等）、`ReleaseApproval`、`CreateReleaseInput`、`ReleaseStatus`（draft/staging/approved/deploying/deployed/rolled_back）、`ReleaseEnvironment`（staging/production）。

## 关键逻辑
```
listReleases(ws, status?): GET /api/workspaces/{ws}/releases?status= → Release[]
createRelease(ws, input): POST /api/workspaces/{ws}/releases → Release
approveRelease(releaseId, { verdict, comment }): POST /api/releases/{id}/approvals → ReleaseApproval
deployRelease / promoteRelease / rollbackRelease: POST /api/releases/{id}/{action} → Release
```

## 注意事项
- 审批/部署/提升/回滚接口以 `releaseId` 为参（非 workspaceId），是发布维度的操作；仅 list/create 需 workspaceId。
- `ReleaseStatus` 状态机：draft→staging→approved→deploying→deployed，任意已部署态可 rolled_back；UI 按状态控制按钮可用性。
- `target_environment` 区分 staging / production，promote 通常指从 staging 提升到 production。
- `pre_check_result` / `post_check_result` 承载部署前后检查结果，`deploy_output` 承载部署输出日志，用于发布详情展示与排障。
- `change_ids` 关联本次发布包含的变更列表，是发布与变更的关联纽带。

## 人工备注
<!-- MANUAL_NOTES_START -->
<!-- MANUAL_NOTES_END -->
