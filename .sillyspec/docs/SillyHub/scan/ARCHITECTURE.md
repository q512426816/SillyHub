---
author: qinyi
created_at: 2026-08-18 01:06:26
source_commit: 744e3de4
updated_at: 2026-08-17T17:06:26Z
generator: sillyspec-scan
---

# 架构（Architecture）

> SillyHub（仓库根 path = `.`）平台级架构与三端运行时交互链路。代码分布在 4 个目录：
> `backend/`（FastAPI）、`frontend/`（Next.js）、`sillyhub-daemon/`（Node）、`deploy/`（compose 栈），根 `Makefile` 提供统一编排入口。

## 技术栈

### backend（Python 3.12 / FastAPI，`backend/pyproject.toml`，uv + hatchling）
- Web 框架：`fastapi>=0.115` + `uvicorn`（lifespan 启停钩子在 `backend/app/main.py`）。
- ORM / DB：`sqlmodel>=0.0.22` + `asyncpg`（PostgreSQL 异步驱动）；迁移 `alembic>=1.13`，迁移脚本在 `backend/migrations/versions`（170 个 revision 文件；2026-08-29-change-delete-closure-and-spec-pull 新增单 revision 两列 `20260829130000_add_platform_deleted_and_quicklog_hidden`：`spec_file_manifest.platform_deleted` + `quicklog_entries.hidden`）。
- 缓存 / 实时：`redis>=5.0`（agent run 日志扇出等）。
- 对象存储：`aiobotocore>=3.8,<4`（文件中心，S3 兼容 / MinIO，经 `modules/storage` 抽象：base / factory / minio_backend）。
- 对外 MCP：官方 MCP Python SDK `mcp>=1.29,<2`（FastMCP + ASGI mount，`modules/mcp_gateway`）。
- 认证：`python-jose[cryptography]` + `passlib[bcrypt]` + `pynacl`（JWT + bcrypt + 会话）。
- 其他：`structlog`（结构化日志）、`httpx`、`psutil`。
- 质量：`pytest` + `pytest-asyncio` + `pytest-xdist`、`ruff`、`mypy`。

### frontend（Next.js 14.2.5 / React 18.3.1 / TypeScript 5.5，`frontend/package.json`，pnpm）
- 路由：Next.js app-router（源码在 `frontend/src/app`）；顶层组 `(dashboard)` 下挂 `workspaces`、`admin`、`ppm`、`runtimes`、`sessions`、`settings`、`account`、`agent-profiles`；`(auth)/login` 登录；`m/` 移动端布局。
- UI：`antd@^6.4.4` + `@ant-design/icons`、`tailwindcss@3.4.7`、`lucide-react`、`@radix-ui/*`、`echarts@^6.1`。
- 数据：`@tanstack/react-query@^5.51`、`zustand@^4.5`、`zod`、`dayjs`。
- 测试 / 类型：`vitest@^2` + `@testing-library/react` + `jsdom`、`openapi-typescript@^7.13`（从 backend OpenAPI 生成 `src/lib/api-types.ts`，禁止手写）。

### sillyhub-daemon（Node ≥20 / ESM / TypeScript 5.5.4，`sillyhub-daemon/package.json`）
- 入口：`bin: sillyhub-daemon → ./dist/cli.js`（`src/cli.ts`，commander；子命令 start/stop/status/logs）。
- Agent 执行：`@anthropic-ai/claude-agent-sdk@0.3.181`（spawn 本地 Claude Code agent 跑 SillySpec 流程）。
- 工具协议：`@modelcontextprotocol/sdk@^1.29`（daemon 内置 stdio MCP server `src/mcp-server.ts`，5 个 tool 经 hub-client 调 backend `agent/mcp_tools.py` 的 5 个 endpoint：派 worker / 读产出 / 列 worker / 收敛 / 报进度）。
- 通信：`ws@^8.18`（daemon 主动拨号 backend `/ws`）、`zod@^4`、`js-yaml`。
- 打包 / 类型：`@vercel/ncc`（单文件分发）、`openapi-typescript`（生成 `src/api-types.ts`）、`vitest`。

### 基础设施（`deploy/docker-compose.yml`，7 服务）
- `postgres:16-alpine`（PG 主库）、`redis:7-alpine`、`minio/minio`（对象存储 9000/9001）、`litellm`（`ghcr.io/berriai/litellm:v1.95.0` LLM 网关 + 专属 `litellm-db` PG）、`backend`、`frontend`。
- 卷：`pgdata` / `redisdata` / `litellm-db-data` / `minio-data` / `worktree-data`（`/data/sillyspec-workspaces`）/ `claude-data`；bind mount `${HOST_PROJECTS_DIR:-C:/Users/qinyi/IdeaProjects}:/host-projects`（扫描宿主项目），spec-workspaces bind mount 让宿主 daemon 与 backend 容器共享 spec 文档。

