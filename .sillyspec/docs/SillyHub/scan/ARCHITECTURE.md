---
source_commit: fcbf3fa7
updated_at: 2026-06-22T18:12:59Z
generator: sillyspec-scan
author: qinyi
created_at: 2026-06-23 02:12:59
---

# ARCHITECTURE.md — SillyHub（产品整体架构）

> 本文档描述 SillyHub 产品的**整体架构与运行时交互链路**（path = `.`，仓库根视角）。
> 实际代码分布在 3 个子项目 + 1 个部署目录：`backend/` / `frontend/` / `sillyhub-daemon/` / `deploy/`。

## 技术栈

### backend (`backend/pyproject.toml`)
- Python ≥3.12，FastAPI ≥0.115 + Uvicorn ≥0.30
- SQLModel ≥0.0.22 + SQLAlchemy[asyncio] ≥2.0 + asyncpg ≥0.29（PostgreSQL 16）；Alembic ≥1.13 迁移
- Redis ≥5.0（缓存 / Pub-Sub / SSE 事件桥接 / 锁）
- AuthN/AuthZ：python-jose[cryptography]（JWT）、passlib[bcrypt]、pynacl
- 结构化日志 structlog ≥24.4；httpx ≥0.27（与 daemon 对接的 HTTP 客户端基线）
- openpyxl（Excel 导出）、psutil、python-frontmatter
- 测试：pytest + pytest-asyncio + aiosqlite（dev）

### frontend (`frontend/package.json`)
- Next.js 14.2.5 + React 18.3.1 + TypeScript 5.5.4（App Router）
- 数据/状态：TanStack Query 5.51、Zustand 4.5、Zod 3.23
- UI：Ant Design 6.4 + Tailwind 3.4 + Radix UI primitives + lucide-react；@xyflow/react（拓扑流程图）、ECharts 6、@uiw/react-markdown-preview
- 测试：Vitest 2 + Testing Library + jsdom；E2E：Playwright 1.60 + Puppeteer；包管理 pnpm 9.6.0（Node ≥20）

### sillyhub-daemon (`sillyhub-daemon/package.json`)
- Node ≥20，TypeScript 5.5.4，ESM（`"type": "module"`）
- `@anthropic-ai/claude-agent-sdk@0.3.181`（pnpm overrides 统一多平台二进制）
- `ws@^8.18`（WebSocket 客户端，连 backend Hub）、`commander@^12`（CLI 参数）
- HTTP 通信用 Node 20 原生 `fetch`（零 HTTP 库依赖，设计 G-05）；测试 Vitest 2

## 架构概览

SillyHub 由 **frontend ↔ backend ↔ daemon** 三层构成，核心运行时是**任务编排链路**：

```
┌─────────────┐   HTTP REST + SSE   ┌──────────────────┐   WebSocket + HTTP   ┌──────────────────┐
│  frontend   │ ───────────────────▶│     backend      │◀────────────────────▶│  sillyhub-daemon │
│ (浏览器)    │ ◀─── SSE 日志流 ────│  (FastAPI)       │   (本地守护进程)     │  (Claude Agent)  │
│ Next.js 14  │                     │  :8000           │                      │  :动态端口        │
└─────────────┘                     └────────┬─────────┘                      └────────┬─────────┘
       │                                      │                                        │ spawn
       │ TanStack Query /                     │ PostgreSQL (持久, ~55 表)               │
       │ EventSource(SSE)                     │ Redis (缓存/锁/Pub-Sub)                 ▼
       │ fetch                                └────────────────                          Claude Code CLI
                                                                                  (@anthropic-ai/
                                                                                   claude-agent-sdk)
```

**核心数据流向**（产品语义）：

1. **frontend → backend**：浏览器通过 TanStack Query 发 REST 请求（工作空间、变更、任务、PPM、租约等），通过 `EventSource` 订阅 SSE 实时日志。
2. **backend → sillyhub-daemon**：backend 经 `DaemonWsHub`（`backend/app/modules/daemon/ws_hub.py`）按 `runtime_id` 推送 `task_available` 等事件给已注册 daemon；daemon 反向用原生 `fetch`（`sillyhub-daemon/src/hub-client.ts` 的 `HubClient`，对齐 Python httpx `trust_env=False` 语义）回调 backend REST（注册、心跳、claim/start/complete lease、提交消息、session 恢复）。
3. **sillyhub-daemon → Claude**：daemon 用 Claude Agent SDK（`@anthropic-ai/claude-agent-sdk@0.3.181`）spawn Claude 进程执行实际任务，把产出 / 日志经 `submit_lease_messages` 回传 backend。交互式会话由 `interactive/session-manager.ts` + `interactive/claude-sdk-driver.ts` 驱动，输出协议由 `adapters/*`（stream-json / json-rpc / jsonl / ndjson）适配。
4. **backend → frontend（实时）**：backend 把 daemon 回传日志落库（`AgentRunLog`）后，经 SSE 端点 `/workspaces/{id}/agent/runs/{run_id}/stream`（`agent/router.py` 的 `stream_agent_run_logs`）推给浏览器。

