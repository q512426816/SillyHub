---
author: qinyi
created_at: 2026-05-31T23:30:00
---

# SillyHub Backend — 集成与依赖

## 1. 外部依赖总览

### 1.1 运行时依赖（12 个）

| 包 | 版本 | 用途 | 集成方式 |
|----|------|------|----------|
| fastapi | >=0.115 | Web 框架 | 核心框架 |
| uvicorn[standard] | >=0.30 | ASGI 服务器 | 进程入口 |
| pydantic | >=2.8 | Schema 校验 | 深度集成 |
| pydantic-settings | >=2.4 | 配置管理 | Settings 类 |
| sqlmodel | >=0.0.22 | ORM | 全部 model 层 |
| sqlalchemy[asyncio] | >=2.0 | 异步 SQL | session/engine |
| asyncpg | >=0.29 | PostgreSQL 驱动 | 连接池 |
| alembic | >=1.13 | DB 迁移 | CLI + 迁移脚本 |
| redis | >=5.0 | 缓存/消息 | 全局单例客户端 |
| structlog | >=24.4 | 结构化日志 | 全局配置 |
| python-jose[cryptography] | >=3.3 | JWT | HS256 签发/验证 |
| passlib[bcrypt] | >=1.7 | 密码哈希 | 声明依赖（实际用 native bcrypt） |
| pynacl | >=1.5 | 凭证加密 | CredentialCipher |
| httpx | >=0.27 | HTTP 客户端 | 异步请求 |
| python-frontmatter | >=1.1 | YAML 解析 | parser.py |

### 1.2 开发依赖（8 个）

| 包 | 用途 |
|----|------|
| pytest + pytest-asyncio | 测试框架 |
| pytest-cov | 覆盖率 |
| ruff | Lint + format |
| mypy | 类型检查 |
| types-passlib | 类型 stub |
| anyio | 异步工具 |
| aiosqlite | 测试用 SQLite |

## 2. 数据库集成（PostgreSQL）

### 2.1 连接管理

```
Settings.database_url
    → create_async_engine()
        → pool_size=10, max_overflow=10
        → pool_timeout=30s, pool_recycle=30min
        → pool_pre_ping=True (健康检查)
    → async_sessionmaker(expire_on_commit=False, autoflush=False)
```

引擎和 session factory 懒初始化，首次使用时才创建连接。

### 2.2 核心表

| 表名 | 模块 | 说明 |
|------|------|------|
| users | auth | 用户账户 |
| roles | auth | RBAC 角色 |
| role_permissions | auth | 角色-权限关联 |
| user_workspace_roles | auth | 用户-工作空间-角色关联 |
| workspaces | workspace | 工作空间（软删除） |
| workspace_relations | workspace | 工作空间间关系 |
| workspace_tasks | workspace | 多对多关联 |
| agent_run_workspaces | workspace | 多对多关联 |
| changes | change | 变更记录 |
| change_documents | change | 变更文档 |
| tasks | task | 任务 |
| agent_runs | agent | Agent 执行记录 |
| agent_run_logs | agent | Agent 执行日志 |
| worktree_leases | worktree | Worktree 租约 |
| git_identities | git_identity | Git 凭证（加密存储） |
| git_operation_logs | git_gateway | Git 操作审计 |
| tool_policies | tool_gateway | 工具执行策略 |
| releases | release | 发布记录 |
| release_approvals | release | 发布审批 |
| incidents | incident | 事件 |
| postmortems | incident | 事后分析 |
| spec_workspaces | spec_workspace | Spec 工作空间 |
| scan_documents | scan_docs | 扫描文档 |
| audit_logs | workflow | 审计日志（自动生成） |
| settings | settings | 平台设置 |

### 2.3 迁移策略

- Alembic autogenerate 模式
- 31 个迁移版本
- 容器启动时自动执行迁移（docker-entrypoint.sh）
- 手动迁移：`alembic upgrade head`

## 3. Redis 集成

### 3.1 连接管理

```python
redis.asyncio.Redis
    → from_url(redis_url)
    → decode_responses=True
    → health_check_interval=30
```

单进程全局客户端，内部管理连接池。

### 3.2 Redis 用途

| 用途 | 模块 | 数据结构 |
|------|------|----------|
| Agent 进度推送 | agent | pub/sub |
| 幂等键 | agent/coordinator | key-value (SETNX) |
| 执行状态缓存 | agent | key-value |
| 租约锁 | worktree | key-value (TTL) |

