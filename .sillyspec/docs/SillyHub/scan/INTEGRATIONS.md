---
date: 2026-06-24
source_commit: ba87eec
updated_at: 2026-06-23T16:32:14Z
created_at: 2026-06-24T00:32:14
author: qinyi
generator: sillyspec-scan
---

# SillyHub — 组件间集成（产品根）

> 本文档由 `sillyspec-scan` 在 `ba87eec` 处全量重扫 SillyHub 产品根生成。
> 按「类型」分组列出 SillyHub 各组件之间的集成点（frontend ↔ backend ↔ daemon ↔ 存储 ↔ 外部 SDK ↔ 部署）。
> 信息来源：`deploy/docker-compose*.yml`、`backend/pyproject.toml`、`frontend/package.json`、`sillyhub-daemon/package.json` 及源码 grep。

## 1. frontend ↔ backend：REST / SSE

- **集成点**：前端统一通过 `@/lib/api` 的 `apiFetch()` 调用 `/api/*` REST 端点；错误统一抛 `ApiError`（401 自动 refresh + 403/404/400 透传）。
- **用途**：业务全部读写 —— workspace、change/workflow（transition/reviews）、task、daemon、agent、tool-gateway、health、auth、ppm、knowledge、incidents、releases、settings、scan-docs 等。
- **关键文件**：
  - 统一客户端：`frontend/src/lib/api.ts`（`apiFetch` 封装）。
  - 按域拆分的客户端模块：`frontend/src/lib/`（`agent.ts`、`daemon.ts`、`runtime.ts`、`workflow.ts`、`health.ts`、`workspace-members.ts`、`tool-gateway.ts`、`git-gateway.ts`、`ppm/`、`auth.ts`、`changes.ts`、`knowledge.ts`、`releases.ts`、`scan-docs.ts` 等约 25 个）。
  - 流式：`frontend/src/lib/agent-stream.ts`（Agent 运行流处理）。
  - 后端入口：`backend/app/main.py`（挂载各模块 router，前缀 `/api`）。
- **运行时 Base URL**：构建期注入 `NEXT_PUBLIC_API_BASE_URL`（默认 `http://localhost:8000`）；服务端渲染走 `INTERNAL_API_BASE_URL`（默认 `http://backend:8000`），见 `frontend/next.config.mjs`。

## 2. daemon ↔ backend：WebSocket + REST 回调

- **WebSocket 长连接**（daemon → backend）：
  - 端点：`backend/app/modules/daemon/router.py:1148` `@router.websocket("/ws")`（`daemon_websocket`）。
  - Hub：`backend/app/modules/daemon/ws_hub.py`（按 runtime_id 注册连接，新连接顶替旧连接）。
  - 客户端：`sillyhub-daemon/src/ws-client.ts`（`ws` 库，http→ws / https→wss 自动转换，含重连）。
  - 协议常量：`sillyhub-daemon/src/protocol.ts`（DaemonMessage 类型联合）+ `backend/app/modules/daemon/`。
  - 用途：daemon 启动后建立长连接，接收 lease 任务派发、RPC（`ws_hub` + `test_ws_rpc.py` 覆盖）、交互式会话 patch（`test_interactive_lifecycle_patch.py`）。
- **REST 注册与回调**（双向）：
  - daemon 注册：`POST /api/daemon/register`（`backend/app/modules/daemon/router.py:136`，颁发 claim token）。
  - daemon → backend REST 回调：`sillyhub-daemon/src/hub-client.ts`（原生 fetch，上报心跳 / 会话事件 / `notifySessionEnd` 等）。
- **唤醒信号**：`backend/app/modules/agent/placement.py:912` 通过 `DaemonWsHub` 发 WebSocket 唤醒 daemon 认领 lease。

## 3. backend ↔ 存储：PostgreSQL + Redis

### 3.1 PostgreSQL（主数据）
- **角色**：用户、workspace、daemon runtime、agent 会话、SillySpec 元数据、PPM 项目域等持久化。
- **镜像**：`postgres:16-alpine`（`deploy/docker-compose.yml`），容器 `5432`，宿主 `${POSTGRES_PORT:-5432}`。
- **连接串**（注入 backend）：`postgresql+asyncpg://${POSTGRES_USER:-platform}:${POSTGRES_PASSWORD:-platform}@postgres:5432/${POSTGRES_DB:-platform}`。
- **客户端依赖**（backend `pyproject.toml`）：`sqlmodel>=0.0.22`、`sqlalchemy[asyncio]>=2.0`、`asyncpg>=0.29`、`alembic>=1.13`。
- **关键文件**：`backend/app/core/db.py`（连接池，为 daemon websocket + mission 轮询调优）、`backend/app/core/config.py`（`database_url`）、`backend/app/models.py` / `backend/app/modules/*/model.py`、`backend/migrations/`（alembic）。
- **健康检查**：`pg_isready`；命名卷 `pgdata`。

### 3.2 Redis（缓存 / Pub-Sub / 锁）
- **角色**：缓存、Pub/Sub、SSE 事件桥接、分布式锁。
- **镜像**：`redis:7-alpine`（appendonly AOF），dev 编排暴露 `${REDIS_PORT:-6379}`，连接串 `redis://redis:6379/0`。
- **客户端依赖**：`redis>=5.0`。
- **关键文件**：`backend/app/core/redis.py`（单例 `redis.asyncio.Redis` + `close_redis`）、`backend/app/modules/health/router.py`（`_check_redis` ping）、`backend/app/modules/daemon/session/service.py`、`backend/app/modules/agent/service.py`、`backend/app/modules/spec_workspace/bootstrap.py` 等多处使用 pub-sub / `EventSourceResponse`（grep 命中约 26 文件）。

