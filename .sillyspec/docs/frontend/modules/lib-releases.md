---
schema_version: 1
doc_type: module-card
module_id: lib-releases
author: qinyi
created_at: 2026-08-18 01:45:00
---

# 发布 API 客户端（lib-releases）

## 定位
发布（Release）领域 API 客户端（`frontend/src/lib/releases.ts`，约 71 行）。封装发布列表/创建与部署/提升/回滚三操作，供 workspace releases 页消费。轻量纯函数模块，仅依赖 `lib-api`。

## 契约摘要
- `listReleases(workspaceId, status?): Promise<Release[]>` — 列表（status 进 query）。
- `createRelease(workspaceId, input: CreateReleaseInput): Promise<Release>` — 创建。
  - `CreateReleaseInput`：version 必填；title / target_environment / change_ids / deploy_policy 可选。
- `deployRelease(releaseId)` / `promoteRelease(releaseId)` / `rollbackRelease(releaseId)` → `Release`。
  - 三个动作端点均以 releaseId 为参（非 workspaceId）；仅 list/create 需 workspaceId。
- 类型（全部手写 interface，未走 gen:types）：
  - `Release` — id / workspace_id / version / title / status / target_environment / change_ids / deploy_policy / pre_check_result / post_check_result / deploy_output / creator_id / deployed_at / rolled_back_at / created_at / updated_at。
  - `ReleaseStatus = draft | staging | approved | deploying | deployed | rolled_back`。
  - `ReleaseEnvironment = staging | production`。

## 关键逻辑
```
GET  /api/workspaces/{ws}/releases?status=   → Release[]
POST /api/workspaces/{ws}/releases           → Release
POST /api/releases/{id}/deploy|promote|rollback → Release
```

## 注意事项
- **旧卡的 `approveRelease` / `listApprovals` / `ReleaseApproval` 已不在源码**（审批职能不在本模块），引用前先核实归属。
- 状态机 draft→staging→approved→deploying→deployed，任意已部署态可 rolled_back；releases 页按 STATUS_KIND/STATUS_LABELS 控制按钮与标签。
- `target_environment` 区分预发/生产，promote 语义为 staging→production；`change_ids` 是发布与变更中心的关联纽带。
- 本模块未上 react-query，页面手写 useState 拉取；改动时注意与其它 lib 客户端范式不一致。
- `pre_check_result`/`post_check_result`/`deploy_output` 承载部署检查与输出，用于详情展示与排障。

## 人工备注

<!-- MANUAL_NOTES_START -->

<!-- MANUAL_NOTES_END -->
