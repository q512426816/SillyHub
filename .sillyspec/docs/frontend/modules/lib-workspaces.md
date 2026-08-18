---
schema_version: 1
doc_type: module-card
module_id: lib-workspaces
author: qinyi
created_at: 2026-08-18 01:45:00
---

# 工作区本体客户端（lib-workspaces）

## 定位
工作区本体域 API 客户端（`frontend/src/lib/workspaces.ts`，163 行）。封装扫描生成、服务端筛选分页列表、CRUD、组件只读目录与全局拓扑，是工作区页面的主数据来源。响应类型全部从 OpenAPI 生成类型（api-types.ts `Schemas[...]`）派生为单一真相（change 2026-07-04-fix-frontend-type-divergence task-11），请求输入类型保留手写以维持窄约束。实测消费方：app-pages 与 app-workspace-pages 多页（workspaces 列表/详情/scan-docs/runtime/agent）、lib-components（薄封装）、workspace-config-card、agent-profile-form、移动端 /m/workspaces。

## 契约摘要
- 扫描生成：
  - `scanGenerate(rootPath, provider?, model?, specStrategy?, daemonId?): Promise<ScanGenerateResponse>` — POST `/api/workspaces/scan-generate`；四个可选参数条件展开（有值才进 json）；`daemon_id` 是 daemon-entity-binding 后的稳定绑定键（runtime 维度已下沉到 per-member binding）。
- 列表：
  - `listWorkspaces(params?: WorkspaceListParams): Promise<WorkspaceListResponse>` — GET `/api/workspaces`；`WorkspaceListParams = { q?, type?, status?, user_id?, limit?, offset?, include_deleted? }`（服务端筛选分页，无参调用保持全量兼容）。
- CRUD：
  - `createWorkspace(input: CreateWorkspaceInput): Promise<Workspace>` — POST `/api/workspaces`；input 含 `name/root_path/slug?/spec_strategy?/daemon_id?`，daemon_id 供后端建 workspace_member_runtimes 成员绑定行。
  - `getWorkspace(id): Promise<Workspace>` — GET `/api/workspaces/{id}`。
  - `updateWorkspace(id, input: UpdateWorkspaceInput): Promise<Workspace>` — PATCH；input 覆盖 name/slug/display_alias/repo_url/default_branch/default_agent/default_model/tech_stack/build_command/test_command/status。
  - `deleteWorkspace(id): Promise<Workspace>` — DELETE（软删除，返回被删实体）。
  - `rescanWorkspace(id): Promise<ScanResult>` — POST `/api/workspaces/{id}/rescan`。
- 组件与拓扑：
  - `getWorkspaceComponents(workspaceId): Promise<ComponentListResponse>` — GET `/api/workspaces/{ws}/components`；组件从 projects/*.yaml 派生只读（D-001@V1 变更 2026-07-06-component-readonly-split）。
  - `getTopology(): Promise<TopologyResponse>` — GET `/api/workspaces/topology`（全局 nodes+edges，非单工作区）。
- 类型：`Workspace` / `WorkspaceListResponse` / `WorkspaceStatus`（从 WorkspaceRead.status 派生，自动含 "pending"）/ `OwnerRead` / `ScanResult` / `ScanGenerateResponse` / `TopologyNode/Edge/Response` 均为生成类型别名；`Component` / `ComponentListResponse` 本文件手写。

## 关键逻辑
```
scanGenerate: POST /api/workspaces/scan-generate
  json = { root_path, ...(provider && {provider}), ...(model && {model}),
           ...(daemonId && {daemon_id}), ...(specStrategy && {spec_strategy}) }
listWorkspaces: GET /api/workspaces?q=&type=&status=&user_id=&limit=&offset=&include_deleted=
updateWorkspace: PATCH /api/workspaces/{id}
  # PATCH 依赖后端 exclude_unset: default_agent 传 null=显式清空, 字段省略=不变
getTopology: GET /api/workspaces/topology → { nodes, edges }
```

## 注意事项
- **旧符号已删**：scanWorkspace / activateWorkspace / reparseWorkspace / getWorkspaceRelations / createRelation / deleteRelation 在 frontend/src 零命中（grep 核实），_module-map 的 main_symbols 是过时清单；reparse 能力在其它域模块（scan-docs/components/tasks 各自的 reparse*），本模块**没有** reparse 入口。
- `Workspace.path_source` 区分 `"server-local"`（服务端本地路径）与 `"daemon-client"`（daemon 客户端机器路径），影响路径展示与目录浏览方式。
- `listWorkspaces` 的 `user_id` 仅平台管理员视图生效（2026-06-25-admin-global-daemon-workspace-management D-003），普通账号不传。
- PATCH 语义依赖后端 `exclude_unset`：null 显式清空、省略不变，适用 `default_agent`（FR-02）与 `display_alias` 等。
- 后端 schema 变动时：响应类型经 `pnpm gen:types` 自动跟随；但手写的请求输入类型与 `Component` 需人工核对（CLAUDE.md 规则：schema 改动同 change 内必须跑 gen:types）。
- `lib-components`（lib/components.ts）是 getWorkspaceComponents 的薄封装且复用其 `Component` 类型——组件查询新能力落在那边，勿在此扩。
- 同文件名近邻易混：`lib/workspace.ts`（单数，PPM 关联客户端）、`lib/workspace-*.ts`（binding/status/members/path），import 时看清。

## 人工备注

<!-- MANUAL_NOTES_START -->

<!-- MANUAL_NOTES_END -->
