---
author: qinyi
created_at: 2026-05-29 17:22:24
---

# Proposal

## 动机

SillyHub 后续要承载 Workflow、Agent 执行、工具边界、知识沉淀和 Runner。现有 Workspace / Component 二分法会把这些能力绑在“项目容器”上，而真实执行单元往往是一个仓库、一个 monorepo 子目录、一个服务或一个共享库。

本变更先把 Component 收口为 Workspace Graph：Workspace 成为唯一基本单元，WorkspaceRelation 表达跨 Workspace 依赖，Change/Task/AgentRun 能关联多个 Workspace。这样后续 `workspace-intake-spec-bootstrap`、`harness-control-plane`、`local-runner-execution-loop`、`knowledge-lifecycle`、`server-sandbox-runner` 才有稳定的数据底座。

## 关键问题

### 1. Workspace 仍像项目容器，不像执行单元

当前模型把 Component 放在 Workspace 内部，Change/Task 主要绑定 Workspace。Agent 执行、扫描文档、权限和上下文都容易停留在项目级，无法准确表达“这个任务影响 api-gateway 和 shared-libs”。

### 2. Component 关系被锁在单 Workspace 里

`project_components` 和 `component_relations` 隐含组件属于同一项目。共享库、多仓库服务、跨项目 API 消费关系都需要重复建模，循环依赖也很难成为一等数据。

### 3. 后续 Runner 和 Knowledge 缺少统一上下文入口

Local Runner 需要知道任务涉及哪些 Workspace、关联依赖是什么、应该注入哪些 spec 摘要。Knowledge Candidate 也需要从任务产物反推 Workspace 范围。如果没有 Workspace Graph，后续会在 runner、knowledge、workflow 各自重复造上下文模型。

## 变更范围

- Workspace 吸收 Component 元数据，删除 `project_components` / `component_relations` 核心语义。
- 新增 `workspace_relations`，支持跨 Workspace 有向图和循环依赖。
- 新增 `change_workspaces`、`task_workspaces`、`agent_run_workspaces`，支持多 Workspace 关联。
- 迁移后端 Workspace parser / scanner / service / router / topology。
- 迁移 Agent context builder，使 `AgentSpecBundle` 可以基于 WorkspaceRelation 拉取关联 spec 摘要。
- 迁移前端核心入口，避免继续把 `/components` 作为平台数据面。
- 在 `MASTER.md` 中保留后续独立变更包路线。

## 不在范围内（显式清单）

- 不做 `2026-05-29-workspace-intake-spec-bootstrap` 的普通仓库接入和 Spec Bootstrap 实现。
- 不做 `2026-05-29-harness-control-plane` 的 Workflow / Policy / Audit 完整控制面。
- 不做 `2026-05-29-local-runner-execution-loop` 的 local daemon、runtime 注册、claim task、CLI 执行。
- 不做 `2026-05-29-knowledge-lifecycle` 的 Candidate 审核和知识成熟度流转。
- 不做 `2026-05-29-server-sandbox-runner` 的云端沙箱 Runner。
- 不引入 Workspace 层级、分组、`parent_id`。
- 不把向量索引或共享文档表作为当前知识模型。

## 成功标准（可验证）

- 后端不再需要 `project_components` / `component_relations` 作为核心表。
- `workspaces` 能保存旧 Component 元数据，并且不再暴露旧 `sillyspec_path` 语义。
- `workspace_relations` 能表达 A -> B -> A 的循环依赖，同时拒绝自环和重复边。
- Change、Task、AgentRun 能通过关联表绑定多个 Workspace。
- `GET /api/workspaces/topology` 返回 Workspace 节点和关系边。
- `AgentSpecBundle` 能根据 Task 关联 Workspace 和 WorkspaceRelation 拉取相关 spec 摘要。
- 前端核心 Workspace/Topology/Change/Task 页面不再依赖旧 `/components` 数据面。
- 当前变更包文档明确列出后续独立变更包，不把 Runner/Knowledge/Sandbox 提前混入实现。
