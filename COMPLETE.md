# 多智能体协作管理平台搭建完整 MD


---

# MASTER — 多智能体协作管理平台搭建总控文档 v2

## 1. 变更标识

```yaml
id: 2026-05-25-multi-agent-platform-bootstrap-v2
title: 多智能体协作管理平台搭建
status: draft
change_type: platform-bootstrap
workspace: multi-agent-platform
owner: qinyi
affected_components:
  - platform-web
  - platform-api
  - agent-runtime
  - sillyspec-adapter
  - git-runtime
  - docs
```

## 2. 背景

目标是开发一个平台，让团队成员可以在同一个系统中完成多个相关项目的全生命周期执行：需求输入、提案、需求澄清、设计、计划、任务拆解、开发执行、测试验证、Review、审批、合并、部署、归档、复盘。

平台必须原生兼容 SillySpec 工具生成的真实结构：

```text
.sillyspec/
  projects/
  docs/
  knowledge/
  changes/
    change/
    archive/
  quicklog/
  .runtime/
  local.yaml
```

其中 `.sillyspec/projects/*.yaml` 不是普通意义上的项目列表，而是当前 SillySpec Workspace 下的项目组成员 / 关联项目组件配置。

## 3. 核心目标

1. 读取并展示 SillySpec Native Layout。
2. 管理 Workspace、项目组组件、Change、Task、Runtime、Knowledge。
3. 支持一个 Change 影响多个项目组件。
4. 支持多人协作，但每个人只能控制自己有 Git 权限的仓库、分支和任务。
5. 支持 Claude Code、Codex、Cursor 等执行器作为可插拔 Agent Adapter。
6. 所有 Agent 工具调用必须经过 Tool Gateway。
7. 所有 Git 操作必须经过 Git Tool Gateway。
8. 所有关键节点必须可审计、可审批、可追溯。

## 4. 非目标

V1 不做：

- 不做完整多租户 SaaS。
- 不做生产级自动部署。
- 不做 Agent 自动合并主分支。
- 不做 Agent 自动修改权限和密钥。
- 不做平台自定义文档协议替代 SillySpec。
- 不做复杂微服务拆分。

## 5. 核心原则

```text
1. SillySpec 是项目事实源，平台是可视化和执行运行时。
2. Change 是生命周期主线，不是 Task。
3. projects 是项目组组件配置，不是顶层项目列表。
4. Agent 是受控执行者，不是系统中心。
5. 人是责任主体，Agent 只能辅助执行。
6. 平台可以单服务器部署，但 Git 身份、凭据、Worktree、执行环境必须隔离。
7. 不能使用全局超级 Git Token 操作所有仓库。
8. 所有 Git 操作都必须记录 user_id、git_identity_id、workspace_id、component_id、change_id、task_id、run_id。
```

## 6. 生命周期总览

```text
需求输入
  ↓
创建 Change
  ↓
proposal.md
  ↓
requirements.md
  ↓
加载 affected_components 上下文
  ↓
design.md / prototype
  ↓
plan.md
  ↓
tasks.md + tasks/task-xx.md
  ↓
Spec Guardian 门禁
  ↓
人 / Agent 执行任务
  ↓
Git Identity + Worktree 隔离
  ↓
Tool Gateway 控制工具
  ↓
测试验证
  ↓
verification.md
  ↓
Review / 审批
  ↓
PR / 合并
  ↓
部署
  ↓
归档到 changes/archive
  ↓
知识沉淀到 knowledge / quicklog
```

## 7. 文档清单

- `proposal.md`：平台搭建提案
- `requirements.md`：完整需求规格
- `design.md`：系统设计
- `plan.md`：实施计划
- `tasks.md`：任务总表
- `verification.md`：验收验证方案
- `tasks/`：可执行任务拆解
- `references/`：架构、权限、Git 隔离、API、部署等补充设计


---

# proposal — 多智能体协作管理平台搭建提案

## 1. 问题陈述

团队希望开发一个平台来管理多项目、多成员、多 Agent 的协同交付过程。该平台同时又要用于管理自身的开发，因此需要支持自举式开发。

现有 SillySpec 已经形成了完整的变更包结构，但还缺少多人协作、可视化、权限控制、Git 身份隔离、Agent 执行管理、审批审计和部署闭环。

## 2. 关键问题

### 2.1 多人协作问题

多人在同一台服务器部署的平台上操作，如果没有隔离，会产生：

- A 用户使用 B 用户 Git 凭据。
- A Agent 修改 B 项目代码。
- 所有人共用一个服务器级 `~/.ssh`。
- 平台使用一个全局 Token 访问所有仓库。
- 任务、分支、工作目录互相覆盖。
- 审计无法判断真正的发起人。

### 2.2 多项目组问题

SillySpec 的 `projects` 不是普通项目列表，而是项目组中的相关组件配置。一个变更可能同时影响后端、前端、文档和测试工程。

因此平台模型不能是：

```text
Project → Change → Task
```

而应是：

```text
Workspace
  ├─ ProjectComponent[]
  └─ Change[]
       └─ affected_components[]
```

### 2.3 Agent 可控性问题

Claude Code、Codex、Cursor 等工具可以执行代码任务，但不能直接获得无限 Git、Shell、文件、部署权限。所有执行必须通过 Adapter、Runtime、Tool Gateway 和审批机制。

## 3. 提案目标

建立一个 SillySpec Native 平台，第一阶段先实现：

1. 识别 `.sillyspec` Workspace。
2. 解析项目组组件配置。
3. 解析 Scan Docs。
4. 展示 active / archived changes。
5. 展示 task 看板。
6. 展示 runtime 状态。
7. 引入 Git Identity 和 Worktree 隔离设计。
8. 为后续 Agent 执行奠定权限和审计边界。

## 4. 设计取向

平台第一阶段不是“AI 自动开发平台”，而是：

```text
SillySpec Native Viewer + Change Lifecycle Manager + Git Safety Runtime
```

后续再演进到：

```text
Controlled Multi-Agent Execution Platform
```

## 5. 预期收益

- 团队能以 Change 为中心管理需求到部署全生命周期。
- SillySpec 真实结构被完整可视化。
- 多项目组组件的影响范围更清晰。
- 多人 Git 权限不互相污染。
- Agent 可以接入，但被严格关在权限边界内。
- 平台自身可以被平台逐步管理。


---

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


---

# design — 多智能体协作管理平台系统设计

## 1. 总体架构

```text
Web UI
  ↓
API Server
  ↓
SillySpec Native Adapter
  ├─ Workspace Scanner
  ├─ Project Component Parser
  ├─ Scan Docs Parser
  ├─ Change Parser
  ├─ Task Parser
  ├─ Runtime Reader
  └─ Knowledge Reader
  ↓
Core Domain
  ├─ Workspace Manager
  ├─ Project Group / Component Manager
  ├─ Change Manager
  ├─ Task Manager
  ├─ Git Identity Manager
  ├─ Worktree Manager
  ├─ Agent Runtime Manager
  ├─ Tool Gateway
  ├─ Approval Center
  └─ Audit Center
  ↓
Storage
  ├─ SQLite/PostgreSQL
  ├─ File System
  ├─ Git Repositories
  └─ Artifact Storage
```

## 2. SillySpec Native Layout

平台原生支持以下结构：

```text
.sillyspec/
  projects/
  docs/
  knowledge/
  changes/
    archive/
    change/
  quicklog/
  .runtime/
  local.yaml
```

## 3. 领域模型

### 3.1 Workspace

