---
author: qinyi
created_at: 2026-06-10T00:00:00
---

# Backend 外部集成

## 数据库：PostgreSQL (asyncpg)

- **用途**：主数据存储，所有业务数据持久化
- **连接**：通过 `settings.database_url` 配置，格式 `postgresql+asyncpg://user:pass@host:5432/db`
- **连接池**：大小 10，溢出 10，超时 30s，回收 1800s，启用 `pool_pre_ping`
- **迁移**：Alembic 管理，38 个版本化迁移文件
- **ORM**：SQLModel (SQLModel + SQLAlchemy async)，`expire_on_commit=False`
- **审计**：SQLAlchemy event hooks 自动捕获 BaseModel 变更写入 `audit_logs` 表

## 缓存/消息：Redis

- **用途**：
  - Agent 运行状态缓存
  - Daemon WebSocket 会话管理
  - 租约状态追踪
  - 分布式锁（乐观并发控制）
- **连接**：`settings.redis_url`，默认 `redis://localhost:6379/0`
- **客户端**：`redis.asyncio.Redis`，单例，`health_check_interval=30`
- **使用位置**：`agent/adapters/claude_code.py`（运行状态）、`daemon/ws_hub.py`（会话管理）

## 认证：JWT + bcrypt

- **JWT 库**：python-jose (cryptography 后端)
- **算法**：HS256
- **Access Token**：15 分钟 TTL（可配置 `auth_access_ttl_minutes`）
- **Refresh Token**：32 字节随机 token，14 天 TTL（可配置 `auth_refresh_ttl_days`），bcrypt 存储
- **密码**：bcrypt，默认 cost 12（可配置 `auth_bcrypt_rounds`，测试中降到 4）
- **Payload**：`{sub, email, is_admin, jti, iat, exp, typ}`

## 加密：NaCl (libsodium)

- **用途**：Git 凭证对称加密存储
- **算法**：XChaCha20-Poly1305 (secretbox)
- **密钥管理**：`SILLYSPEC_MASTER_KEY` 环境变量，格式 `<key_id>:<hex 32-byte key>`
- **密钥版本**：支持多版本共存，解密时校验 key_id
- **使用位置**：`git_identity/service.py`

## AI Agent：Claude Code

- **用途**：AI Agent 执行引擎
- **集成方式**：CLI 子进程调用 (`claude` 命令)
- **适配器**：`agent/adapters/claude_code.py`（继承 `AgentAdapter` ABC）
- **通信**：stdin/stdout 流式读取
- **上下文注入**：通过 `context_builder.py` 渲染 `CLAUDE.md` 到工作目录
- **进程管理**：asyncio 子进程，支持 kill/超时
- **Docker 集成**：Dockerfile 中通过 npm 安装 `@anthropic-ai/claude-code`

## Daemon 通信：WebSocket

- **用途**：后端与守护进程的双向实时通信
- **端点**：`/api/daemon/ws`
- **协议**：自定义 JSON 消息信封 `DaemonMessage {type, payload}`
- **消息类型**：
  - Server→Daemon：`task_available`, `heartbeat`
  - Daemon→Server：`register`, `heartbeat_ack`, `lease_claim`, `lease_start`, `lease_complete`, `lease_messages`
- **实现**：`daemon/ws_hub.py`（连接管理、心跳、广播、慢连接驱逐）
- **租约系统**：`daemon/lease_service.py`（任务分配、心跳续期、超时回收）

## Git 操作网关

- **用途**：代理 Git 操作，安全审计
- **功能**：Git 命令执行、diff 收集、输出脱敏（`redact_output`）
- **审计**：所有操作记录到 `git_operation_logs` 表

## 工具执行网关

- **用途**：受控的 shell 命令执行
- **策略控制**：`tool_policies` 表配置允许/阻止的命令、域名、路径限制
- **安全**：路径校验、SSRF 防护、速率限制
- **审计**：操作记录到 `tool_operation_logs` 表

## HTTP 客户端：httpx

- **用途**：外部 HTTP 请求（如 GitHub API 调用）
- **使用位置**：`git_identity/providers/github.py`

## 前端解析：python-frontmatter

- **用途**：解析带 YAML frontmatter 的 Markdown 文件
- **使用位置**：工作空间扫描和文档解析

## CORS 配置

- **允许来源**：`settings.cors_allowed_origins`，默认 `["http://localhost:3000"]`
- **配置方式**：JSON 数组或逗号分隔字符串
- **凭证**：允许
- **暴露头**：`x-request-id`

## Docker 构建

- **多阶段构建**：node-tools (Claude Code + SillySpec) -> builder (Python 依赖) -> runtime
- **运行时依赖**：curl, ca-certificates, git, libstdc++6
- **非 root 运行**：`app` 用户
- **健康检查**：`curl -fsS http://127.0.0.1:8000/api/health`
- **入口**：`docker-entrypoint.sh` -> `uvicorn app.main:app`
