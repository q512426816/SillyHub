---
author: qinyi
created_at: 2026-05-29 17:22:24
---

# Design

## 架构决策

### ADR-01: 采用主线 + 独立变更包

本轮不把 SillyHub 平台能力做成一个巨型变更，而是按稳定依赖拆成独立变更包：

```text
2026-05-28-component-as-workspace
  -> 2026-05-29-workspace-intake-spec-bootstrap
  -> 2026-05-29-harness-control-plane
  -> 2026-05-29-local-runner-execution-loop
  -> 2026-05-29-knowledge-lifecycle
  -> 2026-05-29-server-sandbox-runner
```

当前变更只承接 Phase 0：Workspace Graph 数据面。后续包依赖当前包的 Workspace、WorkspaceRelation、Change/Task/AgentRun 多 Workspace 关联能力。

### ADR-02: Workspace 是唯一基本单元

取消 Workspace / Component 二分法。每个可独立管理、扫描、执行和沉淀规范的代码单元都是 Workspace。

具体落法：
- 删除 `backend/app/modules/component/` 旧模块。
- `workspaces` 表吸收旧 Component 元数据字段：`component_key`、`type`、`role`、`repo_url`、`default_branch`、`tech_stack`、`build_command`、`test_command`、`source_yaml_path`。
- 删除 Workspace 上的旧 `sillyspec_path` 语义，规范空间以后由 `spec_workspace` 模块表达。
- `root_path` 可以指向独立仓库，也可以指向 monorepo 子目录。

### ADR-03: WorkspaceRelation 是自由有向图

Workspace 间关系使用 `workspace_relations` 表建模，允许循环依赖，但禁止自环。

关系类型沿用当前平台语义：
- `depends_on`
- `consumes_api_from`
- `tests`
- `publishes_to`
- `documents`

唯一约束为 `(source_id, target_id, relation_type)`，避免重复边。拓扑查询默认返回节点和边，不要求图是 DAG。

### ADR-04: Change / Task / AgentRun 支持多 Workspace

`changes.workspace_id`、`tasks.workspace_id`、`agent_runs.workspace_id` 保留为主 Workspace 或兼容字段，同时新增关联表表达多 Workspace：
- `change_workspaces`
- `task_workspaces`
- `agent_run_workspaces`

API 请求和响应新增 `workspace_ids`，服务层需要兼容旧的 `workspace_id` 单值调用。

### ADR-05: Agent 上下文先基于图构建，不引入新共享知识机制

`backend/app/modules/agent/context_builder.py` 基于 Task 关联的 Workspace 和 WorkspaceRelation 构建 `AgentSpecBundle`。当前包只生成跨 Workspace 的 spec 摘要上下文，不做 Knowledge Candidate 生命周期，也不做 Local Runner 执行闭环。

### ADR-06: Local Runner 作为后续独立包，并参考 multica

`2026-05-29-local-runner-execution-loop` 后续参考 `C:\Users\qinyi\IdeaProjects\multica` 的模式：
- local daemon 注册 workspace/provider runtime。
- heartbeat 保活，server 只向 online runtime 派发任务。
- runner claim task、准备隔离 `workdir/output/logs`、运行 Claude/Codex CLI、流式上报消息。
- session id pin 住以支持 resume，watchdog 识别 tool in-flight，执行后收集 diff/test/artifact。

当前包只保证这些能力将来能从 Workspace Graph 中拿到正确上下文。

## 文件变更清单

### 后端删除

- `backend/app/modules/component/`：旧 Component model/schema/service/router/parser/tests。

### 后端修改