## 4. daemon ↔ Claude Agent SDK / 本地 CLI

- **承载子项目**：`sillyhub-daemon`（Node ≥20 ESM 单进程）。
- **核心依赖**：`@anthropic-ai/claude-agent-sdk@0.3.181`（`sillyhub-daemon/package.json`，pnpm overrides 把 win32/linux/darwin 多平台二进制统一指向主包）。
- **使用点**（grep 命中）：
  - `src/interactive/claude-sdk-driver.ts`：`import { query as sdkQuery } from '@anthropic-ai/claude-agent-sdk'`（驱动交互式会话）。
  - `src/interactive/session-manager.ts`、`input-queue.ts`、`types.ts`：导入 `Query` / `SDKMessage` / `SDKResultMessage` / `SDKUserMessage` 等类型。
  - `src/daemon.ts`：导入 `SDKMessage` / `SDKResultMessage` 做消息路由。
- **本地进程 / spawn**（grep `spawn|execa|child_process` 约 21 文件）：`src/spawn-env.ts`、`src/credential.ts`（凭证注入子进程环境）、`src/agent-detector.ts`（宿主 agent 探测）、`src/workspace.ts`（工作目录隔离）、`src/adapters/*.ts`（stream-json / json-rpc / jsonl / ndjson 输出协议适配）、`src/terminal-launcher.ts` / `terminal-observer.ts`（终端观察）。
- **LLM 凭证**：Docker 部署下由 `deploy/.env` 注入 backend 容器；backend 本身不直接 import Anthropic SDK，仅通过 `ANTHROPIC_*` 环境变量传递（`backend/app/modules/agent/delegation.py` `Build from ANTHROPIC_* env`），实际推理由 daemon 驱动的 Claude 子进程完成。

## 5. 文件系统 / workspace 隔离（Docker 部署）

- **spec-workspaces 共享**：backend 容器 bind mount `SPEC_DATA_HOST_DIR`（默认 `C:/data/spec-workspaces`）→ `/data/spec-workspaces`，设 `SPEC_DATA_ROOT`，使宿主 daemon 与容器后端共享 spec 文档。
- **worktree 数据**：命名卷 `worktree-data` → `/data/sillyspec-workspaces`，设 `WORKTREE_BASE_DIR`。
- **宿主项目挂载 + 路径重写**：`HOST_PROJECTS_DIR`（默认 `C:/Users/qinyi/IdeaProjects`）→ `/host-projects`，经 `HOST_PATH_PREFIX` / `CONTAINER_PATH_PREFIX` 重写（commit `ba87eec` 系列：backend 生成宿主路径 prompt，daemon 零配置），扫描器可在容器内读宿主 `.sillyspec` 树。
- **验证产物**：`spikes/01-git-isolation/`、`spikes/02-workspace-scan/`、`spikes/04-delegate-task/`、`spikes/05-mission-e2e/`。

## 6. Docker / 容器编排

### 6.1 全栈 `deploy/docker-compose.yml`（name: `multi-agent-platform`）
| 服务 | 镜像 / 来源 | 端口 | 依赖 | 说明 |
| --- | --- | --- | --- | --- |
| `postgres` | `postgres:16-alpine` | `5432` | — | 见 §3.1 |
| `redis` | `redis:7-alpine` | （容器内） | — | 见 §3.2，AOF 持久化 |
| `backend` | `build context=../backend` | `8000` | `postgres`(healthy) / `redis`(healthy) | 启动 `alembic upgrade head && uvicorn app.main:app`；构建参数 `CLAUDE_CODE_VERSION` / `SILLYSPEC_VERSION` |
| `frontend` | `build context=../frontend` | `3000` | `backend` | 构建期注入 `INTERNAL_API_BASE_URL`（默认 `http://backend:8000`）/ `NEXT_PUBLIC_API_BASE_URL`（默认 `http://localhost:8000`） |

命名卷：`pgdata`、`redisdata`、`worktree-data`、`claude-data`；外加宿主项目目录与 `SPEC_DATA_HOST_DIR` 的 bind mount。

### 6.2 开发 `deploy/docker-compose.dev.yml`（name: `multi-agent-platform-dev`）
仅起依赖服务，backend / frontend 在宿主热重载（`uvicorn --reload` / `next dev`）：
- `postgres:16-alpine`，暴露 `${POSTGRES_PORT:-5432}`。
- `redis:7-alpine`，暴露 `${REDIS_PORT:-6379}`。

> 注：`deploy/` 下**没有** sillyhub-daemon 的 compose 服务 —— daemon 始终在宿主机本地运行（本地脚本拉起），与 backend 通过 WebSocket / REST 交互。

## 7. 前端运行时依赖摘要（frontend/package.json）

- 框架：`next@14.2.5`、`react@18.3.1`、`react-dom@18.3.1`。
- UI：`antd@^6.4.4`、`@ant-design/icons`、`@ant-design/nextjs-registry`、`@radix-ui/*`、`lucide-react`、`tailwindcss@3.4.7` + `tailwindcss-animate`、`class-variance-authority` / `clsx` / `tailwind-merge`。
- 数据/状态：`@tanstack/react-query@^5.51`、`zustand@^4.5`、`zod@^3.23`。
- 可视化/流程：`@xyflow/react@^12.10`（拓扑流程图）、`echarts@^6.1` + `echarts-for-react`（图表）、`@uiw/react-markdown-preview`。
- 测试/E2E：`vitest`、`@testing-library/react`、`@playwright/test`、`puppeteer`、`jsdom`。
- 构建：`node>=20`，`packageManager=pnpm@9.6.0`。
