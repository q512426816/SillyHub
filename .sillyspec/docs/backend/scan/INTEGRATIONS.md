---
author: qinyi
created_at: 2026-06-03T20:35:00+08:00
---

# Backend -- 外部集成

## 数据库 -- PostgreSQL

### 连接

- **引擎**: PostgreSQL 16
- **驱动**: asyncpg（纯异步 Python 驱动）
- **连接字符串**: `DATABASE_URL` 环境变量，格式 `postgresql+asyncpg://user:pass@host:5432/db`
- **ORM**: SQLModel + SQLAlchemy async

### 连接池配置

定义在 `core/db.py`：

| 参数 | 值 | 说明 |
|------|-----|------|
| `pool_size` | 10 | 常驻连接数 |
| `max_overflow` | 10 | 超出 pool_size 的最大临时连接 |
| `pool_timeout` | 30s | 获取连接的超时 |
| `pool_recycle` | 1800s (30min) | 杀掉过期连接 |
| `pool_pre_ping` | True | 使用前检查连接可用性 |

### Session 管理

- `get_engine()` -- 懒创建进程级 AsyncEngine
- `get_session_factory()` -- 懒创建 `async_sessionmaker`
- `get_session(request)` -- FastAPI 依赖，yield session + 自动审计上下文注入 + 异常时 rollback
- `dispose_engine()` -- 应用关闭时释放所有连接

### 迁移

- **工具**: Alembic
- **入口**: `migrations/env.py` -- 异步迁移，从 `Settings` 读取连接 URL
- **命令**: `alembic upgrade head`
- **版本文件**: 33 个，位于 `migrations/versions/`
- **表注册**: 在 `migrations/env.py` 显式 import 每个模块的 `model.py`
- **命名规则**: `YYYYMMDDHHMM_<描述>.py`

### 数据表

约 32 张表，核心表：
- `users`, `sessions`, `roles`, `role_permissions`, `user_workspace_roles` -- 认证和 RBAC
- `workspaces`, `workspace_relations` -- 工作区和关系
- `changes`, `change_documents` -- 变更和文档
- `tasks` -- 任务
- `agent_runs`, `agent_run_logs` -- Agent 运行记录
- `worktree_leases` -- Worktree 租约
- `git_identities`, `git_operation_logs` -- Git 管理
- `tool_operation_logs`, `tool_policies` -- 工具网关
- `scan_documents` -- 扫描文档
- `releases`, `release_approvals` -- 发布管理
- `incidents`, `postmortems` -- 事件管理
- `audit_logs`, `change_reviews` -- 审计和审批
- `spec_workspaces`, `spec_profile_manifests`, `spec_conflicts` -- Spec 管理
- `platform_settings` -- 平台配置
- `change_workspaces`, `task_workspaces`, `agent_run_workspaces` -- M:N 关联表

## 缓存 -- Redis

### 连接

- **版本**: Redis 7
- **驱动**: `redis.asyncio`
- **连接字符串**: `REDIS_URL` 环境变量，默认 `redis://localhost:6379/0`
- **单例模式**: 进程级共享实例，懒创建

### 配置

| 参数 | 值 |
|------|-----|
| `encoding` | utf-8 |
| `decode_responses` | True |
| `health_check_interval` | 30s |

### 用途

1. **Agent SSE 流** -- `agent_run:{run_id}` Pub/Sub 频道，推送 Agent 执行进度和输出
2. **Keepalive** -- 25s 超时，30s 无消息发送 `: keepalive` SSE 注释
3. **健康检查** -- `redis.ping()` 探活

### 生命周期

- 初始化：`get_redis()` 懒创建
- 关闭：`close_redis()` 在 FastAPI lifespan shutdown 调用

## 认证 -- JWT + bcrypt

### JWT 配置

| 参数 | 默认值 | 说明 |
|------|--------|------|
| `secret_key` | 环境变量 | HS256 签名密钥（>=16 字符） |
| `auth_access_ttl_minutes` | 15 min | Access token TTL |
| `auth_refresh_ttl_days` | 14 days | Refresh token TTL |
| `auth_bcrypt_rounds` | 12 | bcrypt cost factor |