## 4. JWT 认证集成

### 4.1 Access Token

- **算法**：HS256
- **密钥**：`Settings.secret_key`
- **TTL**：15 分钟（`auth_access_ttl_minutes`）
- **Payload**：sub(user_id), email, is_admin, jti, iat, exp, typ=access

### 4.2 Refresh Token

- **格式**：32 字节随机 token，base64url 编码（≈43 字符）
- **存储**：bcrypt 哈希后存入 users 表
- **TTL**：7 天（`auth_refresh_ttl_days`）
- **安全**：检测重放攻击（refresh_reused → 杀掉所有 session）

### 4.3 密码哈希

- **算法**：bcrypt（native，非 passlib）
- **Cost**：12（生产）/ 4（测试）
- **截断**：72 字节（bcrypt 限制）

## 5. PyNaCl 凭证加密

### 5.1 密钥管理

- **环境变量**：`SILLYSPEC_MASTER_KEY`
- **格式**：`<key_id>:<hex 32 bytes>` 或纯 hex（默认 key_id=v1）
- **算法**：xchacha20-poly1305 (secretbox)

### 5.2 加密流程

```
GitIdentity.credential_encrypted (bytes) + key_id (str)
    → CredentialCipher.encrypt(plaintext) → (ciphertext, key_id)
    → CredentialCipher.decrypt(ciphertext, key_id) → plaintext
```

密钥版本化设计，支持未来密钥轮换。

## 6. Claude Code 集成

### 6.1 子进程管理

```python
ClaudeCodeAdapter.execute(bundle, lease_path)
    → asyncio.create_subprocess_exec("claude", "--dangerously-skip-permissions", ...)
    → stdin: stream-json 格式 prompt
    → stdout: 逐行解析 JSON 事件
    → stderr: 直接捕获
```

### 6.2 Stream-JSON 协议

```json
{"type": "user", "message": {"role": "user", "content": [...]}}
```

Claude CLI 通过 stdin/stdout 交互，每行一个 JSON 事件。

### 6.3 上下文注入

- CLAUDE.md 文件由 `render_bundle_to_claude_md()` 生成
- 包含：变更描述、任务规格、spec 文档、约束条件
- Worktree 路径作为工作目录

## 7. 内部模块间调用关系

### 7.1 纵向依赖（跨模块调用）

```
agent → workspace (获取 workspace 信息)
agent → task (关联任务)
agent → change (关联变更)
agent → worktree (获取租约)
agent → git_gateway (输出脱敏)
agent → git_identity (凭证解密)
agent → scan_docs (spec 文档)
agent → spec_profile (配置文件)
agent → spec_workspace (spec 工作空间)

change → workspace (关联工作空间)
change → task (创建任务)
change → workflow (审计)

worktree → git_identity (凭证解密)
worktree → workspace (获取路径)

git_gateway → git_identity (获取凭证)
git_gateway → worktree (验证租约)

knowledge → workspace (获取根路径)
runtime → workspace (获取根路径)
runtime → spec_workspace (获取 spec 路径)
scan_docs → workspace (获取根路径)

release → change (关联变更)
incident → change (关联变更)

change_writer → change (读取文档)
archive → change (归档变更)
```

### 7.2 模块间依赖原则

- **单向依赖**：上层模块依赖下层，不反向依赖
- **Service 注入**：通过构造函数注入 session + 可选的协作者
- **无直接 model 跨模块引用**：通过 service 层访问

## 8. 文件系统集成

多个模块直接读取文件系统：

| 模块 | 路径 | 用途 |
|------|------|------|
| workspace | root_path/.sillyspec/workspace.toml | 工作空间元数据 |
| knowledge | root_path/.sillyspec/knowledge/ | 知识条目 |
| knowledge | root_path/.sillyspec/quicklog/ | 快速日志 |
| scan_docs | root_path/.sillyspec/docs/ | 扫描文档 |
| runtime | spec_root/.runtime/ | 运行时进度 |
| change | .sillyspec/changes/ | 变更目录 |
| worktree | lease.branch_path | git worktree 目录 |

## 9. 中间件链

```
请求 → CORSMiddleware → request_id_middleware → 路由处理 → 响应
```

- **CORS**：可配置 origins，暴露 x-request-id
- **Request-ID**：入站生成/透传，出站返回
- **无全局 Auth 中间件**：路由级 Depends 控制
