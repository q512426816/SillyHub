# requirements — 多智能体协作管理平台需求规格

## 1. 角色

| 角色 | 说明 |
|---|---|
| 平台管理员 | 管理平台配置、用户、执行器和全局策略 |
| Workspace Owner | 管理一个 SillySpec Workspace |
| 项目组负责人 | 管理项目组组件和变更优先级 |
| 产品/业务人员 | 输入需求、确认验收标准 |
| 架构师 | 评审设计、接口、数据模型和影响范围 |
| 开发人员 | 执行任务、提交代码、发起 PR |
| 测试人员 | 执行验证、确认 verification |
| 运维人员 | 管理部署、回滚、监控 |
| Agent | 受控执行任务的非人 Actor |
| 审计人员 | 查看操作记录、变更链路和风险记录 |

## 2. 核心概念

### 2.1 Workspace

一个 `.sillyspec` 根目录就是一个 Workspace。

```text
.sillyspec/
```

### 2.2 ProjectComponent

`.sillyspec/projects/*.yaml` 中的每个文件代表一个项目组成员 / 关联项目组件，而不是普通项目列表。

```text
.sillyspec/projects/silly.yaml
.sillyspec/projects/silly-admin-ui.yaml
```

### 2.3 Change

Change 是需求到部署的生命周期主线。

来源：

```text
.sillyspec/changes/change/*
.sillyspec/changes/archive/*
```

### 2.4 Task

Task 是 Change 下的可执行任务。

来源：

```text
.sillyspec/changes/change/{change-id}/tasks/*.md
```

### 2.5 Runtime

`.sillyspec/.runtime` 是当前本地执行态，不是长期事实源，不应提交 Git。

## 3. 功能需求

### FR-001 识别 SillySpec Workspace

平台应能选择一个仓库或目录，并识别是否存在 `.sillyspec`。

验收标准：

- 存在 `.sillyspec` 时进入 Workspace 首页。
- 不存在时提示初始化或选择其他路径。
- 能展示 Workspace 根路径和状态。

### FR-002 解析项目组组件配置

平台应读取：

```text
.sillyspec/projects/*.yaml
```

并解析为 ProjectComponent。

验收标准：

- 显示组件 ID、名称、类型、路径、技术栈、状态。
- 显示组件之间的 relations。
- 能识别组件路径是否存在。
- 能显示组件构建和测试命令。

### FR-003 解析组件扫描文档

平台应读取：

```text
.sillyspec/docs/{component}/scan/*.md
```

包括：

- `ARCHITECTURE.md`
- `CONVENTIONS.md`
- `CONCERNS.md`
- `INTEGRATIONS.md`
- `PROJECT.md`
- `STRUCTURE.md`
- `TESTING.md`

验收标准：

- 组件详情页能展示扫描文档。
- 缺失扫描文档时显示缺失项。
- Agent 上下文构建时可按 affected_components 加载对应扫描文档。

### FR-004 解析 Change

平台应读取：

```text
.sillyspec/changes/change/*
.sillyspec/changes/archive/*
```

验收标准：

- `changes/change/*` 展示为进行中。
- `changes/archive/*` 展示为已归档。
- 每个 Change 显示 MASTER、proposal、requirements、design、plan、tasks、verification 的存在状态。
- 支持展示原型 HTML 等附属产物。

### FR-005 解析 Task

平台应读取：

```text
tasks.md
tasks/task-xx.md
```

验收标准：

- 展示任务总表。
- 展示每个任务详情。
- 支持从文件名推断 task_id。
- 支持读取 frontmatter 中的 status、owner、affected_components。

### FR-006 Runtime 状态展示

平台应读取：

```text
.sillyspec/.runtime/progress.json
.sillyspec/.runtime/user-inputs.md
.sillyspec/.runtime/artifacts/*
```

验收标准：

- 展示当前流程阶段。
- 展示用户输入记录。
- 展示 Agent / 步骤产物。
- 明确标记 `.runtime` 为本地运行态。

### FR-007 Git Identity 管理

平台用户必须绑定自己的 Git Identity 后，才能执行需要访问 Git 仓库的操作。

验收标准：

- 支持绑定 GitHub / GitLab / Gitea / 自建 Git。
- 支持 OAuth Token、Personal Access Token、SSH Key、App Token。
- 凭据加密保存。
- 支持撤销和过期。
- Git 操作默认使用发起人的 Git Identity。

### FR-008 Worktree 隔离

每个任务执行必须使用独立工作目录。

验收标准：

- 路径包含 workspace_id、component_id、change_id、task_id、user_id、run_id。
- 不能共用服务器全局 `~/.ssh`。
- 不能共用服务器全局 `~/.gitconfig`。
- 不能共用同一个仓库工作目录。

### FR-009 Git Tool Gateway

所有 Git 操作必须经过 Git Tool Gateway。

允许操作：

- status
- diff
- branch
- commit
- push task branch
- create PR

禁止或审批操作：

- push main/master
- push --force
- reset --hard
- clean -fd
- merge protected branch
- delete branch
- global git config
- remote set-url

### FR-010 Agent Adapter

平台应支持 Claude Code、Codex、Cursor 等执行器作为 Adapter。

验收标准：

- Agent 不直接控制平台核心权限。
- Agent 只能获得任务上下文。
- Agent 只能访问 affected_components 允许路径。
- Agent 的工具调用进入 Tool Gateway。
- Agent 输出进入 Artifact / Audit。

### FR-011 审批和门禁

关键节点需要人工审批。

验收标准：

- requirements 未确认不能执行开发。
- design 未确认不能进入实现。
- verification 未完成不能合并。
- 生产部署必须人工审批。
- Agent 不能自动合并主分支。

### FR-012 审计追踪

平台必须记录全链路事件。

事件包括：

- 用户操作
- 文档变更
- Git 操作
- Agent Run
- Tool Call
- 审批操作
- 部署操作
- 权限变更

## 4. 非功能需求

### NFR-001 单服务器部署

V1-V3 支持单服务器部署。

### NFR-002 安全隔离

即使单服务器部署，也必须保证：

- 用户 Git 凭据隔离。
- Worktree 隔离。
- Agent 执行目录隔离。
- 高危命令拦截。
- 日志脱敏。

### NFR-003 可演进

系统应从轻量单体演进到：

- Agent Runtime 独立服务。
- Temporal 工作流。
- 容器隔离。
- 多节点执行。

## 5. V1 验收范围

V1 必须实现：

1. Workspace 识别。
2. projects 解析为项目组组件。
3. scan docs 展示。
4. change / archive 展示。
5. task 展示。
6. runtime 展示。
7. Git Identity 数据模型。
8. Worktree 隔离设计落地。
9. 基础审计日志。

V1 不要求实现：

- 自动 Agent 编码。
- 生产部署。
- Temporal。
- K8s。
- 完整企业级多租户。
