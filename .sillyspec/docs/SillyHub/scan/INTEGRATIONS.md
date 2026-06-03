---
author: qinyi
created_at: 2026-06-03T20:35:00+08:00
---

# INTEGRATIONS.md — SillyHub 外部集成

## 子项目间集成

### Frontend → Backend

**协议**：HTTP REST API + SSE

前端通过 `src/lib/api.ts` 统一封装 fetch，指向 `NEXT_PUBLIC_API_BASE_URL`：

```
前端 (Next.js :3000) → HTTP → 后端 (FastAPI :8000)
  ↑ SSE 流式推送（Agent 日志）
```

- 基础 URL 从环境变量读取，自动附加 JWT token
- Docker 内网：`INTERNAL_API_BASE_URL=http://backend:8000`
- CORS 通过 `CORS_ALLOWED_ORIGINS` 配置（默认 `["http://localhost:3000"]`）
- API 按业务模块拆分为 30+ 独立 API 客户端文件（`src/lib/*.ts`）
- Agent 运行日志通过 SSE Route Handler（`/api/workspaces/[id]/agent/runs/[runId]/stream`）代理转发

### Backend 数据层

```
backend → PostgreSQL 16 (asyncpg) + SQLModel + Alembic
  → 异步连接池
  → 32 个迁移版本

backend → Redis 7 (缓存/会话)
  → async redis client
```

### Backend → Git

```
backend → GitGatewayService → subprocess (git CLI)
  → 白名单审计 + 输出脱敏 + 审计日志（GitOperationLog 表）
  → 支持操作：status/diff/add/commit/push/pull/fetch/log/branch/checkout/merge/rebase
  → 禁止：--force/--hard/clean
  → Shell 注入防护（管道、命令替换、链式执行）
  → PAT/Bearer token 自动遮蔽
```

### Backend → Claude Code

```
backend → AgentDispatchService → Claude Code subprocess
  → worktree 隔离 + ContextBuilder + SSE 日志流
  → 环境变量注入（ANTHROPIC_BASE_URL, ANTHROPIC_AUTH_TOKEN, CLAUDE_CODE_MODEL）
  → 超时：API_TIMEOUT_MS=3000000（50 分钟）
```

## 外部服务

### Anthropic / 智谱 API

```
Claude Code → ANTHROPIC_BASE_URL (智谱代理: https://open.bigmodel.cn/api/anthropic)
  ├─ ANTHROPIC_DEFAULT_HAIKU_MODEL=glm-5
  ├─ ANTHROPIC_DEFAULT_SONNET_MODEL=glm-5.1
  ├─ ANTHROPIC_DEFAULT_OPUS_MODEL=glm-5.1
  └─ CLAUDE_CODE_MODEL=opus[1m]，超时 50min
```

- 通过智谱 API 的 Anthropic 兼容接口调用
- 非 Anthropic 原生 API
- 超时配置 API_TIMEOUT_MS=3000000ms

### GitHub API

```
change_writer → httpx → GitHub REST API
  → 创建 PR（PAT 解密后使用，不落日志）
```

- 使用 Git Identity 中加密存储的 PAT
- 解密后仅在内存使用，日志脱敏

### OpenTelemetry（预留）

- SDK 已集成（`app/core/telemetry.py`）
- `OTEL_ENDPOINT` 配置就绪
- 当前未启用（OTEL_ENDPOINT 为空）
- 后续可接入 Grafana/Jaeger

## 部署基础设施

### Docker Compose（全栈）

```
docker-compose.yml
├─ postgres:16-alpine    → pgdata 卷（健康检查: pg_isready）
├─ redis:7-alpine        → redisdata 卷（健康检查: redis-cli ping）
├─ backend               → alembic migrate + uvicorn :8000（依赖 postgres + redis healthy）
└─ frontend              → Next.js :3000（依赖 backend）
```

启动依赖链：`postgres (healthy) + redis (healthy) → backend → frontend`

持久卷：
- pgdata — PostgreSQL 数据
- redisdata — Redis 数据（appendonly）
- worktree-data — Agent 工作树
- spec-data — SillySpec 数据
- claude-data — Claude Code 配置

### Docker Compose（开发）

```
docker-compose.dev.yml
├─ postgres:16-alpine    → 端口映射 5432:5432
└─ redis:7-alpine        → 端口映射 6379:6379
```

仅启动基础设施，前后端在宿主机上用 `uvicorn --reload` / `pnpm dev` 运行。