```text
Workspace
  id
  name
  root_path
  sillyspec_path
  status
  created_by
  created_at
```

一个 Workspace 对应一个 `.sillyspec` 根目录。

### 3.2 ProjectComponent

```text
ProjectComponent
  id
  workspace_id
  component_key
  name
  type
  role
  path
  repo_url
  default_branch
  tech_stack[]
  build_command
  test_command
  status
```

来源：

```text
.sillyspec/projects/*.yaml
```

### 3.3 ComponentRelation

```text
ComponentRelation
  id
  workspace_id
  source_component_id
  target_component_id
  relation_type
  description
```

用于表达前端依赖后端、后端提供 API、测试工程覆盖核心工程等关系。

### 3.4 ScanDocument

```text
ScanDocument
  id
  workspace_id
  component_id
  doc_type
  path
  title
  last_modified_at
```

### 3.5 Change

```text
Change
  id
  workspace_id
  change_key
  title
  status
  location
  path
  affected_components[]
  created_at
  archived_at
```

其中：

```text
location = active | archive
```

### 3.6 ChangeDocument

```text
ChangeDocument
  id
  workspace_id
  change_id
  doc_type
  path
  exists
  status
```

支持：

```text
MASTER
proposal
requirements
design
plan
tasks
verification
prototype
reference
```

### 3.7 Task

```text
Task
  id
  workspace_id
  change_id
  task_key
  title
  status
  owner_id
  affected_components[]
  path
  priority
```

### 3.8 GitIdentity

```text
GitIdentity
  id
  user_id
  provider
  git_username
  git_email
  credential_type
  encrypted_credential
  expires_at
  revoked_at
```

### 3.9 WorktreeLease

```text
WorktreeLease
  id
  workspace_id
  component_id
  change_id
  task_id
  user_id
  run_id
  path
  branch_name
  status
  locked_at
  released_at
```

### 3.10 GitOperationLog

```text
GitOperationLog
  id
  workspace_id
  component_id
  change_id
  task_id
  run_id
  user_id
  git_identity_id
  operation
  branch_name
  commit_sha
  success
  error_message
  created_at
```

## 4. 生命周期设计

### 4.1 输入到 Change

用户输入需求后，平台创建：

```text
.sillyspec/changes/change/{date}-{slug}/
  MASTER.md
  proposal.md
  requirements.md
  design.md
  plan.md
  tasks.md
  verification.md
  tasks/
```

### 4.2 Change 到 Task

`plan.md` 定义实施路线，`tasks.md` 和 `tasks/task-xx.md` 定义可执行任务。

每个任务必须明确：

```text
affected_components
allowed_paths
acceptance
verification
```

### 4.3 Task 到执行

执行前：

1. 检查用户平台权限。
2. 检查用户 Git Identity。
3. 检查用户是否有 component repo 权限。
4. 创建独立 worktree。
5. 创建临时 HOME。
6. 注入当前用户 Git 凭据。
7. 启动人或 Agent 执行。

### 4.4 执行到验证

执行结果进入：

```text
verification.md
.runtime/artifacts
Git diff
AuditLog
```

### 4.5 验证到归档

通过 Review 和审批后：

```text
changes/change/{change-id}
  ↓
changes/archive/{change-id}
```

经验沉淀到：

```text
knowledge/
quicklog/
```

## 5. Git 隔离设计

平台可以单服务器部署，但必须做到：

```text
一个用户一个 Git Identity
一个任务一个 Worktree
一个执行一个临时 HOME
一个 Agent Run 一个凭据注入
所有 Git 操作经过 Git Tool Gateway
所有合并经过 PR 和人工审批
```

### 5.1 Worktree 路径

```text
/data/sillyspec-workspaces/
  {workspace_id}/
    components/
      {component_id}/
        worktrees/
          {user_id}/
            {change_id}/
              {task_id}/
                {run_id}/
                  repo/
```

### 5.2 执行环境

每次执行设置：

```text
HOME=/tmp/sillyspec-runs/{run_id}/home
GIT_CONFIG_GLOBAL=/tmp/sillyspec-runs/{run_id}/gitconfig
GIT_ASKPASS=/tmp/sillyspec-runs/{run_id}/askpass.sh
SSH_AUTH_SOCK=/tmp/sillyspec-runs/{run_id}/ssh-agent.sock
```

禁止使用服务器默认：

```text
~/.ssh
~/.gitconfig
全局 credential helper
```

## 6. Agent Adapter 设计

```text
AgentAdapter
  prepare(context)
  run(input)
  cancel(run_id)
  collect_artifacts(run_id)
```

实现：

```text
ClaudeCodeAdapter
CodexAdapter
CursorAdapter
ShellAdapter
```

平台负责：

- 构建上下文。
- 限制路径。
- 注入凭据。
- 记录日志。
- 收集产物。
- 审计工具调用。

执行器只负责干活。

## 7. Tool Gateway 设计

所有工具调用走 Gateway：

```text
file_read
file_write
shell_exec
git_status
git_diff
git_commit
git_push_branch
create_pr
run_tests
```

高危操作进入审批：

```text
deploy_production
db_migration
git_merge
git_push_main
secret_read
```

## 8. 页面设计

### 8.1 Workspace 首页

- Workspace 状态
- 项目组组件
- 进行中 Change
- 最近归档 Change
- Runtime 当前状态
- 风险摘要

### 8.2 项目组组件页

- 组件列表
- 组件拓扑
- 组件路径
- 技术栈
- 构建命令
- 测试命令

### 8.3 组件认知页

- ARCHITECTURE
- STRUCTURE
- CONVENTIONS
- TESTING
- CONCERNS
- INTEGRATIONS

### 8.4 变更中心

- 进行中变更
- 归档变更
- affected_components
- 任务数量
- 验证状态

### 8.5 变更详情页

- MASTER
- proposal
- requirements
- design
- prototype
- plan
- tasks
- verification

### 8.6 Git 身份页

- 绑定 Git 账号
- 查看 provider
- 查看权限检查结果
- 撤销凭据
- 过期提示

### 8.7 Agent 控制台

- Agent Run
- 任务上下文
- allowed paths
- tool calls
- logs
- diff
- cost

## 9. 技术选型

### V1 推荐

```text
前端：Next.js + TypeScript + shadcn/ui
后端：FastAPI
数据库：SQLite 或 PostgreSQL
队列：先不用或轻量 Redis
执行：本机进程 + Worktree 隔离
Git：Git Tool Gateway
部署：单服务器 Docker Compose 或直接进程
```

### V3+ 推荐

```text
PostgreSQL
Redis
Temporal
Docker Agent Sandbox
OpenTelemetry
Prometheus / Grafana
S3 / MinIO
```

## 10. 安全边界

禁止：

- 全局超级 Git Token。
- 所有用户共用 Git 凭据。
- 所有任务共用工作目录。
- Agent 直接执行裸 git。
- Agent 自动合并主分支。
- Agent 自动部署生产。
- Agent 读取服务器全局 SSH Key。

必须：

- 用户绑定 Git Identity。
- 凭据加密。
- 执行时临时注入。
- 日志脱敏。
- Worktree Lease。
- GitOperationLog。
- ToolCall Audit。


---

# plan — 平台搭建实施计划

## 1. 阶段划分

```text
V0 文档基线
V1 SillySpec Native Viewer
V2 平台写入 SillySpec
V3 工作流、审批、审计
V4 Agent 受控执行
V5 部署、运维、复盘闭环
```

## 2. V0：文档基线

目标：形成标准 SillySpec 变更包。

产物：

