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
