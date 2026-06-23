---
source_commit: fcbf3fa7
updated_at: 2026-06-23T00:00:00Z
generator: sillyspec-scan
author: qinyi
created_at: 2026-06-23 01:56:21
---

# ARCHITECTURE.md — multi-agent-platform (monorepo 根)

本文档描述 `multi-agent-platform` monorepo 的整体架构。根目录无应用源码，实际代码分布在 3 个子项目 + 1 个部署目录：

| 子项目 | 路径 | 角色 |
| --- | --- | --- |
| backend | `backend/` | FastAPI REST/SSE/WebSocket API、任务调度、数据持久化 |
| frontend | `frontend/` | Next.js 14 浏览器端 SPA |
| sillyhub-daemon | `sillyhub-daemon/` | 本地守护进程，拉起并管理 Claude 进程（Claude Agent SDK） |
| deploy | `deploy/` | Docker Compose 编排（生产全栈 / 开发仅 db+redis） |

## 架构概览

三层交互链路：

```
┌─────────────┐   HTTP REST + SSE   ┌──────────────────┐   WebSocket + HTTP   ┌──────────────────┐
│  frontend   │ ───────────────────▶│     backend      │◀────────────────────▶│  sillyhub-daemon │
│ (浏览器)    │ ◀─── SSE 日志流 ────│  (FastAPI)       │   (本地守护进程)     │  (Claude Agent)  │
│ Next.js 14  │                     │  :8000           │                      │  :动态端口        │
└─────────────┘                     └────────┬─────────┘                      └────────┬─────────┘
       │                                      │                                        │
       │ TanStack Query /                     │ PostgreSQL (持久)                       │ spawn
       │ EventSource(SSE)                     │ Redis (缓存/锁)                         ▼
       │ fetch                                └────────────────                          Claude Code CLI
                                                                                  (@anthropic-ai/
                                                                                   claude-agent-sdk)
```

核心数据流向：

1. **frontend → backend**：浏览器通过 TanStack Query 发 REST 请求（任务创建、租约查询、PPM 等），通过 `EventSource` 订阅 SSE 实时日志。
2. **backend → sillyhub-daemon**：backend 通过 WebSocket Hub（`backend/app/modules/daemon/ws_hub.py` 的 `DaemonWsHub`）按 `runtime_id` 推送 `task_available` 等事件给已注册的 daemon；daemon 反向通过原生 `fetch`（`sillyhub-daemon/src/hub-client.ts` 的 `HubClient`，无 HTTP 库依赖，对齐 Python httpx `trust_env=False` 语义）回调 backend REST 端点（注册、心跳、claim/start/complete lease、提交消息、session 恢复）。
3. **sillyhub-daemon → Claude**：daemon 用 Claude Agent SDK（`@anthropic-ai/claude-agent-sdk@0.3.181`）spawn Claude 进程执行实际任务，把产出/日志通过 `submit_lease_messages` 回传 backend。
4. **backend → frontend（实时）**：backend 把 daemon 回传的日志落库（`AgentRunLog`）后，通过 SSE 端点 `/workspaces/{id}/agent/runs/{run_id}/stream`（`agent/router.py` 的 `stream_agent_run_logs`）推给浏览器。

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
- Next.js 14.2.5 + React 18.3.1 + TypeScript 5.5.4（App Router）
- 状态/数据：TanStack Query 5.51、Zustand 4.5、Zod 3.23
- UI：Ant Design 6.4、Tailwind 3.4 + tailwindcss-animate、Radix UI primitives、lucide-react、@xyflow/react（流程图）、ECharts 6
- Markdown：@uiw/react-markdown-preview
- 测试：Vitest 2 + Testing Library + jsdom；E2E：Playwright 1.60 + Puppeteer
- 包管理：pnpm 9.6.0（Node ≥20）

### sillyhub-daemon (`sillyhub-daemon/package.json`)
- Node ≥20，TypeScript 5.5.4，ESM（`"type": "module"`）
- Claude Agent SDK `@anthropic-ai/claude-agent-sdk@0.3.181`（跨平台 pnpm overrides 映射）
- `ws@^8.18`（WebSocket 客户端，连 backend Hub）
- `commander@^12`（CLI 参数）
- HTTP 通信用 Node 20 原生 `fetch`（零 HTTP 库依赖，设计 G-05）
- 测试：Vitest 2

## 部署拓扑（`deploy/`）

### 生产 / 全栈 — `deploy/docker-compose.yml`（`name: multi-agent-platform`）
四服务编排，统一 `.env` 注入：