- `backend/app/modules/workspace/model.py`：`Workspace` 吸收 Component 元数据；新增 `WorkspaceRelation`、`ChangeWorkspaceLink`、`TaskWorkspaceLink`、`AgentRunWorkspaceLink`。
- `backend/app/modules/workspace/schema.py`：Workspace 创建/读取 schema 增加元数据和关系字段。
- `backend/app/modules/workspace/service.py`：创建、更新、扫描导入适配 Workspace-only 模型。
- `backend/app/modules/workspace/scanner.py`：从 `.sillyspec/projects/*.yaml` 生成 Workspace 和关系。
- `backend/app/modules/workspace/parser.py`：解析旧 projects yaml 中的 component 元数据和 relations。
- `backend/app/modules/workspace/router.py`：暴露 Workspace、Relation、Topology 相关接口。
- `backend/app/modules/change/schema.py`、`backend/app/modules/change/service.py`：适配 `workspace_ids`。
- `backend/app/modules/task/schema.py`、`backend/app/modules/task/service.py`：适配 `workspace_ids`。
- `backend/app/modules/agent/model.py`、`backend/app/modules/agent/schema.py`、`backend/app/modules/agent/service.py`：适配 AgentRun 多 Workspace。
- `backend/app/modules/agent/context_builder.py`：基于 WorkspaceRelation 构建跨 Workspace 上下文。
- `backend/app/modules/scan_docs/model.py`、`backend/app/modules/scan_docs/schema.py`、`backend/app/modules/scan_docs/service.py`：扫描文档绑定 Workspace。
- `backend/app/main.py`：移除 component router 挂载，保留 workspace 图谱入口。

### 后端新增

- `backend/app/modules/workspace/relation_schema.py`：关系 CRUD schema。
- `backend/app/modules/workspace/relation_service.py`：关系创建、删除、查询和错误映射。
- `backend/app/modules/workspace/topology.py`：全局拓扑图构建。
- `backend/migrations/versions/202606130900_workspace_graph.py`：Workspace Graph 数据模型迁移。
- `backend/app/modules/workspace/tests/test_model.py`
- `backend/app/modules/workspace/tests/test_parser.py`
- `backend/app/modules/workspace/tests/test_relation_router.py`
- `backend/app/modules/agent/tests/test_context_builder.py`
- `backend/app/modules/scan_docs/tests/test_service.py`

### 前端修改

- `frontend/src/lib/workspaces.ts`：Workspace Graph API client。
- `frontend/src/app/(dashboard)/workspaces/page.tsx`：Workspace 列表不再展示 Component 容器语义。
- `frontend/src/app/(dashboard)/workspaces/[id]/components/page.tsx`：迁移为 Workspace 关系/拓扑入口或兼容页。
- `frontend/src/app/(dashboard)/workspaces/[id]/components/topology/page.tsx`：拓扑图读取 WorkspaceRelation。
- `frontend/src/app/(dashboard)/workspaces/[id]/changes/**/*.tsx`：Change/Task 页面适配多 Workspace。
- `frontend/src/components/workspace-card.tsx`
- `frontend/src/components/workspace-scan-dialog.tsx`
- `frontend/src/components/component-detail-drawer.tsx`

## 数据模型

### `workspaces`（修改）

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | UUID PK | 主键 |
| `name` | String(200) | 显示名称 |
| `slug` | String(100) | URL 标识 |
| `root_path` | String | 代码路径 |
| `status` | String(20) | active / archived / deleted |
| `component_key` | String(100), 新增 | 旧组件标识 |
| `type` | String(50), 新增 | service / library / frontend 等 |
| `role` | String(100), 新增 | 功能角色 |
| `repo_url` | String, 新增 | 源码仓库 URL |
| `default_branch` | String(100), 新增 | 默认分支 |
| `tech_stack` | JSON, 新增 | 技术栈 |
| `build_command` | String, 新增 | 构建命令 |
| `test_command` | String, 新增 | 测试命令 |
| `source_yaml_path` | String, 新增 | 来源 projects yaml |
| `created_at` / `updated_at` | DateTime | 审计时间 |
| `deleted_at` | DateTime nullable | 软删除 |

删除旧字段语义：`sillyspec_path`。

