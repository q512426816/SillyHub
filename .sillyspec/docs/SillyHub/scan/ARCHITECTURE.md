---
author: qinyi
created_at: 2026-07-27 00:35:31
source_commit: 6e78b29a
updated_at: 2026-07-26T16:35:31Z
generator: sillyspec-scan
---

# 架构(Architecture)

> SillyHub（仓库根 path = `.`）整体架构与三端运行时交互链路。代码分布在 4 个目录：
> `backend/`（FastAPI）、`frontend/`（Next.js）、`sillyhub-daemon/`（Node）、`deploy/`（compose 栈）。

## 技术栈

### backend（Python 3.12 / FastAPI，`backend/pyproject.toml`）
- Web 框架：`fastapi>=0.115` + `uvicorn[standard]`（lifespan 启停钩子在 `backend/app/main.py`）。
- ORM / DB：`sqlmodel>=0.0.22` + `sqlalchemy[asyncio]>=2.0` + `asyncpg`（PostgreSQL 异步驱动）；迁移 `alembic>=1.13`，迁移脚本在 `backend/migrations/versions`（117 个 revision 文件，含多个 merge head）。
- 缓存 / 实时：`redis>=5.0`（agent run 日志走 Redis pub/sub 扇出）。
- 对象存储：`aiobotocore>=3.8,<4`（平台文件中心，S3 兼容 / MinIO）。
- 认证：`python-jose[cryptography]` + `passlib[bcrypt]` + `pynacl`（JWT + bcrypt + 会话）。
- 其他：`structlog`（结构化日志）、`httpx`、`python-frontmatter`、`openpyxl`+`Pillow`（Excel/图像导入）、`psutil`。
- 质量：`pytest` + `pytest-asyncio` + `pytest-xdist`、`ruff`、`mypy`（py312，非 strict）。

### frontend（Next.js 14.2.5 / React 18.3 / TypeScript 5.5，`frontend/package.json`）
- 路由：Next.js app-router（源码在 `frontend/src/app`，非 `frontend/app`）；顶层组 `(dashboard)` 下挂 `workspaces/[id]`、`admin`、`ppm`、`runtimes`、`settings`。
- UI：`antd@^6.4.4` + `@ant-design/icons` + `@ant-design/nextjs-registry`、`tailwindcss` + `tailwind-merge` + `class-variance-authority`、`lucide-react`、`@radix-ui/*`、`@xyflow/react`（拓扑图）、`echarts` + `echarts-for-react`（图表）。
- 数据：`@tanstack/react-query@^5.51`、`zustand@^4.5`、`zod`、`dayjs`、`@uiw/react-markdown-preview`。
- 测试 / 类型：`vitest` + `@testing-library/react` + `jsdom`、`puppeteer` + `@playwright/test`、`openapi-typescript`（从 backend OpenAPI 生成 `src/lib/api-types.ts`）。

### sillyhub-daemon（Node ≥20 / ESM / TypeScript，`sillyhub-daemon/package.json`）
- 入口：`bin: sillyhub-daemon → ./dist/cli.js`（`src/cli.ts`，commander；子命令 `start/stop/status/logs`）。
- Agent 执行：`@anthropic-ai/claude-agent-sdk@0.3.181`（spawn 本地 Claude Code agent）。
- 工具协议：`@modelcontextprotocol/sdk@^1.29`（daemon 内置 MCP server，注入 host 文件 / spec / skill 等工具）。
- 通信：`ws@^8.18`（daemon 主动拨号 backend 的 WebSocket）、`commander`、`zod@^4`、`js-yaml`。
- 打包 / 类型：`@vercel/ncc`（产 `build/bundle/sillyhub-daemon.js` 单文件分发）、`openapi-typescript`（生成 `src/api-types.ts`）、`vitest`。

### 基础设施（`deploy/docker-compose.yml`，5 服务）
- `postgres:16-alpine`（PG 主库）、`redis:7-alpine`（缓存 + pub/sub）、`minio/minio`（对象存储，9000/9001）、`backend`（本地 build / 服务器 load 同镜像名 `multi-agent-platform-backend:latest`，启动跑 `alembic upgrade head` 再 `uvicorn`，`--ws-max-size 100MB` 以容纳 spec bundle RPC）、`frontend`（`multi-agent-platform-frontend:latest`）。
- 卷：`/host-projects`（扫描宿主 `.sillyspec` 树）、`/data/spec-workspaces`（宿主 daemon 与 backend 容器共享 spec 文档的 bind mount）。

## 架构概览

### 三端拓扑
```
浏览器 ──HTTP/REST(/api/*)+SSE(quick-chat 流)──> backend(FastAPI)
                                                      │  │
                                          PostgreSQL  │  │ Redis pub/sub(运行日志扇出)
                                                      │  │
                  sillyhub-daemon(Node) ──WebSocket──>│  │
                       │  daemon 拨号 /ws              │  │
                       │  (backend/app/modules/daemon/router.py:1958)
                  spawn Claude Agent SDK + 内置 MCP server
                  读写宿主文件系统 / spec 文档 / skills
```
- backend 是唯一持久化与鉴权中心；daemon 是执行边缘节点，主动连 backend 的 `/ws`（无独立 HTTP 服务），通过 WS 双向消息 + lease 轮询领取任务。
- daemon 分发：`backend/app/modules/daemon/dist_router` 暴露公共 `install.sh` 端点（curl … | bash 安装），backend 镜像 build 时 `additional_contexts` 注入 daemon 的 `build/bundle/`。

