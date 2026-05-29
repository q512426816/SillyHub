---
author: qinyi
created_at: 2026-05-29 17:22:24
---

# Requirements

## 角色

| 角色 | 说明 |
|---|---|
| 平台管理员 | 注册和维护 Workspace，配置 WorkspaceRelation |
| 开发者 | 创建 Change/Task，并选择受影响 Workspace |
| Reviewer | 审查跨 Workspace 影响范围和任务结果 |
| Agent | 读取 AgentSpecBundle，基于 Workspace Graph 获取上下文 |
| 后续 Runner | 后续独立包中的执行器，依赖当前 Workspace Graph 数据面 |

## 功能需求

### FR-01: Workspace 吸收 Component 元数据

Given 创建 Workspace 请求包含 `component_key`、`type`、`role`、`repo_url`、`default_branch`、`tech_stack`、`build_command`、`test_command`
When 平台保存 Workspace
Then 这些字段保存到 `workspaces` 表

Given 查询 Workspace 详情
When Workspace 已保存 Component 元数据
Then 响应返回这些元数据字段

### FR-02: 移除旧 Component 核心数据面

Given 后端启动
When API router 注册完成
Then 不再把旧 `backend/app/modules/component/` router 作为核心入口

Given 前端读取 Workspace 或拓扑
When 页面加载数据
Then 通过 Workspace API 获取数据，而不是依赖旧 `/components` 核心 API

### FR-03: 创建 WorkspaceRelation

Given Workspace A 和 Workspace B 都存在
When 创建 A `depends_on` B
Then `workspace_relations` 新增 `source_id=A`、`target_id=B`、`relation_type=depends_on`

Given A 到 B 已存在 `depends_on`
When 再次创建同类型关系
Then 服务返回重复关系错误或数据库唯一约束错误被映射为业务错误

Given Workspace A 存在
When 创建 A 指向 A 的关系
Then 请求被拒绝

### FR-04: 支持循环依赖图

Given 已存在 A `depends_on` B
And 已存在 B `depends_on` A
When 查询 A 的关系
Then 响应同时包含出边 A -> B 和入边 B -> A

Given 存在 A -> B -> C -> A
When 查询全局拓扑
Then 拓扑结果包含完整环路，不因循环依赖报错

### FR-05: Change 支持多 Workspace

Given 开发者创建 Change 并传入 `workspace_ids=[A,B]`
When 服务保存 Change
Then `change_workspaces` 包含 Change 到 A、B 的关联

Given 旧客户端只传 `workspace_id=A`
When 服务保存 Change
Then Change 仍保存成功，并将 A 视为 primary Workspace

### FR-06: Task 支持多 Workspace

Given 开发者创建 Task 并传入 `workspace_ids=[A,B]`
When 服务保存 Task
Then `task_workspaces` 包含 Task 到 A、B 的关联

Given 查询 Workspace A 的任务
When Task 通过 `task_workspaces` 关联 A
Then 查询结果包含该 Task

### FR-07: AgentRun 支持多 Workspace

Given AgentRun 由一个跨 Workspace Task 触发
When AgentRun 创建
Then `agent_run_workspaces` 记录该 run 涉及的 Workspace

Given 查询 AgentRun 详情
When 该 run 涉及多个 Workspace
Then 响应返回对应 Workspace 列表或 `workspace_ids`

### FR-08: AgentSpecBundle 基于 Workspace Graph 构建

Given Task T 关联 Workspace A
And A `depends_on` Workspace B
When 构建 AgentSpecBundle
Then bundle 包含 A 的 spec 摘要
And bundle 的 `referenced_workspaces` 包含 B 的摘要

Given A -> B -> C 的依赖链
When 构建上下文的 depth 为 1
Then bundle 只包含 A 的直接关联 Workspace，不递归拉取 C

### FR-09: 全局拓扑 API

Given 平台存在多个 Workspace 和 WorkspaceRelation
When 调用 `GET /api/workspaces/topology`
Then 响应返回 nodes 和 edges

Given 某个 Workspace 被软删除或不可见
When 查询拓扑
Then 该 Workspace 不应作为 active 节点展示

### FR-10: 后续独立变更包边界

Given 当前变更包正在实施
When 发现普通仓库接入、Workflow 控制面、Local Runner、Knowledge Lifecycle 或 Server Sandbox 需求
Then 只记录为后续独立变更包，不在当前包实现

## 非功能需求

- 兼容性：旧 `workspace_id` 单值调用仍可用。
- 数据完整性：删除 Workspace 时应清理关联关系和关联表记录。
- 可测试：模型、parser、relation service/router、topology、context builder 都需要 pytest 覆盖。
- 可回退：当前包不引入 Runner 或 Knowledge 状态机，失败时可集中回退 Workspace Graph 迁移。
- 性能：MVP 阶段 100 个 Workspace 内拓扑查询应保持可用，后续大规模优化另立任务。
- 可维护：所有后续阶段必须通过当前 Workspace Graph 取上下文，不重复定义 Component 数据面。
