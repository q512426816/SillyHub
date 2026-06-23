---
source_commit: ba87eec
updated_at: 2026-06-23T16:35:25Z
created_at: 2026-06-24T00:35:25
author: qinyi
generator: sillyspec-scan
---

# multi-agent-platform — 组件间集成（根 monorepo，组件边界视角）

> 由 `sillyspec-scan` 在 `ba87eec` 处扫描根 monorepo 生成。
> 与 SillyHub 功能视角互补：本文聚焦**组件边界**上的集成点、协议、用途与关键文件。
> 来源：`deploy/docker-compose*.yml`、`backend/app/main.py`、各 `router.py`、daemon `ws-client.ts`/`hub-client.ts`、`sillyhub-daemon/package.json`，以及对源码的 grep 结果。

## 1. frontend ↔ backend（REST + SSE）

- **协议**：HTTP REST（前端通过 Next.js `/api` 代理或 `NEXT_PUBLIC_API_BASE_URL` 直连）+ SSE 实时流。
- **集成点**：
  - 前端统一封装 `apiFetch`（`frontend/src/lib/api.ts`），401 自动 refresh；401/403/404/400 透传为 `ApiError`。
  - backend 所有路由统一挂 `/api` 前缀（`backend/app/main.py` 聚合 ~18 个 `include_router(..., prefix="/api")`）：auth / workspace(+members) / change / scan_docs / task / git_identity / agent / daemon / worktree / lease / git_gateway / change_writer / workflow / incident / health 等。
- **典型调用方**（grep 命中）：
  - `frontend/src/lib/auth.ts` → `/api/auth/login`、`/api/auth/refresh`、`/api/auth/me`、`/api/auth/logout`。
  - `frontend/src/lib/changes.ts` → `/api/workspaces/{wid}/changes`、`/changes/{cid}/documents[/{docType}]`、`/changes/{cid}/reparse`。
  - `frontend/src/lib/workspace-members.ts` → `/api/workspaces/{wid}/members/*`（6 个函数 1:1 端点）。
- **SSE 实时流**：backend `StreamingResponse`（`text/event-stream`）见 `backend/app/modules/ppm/task/router.py`；daemon run 日志聚合发布到 Redis channel `agent_run:{run_id}` / `agent_session:{session_id}`，由 SSE 转发前端（`backend/app/modules/daemon/run_sync/service.py`：`{channel, content, timestamp, log_id}` 行级发布，turn_completed / onTokens 终端事件）。
- **前端消费组件**：`frontend/src/components/daemon/`（`runtime-session-dialog.tsx`、`interactive-session-panel.tsx`）、`agent-log/`、`agent-run-panel.tsx`。

## 2. daemon ↔ backend（WebSocket 实时通道 + REST 注册/心跳/lease）

- **WebSocket 通道**（daemon → backend）：
  - backend 端点：`backend/app/modules/daemon/router.py` 中 `@router.websocket("/ws")`（路由前缀 `/api/daemon`，即 `/api/daemon/ws`），按 `runtime_id` 接入 `DaemonWsHub`（`hub.connect(rid, websocket)`），receive_json 驱动；无效 runtime 关闭码 4001。
  - daemon 侧：`sillyhub-daemon/src/ws-client.ts`（`import WebSocket from 'ws'`），内部把 http(s) URL 转 `ws://`/`wss://`，与 backend `_build_ws_url` 1:1；交互式会话远程人审（manualApproval）依赖该通道回传 resolver 信号（`interactive/session-manager.ts`）。
- **REST 注册/心跳**（daemon → backend，启动时与兜底）：
  - `/api/daemon/register`（`router.py:136`）：daemon 启动时在三个循环（heartbeat/poll/ws）前注册 runtime。
  - `/api/daemon/heartbeat`（`router.py:168`）：HTTP 心跳，作为 WebSocket 不可用时的兜底。
  - lease 相关：`backend/app/modules/daemon/lease_service.py` 维护租约与取消信号（注释表明 WS Hub 取消信号在 Wave 2 接入）。
- **daemon 侧心跳循环**：
  - `config.ts`：`heartbeat_interval=15`、`lease_heartbeat_interval=5`。
  - `task-runner.ts`：在 `runLease` 内并发跑 lease heartbeat 循环（`_runLeaseHeartbeatLoop`，检测 backend cancel 信号 + 续期），`finally` 停止循环避免泄漏。
- **backend 内部桥接**：`daemon/session/service.py` 用 Redis `publish` 把会话事件转发给 SSE 客户端；`health/router.py` 探测 redis ping。

## 3. backend ↔ 存储（PostgreSQL + Redis）

