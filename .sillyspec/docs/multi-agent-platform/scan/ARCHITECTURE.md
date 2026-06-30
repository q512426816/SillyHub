---
source_commit: ba87eec
updated_at: 2026-06-23T16:35:08Z
created_at: 2026-06-24T00:35:08
author: qinyi
generator: sillyspec-scan
---

# ARCHITECTURE.md — multi-agent-platform (monorepo 根)

本文档以**组件/子系统视角**描述 `multi-agent-platform` monorepo 的整体架构。根目录无应用源码，代码与基础设施分布在以下组件（与 SillyHub 功能视角互补）：

| 组件 | 路径 | 角色 | 详细文档 |
| --- | --- | --- | --- |
| backend | `backend/` | FastAPI REST/SSE/WebSocket API、任务调度、数据持久化（唯一真理源） | `modules/backend.md` |
| frontend | `frontend/` | Next.js 14 浏览器端 SPA（SSR） | `modules/frontend.md` |
| sillyhub-daemon | `sillyhub-daemon/` | 本地守护进程，spawn 并管理 Claude 进程（Claude Agent SDK） | `modules/sillyhub-daemon.md` |
| deploy | `deploy/` | Docker Compose 编排基础设施（生产全栈 / 开发仅 db+redis） | `modules/deploy.md` |
| docs | `docs/` | 设计文档、参考资料、QA 评审 | `modules/docs.md` |
| spikes | `spikes/` | 实验性原型（HTML demo 等） | `modules/spikes.md` |
| sillyspec | `.sillyspec/` | 规范体系（modules / flows / changes / scan） | `modules/sillyspec.md` |

另有跨组件流程文档 `.sillyspec/docs/multi-agent-platform/flows/`（6 篇）：`agent-execution.md`、`agent-run-flow.md`、`auth-flow.md`、`change-lifecycle.md`、`sillyspec-workflow.md`、`workspace-scan-bootstrap.md`。

## 架构概览

三组件 + 一套基础设施，三层交互链路：

```
┌─────────────┐   HTTP REST + SSE   ┌──────────────────┐   WebSocket + HTTP   ┌──────────────────┐
│  frontend   │ ───────────────────▶│     backend      │◀────────────────────▶│  sillyhub-daemon │
│ (浏览器)    │ ◀─── SSE 日志流 ────│  (FastAPI)       │   (本地守护进程)     │  (Claude Agent)  │
│ Next.js 14  │                     │  :8000           │                      │  :动态端口        │
└─────────────┘                     └────────┬─────────┘                      └────────┬─────────┘
       │                                      │                                        │
       │ TanStack Query /                     │ PostgreSQL 16 (持久)                    │ spawn
       │ EventSource(SSE)                     │ Redis 7 (缓存/锁)                       ▼
       │ fetch                                └────────────────                          Claude Code CLI
                                                                                  (@anthropic-ai/
                                                                                   claude-agent-sdk)
                            ┌─────────────────────────────────────┐
                            │  deploy/ Docker Compose 基础设施      │
                            │  postgres:16  redis:7  backend  frontend │
                            └─────────────────────────────────────┘
```

核心数据流向：

1. **frontend → backend**：浏览器通过 TanStack Query 发 REST 请求（任务创建、租约查询、PPM 等），通过 `EventSource` 订阅 SSE 实时日志。前端 SSE 入口：`frontend/src/lib/agent-stream.ts`（`new EventSource`）、`frontend/src/lib/daemon.ts`（session SSE，用 query 传 accessToken）。
2. **backend → sillyhub-daemon**：backend 通过 WebSocket Hub（`backend/app/modules/daemon/ws_hub.py` 的 `DaemonWsHub`）按 `runtime_id` 推送 `task_available` 等事件给已注册的 daemon；daemon 反向通过原生 `fetch`（`sillyhub-daemon/src/hub-client.ts` 的 `HubClient`，无 HTTP 库依赖，对齐 Python httpx `trust_env=False` 语义）回调 backend REST 端点（注册、心跳、claim/start/complete lease、提交消息、session 恢复）。daemon 侧 `ws-client.ts` 用 `ws@^8.18` 连 backend Hub。
3. **sillyhub-daemon → Claude**：daemon 用 Claude Agent SDK（`@anthropic-ai/claude-agent-sdk@0.3.181`）spawn Claude 进程执行实际任务，把产出/日志通过 `submit_lease_messages` 回传 backend。
4. **backend → frontend（实时）**：backend 把 daemon 回传的日志落库（`AgentRunLog`）后，通过 SSE 端点推给浏览器（`agent/router.py` 的 `stream_agent_run_logs`、`daemon/router.py` 的 session SSE，均 `text/event-stream`）。

## 技术栈

### backend (`backend/pyproject.toml`)
- Python ≥3.12，FastAPI ≥0.115 + Uvicorn ≥0.30
- SQLModel ≥0.0.22 + SQLAlchemy[asyncio] ≥2.0 + asyncpg ≥0.29（PostgreSQL 16）
- Alembic ≥1.13 迁移
- Redis ≥5.0
- AuthN/AuthZ：python-jose[cryptography]（JWT）、passlib[bcrypt]、pynacl
- 结构化日志 structlog ≥24.4
- httpx ≥0.27（与 daemon 对接的 HTTP 客户端基线）
- openpyxl（Excel 导出）、psutil、python-frontmatter
- 测试：pytest + pytest-asyncio + aiosqlite（dev）