| 服务 | 镜像/构建 | 端口 | 依赖 |
| --- | --- | --- | --- |
| `postgres` | postgres:16-alpine | `${POSTGRES_PORT:-5432}:5432` | healthcheck pg_isready |
| `redis` | redis:7-alpine（appendonly AOF） | —（内部） | healthcheck redis-cli ping |
| `backend` | 构建 `../backend/Dockerfile`（build-args 注入 `CLAUDE_CODE_VERSION=2.1.158`、`SILLYSPEC_VERSION=3.18.6`） | `${BACKEND_PORT:-8000}:8000` | postgres/redis healthy |
| `frontend` | 构建 `../frontend/Dockerfile`（SSR，`INTERNAL_API_BASE_URL=http://backend:8000`） | `${FRONTEND_PORT:-3000}:3000` | backend |

backend 关键挂载与配置：
- `${HOST_PROJECTS_DIR:-C:/Users/qinyi/IdeaProjects}:/host-projects` — 让扫描器读宿主 `.sillyspec` 树
- `${SPEC_DATA_HOST_DIR}:/data/spec-workspaces` bind mount — 宿主 daemon（Windows）与 backend 容器共享同一物理 spec 目录
- `worktree-data`、`claude-data` 命名卷
- `HOST_PATH_PREFIX` / `CONTAINER_PATH_PREFIX` 把宿主风格路径重写为容器挂载路径（见 commit `fcbf3fa7`）
- 启动命令：`alembic upgrade head && exec uvicorn app.main:app --host 0.0.0.0 --port 8000`
- 必填 env：`SECRET_KEY`、`SILLYSPEC_MASTER_KEY`
- CORS 默认放行 `http://localhost:3001`、`http://127.0.0.1:3001`

#### spec 文档 transport 双模式（`SPEC_TRANSPORT`）

scan / propose / plan / execute 等 spec 写盘 stage 生成的 spec 文档在 daemon 与 backend 间的同步路径由全局环境变量 `SPEC_TRANSPORT` 决定（D-001: 正交于 `SpecWorkspace.strategy`；D-002: 不入库，走 backend `Settings.spec_transport`）：

- **`shared`（默认，同机拓扑）**：依赖本段上方描述的 bind mount（`${SPEC_DATA_HOST_DIR}:/data/spec-workspaces`，见行 88）。daemon 把 spec 写到宿主路径 `spec_data_host_dir/{ws}`，backend 经 bind mount 看到同一物理目录 reparse 入库。无 pull / 无回传，零额外机制。向后兼容现有同机部署（D-004），未配置 `SPEC_TRANSPORT` 时行为不变（SC-1）。

- **`tar`（异机拓扑，daemon 与 backend 两台独立设备无共享盘）**：bind mount 失效，走整树 tar 回传（D-003 双向同步），六步机制严格对照 design §5.2：
  1. lease interactive claim：backend `build_claim_payload` 不透传 `spec_root`，透传 `workspace_id` + transport。
  2. daemon `_startInteractiveSession`：session 创建后 `pullSpecBundle` 拉 backend spec bundle 解到本地 `~/.sillyhub/daemon/specs/{ws}`（缓存，首次 404 容错为空目录）。
  3. prompt `--spec-root` 用 daemon 本地路径；agent 跑 scan/stage 文档写本地缓存。
  4. daemon `onSessionEnd`：session 终态回调 `postSpecSync` 打 tar 整树回传 backend。
  5. backend `apply_sync`：解 tar 到权威源容器 `/data/{ws}` + reparse 入库。
  6. daemon 本地缓存保留（D-003），下次 lease 覆盖。

  batch task-runner 流程（stage 写盘场景）在步骤 1.5（claim 后 pull）/ 8.5（complete 前 sync）插入对等的 pull/postSpecSync 调用，与 interactive 共用同一套 tar 回传机制（D-008）。

backend 是唯一真理源（G2）：shared 靠 bind mount 天然一致，tar 靠 `apply_sync` 整树覆盖（whole-tree overwrite）保证 `/data/{ws}` 为权威副本。

**已知约束**：全局单一 transport，同一 backend 不能同时服务同机 + 异机 daemon（R-04 / N1；未来需升级为 per-daemon transport 才能混部）。

### 开发 — `deploy/docker-compose.dev.yml`（`name: multi-agent-platform-dev`）
仅起 `postgres:16-alpine` + `redis:7-alpine`，backend / frontend 在宿主以 `uvicorn --reload`、`next dev` 运行，保证迭代速度。

