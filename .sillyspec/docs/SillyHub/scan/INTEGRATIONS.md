---
author: qinyi
created_at: 2026-05-29T17:40:00
---

# INTEGRATIONS — multi-agent-platform (monorepo)

## 数据库和缓存

| 集成 | 用途 |
|------|------|
| PostgreSQL 16 (asyncpg) | 后端主数据库，24+ 张表 |
| Alembic | 数据库迁移（22 个版本文件） |
| Redis 7 | 缓存 + Agent 日志 pub/sub + 健康检查 |

## 认证和安全

| 集成 | 用途 |
|------|------|
| python-jose (JWT) | Access/refresh token 签发和验证 |
| passlib (bcrypt) | 密码哈希（默认 12 轮） |
| PyNaCl | 额外加密操作 |

## 外部服务

| 集成 | 用途 |
|------|------|
| GitHub API (httpx) | Git identity PAT 验证（`GET /repos/{owner}/{repo}`） |
| Claude Code CLI (subprocess) | Agent 适配器通过子进程调用 claude CLI |

## 文件系统

| 集成 | 用途 |
|------|------|
| `.sillyspec/` 目录树 | 读取 projects/*.yaml、docs/、changes/、.runtime/ |
| Worktree 数据目录 | 默认 Windows `C:/data/sillyspec-workspaces`，Linux `/data/sillyspec-workspaces` |
| Docker 挂载 | 宿主机项目目录挂载到容器，供扫描器读取 |

## 前后端通信

| 集成 | 用途 |
|------|------|
| REST API (`/api` 前缀) | 前端通过 `apiFetch<T>()` 调用后端 18+ 个业务域端点 |
| SSE (Redis pub/sub) | Agent 运行日志实时流式传输 |
| CORS | 配置 `cors_allowed_origins`，默认 `http://localhost:3000` |

## 可观测性

| 集成 | 用途 |
|------|------|
| structlog | 结构化日志（全链路使用） |
| OpenTelemetry | 配置项预留（`otel_endpoint`），当前为 stub |
| Request ID middleware | 请求追踪 UUID |

## CI/CD

| 集成 | 用途 |
|------|------|
| GitHub Actions | Backend CI: ruff → mypy → pytest --cov-fail-under=60 |
| Docker Compose | 全栈部署（4 服务） + 开发模式（2 服务） |
| Makefile | 20 个统一命令 target |

## SillySpec 文件约定

| 路径 | 用途 |
|------|------|
| `.sillyspec/projects/*.yaml` | 子项目配置 |
| `.sillyspec/docs/{component}/scan/*.md` | 扫描文档 |
| `.sillyspec/changes/{change}/` | 变更文档 |
| `.sillyspec/.runtime/progress.json` | 运行时进度 |
| `.sillyspec/knowledge/` | 知识库 |
| `.sillyspec/shared/` | 共享规范 |