### `workspace_relations`（新增）

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | UUID PK | 主键 |
| `source_id` | UUID FK -> `workspaces.id` | 源 Workspace |
| `target_id` | UUID FK -> `workspaces.id` | 目标 Workspace |
| `relation_type` | String(50) | 关系类型 |
| `description` | String nullable | 描述 |
| `created_at` | DateTime | 创建时间 |

约束：
- UQ: `(source_id, target_id, relation_type)`
- CHECK: `source_id != target_id`

### `change_workspaces`（新增）

| 字段 | 类型 | 说明 |
|---|---|---|
| `change_id` | UUID FK -> `changes.id` | Change |
| `workspace_id` | UUID FK -> `workspaces.id` | Workspace |
| `role` | String nullable | primary / affected / referenced |

### `task_workspaces`（新增）

| 字段 | 类型 | 说明 |
|---|---|---|
| `task_id` | UUID FK -> `tasks.id` | Task |
| `workspace_id` | UUID FK -> `workspaces.id` | Workspace |
| `role` | String nullable | primary / affected / referenced |

### `agent_run_workspaces`（新增）

| 字段 | 类型 | 说明 |
|---|---|---|
| `agent_run_id` | UUID FK -> `agent_runs.id` | AgentRun |
| `workspace_id` | UUID FK -> `workspaces.id` | Workspace |

### 删除表

- `project_components`
- `component_relations`

## API 设计

### Workspace

- `POST /api/workspaces`：创建 Workspace，支持 component 元数据字段。
- `GET /api/workspaces`：列表查询。
- `GET /api/workspaces/{workspace_id}`：详情查询。
- `PATCH /api/workspaces/{workspace_id}`：更新。
- `POST /api/workspaces/{workspace_id}/scan`：扫描并同步 Workspace 元数据。

### WorkspaceRelation

- `GET /api/workspaces/{workspace_id}/relations`：查询指定 Workspace 的入边和出边。
- `POST /api/workspaces/{workspace_id}/relations`：创建出边关系。
- `DELETE /api/workspaces/relations/{relation_id}`：删除关系。
- `GET /api/workspaces/topology`：返回全局 Workspace Graph。

### Change / Task / AgentRun

- 创建和读取 schema 支持 `workspace_ids: list[UUID]`。
- 旧 `workspace_id` 单值字段保留兼容，服务层将其视作 primary Workspace。
- 查询 Workspace 详情时可按关联表返回相关 changes / tasks / agent runs。

## 兼容策略

- API 兼容：旧请求只传 `workspace_id` 时仍可创建 Change/Task/AgentRun。
- 数据兼容：项目未上线时可以接受清空或一次性迁移；迁移文件仍必须能建出新表并移除旧表。
- 前端兼容：旧 components 页面可以先作为 Workspace 关系页兼容入口，不再依赖 `/components` 核心 API。
- 语义兼容：`component_key` 保留旧标识，便于用户和扫描文档对齐。

## 风险登记

| 风险 | 影响 | 缓解 |
|---|---|---|
| 前端仍调用旧 `/components` | 页面不可用 | 统一迁移到 `frontend/src/lib/workspaces.ts` |
| 循环依赖导致上下文递归爆炸 | Agent prompt 过大 | `context_builder` 默认 depth=1，并去重 |
| 删除 Component 模块影响旧测试 | CI 大面积失败 | 用 Workspace parser/service 测试覆盖旧行为 |
| 全局拓扑在大规模下变慢 | API 响应慢 | 当前限制 MVP 数据量，后续加缓存/分页 |
| 当前包混入 Runner/Knowledge 实现 | 范围失控 | 明确放入后续独立变更包 |

## 自审

- 当前包只解决 Workspace Graph 数据面，没有提前实现 Local Runner、Knowledge 或 Server Sandbox。
- 后续独立变更包名称和依赖已明确。
- 表名、字段名、模块路径来自当前代码或标注为新增。
- 多 Workspace 关联保留旧 `workspace_id` 兼容路径。
- `multica` 仅作为 Phase 3 参考实现，不作为当前包代码依赖。