### frontend (`frontend/package.json`)
- Next.js 14.2.5 + React 18.3.1 + TypeScript 5.5（App Router，SSR）
- 状态/数据：TanStack Query ^5.51、Zustand、Zod
- UI：Ant Design ^6.4、Tailwind 3.4.7、Radix UI primitives、lucide-react、@xyflow/react（流程图）、ECharts
- Markdown：@uiw/react-markdown-preview
- 测试：Vitest + Testing Library + jsdom；E2E：Playwright + Puppeteer
- 包管理：pnpm（Node ≥20）

### sillyhub-daemon (`sillyhub-daemon/package.json`)
- Node ≥20，TypeScript 5.5，ESM（`"type": "module"`）
- Claude Agent SDK `@anthropic-ai/claude-agent-sdk@0.3.181`
- `ws@^8.18.0`（WebSocket 客户端，连 backend Hub）
- `commander@^12.1.0`（CLI 参数）
- HTTP 通信用 Node 20 原生 `fetch`（零 HTTP 库依赖）
- 测试：Vitest
- 源文件（21 个 `.ts`，`sillyhub-daemon/src/`）：`daemon.ts`（生命周期）/`cli.ts`/`hub-client.ts`（REST 回调）/`ws-client.ts`（WS 客户端）/`task-runner.ts`（批处理 lease）/`spec-sync.ts`（spec tar 双模式）/`protocol.ts`/`config.ts`/`credential.ts` 等

### deploy / 基础设施
- Docker Compose 编排；镜像 `postgres:16-alpine`、`redis:7-alpine`
- backend 镜像通过 build-args 注入 `CLAUDE_CODE_VERSION=2.1.158`、`SILLYSPEC_VERSION=3.20.4`
- 数据卷：`worktree-data`、`claude-data` 命名卷；`/host-projects`、`/data/spec-workspaces` bind mount

## 部署拓扑（`deploy/`）

### 生产 / 全栈 — `deploy/docker-compose.yml`（`name: multi-agent-platform`）
四服务编排，统一 `.env` 注入：

| 服务 | 镜像/构建 | 端口 | 依赖 |
| --- | --- | --- | --- |
| `postgres` | postgres:16-alpine | `${POSTGRES_PORT:-5432}:5432` | healthcheck pg_isready |
| `redis` | redis:7-alpine（appendonly AOF） | —（内部） | healthcheck redis-cli ping |
| `backend` | 构建 `../backend/Dockerfile`（build-args `CLAUDE_CODE_VERSION`、`SILLYSPEC_VERSION`） | `${BACKEND_PORT:-8000}:8000` | postgres/redis healthy |
| `frontend` | 构建 `../frontend/Dockerfile`（SSR，`INTERNAL_API_BASE_URL=http://backend:8000`） | `${FRONTEND_PORT:-3000}:3000` | backend |

backend 关键挂载与配置：
- `${HOST_PROJECTS_DIR:-C:/Users/qinyi/IdeaProjects}:/host-projects` — 让扫描器读宿主 `.sillyspec` 树
- `${SPEC_DATA_HOST_DIR:-C:/data/spec-workspaces}:/data/spec-workspaces` bind mount — 宿主 daemon（Windows）与 backend 容器共享同一物理 spec 目录
- `worktree-data`、`claude-data` 命名卷
- `HOST_PATH_PREFIX` / `CONTAINER_PATH_PREFIX` 把宿主风格路径重写为容器挂载路径
- 启动命令：`ENTRYPOINT ["sillyhub-backend-entrypoint"]` + `CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]`（entrypoint 内跑 `alembic upgrade head`）
- healthcheck：`curl -fsS http://127.0.0.1:8000/api/health`
- 必填 env：`SECRET_KEY`、`SILLYSPEC_MASTER_KEY`
- CORS 默认放行 `http://localhost:3001`、`http://127.0.0.1:3001`

frontend 镜像：
- 构建期注入 `INTERNAL_API_BASE_URL`、`NEXT_PUBLIC_API_BASE_URL`、`NEXT_PUBLIC_COMMIT_SHA`
- `CMD ["node", "server.js"]`（Next.js SSR）
- healthcheck：`node -e "fetch('http://127.0.0.1:3000')..."`

#### spec 文档 transport 双模式（`SPEC_TRANSPORT`）

scan / propose / plan / execute 等 spec 写盘 stage 生成的 spec 文档在 daemon 与 backend 间的同步路径由全局环境变量 `SPEC_TRANSPORT` 决定（正交于 `SpecWorkspace.strategy`；不入库，走 backend `Settings.spec_transport`）：