### backend 分层（`backend/app/`）
- `core/`：基础设施（`db` 引擎/会话、`redis`、`config`/settings、`logging`/structlog、`telemetry`/OTEL、`errors` 全局异常、`auth_deps`、`audit_hooks`）。
- `modules/`：按业务域拆分（~27 个），每个模块典型含 `router.py` + `service.py` + `model.py` + `schema.py` + `tests/`。main.py 注册的 router 包括：auth、admin、workspace（+ members、member_runtimes）、change、change_writer、scan_docs、task、git_identity、git_gateway、agent、daemon（+ dist）、runtime、worktree、workflow、incident、knowledge、release、tool_gateway（+ policy）、settings、spec_workspace、llm_provider、file、skills、health，以及 `ppm/` 子域（project / plan / task / problem / kanban / workbench，统一前缀 `/api/ppm`）。
- 快捷聊天：main.py 内联注册 `/api/daemon-chat*`（POST 创建 agent_run → RunPlacementService.dispatch_to_daemon；GET/SSE/kill/logs）。

### DB Schema 概况（PostgreSQL，~70 张表）
按域分组（仅列代表性表名 + 说明，不列字段）：
- 认证 / 组织：`users`、`sessions`、`roles`、`role_permissions`、`api_keys`、`user_workspace_roles`、`organizations`、`user_organizations`、`user_roles`。
- 工作空间 / 协作：`workspaces`、`workspace_member_runtimes`、`task_workspaces`、`agent_run_workspaces`。
- 变更流 / 文档：`changes`、`change_documents`、`change_reviews`、`tasks`、`scan_documents`、`scan_doc_conflict_history`、`spec_workspaces`、`spec_profile_manifests`、`spec_conflicts`。
- Agent 编排：`agent_runs`、`agent_run_logs`、`agent_sessions`、`agent_missions`、`agent_run_dependencies`、`agent_artifacts`、`daemon_borrow_audit`。
- Daemon 运行时：`daemon_instances`、`daemon_runtimes`、`daemon_task_leases`、`daemon_change_writes`、`session_dialog_requests`、`policy_audit_log`。
- 网关 / 审计：`git_identities`、`git_operation_logs`、`tool_operation_logs`、`tool_policies`、`audit_logs`。
- DevOps：`releases`、`release_approvals`、`incidents`、`postmortems`、`worktree_leases`、`custom_skills`、`llm_providers`、`platform_settings`。
- PPM 子域（项目计划管理，~20 张）：`ppm_plan_task`、`ppm_task_execute`、`ppm_work_hour`、`ppm_project_maintenance`、`ppm_customer_maintenance`、`ppm_project_member`、`ppm_project_stakeholder`、`ppm_problem_list`、`ppm_problem_change`、`ppm_*_process_task`、`ppm_*_process_log`、`ppm_kanban_comment`、`ppm_kanban_subtask`、`ppm_plan_node(_detail/_module)`、`ppm_ps_project_plan`、`ppm_ps_plan_node_*` 等。
- 文件中心：`file`（平台级，元数据指向 MinIO 对象）。

### sillyhub-daemon 核心模块（`sillyhub-daemon/src/`）
- `cli.ts`（commander 入口，`start` 拉起 `daemon.ts` 主循环）、`daemon.ts`（生命周期 + 心跳）、`ws-client.ts`（daemon→backend WebSocket，http↔ws / https↔wss 自动转换）。
- `task-runner.ts`（领取并执行 lease 任务）、`interactive/`（交互式会话 driver）、`agent-detector.ts`、`runtime-lock.ts`、`spawn-env.ts`、`preflight.ts`。
- 工具 / RPC：`mcp-server.ts` + `mcp-config.ts`（内置 MCP server + 注入配置）、`host-fs-handler.ts`、`roots-rpc.ts`、`file-rpc.ts`（宿主文件系统读写）、`spec-sync.ts`（.sillyspec 文档回写同步）、`skill-manager.ts`、`permission-rules.ts`、`tool-kind.ts`。
- 凭证：`credential.ts` + `credential-injector.ts`（向 agent 进程注入 API key 等，含 `CLAUDE_CONFIG_DIR` 隔离）。
- 协议：`protocol.ts`（与 backend 的 WS 消息信封）、`hub-client.ts`（HTTP 调 backend REST）、`api-types.ts`（OpenAPI 生成）。

### 三端契约同步
- 单一真相：backend 的 OpenAPI（`/api/openapi.json`）。
- 生成器：`scripts/gen-api-types.mjs`（frontend 与 daemon 各有一份），分别产出 `frontend/src/lib/api-types.ts` 与 `sillyhub-daemon/src/api-types.ts`；CI 用 `gen:types:check`（生成后 `git diff --exit-code`）卡类型漂移。

### 跨平台
- 三端均要求兼容 Windows / Linux / macOS（CLAUDE.md 规则 13）；daemon 在 Windows 走宿主进程，spec 文档经 `deploy/docker-compose.yml` 的 bind mount `/data/spec-workspaces` 与 backend 容器共享。