### 编排（根 `Makefile`）
- dev 组：`dev-up/dev-down/dev-logs/dev-reset`（`deploy/docker-compose.dev.yml` 起 PG+Redis）。
- backend 组：`backend-install`（uv sync --all-extras）/ `backend-run`（uvicorn --reload :8000）/ `backend-test`（pytest --cov）/ `backend-lint`（ruff + mypy）/ `backend-format` / `backend-migrate`。
- frontend 组：`frontend-install/run/test/lint/typecheck/build`。
- 聚合：`test`、`lint`、`up/down/logs`（生产 compose `deploy/docker-compose.yml`）。

## 架构概览

### 平台拓扑
```
浏览器 ──HTTP(/api/*)+SSE──> Next.js 前端(:3000) ──REST/SSE 中继──> backend FastAPI(:8000)
                              │  app/api/* Route Handlers            │        │
                              │  (daemon/sessions、daemon-chat、      │        │
                              │   agent/runs 三条 stream 中继)        │        │
                              │                            PostgreSQL │     Redis
                              │                            (alembic)  │   (缓存/pub-sub)
                              │                                      │
                              │                                 MinIO(S3 兼容, 文件中心)
                              │                                      │
                              │                                 LiteLLM 网关(v1.95.0)
                              │                                   (LLM 统一出口)
                              │                                      │
  sillyhub-daemon(Node) ──WebSocket 拨号 /ws──────────────────────────┤
       │  hub-client.ts HTTP 调 REST（Bearer / X-API-Key）
       │  spawn Claude Agent SDK ──> Claude Code agent 执行 SillySpec 流程
       │  内置 stdio MCP server（5 tool）──> backend mcp_tools 5 endpoint
       │  读写宿主文件系统 / .sillyspec 文档 / skills
       │
  SillySpec CLI（agent 进程内）──platform_sync 端点(/api/platform-sync/*)──> backend
       │  shpsync_ workspace token 鉴权，回传 progress/documents/approval/quicklog，
       │  spec 文件推拉（增量 ops / 整树 bundle 快照，2026-08-29 起 CLI 侧 `pull --spec`）
```
- backend 是唯一持久化与鉴权中心；daemon 是执行边缘节点（无独立 HTTP 服务），主动连 backend `/ws`（`modules/daemon/router.py:2552`），WS 双向消息 + lease 轮询领取任务。
- LLM 调用经 LiteLLM 网关统一出口：backend `llm_provider` 模块持 `litellm_client.py`；daemon 侧经 backend `/api/llm-proxy/{path}` 透传端点（`modules/daemon/router.py:2307`，master key 不出 backend 进程）。
- SillySpec CLI 在 agent 进程内运行，进度经 `platform_sync` 模块回传（详见"关键横切"）。

### backend 分层（`backend/app/`）
- `core/`：基础设施——`db`（引擎/会话）、`redis`、`config`、`logging`（structlog）、`errors`、`auth_deps`、`audit_hooks`、`security`、`crypto`、`ssrf`、`permission_cache`、`monitoring`、`telemetry`、`paths` / `spec_paths`。
- `models/`：共享模型基座（`base.py`）。
- `modules/`：按业务域拆分，29 个域，每个典型含 `router.py + service.py + model.py + schema.py + tests/`：
  - 认证/组织：`auth`、`admin`、`settings`
  - 工作空间：`workspace`（members / member_runtimes）、`runtime`
  - 变更流/文档：`change`、`change_writer`、`task`、`scan_docs`、`spec_workspace`、`spec_profile`、`knowledge`、`skills`
  - Agent 编排：`agent`（含 `profile/` AgentProfile 配置层、`placement.py` RunPlacement 派发、`mcp_tools.py`）、`workflow`、`worktree`
  - Daemon：`daemon`（含 dist 分发、lease、llm-proxy 透传）
  - 网关：`git_gateway`、`git_identity`、`tool_gateway`（+policy）、`mcp_gateway`（McpToken + SSE）、`llm_provider`（+LiteLLM client）、`file`、`storage`
  - 跨仓同步：`platform_sync`（CLI ↔ 平台进度/文档/审批/quicklog 同步）
  - DevOps：`incident`、`release`
  - PPM 子域：`ppm/`（project / plan / task / problem / kanban / workbench，统一前缀 `/api/ppm`）
  - `health`
