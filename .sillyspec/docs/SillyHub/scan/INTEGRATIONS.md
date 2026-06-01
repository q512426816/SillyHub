---
author: qinyi
created_at: 2026-05-31T23:30:00
---

# 集成总览

> 最后更新：2026-05-31
> 范围：SillyHub 子项目间集成、外部服务、部署基础设施

## 1. 子项目间集成

### 1.1 Frontend → Backend

**协议**：HTTP REST API

前端通过 `src/lib/api.ts` 统一封装 fetch，指向 `NEXT_PUBLIC_API_BASE_URL`：

```text
前端 (Next.js :3000) → HTTP → 后端 (FastAPI :8000)
```

- 基础 URL 从环境变量读取，自动附加 JWT token
- Docker 内网：`INTERNAL_API_BASE_URL=http://backend:8000`
- CORS 通过 `CORS_ALLOWED_ORIGINS` 配置（默认 `["http://localhost:3000"]`）
- API 按业务模块拆分（auth/changes/workspaces/agent 等）

### 1.2 Backend 数据层

```text
backend → PostgreSQL 16 (asyncpg) + SQLModel + Alembic
backend → Redis 7 (缓存/会话)
```

### 1.3 Backend → Git

```text
backend → GitGatewayService → subprocess (git CLI)
  → 白名单审计 + 输出脱敏 + 审计日志
```

### 1.4 Backend → Claude Code

```text
backend → AgentDispatchService → Claude Code subprocess
  → worktree 隔离 + ContextBuilder + SSE 日志流
```

## 2. 外部服务

### 2.1 Anthropic / 智谱 API

```text
Claude Code → ANTHROPIC_BASE_URL (智谱代理)
  ├─ glm-5 (Haiku) / glm-5.1 (Sonnet/Opus)
  └─ CLAUDE_CODE_MODEL=opus[1m]，超时 50min
```

### 2.2 GitHub API

```text
change_writer → httpx → GitHub REST API
  → 创建 PR（PAT 解密后使用，不落日志）
```

### 2.3 OpenTelemetry（预留）

SDK 已集成，`OTEL_ENDPOINT` 配置就绪，暂未启用。

## 3. 部署基础设施

### 3.1 Docker Compose

```text
docker-compose.yml
├─ postgres:16-alpine    → pgdata 卷
├─ redis:7-alpine        → redisdata 卷
├─ backend               → alembic migrate + uvicorn :8000
└─ frontend              → Next.js :3000
```

启动依赖：`postgres (healthy) + redis (healthy) → backend → frontend`

持久卷：pgdata / redisdata / worktree-data / spec-data / claude-data

### 3.2 frp 隧道

```text
公网 → frp server → frp client → localhost:3000
```

前端通过 frp 暴露，后端主要供内网调用。

### 3.3 宿主机挂载

后端挂载 `${HOST_PROJECTS_DIR}:/host-projects`，通过 `HOST_PATH_PREFIX`/`CONTAINER_PATH_PREFIX` 映射，供 SillySpec 扫描读取 `.sillyspec/` 目录。

### 3.4 后端启动流程

```bash
alembic upgrade head && exec uvicorn app.main:app --host 0.0.0.0 --port 8000
```

## 4. 开发环境

### 4.1 本地模式

```text
docker compose dev (PG + Redis) + uvicorn --reload + pnpm dev
```

### 4.2 CI/CD

- **backend-ci**：ruff → mypy → pytest（覆盖率 ≥ 60%）
- **frontend-ci**：lint → typecheck → test → build
- 路径触发：`backend/**` / `frontend/**`
- `workflow_dispatch` 手动触发

### 4.3 Makefile

| 命令 | 作用 |
|------|------|
| `make dev-up` | PG + Redis |
| `make up/down` | 全栈容器启停 |
| `make test` | 后端 + 前端测试 |
| `make lint` | 后端 + 前端检查 |
| `make backend-migrate` | 数据库迁移 |

## 5. 集成风险

| 风险 | 缓解 |
|------|------|
| 宿主机路径映射不一致 | 正确配置 HOST_PATH_PREFIX |
| frp 隧道不稳定 | 健康检查 + 自动重连 |
| 智谱 API 限流 | 重试 + API_TIMEOUT_MS |
| Docker 卷数据丢失 | 定期备份 pgdata |
