---
author: qinyi
created_at: 2026-06-03T10:00:00
---

# INTEGRATIONS — backend

## 数据库

- **引擎**: PostgreSQL 16，通过 asyncpg 驱动
- **ORM**: SQLModel（Pydantic + SQLAlchemy）
- **异步模式**: 全链路 async（`asyncpg` + `AsyncSession`）
- **连接配置**: `DATABASE_URL` 环境变量
- **迁移**: Alembic，容器启动时自动执行 `alembic upgrade head`
- **数据表**: 32 张
- **审计**: audit_hooks 自动记录模型变更到 `AuditLog`

## 缓存

- **引擎**: Redis 7（redis.asyncio）
- **单例模式**: 进程级共享实例（`core/redis.py`）
- **配置**: `redis_url` 环境变量，默认 `redis://localhost:6379/0`
- **生命周期**: FastAPI shutdown 时 `close_redis()`

## 外部 API

### httpx
- `git_identity/providers/github.py`: GitHub API（OAuth token 验证）
- `tool_gateway/service.py`: 外部工具代理请求

### GitHub OAuth
- `git_identity` 模块支持 GitHub OAuth 流程

## CLI 工具

### Claude Code CLI
- **集成方式**: `asyncio.create_subprocess_exec`
- **适配器**: `agent/adapters/claude_code.py` — `ClaudeCodeAdapter`
- **协议**: stream-json（JSON 流式输出）
- **版本**: `CLAUDE_CODE_VERSION` 构建参数（默认 2.1.158）

### SillySpec CLI
- **集成方式**: subprocess 调用
- **版本**: `SILLYSPEC_VERSION` 构建参数（默认 3.14.0）

## Docker

- **基础镜像**: Python 3.12
- **多阶段构建**: 安装 Claude Code CLI + SillySpec CLI
- **启动流程**: alembic migrate → uvicorn :8000
- **数据卷**: spec-data, worktree-data, claude-data
- **宿主挂载**: `/host-projects` 映射宿主项目目录

## Git 集成

- `git_gateway`: 封装 Git 操作（clone/pull/commit/push/diff）
- `worktree`: Git worktree 隔离
- `git_identity`: Git 凭据管理（SSH key、GitHub token）