- MASTER.md
- proposal.md
- requirements.md
- design.md
- plan.md
- tasks.md
- verification.md
- references/*

验收：

- 能解释 Workspace、ProjectComponent、Change、Task、Runtime。
- 能解释多人 Git 隔离设计。
- 能作为开发输入。

## 3. V1：SillySpec Native Viewer

目标：平台能读取真实 `.sillyspec` 结构并展示。

功能：

1. 选择 Workspace。
2. 解析 projects/*.yaml。
3. 解析 docs/{component}/scan/*.md。
4. 解析 changes/change/*。
5. 解析 changes/archive/*。
6. 解析 tasks.md 和 tasks/*.md。
7. 读取 .runtime/progress.json。
8. 展示 Workspace 首页、组件页、变更中心、任务看板。
9. 建立 GitIdentity、WorktreeLease、GitOperationLog 基础模型。

## 4. V2：平台写入 SillySpec

目标：平台可以创建和修改 Change 包。

功能：

1. 创建 Change。
2. 生成 proposal.md。
3. 生成 requirements.md。
4. 生成 design.md。
5. 生成 plan.md。
6. 生成 tasks.md。
7. 生成 tasks/task-xx.md。
8. 查看 Git diff。
9. 使用用户 Git Identity 提交到任务分支。
10. 创建 PR。

## 5. V3：工作流、审批、审计

目标：让 Change 生命周期状态化。

功能：

1. Change 状态机。
2. Task 状态机。
3. Spec Guardian 检查。
4. Review 封驳。
5. 审批节点。
6. 审计日志。
7. Git Tool Gateway 完整落地。
8. Worktree Lease 释放和清理。

## 6. V4：Agent 受控执行

目标：接入 Claude Code、Codex、Cursor。

功能：

1. Agent Adapter。
2. Agent Run。
3. 上下文注入。
4. allowed_paths / denied_paths。
5. shell/git/file 工具网关。
6. 代码 diff 收集。
7. 测试执行。
8. verification 更新。
9. 人工审批后 PR。

## 7. V5：部署与运维闭环

目标：从需求到部署完整闭环。

功能：

1. 发布单。
2. 环境管理。
3. 部署审批。
4. 回滚方案。
5. 监控结果回填。
6. 事故记录。
7. 复盘沉淀到 knowledge。

## 8. 推荐时间线

| 阶段 | 周期 | 重点 |
|---|---:|---|
| V0 | 1 周 | 文档基线 |
| V1 | 3-4 周 | 只读解析和展示 |
| V2 | 3-4 周 | 写入和 Git 分支 |
| V3 | 4-5 周 | 审批、审计、状态机 |
| V4 | 5-6 周 | Agent 执行 |
| V5 | 4-6 周 | 部署闭环 |

## 9. 第一迭代只做什么

第一迭代建议只做：

```text
SillySpec Native Viewer + Git Identity 数据模型 + Worktree 隔离基础
```

不要提前做：

```text
自动 Agent 编码
生产部署
完整工作流引擎
复杂多租户
Kubernetes
```


---

# tasks — 平台搭建任务总表

## 任务列表

| 编号 | 任务 | 阶段 | 优先级 | 说明 |
|---|---|---|---|---|
| task-01 | 初始化平台仓库与基础工程 | V1 | P0 | 前后端基础结构 |
| task-02 | 实现 Workspace 识别 | V1 | P0 | 识别 `.sillyspec` |
| task-03 | 实现 projects 组件配置解析 | V1 | P0 | 注意 projects 是项目组组件，不是项目列表 |
| task-04 | 实现 scan docs 解析 | V1 | P0 | 组件认知文档 |
| task-05 | 实现 Change 解析 | V1 | P0 | change/archive |
| task-06 | 实现 Task 解析和看板 | V1 | P0 | tasks.md 和 tasks/*.md |
| task-07 | 实现 Runtime 状态展示 | V1 | P1 | .runtime 读取 |
| task-08 | 实现 Knowledge / Quicklog 展示 | V1 | P1 | 知识和日志 |
| task-09 | 实现 Git Identity Manager | V1/V2 | P0 | 多人 Git 权限基础 |
| task-10 | 实现 Worktree Manager | V1/V2 | P0 | 单服务器隔离核心 |
| task-11 | 实现 Git Tool Gateway | V2/V3 | P0 | 拦截危险 Git 操作 |
| task-12 | 实现平台写入 Change 包 | V2 | P1 | 生成 MD |
| task-13 | 实现审批和状态机 | V3 | P1 | 生命周期管理 |
| task-14 | 实现 Agent Adapter 接口 | V4 | P1 | Claude Code / Codex / Cursor |
| task-15 | 实现 Tool Gateway 通用能力 | V4 | P1 | file/shell/test/git |
| task-16 | 实现部署和归档闭环 | V5 | P2 | release/archive/knowledge |

## 第一批必须完成

```text
task-01
task-02
task-03
task-04
task-05
task-06
task-09
task-10
```

这批完成后，平台已经具备 SillySpec Native Viewer 和多人 Git 隔离基础。


---

# verification — 平台搭建验证方案

## 1. V1 验证目标

验证平台能正确理解和展示 SillySpec Native Layout，并为多人 Git 隔离打好基础。

## 2. 测试样例

使用以下结构作为测试输入：

```text
.sillyspec/
  projects/
    silly.yaml
    silly-admin-ui.yaml
  docs/
    silly/scan/*.md
    silly-admin-ui/scan/*.md
  knowledge/
    INDEX.md
    uncategorized.md
  changes/
    change/2026-05-25-silly-query-enhancement/
    archive/2026-05-21-persistence-spi-jdbc-tck/
  quicklog/
    QUICKLOG-qinyi.md
  .runtime/
    progress.json
    user-inputs.md
    artifacts/
  local.yaml
```

## 3. 必须通过的验证项

### 3.1 Workspace 识别

- 能识别 `.sillyspec`。
- 能读取目录结构。
- 缺失目录时给出友好提示。

### 3.2 projects 解析

- 能将 `projects/*.yaml` 解析为 ProjectComponent。
- 不能错误地展示为普通项目列表。
- 能显示组件关系。
- 能校验组件 path 是否存在。

### 3.3 scan docs 解析

- 能按组件展示 scan 文档。
- 缺失文档显示 warning。
- 能将 scan docs 作为 Agent 上下文候选来源。

### 3.4 Change 解析

- `changes/change/*` 显示为进行中。
- `changes/archive/*` 显示为已归档。
- 能展示 MASTER、proposal、requirements、design、plan、tasks、verification 完整性。

### 3.5 Task 解析

- 能读取 tasks.md。
- 能读取 tasks/task-xx.md。
- 能展示任务看板。
- 无 frontmatter 时能从文件名推断 ID。

### 3.6 Runtime 解析

- 能读取 progress.json。
- 能显示 user-inputs.md。
- 能列出 artifacts。
- 明确 runtime 不作为长期事实源。

### 3.7 Git Identity 验证

- 用户未绑定 Git Identity 时不能执行 Git 操作。
- 用户绑定 Git Identity 后只能访问其有权限的仓库。
- Git 操作使用用户自己的身份。
- 不使用服务器全局 Git 凭据。

### 3.8 Worktree 隔离验证

- 不同用户同一任务使用不同 worktree。
- 同一用户不同任务使用不同 worktree。
- Agent Run 有独立 HOME。
- run 结束后临时凭据被销毁。

### 3.9 Git Tool Gateway 验证

允许：

```text
git status
git diff
git commit
git push task branch
```

禁止：

```text
git push origin main
git push --force
git reset --hard
git config --global
git remote set-url
```

## 4. V1 完成标准

```text
能读、能看、能索引、能隔离 Git 身份和 Worktree。
```

不要求：

```text
自动编码、自动部署、自动合并。
```


---

# 01 — SillySpec Native Layout 设计

## 1. 标准结构

```text
.sillyspec/
  projects/
  docs/
  knowledge/
  changes/
    archive/
    change/
  quicklog/
  .runtime/
  local.yaml
```

## 2. 关键语义

### Workspace

一个 `.sillyspec` 根目录就是一个 Workspace。

### projects

`projects/*.yaml` 是项目组成员 / 关联项目组件配置，不是普通项目列表。

### docs

`docs/{component}/scan` 是组件级扫描认知。

### changes

`changes/change` 是进行中变更。

`changes/archive` 是已归档变更。

一个变更可以影响多个组件。

### knowledge

Workspace 级知识库。

### quicklog

用户级快速日志。

### .runtime

当前本地执行态，不应提交 Git。

### local.yaml

本地运行配置，建议不提交；如需模板，使用 `local.example.yaml`。

## 3. 平台适配原则

平台不能要求用户迁移到新的目录结构。

平台应该：

```text
读取原始文件
保留原始路径
建立内部索引
提供可视化和执行管理
```


---

# 02 — 从需求输入到系统部署全生命周期

## 1. 生命周期图

```text
需求输入
  ↓
创建 Change
  ↓
proposal.md
  ↓
requirements.md
  ↓
加载项目组组件上下文
  ↓
design.md / prototype
  ↓
plan.md
  ↓
tasks.md + tasks/task-xx.md
  ↓
Spec Guardian 检查
  ↓
人 / Agent 执行任务
  ↓
Git Identity + Worktree 隔离
  ↓
Tool Gateway 控制工具
  ↓
测试验证
  ↓
verification.md
  ↓
Review / 审批
  ↓
PR / 合并
  ↓
部署
  ↓
归档 archive
  ↓
知识沉淀
```

## 2. 输入阶段

输入来源：

- 平台表单。
- quicklog。
- 外部 Issue。
- SillySpec 工具命令。
- 人工创建变更包。

输出：

```text
.sillyspec/changes/change/{change-id}/
```

## 3. Proposal 阶段

回答：为什么做、解决什么问题、影响哪些组件、不做什么。

输出：

```text
proposal.md
MASTER.md
```

## 4. Requirements 阶段

回答：用户故事、验收标准、边界条件、异常场景。

输出：

```text
requirements.md
```

门禁：requirements 未确认，不允许进入执行。

## 5. Design 阶段

回答：架构、接口、数据、UI、风险、影响范围。

输出：

```text
design.md
prototype-xxx.html
```

## 6. Plan 阶段

回答：如何实施、顺序、依赖、验证方式。

输出：

```text
plan.md
```

## 7. Task 阶段

输出：

```text
tasks.md
tasks/task-xx.md
```

每个任务必须明确：

```text
affected_components
allowed_paths
acceptance
verification
```

## 8. Execute 阶段

执行者：

- 人。
- Claude Code。
- Codex。
- Cursor。
- 自定义 Agent。

约束：

- Git 身份隔离。
- Worktree 隔离。
- Tool Gateway。
- 审计日志。

## 9. Verification 阶段

输出：

```text
verification.md
```

内容：

- 测试命令。
- 测试结果。
- 覆盖的验收标准。
- 失败记录。
- 修复记录。

## 10. Review 和审批

Review 类型：

- Spec Review。
- Code Review。
- Test Review。
- Security Review。
- Release Review。

## 11. Merge 和部署

原则：

- Agent 不能自动合并主分支。
- 生产部署必须人工审批。
- 部署必须可回滚。

## 12. Archive 和知识沉淀

完成后移动：

```text
changes/change/{change-id}
  → changes/archive/{change-id}
```

经验沉淀：

```text
knowledge/
quicklog/
```


---

# 03 — 领域模型

## 核心模型

```text
Workspace
ProjectComponent
ComponentRelation
ScanDocument
Change
ChangeDocument
Task
RuntimeState
KnowledgeDocument
QuickLog
GitIdentity
WorktreeLease
AgentRun
ToolCall
AuditEvent
Approval
Artifact
```

## 关系

```text
Workspace
  ├─ ProjectComponent[]
  ├─ Change[]
  ├─ KnowledgeDocument[]
  ├─ QuickLog[]
  └─ RuntimeState

Change
  ├─ affected_components[]
  ├─ ChangeDocument[]
  └─ Task[]

Task
  ├─ affected_components[]
  ├─ AgentRun[]
  ├─ WorktreeLease[]
  └─ Artifact[]
```

## 关键修正

错误模型：

```text
Project → Change → Task
```

正确模型：

```text
Workspace
  ├─ ProjectComponent[]
  └─ Change[]
       └─ affected_components[]
```


---

# 04 — Git 身份、凭据与 Worktree 隔离设计

## 1. 问题

平台如果部署在一台服务器上，多人同时使用时，最大风险是所有 Git 操作共享服务器身份。

错误做法：

```text
平台服务器配置一个全局 Git Token
所有用户和 Agent 都用这个 Token clone / commit / push
```

后果：

- A 用户可操作 B 用户仓库。
- Agent 可越权修改代码。
- 无法追踪真实发起人。
- 离职用户权限无法单独回收。
- 审计失真。

## 2. 核心原则

```text
谁发起 Git 操作，就使用谁的 Git Identity。
```

Agent 执行时：

```text
继承任务 Owner 的 Git 权限，或使用受限 Bot 权限。
```

## 3. Git Identity

```text
GitIdentity
  id
  user_id
  provider
  git_username
  git_email
  credential_type
  encrypted_credential
  allowed_repositories
  expires_at
  revoked_at
```

支持：

- GitHub OAuth。
- GitLab OAuth。
- Gitea Token。
- SSH Key。
- App Token。

## 4. 凭据保护

要求：

- 数据库只保存加密凭据。
- 执行时临时解密。
- 只注入当前 run。
- run 结束后销毁。
- 日志脱敏。

禁止：

```text
把 token 写进命令行
把 token 写进 repo/.git/config
把 token 写进日志
使用服务器 ~/.ssh
使用服务器 ~/.gitconfig
```

## 5. Worktree 隔离

每个任务必须独立工作目录：

```text
/data/sillyspec-workspaces/
  {workspace_id}/
    components/
      {component_id}/
        worktrees/
          {user_id}/
            {change_id}/
              {task_id}/
                {run_id}/
                  repo/
```

路径必须包含：

```text
workspace_id
component_id
user_id
change_id
task_id
run_id
```

## 6. 临时执行环境

每次 Git 操作设置：

```text
HOME=/tmp/sillyspec-runs/{run_id}/home
GIT_CONFIG_GLOBAL=/tmp/sillyspec-runs/{run_id}/gitconfig
GIT_ASKPASS=/tmp/sillyspec-runs/{run_id}/askpass.sh
SSH_AUTH_SOCK=/tmp/sillyspec-runs/{run_id}/ssh-agent.sock
```

每次执行显式设置：

```text
git config user.name  当前 Git Identity 的用户名
git config user.email 当前 Git Identity 的邮箱
```

## 7. 分支隔离

人工分支：

```text
users/{user_id}/changes/{change_id}/tasks/{task_id}
```

Agent 分支：

```text
agents/{agent_type}/users/{user_id}/changes/{change_id}/tasks/{task_id}/runs/{run_id}
```

## 8. Git Tool Gateway

允许操作：

```text
git_status
git_diff
git_create_branch
git_commit
git_push_branch
git_create_pr
```

禁止或审批操作：

```text
git push origin main
git push --force
git reset --hard
git clean -fd
git merge main
git tag
git branch -D
git config --global
git remote set-url
```

## 9. 权限判断链路

```text
用户点击执行任务
  ↓
检查平台 Workspace 权限
  ↓
检查 Change / Task 权限
  ↓
检查 affected_components
  ↓
检查用户 Git Identity
  ↓
检查 Git provider 仓库权限
  ↓
创建独立 Worktree
  ↓
注入临时 Git 凭据
  ↓
执行 Git 操作
  ↓
Git Tool Gateway 拦截危险命令
  ↓
push 到用户/任务分支
  ↓
创建 PR
  ↓
人工 Review / Merge
```

## 10. 审计

每次 Git 操作记录：

```text
user_id
git_identity_id
workspace_id
component_id
change_id
task_id
run_id
operation
branch_name
commit_sha
success
error_message
timestamp
```

## 11. 单服务器部署结论

一台服务器可以部署，但必须做到：

```text
不能共用 Git 凭据
不能共用工作目录
不能共用 Git 身份
不能让 Agent 直接执行裸 git
不能让平台使用全局超级 Token
```


---

# 05 — 权限与风险控制

## 1. 权限层级

```text
Platform
Workspace
ProjectComponent
Change
Task
Tool
Git
Deployment
```

## 2. Actor

```text
User
Agent
Bot
System
```

Agent 也是 Actor，必须有权限边界。

## 3. 关键规则

- 人是责任主体。
- Agent 不能拥有超过任务 Owner 的权限。
- Agent 不能读取未授权组件路径。
- Agent 不能直接访问生产环境。
- Agent 不能自动合并 protected branch。
- 所有高危操作进入 Approval。

## 4. 风险清单

| 风险 | 控制 |
|---|---|
| 人机责任不清 | owner/reviewer/approver |
| 项目组上下文串线 | affected_components |
| Git 凭据串用 | GitIdentity + 临时注入 |
| Worktree 冲突 | WorktreeLease |
| Agent 误操作 | Tool Gateway |
| 生产发布失控 | 审批 + 发布窗口 |
| 文档代码脱节 | Spec Guardian |
| 状态不可信 | 状态机 + 审计 |
| 成本失控 | Run 限额 |
| 平台过重 | 角色化视图 |


---

# 06 — Agent Adapter 设计

## 1. 目标

支持 Claude Code、Codex、Cursor 等工具，但不绑定任何一个工具。

## 2. 接口

```typescript
interface AgentAdapter {
  name: string
  capabilities: string[]
  prepare(context: AgentContext): Promise<PreparedSession>
  run(input: AgentTaskInput): AsyncIterable<AgentEvent>
  cancel(runId: string): Promise<void>
  collectArtifacts(runId: string): Promise<Artifact[]>
}
```

## 3. 实现

```text
ClaudeCodeAdapter
CodexAdapter
CursorAdapter
ShellAdapter
RemoteAgentAdapter
```

## 4. 上下文

AgentContext 包含：

```text
workspace
change
task
affected_components
scan_docs
requirements
design
plan
allowed_paths
denied_paths
git_identity_policy
tool_permissions
cost_limit
timeout
```

## 5. 执行规则

- Agent 不直接读全仓库。
- Agent 不直接拿 Git 凭据。
- Agent 只看到任务允许的上下文。
- Agent 所有工具调用经过 Tool Gateway。
- Agent 输出必须落到 Artifact 和 Audit。


---

# 07 — Tool Gateway 设计

## 1. 目标

所有 Agent 和自动化执行都必须通过 Tool Gateway。

## 2. 工具分类

| 工具 | 风险 | 控制 |
|---|---:|---|
| file_read | 低 | 路径限制 |
| file_write | 中 | allowed_paths |
| shell_exec | 高 | 命令白名单 |
| git_status | 低 | 记录日志 |
| git_commit | 中 | 分支限制 |
| git_push_branch | 中 | 只能任务分支 |
| git_merge | 高 | 审批 |
| db_execute | 极高 | 默认禁止 |
| deploy_production | 极高 | 多人审批 |
| secret_read | 极高 | 默认禁止 |

## 3. 执行流程

```text
Tool Call
  ↓
权限检查
  ↓
路径检查
  ↓
风险分级
  ↓
审批判断
  ↓
执行
  ↓
日志脱敏
  ↓
审计记录
```


---

# 08 — API Contract 草案

## Workspace

```http
GET /api/workspaces
POST /api/workspaces/scan
GET /api/workspaces/{workspace_id}
```

## Components

```http
GET /api/workspaces/{workspace_id}/components
GET /api/workspaces/{workspace_id}/components/{component_id}
GET /api/workspaces/{workspace_id}/components/{component_id}/scan-docs
```

## Changes

```http
GET /api/workspaces/{workspace_id}/changes
GET /api/workspaces/{workspace_id}/changes/{change_id}
POST /api/workspaces/{workspace_id}/changes
```

## Tasks

```http
GET /api/workspaces/{workspace_id}/changes/{change_id}/tasks
GET /api/workspaces/{workspace_id}/tasks/{task_id}
```

## Runtime

```http
GET /api/workspaces/{workspace_id}/runtime
```

## Git Identity

```http
GET /api/git/identities
POST /api/git/identities
DELETE /api/git/identities/{identity_id}
POST /api/git/check-access
```

## Worktree

```http
POST /api/worktrees/acquire
POST /api/worktrees/{lease_id}/release
GET /api/worktrees/{lease_id}
```

## Agent

```http
POST /api/agent-runs
GET /api/agent-runs/{run_id}
POST /api/agent-runs/{run_id}/cancel
```


---

# 09 — 页面规划

## 页面列表

1. Workspace 首页
2. 项目组组件页
3. 组件详情页
4. 组件扫描认知页
5. 变更中心
6. 变更详情页
7. 任务看板
8. 任务详情页
9. Runtime 页面
10. Git 身份管理页
11. Agent 控制台
12. 审批中心
13. 审计中心
14. 设置页

## 关键页面说明

### Workspace 首页

展示一个 `.sillyspec` 的整体状态。

### 项目组组件页

展示 `projects/*.yaml` 解析结果和组件拓扑。

### 变更详情页

按 SillySpec 变更包结构展示：

```text
MASTER
proposal
requirements
design
prototype
plan
tasks
verification
```

### Git 身份管理页

展示当前用户绑定的 Git Identity，并验证仓库访问权限。

### Agent 控制台

展示 Agent Run、上下文、allowed_paths、工具调用、日志、diff。


---

# 10 — 存储与索引设计

## 1. 文件事实源

SillySpec 文件仍然是事实源。

平台数据库只存：

- 索引。
- 状态缓存。
- 权限。
- 审计。
- Git Identity。
- Worktree Lease。

## 2. 索引对象

```text
WorkspaceIndex
ComponentIndex
ScanDocIndex
ChangeIndex
TaskIndex
KnowledgeIndex
RuntimeSnapshot
```

## 3. 同步策略

V1：手动扫描。

V2：文件变更后重新索引。

V3：Git hook / watcher 触发增量索引。

## 4. 数据库

V1 可用 SQLite。

V3+ 推荐 PostgreSQL。

## 5. 文件存储

V1 使用本地文件系统。

V4+ 可接入 S3 / MinIO。


---

# 11 — 单服务器部署方案

## 1. 部署目标

平台可以先部署在一台服务器上，支持多人访问。

## 2. 组件

```text
Web UI
API Server
Database
Worktree Storage
Git Credential Manager
Agent Runtime Worker
Tool Gateway
```

## 3. 单服务器安全要求

即使在一台服务器上，也必须隔离：

```text
Git Identity
Git Credential
Worktree
HOME
Git Config
SSH Agent
Agent Run
```

## 4. 目录建议

```text
/opt/sillyspec-platform/
  app/
  config/
  logs/

/data/sillyspec-workspaces/
  {workspace_id}/

/tmp/sillyspec-runs/
  {run_id}/
```

## 5. 启动方式

V1 可使用：

```text
Docker Compose
或 systemd + venv + node process
```

不要求 K8s。

## 6. 后续演进

V4 后，Agent Run 可以迁移到容器隔离：

```text
每个 Agent Run 一个容器
只挂载当前 worktree
只注入当前临时凭据
容器结束即销毁
```


---

# 12 — Frontmatter Schema 建议

## Change

```yaml
---
id: 2026-05-25-multi-agent-platform-bootstrap-v2
title: 多智能体协作管理平台搭建
status: in_progress
change_type: feature
owner: qinyi
affected_components:
  - platform-web
  - platform-api
---
```

## Task

```yaml
---
id: task-01
title: 初始化平台仓库与基础工程
status: draft
priority: P0
owner: qinyi
affected_components:
  - platform-web
  - platform-api
allowed_paths:
  - frontend/
  - backend/
acceptance:
  - 能启动前端
  - 能启动后端
---
```

## Project Component

```yaml
id: silly-admin-ui
name: Silly Admin UI
type: frontend
path: ../silly-admin-ui
role: admin_console
tech_stack:
  - TypeScript
  - React
  - Vite
commands:
  build: npm run build
  test: npm run test
relations:
  - target: silly
    type: consumes_api_from
```


---

# 13 — 从旧文档包迁移到 SillySpec Native 结构

## 1. 旧问题

之前生成的文档包使用了理想化结构：

```text
requirements/
architecture/
plans/
risks/
tasks/
```

这不符合 SillySpec 真实变更包结构。

## 2. 新结构

应迁移为：

```text
.sillyspec/changes/change/2026-05-25-multi-agent-platform-bootstrap-v2/
  MASTER.md
  proposal.md
  requirements.md
  design.md
  plan.md
  tasks.md
  verification.md
  tasks/
  references/
```

## 3. 迁移策略

- 需求类内容合并到 `requirements.md`。
- 架构类内容进入 `design.md` 或 `references/`。
- 风险类内容进入 `references/05-permission-and-risk.md` 和 `references/14-risk-register.md`。
- 任务类内容进入 `tasks.md` 和 `tasks/task-xx.md`。
- 技术选型进入 `design.md`。


---

# 14 — 风险登记

| ID | 风险 | 等级 | 应对 |
|---|---|---|---|
| R-001 | projects 被误解为项目列表 | P0 | 明确 ProjectComponent 模型 |
| R-002 | 多人共用 Git Token | P0 | GitIdentity + 凭据隔离 |
| R-003 | 多任务共用 Worktree | P0 | WorktreeLease |
| R-004 | Agent 越权执行 Git | P0 | Git Tool Gateway |
| R-005 | Agent 读取服务器 SSH Key | P0 | 临时 HOME + 禁止全局 ~/.ssh |
| R-006 | Change 影响组件不明确 | P1 | affected_components 必填 |
| R-007 | 文档和代码脱节 | P1 | Spec Guardian |
| R-008 | Runtime 被误当事实源 | P1 | UI 标记 runtime 为临时态 |
| R-009 | 生产发布失控 | P0 | 审批 + 回滚 |
| R-010 | 平台过重 | P2 | V1 只做 Viewer + Git 隔离基础 |


---

# 任务详情汇总


---

# task-01 — 初始化平台仓库与基础工程

## Frontmatter 建议

```yaml
id: task-01
title: 初始化平台仓库与基础工程
phase: V1
priority: P0
status: draft
affected_components:
  - platform-web
  - platform-api
```

## 目标

建立 Next.js + FastAPI 的基础工程结构，定义模块边界。

## 输入

- `MASTER.md`
- `requirements.md`
- `design.md`
- `plan.md`
- 相关 `references/*.md`

## 执行要点

1. 保持 SillySpec Native Layout，不创造不兼容的新结构。
2. 所有文件读取要保留原始路径，内部建立索引即可。
3. 涉及 Git 操作时必须经过 Git Identity 和 Worktree 隔离。
4. 所有重要操作记录审计日志。

## 验收标准

- 功能按任务目标可演示。
- 关键路径有错误处理。
- 有最小测试或手工验证步骤。
- 文档和实现保持一致。

## 风险

- 误解 SillySpec 目录语义。
- 将 `projects` 误当成普通项目列表。
- 多人共用 Git 身份或工作目录。

## 完成定义

- 代码完成。
- 文档更新。
- 自测通过。
- 相关变更记录在当前 Change 包中。


---

# task-02 — 实现 Workspace 识别

## Frontmatter 建议

```yaml
id: task-02
title: 实现 Workspace 识别
phase: V1
priority: P0
status: draft
affected_components:
  - platform-web
  - platform-api
```

## 目标

扫描用户选择目录，识别 .sillyspec 并建立 Workspace。

## 输入

- `MASTER.md`
- `requirements.md`
- `design.md`
- `plan.md`
- 相关 `references/*.md`

## 执行要点

1. 保持 SillySpec Native Layout，不创造不兼容的新结构。
2. 所有文件读取要保留原始路径，内部建立索引即可。
3. 涉及 Git 操作时必须经过 Git Identity 和 Worktree 隔离。
4. 所有重要操作记录审计日志。

## 验收标准

- 功能按任务目标可演示。
- 关键路径有错误处理。
- 有最小测试或手工验证步骤。
- 文档和实现保持一致。

## 风险

- 误解 SillySpec 目录语义。
- 将 `projects` 误当成普通项目列表。
- 多人共用 Git 身份或工作目录。

## 完成定义

- 代码完成。
- 文档更新。
- 自测通过。
- 相关变更记录在当前 Change 包中。


---

# task-03 — 实现 projects 组件配置解析

## Frontmatter 建议

```yaml
id: task-03
title: 实现 projects 组件配置解析
phase: V1
priority: P0
status: draft
affected_components:
  - platform-web
  - platform-api
```

## 目标

读取 .sillyspec/projects/*.yaml，解析为 ProjectComponent 和 ComponentRelation。

## 输入

- `MASTER.md`
- `requirements.md`
- `design.md`
- `plan.md`
- 相关 `references/*.md`

## 执行要点

1. 保持 SillySpec Native Layout，不创造不兼容的新结构。
2. 所有文件读取要保留原始路径，内部建立索引即可。
3. 涉及 Git 操作时必须经过 Git Identity 和 Worktree 隔离。
4. 所有重要操作记录审计日志。

## 验收标准

- 功能按任务目标可演示。
- 关键路径有错误处理。
- 有最小测试或手工验证步骤。
- 文档和实现保持一致。

## 风险

- 误解 SillySpec 目录语义。
- 将 `projects` 误当成普通项目列表。
- 多人共用 Git 身份或工作目录。

## 完成定义

- 代码完成。
- 文档更新。
- 自测通过。
- 相关变更记录在当前 Change 包中。


---

# task-04 — 实现 scan docs 解析

## Frontmatter 建议

```yaml
id: task-04
title: 实现 scan docs 解析
phase: V1
priority: P0
status: draft
affected_components:
  - platform-web
  - platform-api
```

## 目标

读取 .sillyspec/docs/{component}/scan/*.md 并展示。

## 输入

- `MASTER.md`
- `requirements.md`
- `design.md`
- `plan.md`
- 相关 `references/*.md`

## 执行要点

1. 保持 SillySpec Native Layout，不创造不兼容的新结构。
2. 所有文件读取要保留原始路径，内部建立索引即可。
3. 涉及 Git 操作时必须经过 Git Identity 和 Worktree 隔离。
4. 所有重要操作记录审计日志。

## 验收标准

- 功能按任务目标可演示。
- 关键路径有错误处理。
- 有最小测试或手工验证步骤。
- 文档和实现保持一致。

## 风险

- 误解 SillySpec 目录语义。
- 将 `projects` 误当成普通项目列表。
- 多人共用 Git 身份或工作目录。

## 完成定义

- 代码完成。
- 文档更新。
- 自测通过。
- 相关变更记录在当前 Change 包中。


---

# task-05 — 实现 Change 解析

## Frontmatter 建议

```yaml
id: task-05
title: 实现 Change 解析
phase: V1
priority: P0
status: draft
affected_components:
  - platform-web
  - platform-api
```

## 目标

读取 changes/change 与 changes/archive 下的变更包。

## 输入

- `MASTER.md`
- `requirements.md`
- `design.md`
- `plan.md`
- 相关 `references/*.md`

## 执行要点

1. 保持 SillySpec Native Layout，不创造不兼容的新结构。
2. 所有文件读取要保留原始路径，内部建立索引即可。
3. 涉及 Git 操作时必须经过 Git Identity 和 Worktree 隔离。
4. 所有重要操作记录审计日志。

## 验收标准

- 功能按任务目标可演示。
- 关键路径有错误处理。
- 有最小测试或手工验证步骤。
- 文档和实现保持一致。

## 风险

- 误解 SillySpec 目录语义。
- 将 `projects` 误当成普通项目列表。
- 多人共用 Git 身份或工作目录。

## 完成定义

- 代码完成。
- 文档更新。
- 自测通过。
- 相关变更记录在当前 Change 包中。


---

# task-06 — 实现 Task 解析和看板

## Frontmatter 建议

```yaml
id: task-06
title: 实现 Task 解析和看板
phase: V1
priority: P0
status: draft
affected_components:
  - platform-web
  - platform-api
```

## 目标

读取 tasks.md 和 tasks/task-xx.md，生成任务看板。

## 输入

- `MASTER.md`
- `requirements.md`
- `design.md`
- `plan.md`
- 相关 `references/*.md`

## 执行要点

1. 保持 SillySpec Native Layout，不创造不兼容的新结构。
2. 所有文件读取要保留原始路径，内部建立索引即可。
3. 涉及 Git 操作时必须经过 Git Identity 和 Worktree 隔离。
4. 所有重要操作记录审计日志。

## 验收标准

- 功能按任务目标可演示。
- 关键路径有错误处理。
- 有最小测试或手工验证步骤。
- 文档和实现保持一致。

## 风险

- 误解 SillySpec 目录语义。
- 将 `projects` 误当成普通项目列表。
- 多人共用 Git 身份或工作目录。

## 完成定义

- 代码完成。
- 文档更新。
- 自测通过。
- 相关变更记录在当前 Change 包中。


---

# task-07 — 实现 Runtime 状态展示

## Frontmatter 建议

```yaml
id: task-07
title: 实现 Runtime 状态展示
phase: V1
priority: P1
status: draft
affected_components:
  - platform-web
  - platform-api
```

## 目标

读取 .runtime/progress.json、user-inputs.md、artifacts。

## 输入

- `MASTER.md`
- `requirements.md`
- `design.md`
- `plan.md`
- 相关 `references/*.md`

## 执行要点

1. 保持 SillySpec Native Layout，不创造不兼容的新结构。
2. 所有文件读取要保留原始路径，内部建立索引即可。
3. 涉及 Git 操作时必须经过 Git Identity 和 Worktree 隔离。
4. 所有重要操作记录审计日志。

## 验收标准

- 功能按任务目标可演示。
- 关键路径有错误处理。
- 有最小测试或手工验证步骤。
- 文档和实现保持一致。

## 风险

- 误解 SillySpec 目录语义。
- 将 `projects` 误当成普通项目列表。
- 多人共用 Git 身份或工作目录。

## 完成定义

- 代码完成。
- 文档更新。
- 自测通过。
- 相关变更记录在当前 Change 包中。


---

# task-08 — 实现 Knowledge / Quicklog 展示

## Frontmatter 建议

```yaml
id: task-08
title: 实现 Knowledge / Quicklog 展示
phase: V1
priority: P1
status: draft
affected_components:
  - platform-web
  - platform-api
```

## 目标

展示 knowledge 和 quicklog。

## 输入

- `MASTER.md`
- `requirements.md`
- `design.md`
- `plan.md`
- 相关 `references/*.md`

## 执行要点

1. 保持 SillySpec Native Layout，不创造不兼容的新结构。
2. 所有文件读取要保留原始路径，内部建立索引即可。
3. 涉及 Git 操作时必须经过 Git Identity 和 Worktree 隔离。
4. 所有重要操作记录审计日志。

## 验收标准

- 功能按任务目标可演示。
- 关键路径有错误处理。
- 有最小测试或手工验证步骤。
- 文档和实现保持一致。

## 风险

- 误解 SillySpec 目录语义。
- 将 `projects` 误当成普通项目列表。
- 多人共用 Git 身份或工作目录。

## 完成定义

- 代码完成。
- 文档更新。
- 自测通过。
- 相关变更记录在当前 Change 包中。


---

# task-09 — 实现 Git Identity Manager

## Frontmatter 建议

```yaml
id: task-09
title: 实现 Git Identity Manager
phase: V1/V2
priority: P0
status: draft
affected_components:
  - platform-web
  - platform-api
```

## 目标

管理用户 Git 身份和加密凭据。

## 输入

- `MASTER.md`
- `requirements.md`
- `design.md`
- `plan.md`
- 相关 `references/*.md`

## 执行要点

1. 保持 SillySpec Native Layout，不创造不兼容的新结构。
2. 所有文件读取要保留原始路径，内部建立索引即可。
3. 涉及 Git 操作时必须经过 Git Identity 和 Worktree 隔离。
4. 所有重要操作记录审计日志。

## 验收标准

- 功能按任务目标可演示。
- 关键路径有错误处理。
- 有最小测试或手工验证步骤。
- 文档和实现保持一致。

## 风险

- 误解 SillySpec 目录语义。
- 将 `projects` 误当成普通项目列表。
- 多人共用 Git 身份或工作目录。

## 完成定义

- 代码完成。
- 文档更新。
- 自测通过。
- 相关变更记录在当前 Change 包中。


---

# task-10 — 实现 Worktree Manager

## Frontmatter 建议

```yaml
id: task-10
title: 实现 Worktree Manager
phase: V1/V2
priority: P0
status: draft
affected_components:
  - platform-web
  - platform-api
```

## 目标

按用户、组件、任务、run 创建独立 worktree。

## 输入

- `MASTER.md`
- `requirements.md`
- `design.md`
- `plan.md`
- 相关 `references/*.md`

## 执行要点

1. 保持 SillySpec Native Layout，不创造不兼容的新结构。
2. 所有文件读取要保留原始路径，内部建立索引即可。
3. 涉及 Git 操作时必须经过 Git Identity 和 Worktree 隔离。
4. 所有重要操作记录审计日志。

## 验收标准

- 功能按任务目标可演示。
- 关键路径有错误处理。
- 有最小测试或手工验证步骤。
- 文档和实现保持一致。

## 风险

- 误解 SillySpec 目录语义。
- 将 `projects` 误当成普通项目列表。
- 多人共用 Git 身份或工作目录。

## 完成定义

- 代码完成。
- 文档更新。
- 自测通过。
- 相关变更记录在当前 Change 包中。


---

# task-11 — 实现 Git Tool Gateway

## Frontmatter 建议

```yaml
id: task-11
title: 实现 Git Tool Gateway
phase: V2/V3
priority: P0
status: draft
affected_components:
  - platform-web
  - platform-api
```

## 目标

封装并拦截 Git 操作，禁止危险命令。

## 输入

- `MASTER.md`
- `requirements.md`
- `design.md`
- `plan.md`
- 相关 `references/*.md`

## 执行要点

1. 保持 SillySpec Native Layout，不创造不兼容的新结构。
2. 所有文件读取要保留原始路径，内部建立索引即可。
3. 涉及 Git 操作时必须经过 Git Identity 和 Worktree 隔离。
4. 所有重要操作记录审计日志。

## 验收标准

- 功能按任务目标可演示。
- 关键路径有错误处理。
- 有最小测试或手工验证步骤。
- 文档和实现保持一致。

## 风险

- 误解 SillySpec 目录语义。
- 将 `projects` 误当成普通项目列表。
- 多人共用 Git 身份或工作目录。

## 完成定义

- 代码完成。
- 文档更新。
- 自测通过。
- 相关变更记录在当前 Change 包中。


---

# task-12 — 实现平台写入 Change 包

## Frontmatter 建议

```yaml
id: task-12
title: 实现平台写入 Change 包
phase: V2
priority: P1
status: draft
affected_components:
  - platform-web
  - platform-api
```

## 目标

平台创建变更并生成 Markdown 文件。

## 输入

- `MASTER.md`
- `requirements.md`
- `design.md`
- `plan.md`
- 相关 `references/*.md`

## 执行要点

1. 保持 SillySpec Native Layout，不创造不兼容的新结构。
2. 所有文件读取要保留原始路径，内部建立索引即可。
3. 涉及 Git 操作时必须经过 Git Identity 和 Worktree 隔离。
4. 所有重要操作记录审计日志。

## 验收标准

- 功能按任务目标可演示。
- 关键路径有错误处理。
- 有最小测试或手工验证步骤。
- 文档和实现保持一致。

## 风险

- 误解 SillySpec 目录语义。
- 将 `projects` 误当成普通项目列表。
- 多人共用 Git 身份或工作目录。

## 完成定义

- 代码完成。
- 文档更新。
- 自测通过。
- 相关变更记录在当前 Change 包中。


---

# task-13 — 实现审批和状态机

## Frontmatter 建议

```yaml
id: task-13
title: 实现审批和状态机
phase: V3
priority: P1
status: draft
affected_components:
  - platform-web
  - platform-api
```

## 目标

Change 和 Task 状态机、Review 封驳、审批。

## 输入

- `MASTER.md`
- `requirements.md`
- `design.md`
- `plan.md`
- 相关 `references/*.md`

## 执行要点

1. 保持 SillySpec Native Layout，不创造不兼容的新结构。
2. 所有文件读取要保留原始路径，内部建立索引即可。
3. 涉及 Git 操作时必须经过 Git Identity 和 Worktree 隔离。
4. 所有重要操作记录审计日志。

## 验收标准

- 功能按任务目标可演示。
- 关键路径有错误处理。
- 有最小测试或手工验证步骤。
- 文档和实现保持一致。

## 风险

- 误解 SillySpec 目录语义。
- 将 `projects` 误当成普通项目列表。
- 多人共用 Git 身份或工作目录。

## 完成定义

- 代码完成。
- 文档更新。
- 自测通过。
- 相关变更记录在当前 Change 包中。


---

# task-14 — 实现 Agent Adapter 接口

## Frontmatter 建议

```yaml
id: task-14
title: 实现 Agent Adapter 接口
phase: V4
priority: P1
status: draft
affected_components:
  - platform-web
  - platform-api
```

## 目标

定义 Claude Code、Codex、Cursor 可插拔接口。

## 输入

- `MASTER.md`
- `requirements.md`
- `design.md`
- `plan.md`
- 相关 `references/*.md`

## 执行要点

1. 保持 SillySpec Native Layout，不创造不兼容的新结构。
2. 所有文件读取要保留原始路径，内部建立索引即可。
3. 涉及 Git 操作时必须经过 Git Identity 和 Worktree 隔离。
4. 所有重要操作记录审计日志。

## 验收标准

- 功能按任务目标可演示。
- 关键路径有错误处理。
- 有最小测试或手工验证步骤。
- 文档和实现保持一致。

## 风险

- 误解 SillySpec 目录语义。
- 将 `projects` 误当成普通项目列表。
- 多人共用 Git 身份或工作目录。

## 完成定义

- 代码完成。
- 文档更新。
- 自测通过。
- 相关变更记录在当前 Change 包中。


---

# task-15 — 实现 Tool Gateway 通用能力

## Frontmatter 建议

```yaml
id: task-15
title: 实现 Tool Gateway 通用能力
phase: V4
priority: P1
status: draft
affected_components:
  - platform-web
  - platform-api
```

## 目标

统一管理 file/shell/test/git 工具调用。

## 输入

- `MASTER.md`
- `requirements.md`
- `design.md`
- `plan.md`
- 相关 `references/*.md`

## 执行要点

1. 保持 SillySpec Native Layout，不创造不兼容的新结构。
2. 所有文件读取要保留原始路径，内部建立索引即可。
3. 涉及 Git 操作时必须经过 Git Identity 和 Worktree 隔离。
4. 所有重要操作记录审计日志。

## 验收标准

- 功能按任务目标可演示。
- 关键路径有错误处理。
- 有最小测试或手工验证步骤。
- 文档和实现保持一致。

## 风险

- 误解 SillySpec 目录语义。
- 将 `projects` 误当成普通项目列表。
- 多人共用 Git 身份或工作目录。

## 完成定义

- 代码完成。
- 文档更新。
- 自测通过。
- 相关变更记录在当前 Change 包中。


---

# task-16 — 实现部署和归档闭环

## Frontmatter 建议

```yaml
id: task-16
title: 实现部署和归档闭环
phase: V5
priority: P2
status: draft
affected_components:
  - platform-web
  - platform-api
```

## 目标

发布、回滚、归档、知识沉淀。

## 输入

- `MASTER.md`
- `requirements.md`
- `design.md`
- `plan.md`
- 相关 `references/*.md`

## 执行要点

1. 保持 SillySpec Native Layout，不创造不兼容的新结构。
2. 所有文件读取要保留原始路径，内部建立索引即可。
3. 涉及 Git 操作时必须经过 Git Identity 和 Worktree 隔离。
4. 所有重要操作记录审计日志。

## 验收标准

- 功能按任务目标可演示。
- 关键路径有错误处理。
- 有最小测试或手工验证步骤。
- 文档和实现保持一致。

## 风险

- 误解 SillySpec 目录语义。
- 将 `projects` 误当成普通项目列表。
- 多人共用 Git 身份或工作目录。

## 完成定义

- 代码完成。
- 文档更新。
- 自测通过。
- 相关变更记录在当前 Change 包中。