## 部署拓扑（`deploy/`）

### 生产 / 全栈 — `deploy/docker-compose.yml`（`name: multi-agent-platform`）
四服务，统一 `.env` 注入：

| 服务 | 镜像/构建 | 端口 | 依赖 |
| --- | --- | --- | --- |
| `postgres` | postgres:16-alpine | `${POSTGRES_PORT:-5432}:5432` | healthcheck `pg_isready` |
| `redis` | redis:7-alpine（appendonly AOF） | —（内部） | healthcheck `redis-cli ping` |
| `backend` | 构建 `../backend/Dockerfile`（build-args 注入 `CLAUDE_CODE_VERSION=2.1.158`、`SILLYSPEC_VERSION=3.19.1`） | `${BACKEND_PORT:-8000}:8000` | postgres/redis healthy |
| `frontend` | 构建 `../frontend/Dockerfile`（SSR，`INTERNAL_API_BASE_URL=http://backend:8000`） | `${FRONTEND_PORT:-3000}:3000` | backend |

backend 关键挂载与配置：
- `${HOST_PROJECTS_DIR:-C:/Users/qinyi/IdeaProjects}:/host-projects` — 扫描器读宿主 `.sillyspec` 树
- `${SPEC_DATA_HOST_DIR}:/data/spec-workspaces` bind mount — 宿主 daemon（Windows）与 backend 容器共享同一物理 spec 目录
- `worktree-data`、`claude-data` 命名卷
- `HOST_PATH_PREFIX` / `CONTAINER_PATH_PREFIX` 把宿主风格路径重写为容器挂载路径（见 commit `fcbf3fa7`：backend 生成宿主路径 prompt，daemon 零配置）
- 启动命令：`alembic upgrade head && exec uvicorn app.main:app --host 0.0.0.0 --port 8000`
- 必填 env：`SECRET_KEY`、`SILLYSPEC_MASTER_KEY`；CORS 默认放行 `http://localhost:3001`、`http://127.0.0.1:3001`

> 注：`deploy/` 下**没有** sillyhub-daemon 的 compose 服务 —— daemon 始终在宿主机本地运行（`daemon-start.bat` 等脚本拉起），与 backend 通过本地协议交互。

### 开发 — `deploy/docker-compose.dev.yml`（`name: multi-agent-platform-dev`）
仅起 `postgres:16-alpine` + `redis:7-alpine`，backend / frontend 在宿主以 `uvicorn --reload`、`next dev` 热重载运行。

## 数据模型概览

backend 全部持久化模型继承 `app/models/base.py:BaseModel(SQLModel)`，审计钩子 `app/core/audit_hooks.py` 自动捕获所有 `table=True` 变更写入 `AuditLog`。共约 55 张表，按模块分组：auth(6) / admin(3) / **agent(6，运行时核心：AgentRun / AgentRunLog / AgentSession / AgentMission / AgentRunDependency / AgentArtifacts)** / daemon(3) / workspace(5) / change(2) / task(1) / workflow(2) / **ppm(≈20，最大域)** / release / git_gateway / tool_gateway / 其他（Incident / SpecProfileManifest / ScanDocument / PlatformSetting 等）。

## 关键交互协议

- **Daemon WebSocket Hub**（`backend/app/modules/daemon/ws_hub.py`）：按 `runtime_id` 维护连接注册表，支持广播 `task_available`、逐连接定向发送、去重保护、慢连接驱逐。
- **协议消息**（`backend/app/modules/daemon/protocol.py`）：`DaemonMessage(type)` + 一组 payload（TaskAvailable / Heartbeat+Ack / LeaseClaim+Ack / LeaseComplete / RpcRequest+Result / SessionInject / SessionControl / PermissionRequest+Response）。
- **daemon REST 回调**（`backend/app/modules/daemon/router.py`，约 25 端点）：register / heartbeat / claim / start / lease_heartbeat / submit_lease_messages / complete / sync_status / close_interactive_run / recover_session / confirm_session_reconnected / mark_session_recovery_failed 等。
- **SSE**：`agent/router.py` 的 `stream_agent_run_logs`（`EventSourceResponse`，`text/event-stream`）；session SSE 见 `daemon/tests/test_session_sse.py`。
- **daemon 侧**：`WsClient`（`ws-client.ts`，连 backend Hub，含重连与握手超时）+ `HubClient`（`hub-client.ts`，原生 fetch 调 REST）+ `daemon.ts`（生命周期）+ `RecoveryCoordinator`（session 恢复）。

## 设计文档索引（`docs/`）

`claude-loop-v1-p0.md`、`execution-plan-v2-v5.md`、`change-center-redesign.md`、`spec-alignment.md`、`sillyspec-tool-side-requirements.md`、`agent-sillyspec-stage-execution-analysis.md`、`sillyhub_refs/`（harness-runtime / knowledge-moat / cloud-runner 等设计参考）、`qa/sillyhub-functional-review-2026-05-31.md`。