## 数据模型概览（SQLModel `table=True`，统计自 `grep backend/app`）

backend 全部持久化模型继承 `app/models/base.py:BaseModel(SQLModel)`，审计钩子 `app/core/audit_hooks.py` 自动捕获所有 `table=True` 变更写入 `AuditLog`。共约 55 张表，按模块分组（只记表名 + 说明 + 字段规模）：

- **auth**（6 表）：`User` / `Session` / `Role` / `RolePermission` / `ApiKey` / `UserWorkspaceRole`
- **admin**（3 表）：`Organization` / `UserOrganization` / `UserRole`
- **agent**（6 表，运行时核心）：`AgentRun`（最大表，含状态/恢复字段）/ `AgentRunLog` / `AgentSession` / `AgentMission` / `AgentRunDependency` / `AgentArtifacts`
- **daemon**（3 表）：`DaemonRuntime`（守护进程注册表）/ `SessionDialogRequest` / `DaemonTaskLease`（任务租约）
- **workspace**（5 表）：`Workspace` / `WorkspaceRelation` / `ChangeWorkspace` / `TaskWorkspace` / `AgentRunWorkspace`
- **change**（2 表）：`Change` / `ChangeDocument`
- **task**（1 表）：`Task`
- **workflow**（2 表）：`ChangeReview` / `AuditLog`（审计落点）
- **ppm**（≈20 表，最大域）：`PlanTask`/`TaskExecute`/`WorkHour`、`PpmProjectMaintenance`/`PpmCustomerMaintenance`/`PpmProjectMember`/`PpmProjectStakeholder`、`PpmProblemList`/`PpmProblemChange`/`...ProcessTask`/`...ProcessLog`、`PlanNode`/`PlanNodeDetail`/`PlanNodeModule`/`PsProjectPlan`/`PsPlanNode`/`PsPlanNodeDetail`/`PsPlanNodeDetailProcess`、`PpmKanbanComment`/`PpmKanbanSubtask`
- **release / git_gateway / tool_gateway**：`Release` / `ReleaseApproval`、`GitOperationLog`、`ToolPolicy` / `ToolOperationLog`
- **其他**：`Incident` / `Postmortem`、`SpecProfileManifest` / `SpecConflict`、`ScanDocument`、`PlatformSetting`、`SpecWorkspace`、`WorktreeLease`、`GitIdentity`

## 关键交互协议

- **Daemon WebSocket Hub**（`backend/app/modules/daemon/ws_hub.py`）：按 `runtime_id` 维护连接注册表，支持广播 `task_available`、逐连接定向发送、去重保护、慢连接驱逐（send timeout）。
- **协议消息**（`backend/app/modules/daemon/protocol.py`）：`DaemonMessage(type)` + 一组 payload — `TaskAvailablePayload` / `HeartbeatPayload`(+Ack) / `LeaseClaimPayload`(+Ack) / `LeaseCompletePayload` / `RpcRequestPayload`(+Result) / `SessionInjectPayload` / `SessionControlPayload` / `PermissionRequestPayload`(+Response)。
- **daemon REST 回调**（`backend/app/modules/daemon/router.py`，约 25 个端点）：`register_daemon` / `daemon_heartbeat` / `claim_lease` / `start_lease` / `lease_heartbeat` / `submit_lease_messages` / `complete_lease` / `sync_lease_status` / `close_interactive_run` / `recover_session` / `confirm_session_reconnected` / `mark_session_recovery_failed` 等。
- **SSE**：`agent/router.py` 的 `stream_agent_run_logs`（`EventSourceResponse`，`text/event-stream`）；session SSE 见 `daemon/tests/test_session_sse.py`。
- **daemon 侧**：`WsClient`（`ws-client.ts`，连 backend Hub，含重连与握手超时）+ `HubClient`（`hub-client.ts`，原生 fetch 调 REST）+ `daemon.ts`（生命周期）+ `RecoveryCoordinator`（session 恢复，commit `fcbf3fa7` 前序修复）。

## 设计文档索引（`docs/`）
`claude-loop-v1-p0.md`、`execution-plan-v2-v5.md`、`change-center-redesign.md`、`spec-alignment.md`、`sillyspec-tool-side-requirements.md`、`agent-sillyspec-stage-execution-analysis.md`、`sillyhub_refs/`（harness-runtime / knowledge-moat / cloud-runner 等设计参考）、`qa/sillyhub-functional-review-2026-05-31.md`。