- **PostgreSQL**：
  - 镜像 `postgres:16-alpine`（`deploy/docker-compose.yml`），命名卷 `pgdata`，健康检查 `pg_isready`。
  - 连接串（注入 backend 容器）：`postgresql+asyncpg://${POSTGRES_USER:-platform}:${POSTGRES_PASSWORD:-platform}@postgres:5432/${POSTGRES_DB:-platform}`。
  - 客户端依赖：`sqlmodel>=0.0.22`、`sqlalchemy[asyncio]>=2.0`、`asyncpg>=0.29`、`alembic>=1.13`（`backend/pyproject.toml`）；容器启动先 `alembic upgrade head` 再 `uvicorn`。
- **Redis**：
  - 镜像 `redis:7-alpine`（`--appendonly yes`），命名卷 `redisdata`，连接 `redis://redis:6379/0`。
  - 客户端依赖：`redis>=5.0`；封装见 `backend/app/core/redis.py`（`get_redis`）。
  - 用途：缓存 + Pub/Sub（daemon session/run 事件桥接 SSE）+ 健康检查。grep 命中 `health/router.py`、`daemon/session/service.py`、`daemon/run_sync/service.py` 等多处。

## 4. daemon ↔ Claude Agent SDK（本地子进程编排）

- **承载**：`sillyhub-daemon`（Node ≥20 ESM 单进程）。
- **依赖**：`@anthropic-ai/claude-agent-sdk@0.3.181`（`sillyhub-daemon/package.json`，pnpm overrides 对 win32/linux/darwin 多平台二进制统一指向主包）。
- **使用点**（type/value import，grep 命中）：
  - `src/interactive/claude-sdk-driver.ts`：`import { query as sdkQuery } from '@anthropic-ai/claude-agent-sdk'`，驱动交互式会话；启动前解析 wrapper 到底层 `@anthropic-ai/claude-code/bin/claude(.exe)`。
  - `src/interactive/session-manager.ts`、`src/interactive/types.ts`：复用 `Query` / `SDKMessage` / `SDKResultMessage` / `SDKUserMessage` 类型。
- **凭证 / 子进程环境**：`src/credential.ts`、`src/spawn-env.ts` 把宿主凭证注入子进程；Docker 部署下由 `deploy/.env` 注入 backend 容器。
- **协议适配**：`src/adapters/`（stream-json / json-rpc / jsonl / ndjson）统一 SDK 输出协议。

## 5. deploy docker 编排（组件拓扑）

- **全栈**（`deploy/docker-compose.yml`，name `multi-agent-platform`）：
  - `postgres`(5432) ← `backend`(8000，依赖 pg+redis healthy) ← `frontend`(3000，依赖 backend)。
  - backend 构建参数注入 `CLAUDE_CODE_VERSION`(默认 2.1.158) / `SILLYSPEC_VERSION`(默认 3.19.1)；frontend 构建期注入 `INTERNAL_API_BASE_URL`(默认 `http://backend:8000`) + `NEXT_PUBLIC_API_BASE_URL`(默认 `http://localhost:8000`)。
  - 卷：`pgdata`、`redisdata`、`worktree-data`(`/data/sillyspec-workspaces`)、`claude-data`(`/app/.claude`) + bind mount `HOST_PROJECTS_DIR`→`/host-projects`、`SPEC_DATA_HOST_DIR`→`/data/spec-workspaces`（宿主 daemon 与容器 backend 共享 spec 文档物理目录）。
- **dev**（`deploy/docker-compose.dev.yml`）：仅 pg + redis，backend/frontend 宿主热重载。
- **daemon 不入容器**：始终宿主机本地运行，通过 WebSocket/HTTP 连 backend（backend 端口对宿主开放 `${BACKEND_PORT:-8000}`）。

## 6. 跨组件文件系统共享（spec workspace / worktree）

- **spec-workspaces 隔离**：backend 容器 bind mount `SPEC_DATA_HOST_DIR`→`/data/spec-workspaces`，设 `SPEC_DATA_ROOT`，宿主 daemon 与容器 backend 共享同一物理目录，否则 agent 看不到 backend 写入的 spec 文档。
- **宿主项目挂载**：`HOST_PROJECTS_DIR`→`/host-projects`，配 `HOST_PATH_PREFIX`/`CONTAINER_PATH_PREFIX` 路径重写，使扫描器在容器内读宿主 `.sillyspec` 树。
- **worktree**：命名卷 `worktree-data`→`/data/sillyspec-workspaces`，设 `WORKTREE_BASE_DIR`。
- **本地数据**：仓库内 `data/spec-storage/`（本地 spec 数据）、`backups/`（DB 备份 SQL）。
