---
author: qinyi
created_at: 2026-05-29T17:40:00
---

# INTEGRATIONS — backend

## 数据库

| 集成 | 库 | 用途 |
|------|------|------|
| PostgreSQL | asyncpg + SQLAlchemy 2.0 async | 主数据库，24+ 张表 |
| Alembic | alembic >=1.13 | 数据库迁移（22 个版本） |
| 健康检查 | `SELECT 1` | PostgreSQL 连通性检查 |

## 缓存

| 集成 | 库 | 用途 |
|------|------|------|
| Redis | redis >=5.0 (async) | 进程级单例 `get_redis()` |
| Redis pub/sub | redis.asyncio | Agent 运行日志实时推送（channel `agent_run:{run_id}`） |
| 健康检查 | `redis.ping()` | Redis 连通性检查 |

## HTTP 客户端

| 集成 | 库 | 用途 |
|------|------|------|
| GitHub API | httpx >=0.27 | `GET /repos/{owner}/{repo}` 验证 PAT 权限 |
| ASGI 测试 | httpx | 测试中使用 AsyncClient 作为 ASGI transport |

## 认证

| 集成 | 库 | 用途 |
|------|------|------|
| JWT | python-jose[cryptography] >=3.3 | Access/refresh token 签发和验证 |
| 密码 | passlib[bcrypt] >=1.7 | 密码哈希（默认 12 轮） |
| 加密 | PyNaCl >=1.5 | 额外加密操作 |

## 外部命令（子进程）

| 集成 | 用途 |
|------|------|
| Claude Code CLI | Agent 适配器通过子进程调用 `claude` 命令 |
| Git CLI | worktree/git_gateway 通过子进程执行 Git 操作 |

## 可观测性

| 集成 | 库 | 用途 |
|------|------|------|
| structlog | >=24.4 | 结构化日志（全链路） |
| OpenTelemetry | — | 配置项预留（`otel_endpoint`），当前为 stub |

## 配置

| 集成 | 库 | 用途 |
|------|------|------|
| pydantic-settings | >=2.4 | 从环境变量/.env 加载配置 |
| python-frontmatter | >=1.1 | 解析 Markdown frontmatter |
