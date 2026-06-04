# SillyHub 集成文档

author: scan-agent
created_at: 2026-06-03T12:00:03

## 1. PostgreSQL 集成

### 1.1 连接配置

后端通过 `Settings.database_url` 配置数据库连接，使用 AsyncPG 驱动：

```
DATABASE_URL=postgresql+asyncpg://platform:platform@localhost:5432/platform
```

### 1.2 连接池

`app/core/db.py` 管理全局 AsyncEngine，连接池参数：
- `pool_size`：10
- `max_overflow`：10
- `pool_timeout`：30s
- `pool_recycle`：1800s（30 分钟回收）
- `pool_pre_ping`：启用（自动检测断连）

### 1.3 Session 管理

- 通过 `get_session()` FastAPI 依赖注入 AsyncSession
- `expire_on_commit=False`：提交后对象属性仍可访问
- `autoflush=False`：手动控制 flush 时机
- 异常时自动 `rollback`

### 1.4 审计上下文注入

`get_session()` 在创建 session 时自动从 Bearer token 中提取 `actor_id` 和 `workspace_id`，注入到 `session.info["audit_context"]`。SQLAlchemy 事件钩子读取此上下文写入审计日志。

### 1.5 数据库迁移

使用 Alembic 管理数据库 schema，迁移文件位于 `backend/migrations/versions/`，按时间戳命名。当前共 38 个迁移文件，覆盖所有业务表。

迁移命令：
```bash
make backend-migrate   # alembic upgrade head
```

### 1.6 核心数据表

| 表 | 模块 | 用途 |
|----|------|------|
| users | auth | 用户账户 |
| roles / user_roles | auth | RBAC 角色绑定 |
| refresh_tokens | auth | Refresh token 存储 |
| workspaces | workspace | 工作区 |
| workspace_relations | workspace | 工作区间关系 |
| changes / change_documents | change | 变更管理 |
| tasks | task | 任务管理 |
| agent_runs | agent | Agent 运行记录 |
| worktree_leases | worktree | Worktree 租约 |
| audit_logs | workflow | 自动审计日志 |
| change_reviews | workflow | 变更审批 |
| git_identities | git_identity | Git 身份凭证 |
| git_operation_logs | git_gateway | Git 操作日志 |
| tool_operation_logs | tool_gateway | 工具操作日志 |
| tool_policies | tool_gateway | 工具策略 |
| releases | release | 发布记录 |
| incidents | incident | 事件记录 |
| scan_documents | scan_docs | Scan 文档索引 |
| spec_workspaces | spec_workspace | Spec 工作区 |
| spec_profiles | spec_profile | Spec 配置 profile |
| platform_settings | settings | 平台设置 |
| health_probes | health | 健康检查 |
| agent_run_workspaces | workspace | Agent 运行 ↔ 工作区 M:N |

## 2. Redis 集成

### 2.1 连接配置

```
REDIS_URL=redis://localhost:6379/0
```

使用 `redis.asyncio.Redis` 客户端，全局单例模式（`app/core/redis.py`），自动管理连接池，健康检查间隔 30 秒。

### 2.2 用途

Redis 主要用于 **Agent 运行时的实时日志推送**：

- Agent 子进程的 stdout/stderr 通过 `redis.publish(channel, message)` 发布
- 前端通过 SSE 代理订阅 Redis Pub/Sub channel `agent_run:{run_id}`
- 消息格式：`{"channel": "stdout"|"stderr"|"tool_call"|"done", "content": "...", "timestamp": "..."}`

## 3. 认证系统

### 3.1 认证流程

**登录**：
1. 用户提交 email + password
2. 后端验证凭据（bcrypt 哈希比对）
3. 返回 `access_token`（JWT HS256, 15 分钟 TTL）+ `refresh_token`（opaque, 32 字节）
4. 前端存入 Zustand session store（localStorage 持久化）

**请求认证**：
1. 前端 `apiFetch` 自动从 session store 读取 `accessToken`
2. 附加 `Authorization: Bearer <token>` 请求头
3. 后端 `auth_deps.get_current_user()` 解码 JWT + 查询用户

**Token 刷新**：
1. Access token 过期（401 响应）
2. 前端自动调用 `/api/auth/refresh`，传入 refresh_token
3. 获取新的 access_token + refresh_token
4. 重试原始请求
5. 刷新失败则清除 session，跳转登录页

**安全设计**：
- Refresh token 在 DB 中存储为 bcrypt 哈希
- 重放检测：如果 refresh token 被重用，所有 session 立即失效（`AuthRefreshReused`）
- 密码哈希使用 bcrypt（cost 12 生产环境，cost 4 测试环境）

### 3.2 RBAC 权限模型

权限通过 `Permission` StrEnum 定义（25 个权限），分为 7 个域：

- **Platform**：platform:admin, platform:billing, platform:audit:read
- **Workspace**：workspace:read/write/admin/member:manage
- **Change**：change:create/read/update/approve/archive
- **Task**：task:read/create/assign/run_agent/cancel/approve
- **Code**：code:read/write/review/merge
- **Deploy**：deploy:staging/production/rollback
- **Tool**：tool:shell_exec/network/database/secret:read

权限检查通过 `require_permission(Permission.X)` FastAPI 依赖注入实现，在路由级别显式声明。

### 3.3 管理员引导

应用启动时自动引导管理员账户（通过 `PLATFORM_BOOTSTRAP_ADMIN_*` 环境变量），并初始化 RBAC 角色和权限。

## 4. 前后端 API 对接

### 4.1 请求代理

Next.js 通过 `rewrites` 将前端 `/api/*` 请求代理到后端：

```javascript
// next.config.mjs
rewrites() {
  return [{
    source: "/api/:path*",
    destination: `${apiBaseUrl}/api/:path*`,
  }];
}
```

### 4.2 SSE 直连

Agent 实时日志通过 SSE（Server-Sent Events）推送，前端使用 `getDirectApiBaseUrl()` 直连后端（绕过 Next.js 代理的缓冲问题），通过 Next.js Route Handler (`src/app/api/workspaces/.../stream/route.ts`) 代理。

### 4.3 错误格式

后端统一错误信封：
```json
{
  "code": "workspace_not_found",
  "message": "Workspace not found.",
  "request_id": "uuid",
  "details": { "workspace_id": "uuid" }
}
```

前端 `ApiError` 类直接映射此结构。

### 4.4 CORS

后端通过 `CORSMiddleware` 配置 `cors_allowed_origins`，暴露 `x-request-id` 响应头。

## 5. Claude Code 集成

### 5.1 Agent 执行

后端通过 `ClaudeCodeAdapter` 将 Claude Code CLI 作为子进程启动：
- 使用 stream-json 协议捕获完整对话
- 通过 `--permission-mode bypassPermissions` 跳过交互确认
- 通过 `--disallowedTools AskUserQuestion` 禁止用户交互
- 工作目录设为 Worktree 租约路径

### 5.2 SillySpec CLI 集成

Agent 可以调用 `sillyspec` CLI 工具进行规范生成和管理。

## 6. Git 集成

### 6.1 Git Identity 管理

通过 `git_identity` 模块管理 GitHub OAuth 身份，凭证使用 NaCl 加密存储。

### 6.2 Git Gateway

`git_gateway` 模块提供 Git 操作 API，输出自动脱敏（redact）。