- main.py 内联注册快捷聊天：`/api/daemon-chat`（POST 创建 → RunPlacementService 派发 daemon；`GET /{id}/stream` SSE、kill、logs）。

### DB Schema 概况（PostgreSQL，约 94 张表，`__tablename__` 计数）
按域分组（列代表性表名 + 用途，不列字段明细）：
- 认证 / 组织：`users`、`sessions`、`roles`、`api_keys`、`workspaces`、`user_workspace_roles` 等。
- 变更流 / 文档：`changes`、`change_documents`、`change_reviews`、`tasks`、`scan_documents`、`spec_workspaces`、`spec_conflicts`、`spec_file_manifest`（spec 文件增量清单；2026-08-29-change-delete-closure-and-spec-pull 加 `platform_deleted` 平台删除墓碑列，拦截四条复活通道）等。
- Agent 编排：`agent_runs`、`agent_run_logs`、`agent_sessions`、`agent_missions`、`agent_profiles`（AgentProfile 配置层）、`agent_artifacts` 等。
- Daemon 运行时：`daemon_instances`、`daemon_task_leases`、`daemon_change_writes`、`daemon_borrow_audit` 等。
- 跨仓同步（platform_sync）：`platform_change_progress`（CLI 进度回传落库；`last_pushed_at` 列自 2026-08-29 起投影进 ChangeSummary）、`platform_sync_tokens`（shpsync_ workspace 级 token）、`quicklog_entries`（quick 条目推送；2026-08-29 加 `hidden` 软隐藏列——apply 期对账镜像文件中缺失的 pushed 行，读端 merge_entries 过滤）。
- MCP 网关：`mcp_tokens`（McpToken 签发/吊销）、`mcp_webhooks`。
- 网关 / 审计：`git_identities`、`git_operation_logs`、`tool_policies`、`audit_logs` 等。
- DevOps：`releases`、`release_approvals`、`incidents`、`postmortems`。
- 文件中心：`file`（平台级，元数据指向 MinIO 对象）。
- PPM 子域（约 20 张）：`ppm_plan_task`、`ppm_task_execute`、`ppm_problem_list`、`ppm_kanban_*`、`ppm_*_process_*` 等。

### 前端页面域（`frontend/src/app`）
- `(auth)/login`：登录。
- `(dashboard)/`：顶层布局组——`workspaces`（工作空间列表）、`admin`（users / roles / organizations）、`ppm`（项目管理）、`runtimes`、`sessions`（跨工作空间会话）、`settings`、`account`、`agent-profiles`（全局 AgentProfile）。
- `(dashboard)/workspaces/[id]/`（工作空间内，17 个子域）：`agent`、`agent-profiles`、`approvals`（审批）、`audit`（审计）、`changes`（变更中心）、`files`（文件中心）、`incidents`、`knowledge`、`mcp`、`mcp-tokens`、`members`、`missions`、`releases`、`runtime`、`scan-docs`、`sessions`（会话/快捷聊天）、`skills`。
- `m/`：移动端布局（account / login / ppm / workspaces）。
- `api/`：Next.js Route Handlers，纯 SSE stream 中继（daemon/sessions/[id]/stream、daemon-chat/[runId]/stream、workspaces/[id]/agent/runs/[runId]/stream）。

### sillyhub-daemon 核心模块（`sillyhub-daemon/src/`）
- 入口/生命周期：`cli.ts`（commander）、`daemon.ts`（主循环+心跳）、`ws-client.ts`（daemon→backend WebSocket，http↔ws 自动转换）。
- 任务执行：`task-runner.ts`（领取并执行 lease 任务）、`interactive/`（交互式会话 driver）、`terminal-launcher.ts` / `terminal-observer.ts`、`agent-detector.ts`、`runtime-lock.ts`、`spawn-env.ts`、`preflight.ts`。
- 工具 / RPC：`mcp-server.ts` + `mcp-config.ts`（内置 stdio MCP server + 注入配置）、`host-fs-handler.ts`、`roots-rpc.ts`、`file-rpc.ts`（宿主文件系统读写）、`spec-sync.ts`（.sillyspec 文档回写同步）、`skill-manager.ts`、`permission-rules.ts`、`tool-kind.ts`。
- 凭证：`credential.ts` + `credential-injector.ts`（向 agent 进程注入 API key，含 CLAUDE_CONFIG_DIR 隔离）、`local-yaml-writer.ts`（写 .sillyspec/local.yaml）。
- 适配/韧性：`adapters/`、`resilience/`、`policy/`、`model-error/`。
- 协议：`protocol.ts`（WS 消息信封）、`hub-client.ts`（HTTP 调 backend REST）、`api-types.ts`（OpenAPI 生成）。

