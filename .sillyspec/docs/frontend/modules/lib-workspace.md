---
schema_version: 1
doc_type: module-card
module_id: lib-workspace
author: qinyi
created_at: 2026-08-18 01:45:00
---

# 项目工作区关联客户端（lib-workspace）

## 定位
PPM 项目 ↔ 工作区关联的浏览器侧 API 客户端（`frontend/src/lib/workspace.ts`，168 行，源自 change 2026-07-28-ppm-project-link-workspace）。双边对称的 6 个函数操作同一张 `ppm_project_workspace` 关联表：工作区侧管"这个工作区挂了哪些 PPM 项目"，项目侧管"这个项目挂了哪些工作区"。供 `components-workspace`（LinkWorkspaceDialog / LinkedProjectsSection）消费。与 `lib-workspaces`（工作区 CRUD 本体）是两个模块，注意 import 时别混。

## 契约摘要
- 工作区侧（基址 `/api/workspaces/{ws}/ppm-projects`）：
  - `listLinkedProjects(workspaceId): PpmProjectBrief[]` — 列关联项目（过滤软删除工作区）。
  - `linkProject(workspaceId, ppmProjectId): PpmProjectBrief` — 绑定，重复 409、项目不存在 404。
  - `unlinkProject(workspaceId, ppmProjectId): void` — 解绑，幂等（不存在静默 204）。
- 项目侧（基址 `/api/ppm/projects/{pid}/workspaces`）：
  - `listProjectWorkspaces(projectId): WorkspaceBrief[]` — 列关联工作区。
  - `linkWorkspace(projectId, workspaceId): WorkspaceBrief` — 绑定，非 manager 403。
  - `unlinkWorkspace(projectId, workspaceId): void` — 解绑，幂等。
- 类型：`PpmProjectBrief`（project_id/name/status，均可为 null 除 id）、`WorkspaceBrief`（workspace_id/name/status/type）、`BindPpmProjectRequest` / `BindWorkspaceRequest`。

## 关键逻辑
```
workspacePpmBase(wid) = `/api/workspaces/${encodeURIComponent(wid)}/ppm-projects`
projectWorkspaceBase(pid) = `/api/ppm/projects/${encodeURIComponent(pid)}/workspaces`
linkProject:  POST   base, json { ppm_project_id }        → 201 PpmProjectBrief
unlinkWorkspace: DELETE base/${workspaceId}               → 204（幂等）
```

## 注意事项
- 类型目前为**手写** DTO（字段名与 backend schema 1:1）；文件头注释提及后续由 `pnpm gen:types` 对齐，若后端 schema 变动需人工核对字段。
- 错误不本地处理：统一由 `apiFetch` 抛 `ApiError`（401 自动 refresh，403/404/409 透传），调用方按 status 决定提示文案。
- 每个函数包了一层 try/catch 重新 throw（telemetry hook 预留位，`eslint-disable no-useless-catch`），无业务语义，勿"顺手清理"除非同步移除约定。
- 双侧权限模型不对称：工作区侧绑定要"工作区成员管理"权限，项目侧要"项目 manager"；解绑双侧均幂等。
- id 一律走 `encodeURIComponent`（虽为 UUID，防御性编码）。

## 人工备注

<!-- MANUAL_NOTES_START -->

<!-- MANUAL_NOTES_END -->