- **`shared`（默认，同机拓扑）**：依赖上段描述的 bind mount（`${SPEC_DATA_HOST_DIR}:/data/spec-workspaces`）。daemon 把 spec 写到宿主路径，backend 经 bind mount 看到同一物理目录 reparse 入库。无 pull / 无回传，零额外机制。
- **`tar`（异机拓扑，daemon 与 backend 两台独立设备无共享盘）**：bind mount 失效，走整树 tar 回传（双向同步），严格对照 design §5.2：lease claim 时 daemon `pullSpecBundle` 拉解本地缓存 → prompt `--spec-root` 指本地 → session/task 终态回调 `postSpecSync` 打 tar 回传 → backend `apply_sync` 解 tar 到 `/data/{ws}` + reparse。daemon 本地缓存保留，下次 lease 覆盖。

backend 是唯一真理源：shared 靠 bind mount 天然一致，tar 靠 `apply_sync` 整树覆盖保证 `/data/{ws}` 为权威副本。**已知约束**：全局单一 transport，同一 backend 不能同时服务同机 + 异机 daemon（未来需升级为 per-daemon transport 才能混部）。

### 开发 — `deploy/docker-compose.dev.yml`（`name: multi-agent-platform-dev`）
仅起 `postgres:16-alpine` + `redis:7-alpine`，backend / frontend 在宿主以 `uvicorn --reload`、`next dev` 运行，保证迭代速度。

## backend 组件内部结构（路由聚合）

`backend/app/main.py` 共 `include_router` 39 处，全部挂载 `/api` 前缀（PPM 域挂 `/api/ppm`）。主要模块路由：auth、workspace、members、change、scan_docs、task、git_identity、agent、daemon、worktree、lease、git_gateway、change_writer、workflow、incident、knowledge、release、admin、spec_workspace、settings、archive、runtime、tool_gateway、policy、health/qc，以及 PPM 域的 project / plan / task / problem / kanban 五个子路由。

backend 全部持久化模型继承 `app/models/base.py:BaseModel(SQLModel)`，审计钩子 `app/core/audit_hooks.py` 自动捕获所有 `table=True` 变更写入 `AuditLog`。全仓共约 66 处 `table=True`（约 55 张去重后的业务表），按域分组：auth / admin / agent（运行时核心）/ daemon / workspace / change / task / workflow / ppm（最大域，约 20 表）/ release / git_gateway / tool_gateway 等。

## 关键交互协议

- **Daemon WebSocket Hub**（`backend/app/modules/daemon/ws_hub.py` 的 `DaemonWsHub`）：按 `runtime_id` 维护连接注册表（`dict[uuid.UUID, WebSocket]`），支持广播 `task_available`、逐连接定向发送、去重保护、慢连接驱逐（send timeout）。
- **协议消息**（`backend/app/modules/daemon/protocol.py` / `sillyhub-daemon/src/protocol.ts` 双端 1:1）：`DaemonMessage(type)` + payload — `TaskAvailable` / `Heartbeat`(+Ack) / `LeaseClaim`(+Ack) / `LeaseComplete` / `RpcRequest`(+Result) / `SessionInject` / `SessionControl` / `PermissionRequest`(+Response)。
- **daemon REST 回调**（`backend/app/modules/daemon/router.py`，35 个端点）：`register_daemon` / `daemon_heartbeat` / `claim_lease` / `start_lease` / `lease_heartbeat` / `submit_lease_messages` / `complete_lease` / `sync_lease_status` / `close_interactive_run` / `recover_session` / `confirm_session_reconnected` / `mark_session_recovery_failed` 等。
- **SSE**：`agent/router.py` 的 `stream_agent_run_logs`（agent run 日志流）；`daemon/router.py` 的 session SSE（`text/event-stream`，见 `daemon/tests/test_session_sse.py`）；PPM/spec_workspace 另有 Excel 导出与文件流的 `StreamingResponse`。
- **daemon 侧**：`WsClient`（`ws-client.ts`，连 backend Hub，含重连与握手超时）+ `HubClient`（`hub-client.ts`，原生 fetch 调 REST）+ `daemon.ts`（生命周期）+ `task-runner.ts`（批处理 lease 执行）+ `spec-sync.ts`（tar 双模式同步）+ `RecoveryCoordinator`（session 恢复）。

## 与 flows/ 流程文档的呼应

本架构的静态组件拓扑对应 `.sillyspec/docs/multi-agent-platform/flows/` 的 6 篇动态流程文档：

| flows 文档 | 对应架构组件交互 |
| --- | --- |
| `agent-execution.md` | daemon 内 Claude Agent SDK spawn + 任务执行 |
| `agent-run-flow.md` | frontend SSE ← backend ← daemon 的 agent run 日志全链路 |
| `auth-flow.md` | frontend ↔ backend 的 JWT/Session/RBAC 认证 |
| `change-lifecycle.md` | change/change_writer/workflow 模块的变更生命周期 |
| `sillyspec-workflow.md` | backend spec_workspace + daemon spec-sync 的 brainstorm→plan→execute→verify 流程 |
| `workspace-scan-bootstrap.md` | backend 扫描器读 `/host-projects` 宿主 `.sillyspec` 树初始化 workspace |