### 关键横切
- **鉴权四轨**：JWT 会话（浏览器）、`X-API-Key`（daemon 长期 key，`auth_deps` 双路径鉴权）、`shpsync_` 前缀 token（platform_sync workspace 级同步 token，写通道仅接受它，读端点兼容 JWT/API key）、McpToken（mcp_gateway 签发，dispatch scope）。
- **实时通道**：WS（daemon ↔ backend `/ws`，`daemon/router.py:2552`）+ SSE 三路（`/api/daemon-chat/{id}/stream` 快捷聊天流、`mcp_gateway/sse.py` EventSource 帧 worker 事件流、Next.js `app/api/*` stream 中继）。WS `--ws-max-size 100MB` 以容纳 spec bundle RPC。
- **文件中心**：`modules/file`（元数据+权限）+ `modules/storage`（base/factory/minio_backend 抽象）→ MinIO 对象存储。
- **进度投影**：SillySpec CLI 经 `platform_sync` 10 个端点回传（`POST /changes/{name}/progress`、`GET /changes/-/spec-manifest`、`POST /changes/-/spec-sync` 增量同步、`GET /changes/-/spec-bundle` 整树快照 tar 拉取（2026-08-29 新增，shpsync token，响应头 `X-Spec-Version` + tar 顶层 `PLATFORM-BUNDLE.json` 快照元数据）、`POST /changes/{name}/documents`、`POST /changes/{name}/approval`、`POST /quicklog-entries` 等），落 `platform_change_progress` / `quicklog_entries`，变更中心读时投影覆盖 CLI 镜像。
- **变更删除闭环**（2026-08-29-change-delete-closure-and-spec-pull）：① 平台删除入口 `DELETE /workspaces/{ws}/changes/{cid}`（权限 CHANGE_ARCHIVE 或 change owner）→ `soft_delete_change_dir` 镜像软删（30 天备份区 + manifest `platform_deleted` 墓碑）→ progress 删 → `location='deleted'` 软删 + `change_events` delete 审计；② 本地裸删自动收敛：apply_ops 空目录清理 + scoped 定向删除（R-08 收窄修订：scope∩磁盘确认消失可删，scope 外零动作）+ 删除环顺手清 progress 行；③ 防复活四通道拦截：`platform_deleted` 墓碑上 add/rename 拒（conflict + `platform_deleted` 列表回告，delete 幂等放行）、`_write_spec_root` 落盘集计算阶段前缀排除、`_ensure_change_row` 双层拒收（行 location='deleted' 为主 + manifest 前缀兜底锚点，409 code=change_deleted）、删除环（scoped/全量）与 `_apply_parsed` 对 deleted 行三点豁免；④ CLI 删除/归档上行 `status='deleted'` 墓碑（progress POST 写路径处理）为收敛加速器，平台闭环不依赖。
- **进行中可见性**（2026-08-29 波 4，纯 CLI 模式）：`ChangeSummary.last_pushed_at`（progress 行既有列投影，ISO 原文透传零服务端解析）驱动前端活动徽标三态（进行中/停滞/空闲，`ACTIVITY_STALE_MS=30min` 阈值与 `ISO_LIKE_RE` 防御解析均为前端展示层关注点）；sillyspec CLI 步骤开始（X3）/execute 任务边界（X4）补推 progress 刷新最后信号（渐进增强，旧 CLI 行为不变；心跳 Layer 3 为 Non-Goal 协议预留）。
- **LLM 出口收敛**：全部 LLM 调用经 LiteLLM 网关；daemon 侧无直连密钥，经 backend `/api/llm-proxy/{path}` 透传（master key 不出进程）。

### 三端契约同步
- 单一真相：backend 的 OpenAPI（`/api/openapi.json`）。
- 生成器：`scripts/gen-api-types.mjs`（frontend 与 daemon 各一份），分别产出 `frontend/src/lib/api-types.ts` 与 `sillyhub-daemon/src/api-types.ts`；CI 用 `gen:types:check` 卡类型漂移。

### 跨平台
- 三端均要求兼容 Windows / Linux / macOS（CLAUDE.md 规则）；Makefile 目标在 Windows 经 Git Bash 可跑；daemon 在 Windows 走宿主进程，spec 文档经 compose bind mount 与 backend 容器共享。
