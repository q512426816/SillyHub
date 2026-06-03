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
