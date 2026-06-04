---
author: qinyi
created_at: 2026-06-01T12:00:00
---

# git_gateway
> 最后更新：2026-06-01
> 最近变更：scan（初始生成）
> 模块路径：backend/app/modules/git_gateway/**

## 职责

git_gateway 是 Git 操作的安全网关层。它代理用户对 worktree 的 Git 命令执行，负责：

- **命令白名单校验**：只允许安全的 Git 子命令（如 status、log、add、commit、push 等）
- **Shell 注入防护**：拦截 `;`、`|`、`$()`、反引号、`&&`、重定向等注入模式
- **敏感信息脱敏**：自动从 Git 输出中脱敏 GitHub PAT、Bearer Token 等
- **保护分支推送拦截**：阻止向 main/master 分支的 force push 和直接 push
- **操作审计**：将每次 Git 操作记录到 `GitOperationLog` 表

## 当前设计

```
router.py            HTTP 入口，2 个端点
  |
service.py           GitGatewayService — 核心业务逻辑
  |                    - validate_operation()  命令白名单/黑名单校验
  |                    - redact_output()       输出脱敏
  |                    - execute()             执行 Git 命令并记录日志
  |                    - list_operations()     查询操作日志
  |
model.py             GitOperationLog (SQLModel 表)
schema.py            请求/响应 schema
```

### 安全层

1. **白名单**：只允许 `status`、`log`、`diff`、`add`、`commit`、`push`、`pull`、`fetch`、`branch`、`checkout`、`merge`、`tag` 等操作
2. **黑名单**：拒绝 `push --force`、`reset`、`clean`、`reflog`、`stash`、`config`、`remote`、`gc`、`clone`
3. **Shell 注入**：正则匹配 `$()`、`` ` ``、`;`、`|`、`&&`、`>` 等危险字符
4. **默认分支保护**：阻止 `push origin main`、`push origin master`
5. **PAT 脱敏**：正则替换 GitHub PAT 格式（`ghp_`、`gho_` 等）和 URL 内嵌 token

### Git Identity 集成

执行命令前通过 `_resolve_git_identity()` 查询 `git_identity` 模块，将用户配置的 `GIT_AUTHOR_NAME`、`GIT_AUTHOR_EMAIL` 注入执行环境。

### Worktree Lease 验证

通过 `_get_active_lease()` 验证 lease 存在且属于当前用户，然后通过 `ExecEnvBuilder` 构建执行环境。

## 对外接口

| 方法 | 路径 | 说明 | 认证 |
|------|------|------|------|
| POST | `/worktrees/{lease_id}/git` | 执行 Git 操作 | get_current_user |
| GET | `/git/operations` | 查询操作日志（支持 lease_id/workspace_id 过滤和分页） | get_current_user |

## 关键数据流

```
Client → POST /worktrees/{lease_id}/git
  → validate_operation(operation, args)     # 白名单+黑名单+注入检测
  → _get_active_lease(lease_id, user_id)    # 验证 lease 所有权
  → _resolve_git_identity(user_id)          # 获取 git 用户名/邮箱
  → ExecEnvBuilder 构建环境变量
  → asyncio.create_subprocess_exec(...)     # 执行 Git 命令
  → redact_output(raw_output)               # 脱敏
  → GitOperationLog 写入数据库
  → 返回 GitOperationResponse
```

## 设计决策

| 决策 | 原因 |
|------|------|
| 使用 `asyncio.create_subprocess_exec` 而非 `shell=True` | 避免 shell 注入风险 |
| 白名单 + 黑名单双重校验 | 纵深防御，白名单限制操作类型，黑名单拦截危险参数 |
| 输出截断 4096 字符 | 防止大量 Git 输出撑爆内存或日志 |
| 操作记录持久化到数据库 | 审计追踪，支持按 workspace/lease 查询 |
| Git Identity 通过 env 注入 | 不修改全局 git config，按用户隔离 |

## 依赖关系

### 内部依赖

- `app.core.auth_deps` — get_current_user（用户认证）
- `app.core.db` — get_session（数据库会话）
- `app.core.errors` — AppError, PermissionDenied, WorktreeLeaseNotFound
- `app.core.logging` — get_logger
- `app.models.base` — BaseModel
- `app.modules.auth.model` — User
- `app.modules.git_identity.model` — GitIdentity（解析 Git 用户名/邮箱）
- `app.modules.worktree.model` — WorktreeLease
- `app.modules.worktree.exec_env` — ExecEnvBuilder

### 外部依赖

- asyncio（子进程执行）
- uuid, datetime（类型标注）

## 注意事项

- 该模块不直接操作数据库表进行 CRUD，而是通过 GitOperationLog 记录审计日志
- Worktree Lease 必须处于 active 状态才能执行 Git 操作
- force push（`--force`、`--force-with-lease`、`-f`）在参数级别被黑名单拦截
- 默认分支推送保护不仅拦截 `push origin main`，也拦截 `push --set-upstream origin main`
- 输出中如果包含 PAT token，会被替换为 `***REDACTED***`

## 变更索引

| 日期 | 变更 | 摘要 |
|------|------|------|
| | | （初始生成，暂无变更记录） |