### 宿主机挂载

后端挂载 `${HOST_PROJECTS_DIR:-C:/Users/qinyi/IdeaProjects}:/host-projects`，通过 `HOST_PATH_PREFIX` / `CONTAINER_PATH_PREFIX` 映射，供 SillySpec 扫描读取 `.sillyspec/` 目录。

### 后端启动流程

```bash
# Docker entrypoint
alembic upgrade head && exec uvicorn app.main:app --host 0.0.0.0 --port 8000
```

1. 执行数据库迁移（alembic upgrade head）
2. 启动 FastAPI 应用（uvicorn）
3. lifespan 钩子：配置日志 → 初始化遥测 → 创建管理员 + RBAC 种子

### 前端启动流程

```bash
node server.js  # standalone 模式
```

- Next.js standalone 输出
- API 请求 rewrite 到后端

### frp 隧道

```
公网 → frp server → frp client → localhost:3000
```

前端通过 frp 暴露给公网，后端主要供内网调用。

## CI/CD

### GitHub Actions

#### backend-ci

```
触发：backend/** push/PR + workflow_dispatch
步骤：
  1. checkout (actions/checkout@v6)
  2. setup uv (astral-sh/setup-uv@v8.1.0, version 0.4.18)
  3. install Python 3.12
  4. uv sync --all-extras
  5. ruff check .
  6. ruff format --check .
  7. mypy app
  8. pytest -q --cov=app --cov-fail-under=60
环境变量：
  DATABASE_URL=postgresql+asyncpg://platform:platform@localhost:5432/platform_test
  REDIS_URL=redis://localhost:6379/15
  SECRET_KEY=ci-secret-must-be-at-least-16-chars
  ENVIRONMENT=test
超时：15 分钟
```

#### frontend-ci

```
触发：frontend/** push/PR + workflow_dispatch
步骤：
  1. checkout (actions/checkout@v4)
  2. setup pnpm (pnpm/action-setup@v4, version 9.6.0)
  3. setup Node 20 (actions/setup-node@v4, pnpm cache)
  4. pnpm install --frozen-lockfile
  5. pnpm lint
  6. pnpm typecheck
  7. pnpm test
  8. pnpm build（NEXT_PUBLIC_API_BASE_URL=http://localhost:8000）
超时：15 分钟
```

### Makefile 命令

| 命令 | 作用 |
|------|------|
| `make dev-up` | 启动 PG + Redis（docker-compose.dev.yml） |
| `make dev-down` | 停止开发依赖 |
| `make dev-logs` | 查看开发依赖日志 |
| `make dev-reset` | 清除 PG/Redis 数据（DESTRUCTIVE） |
| `make up` | 全栈容器启动（docker-compose.yml） |
| `make down` | 全栈容器停止 |
| `make logs` | 全栈容器日志 |
| `make test` | 后端 pytest + 前端 vitest |
| `make lint` | 后端 ruff+mypy + 前端 eslint+typecheck |
| `make backend-install` | uv sync |
| `make backend-run` | uvicorn --reload :8000 |
| `make backend-test` | pytest --cov --cov-fail-under=60 |
| `make backend-lint` | ruff check + format check + mypy |
| `make backend-format` | ruff format + ruff check --fix |
| `make backend-migrate` | alembic upgrade head |
| `make frontend-install` | pnpm install |
| `make frontend-run` | pnpm dev |
| `make frontend-test` | pnpm test |
| `make frontend-lint` | pnpm lint |
| `make frontend-typecheck` | pnpm typecheck |
| `make frontend-build` | pnpm build |

## 集成风险

| 风险 | 影响 | 缓解 |
|------|------|------|
| 宿主机路径映射不一致 | SillySpec 扫描失败 | 正确配置 HOST_PATH_PREFIX + HOST_PROJECTS_DIR |
| 智谱 API 限流/不稳定 | Agent 执行超时 | API_TIMEOUT_MS=3000000 + 重试策略 |
| Docker 卷数据丢失 | 数据库数据丢失 | 定期备份 pgdata 卷 |
| frp 隧道不稳定 | 公网不可访问 | 健康检查 + 自动重连 |
| Claude Code 版本锁定 | 功能过期 | .env 中 CLAUDE_CODE_VERSION 可调整 |
| SillySpec CLI 版本锁定 | 兼容性风险 | .env 中 SILLYSPEC_VERSION 可调整 |