### Token 结构

**Access Token (JWT)**:
```json
{
  "sub": "<user_uuid>",
  "email": "<email>",
  "is_admin": true,
  "jti": "<token_uuid>",
  "iat": 1234567890,
  "exp": 1234568790,
  "typ": "access"
}
```

**Refresh Token**: 32 字节 `secrets.token_urlsafe`，bcrypt 哈希后存入 `sessions` 表。

### Token 刷新策略

1. 客户端提交 refresh_token
2. 遍历活跃 session 的 bcrypt 哈希查找匹配
3. 找到后 revoke 旧 session，签发新 (access, refresh) 对
4. 如果提交的是已 revoked 的 token → 判定为重放攻击 → revoke 该用户所有 session

## HTTP 客户端 -- httpx

### 用途

- `git_identity/providers/github.py` -- GitHub API（OAuth token 验证）
- `tool_gateway/service.py` -- 外部工具代理请求（`http_get` 工具类型）

## CLI 工具集成

### Claude Code CLI

- **集成方式**: `asyncio.create_subprocess_exec` 子进程调用
- **适配器**: `agent/adapters/claude_code.py` -- `ClaudeCodeAdapter(AgentAdapter)`
- **协议**: stream-json（JSON 流式输出）
- **版本**: Dockerfile 构建参数 `CLAUDE_CODE_VERSION=2.1.158`
- **安装**: Docker 中通过 npm 全局安装
- **用途**: 执行 Agent 任务（代码生成、分析、变更执行）

### SillySpec CLI

- **集成方式**: `asyncio.create_subprocess_exec` 子进程调用
- **版本**: Dockerfile 构建参数 `SILLYSPEC_VERSION=3.14.1`
- **安装**: Docker 中通过 npm 全局安装
- **用途**: SillySpec 流程执行（sillyspec run / sillyspec quick）

## Git 集成

### git_gateway 模块

- **操作白名单**: `status`, `diff`, `add`, `commit`, `push`, `pull`, `fetch`, `log`, `branch`, `checkout`, `merge`, `rebase`
- **输出脱敏**: `redact_output()` 函数清理敏感信息（token、密钥等）
- **审计日志**: 所有 Git 操作记录到 `git_operation_logs` 表

### worktree 模块

- **Git Worktree 隔离**: 每个任务/变更获取独立的 worktree
- **租约管理**: acquire / release / extend / GC
- **凭证加密**: PyNaCl 加密 Git 凭证（SSH key、token）

### git_identity 模块

- **身份类型**: GitHub OAuth token、SSH key
- **Provider 抽象**: `providers/base.py` + `providers/github.py`

## 加密 -- PyNaCl

- **用途**: Worktree 凭证加密（`core/crypto.py`）
- **密钥**: `SILLYSPEC_MASTER_KEY` 环境变量
- **算法**: NaCl secretbox (XSalsa20-Poly1305)

## Docker 部署

### 多阶段构建

1. **node-tools 阶段**: 安装 Claude Code CLI + SillySpec CLI
2. **builder 阶段**: Python 3.12-slim + uv 安装 Python 依赖
3. **runtime 阶段**: Python 3.12-slim + Node.js 二进制 + venv + 源码

### 运行时配置

| 参数 | 值 |
|------|-----|
| 端口 | 8000 |
| 用户 | app (非 root) |
| 健康检查 | `curl -fsS http://127.0.0.1:8000/api/health` |
| 启动命令 | `uvicorn app.main:app --host 0.0.0.0 --port 8000` |
| 入口脚本 | `docker-entrypoint.sh`（含 alembic migrate） |

### 路径映射

- `/data/spec-workspaces` -- Spec 数据持久化
- `/host-projects` -- 宿主项目目录映射（通过 `host_path_prefix` / `container_path_prefix` 配置）
