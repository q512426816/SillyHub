---
author: qinyi
created_at: 2026-08-18 01:06:26
source_commit: 744e3de4
updated_at: 2026-08-17T17:06:26Z
generator: sillyspec-scan
---

# 集成（Integrations）

按类型分组列出 SillyHub 对外部依赖、服务、SDK 的集成。来源：`backend/pyproject.toml`、`frontend/package.json`、`sillyhub-daemon/package.json`、`deploy/docker-compose.yml` 及源码核实（基于 744e3de4 全量重扫）。

## 1. 数据存储 / 缓存 / 对象存储

| 集成 | 用途 | 客户端 / 镜像 | 依据 |
|---|---|---|---|
| PostgreSQL 16 | 主关系库（用户/工作区/变更/任务/PPM/审计等全量业务） | asyncpg>=0.29 + SQLAlchemy[asyncio] + SQLModel>=0.0.22；镜像 `postgres:16-alpine` | backend/pyproject.toml；deploy/docker-compose.yml `postgres` 服务 |
| Alembic | DB 迁移（`backend/migrations/versions/`） | alembic>=1.13（backend 启动 `alembic upgrade head`） | backend/pyproject.toml；compose `backend.command` |
| Redis 7 | 缓存 / 会话 / 权限缓存 / lease 协调 / Pub-Sub | redis-py（`redis>=5.0`）；镜像 `redis:7-alpine`（AOF） | backend/app/core/redis.py；compose `redis` 服务 |
| MinIO（S3 兼容） | 平台文件中心对象存储（文件/图片/spec 包） | aiobotocore>=3.8,<4；镜像 `minio/minio:latest` | backend/pyproject.toml + app/modules/file/、storage/；compose `minio` 服务（`STORAGE_BACKEND=minio`） |

## 2. LLM / Agent

| 集成 | 用途 | SDK / 通道 | 依据 |
|---|---|---|---|
| LiteLLM 网关 | OpenAI 格式供应商统一接入（Anthropic /v1/messages ↔ OpenAI 上游转换由 LiteLLM 承担）；后端经 admin API `/model/new` 动态注册 `usr-<uid>-<pid>` 模型路由 | 镜像 `ghcr.io/berriai/litellm:v1.95.0` + 独立 `litellm-db`（postgres）；master key 走 env `LITELLM_MASTER_KEY` | deploy/docker-compose.yml `litellm`/`litellm-db` 服务 + deploy/litellm-config.yaml；backend/app/modules/llm_provider/litellm_client.py |
| Anthropic Claude | 执行 Agent 任务、交互式会话 | `@anthropic-ai/claude-agent-sdk` 0.3.181（daemon 引入）；daemon 同时 spawn 本地 `claude` CLI（`CLAUDE_CODE_VERSION` build arg 随 backend 镜像分发） | sillyhub-daemon/package.json；src/interactive/claude-sdk-driver.ts、spawn-env.ts；compose `backend.build.args` |
| Codex | 备选 Agent（OpenAI Codex app-server 协议） | daemon 内 `codex-app-server-driver.ts`（自定义适配，未引第三方 SDK） | sillyhub-daemon/src/interactive/ |
| 模型供应商管理 | 运行期切换/配置 Claude、OpenAI 格式等供应商 | backend `llm_provider` 模块（litellm_client/router/service/schema）+ 前端 `components/llm-providers/` 与 `lib/config/llmProviderPresets.ts` | backend/app/modules/llm_provider/；frontend/src/components/llm-providers/ |

注：backend 本身不直接 import Anthropic SDK，仅经环境变量/网关传递凭证，实际推理由 daemon 驱动的 Claude 子进程或 LiteLLM 网关上游完成。

## 3. 协议 / 通道

| 集成 | 用途 | 实现 | 依据 |
|---|---|---|---|
| WebSocket | daemon ↔ backend 长连接（daemon 主动连，WS 鉴权/握手/权限校验），配 lease 轮询 + outbox 韧性 | backend `daemon/router.py` WS 端点；daemon `ws` ^8.18（`ws-client.ts` / `hub-client.ts`） | backend/app/modules/daemon/（test_ws_auth 等）；sillyhub-daemon/src/ |
| SSE | Agent 运行流 / daemon 会话流 / spec 导入进度 / MCP 传输 | backend 多端点 `text/event-stream`；前端 `lib/fetch-sse.ts` | backend/app/main.py、modules/agent/router.py、modules/daemon/router.py（test_session_sse）、modules/spec_workspace/router.py；frontend/src/lib/fetch-sse.ts |
| MCP（对外服务） | backend 对平台外 Agent 暴露 MCP 工具集（SSE 传输 + webhooks） | 官方 Python SDK `mcp>=1.29,<2`（FastMCP + http_app ASGI mount）；`mcp_gateway` 模块（server/tools/sse/auth） | backend/pyproject.toml；backend/app/modules/mcp_gateway/；docs/mcp/（tools-reference/sse/webhooks） |
| MCP（daemon 侧） | daemon 作为 MCP server 暴露本机工具；按 workspace 注入 MCP 配置 | `@modelcontextprotocol/sdk` ^1.29.0 | sillyhub-daemon/src/mcp-server.ts、mcp-config.ts |

## 4. 进度同步（platform_sync）

| 集成 | 用途 | 实现 | 依据 |
|---|---|---|---|
| SillySpec CLI ↔ 平台进度同步 | CLI（daemon 本地）向平台上报 change 进度/审批/文档，读进度列表 | `/api/changes/{name}/progress`（GET/POST）、`GET /api/changes`、`/api/changes/{name}/documents`、`/api/changes/{name}/approval`、`/api/quicklog-entries`；鉴权 `shpsync_` token | backend/app/modules/platform_sync/router.py、auth.py、token_service.py |
| spec 文件增量同步 | CLI 直跑 spec 树 manifest 对比 + 增量推送（替代整树 tar 全量） | `GET /api/changes/-/spec-manifest`、`POST /api/changes/-/spec-sync`；daemon 侧 `spec-sync.ts` | backend/app/modules/platform_sync/router.py；sillyhub-daemon/src/spec-sync.ts |
| workspace 同步 token 管理 | 工作区粒度签发/管理 `shpsync_` token（key_prefix 前缀对账） | `/api/workspaces/...`（platform-sync-tokens router） | backend/app/modules/platform_sync/workspace_router.py、token_model.py |
| daemon 本机配置 | init/claim 时写 `.sillyspec/local.yaml`（platform + mcp 派发段） | daemon `local-yaml-writer.ts` | sillyhub-daemon/src/local-yaml-writer.ts |

## 5. 工具链 / 构建

| 集成 | 用途 | 实现 | 依据 |
|---|---|---|---|
| SillySpec CLI | 文档驱动开发流程（brainstorm/plan/execute/verify/archive + quick），多项目定义 | `.sillyspec/`（projects/、changes/、quicklog/、workflows/）+ local.yaml | 仓库 `.sillyspec/` 目录 |
| openapi-typescript | 后端 schema → 前端/daemon 类型（禁止手写） | 前端 `pnpm gen:types` → `src/lib/api-types.ts`；daemon `pnpm gen:types` → `src/api-types.ts`（openapi-typescript ^7.13）；产物 `backend/openapi.json` | frontend/package.json、sillyhub-daemon/package.json、backend/scripts/ |
| pnpm / uv | 前端+daemon 包管理（pnpm workspace 分离）/ backend Python 依赖（uv.lock） | Node>=20、Python 3.12 | frontend/package.json、backend/uv.lock |
| Docker Compose | 本机与服务器统一部署（7 服务） | deploy/docker-compose.yml + .env + images.tar.gz | deploy/ |
| Git / GitHub | 仓库克隆、worktree、Git 凭证管理、变更提交 | backend `git_gateway`/`git_identity`/`worktree` 模块；httpx 调 GitHub API | backend/app/modules/ |

## 6. 后端核心框架 / 工具库（Python）

来源：backend/pyproject.toml。
- **Web**：FastAPI>=0.115 + uvicorn[standard]>=0.30（WebSocket，`--ws-max-size 100MB`）。
- **校验/配置**：pydantic>=2.8、pydantic-settings>=2.4。
- **鉴权/加密**：python-jose[cryptography]>=3.3（JWT）、passlib[bcrypt]>=1.7、pynacl>=1.5。
- **HTTP 客户端**：httpx>=0.27（GitHub / daemon 回写 / LiteLLM admin API）。
- **日志/观测**：structlog>=24.4；OpenTelemetry（可选，`OTEL_ENDPOINT`，core/telemetry.py）；core/monitoring.py。
- **安全**：core/ssrf.py（getaddrinfo 级 SSRF 防护）。
- **文档解析**：python-frontmatter>=1.1（spec/知识库 frontmatter）、openpyxl + Pillow（PPM Excel 导入/图像）。
- **测试/静态检查（dev）**：pytest + pytest-asyncio + pytest-xdist + pytest-cov、aiosqlite（单测 SQLite）、ruff、mypy。

## 7. 前端核心依赖（npm）

来源：frontend/package.json（pnpm，Node>=20）。
- **框架**：next 14.2.5、react/react-dom 18.3.1。
- **UI**：antd ^6.4.4 + @ant-design/icons + @ant-design/nextjs-registry；Radix UI；lucide-react。
- **样式**：tailwindcss 3.4.7 + tailwindcss-animate + tailwind-merge + cva + clsx。
- **数据层**：@tanstack/react-query ^5.51、zustand ^4.5。
- **图表/可视化**：echarts ^6.1 + echarts-for-react、@xyflow/react ^12.10。
- **校验/工具**：zod ^3.23、dayjs ^1.11；@uiw/react-markdown-preview。
- **dev**：openapi-typescript、typescript 5.5.4、vitest 2 + @testing-library + jsdom、@playwright/test。

## 8. Daemon 核心依赖（npm）

来源：sillyhub-daemon/package.json（Node>=20，ESM）。
- **CLI**：commander ^12.1。
- **传输**：ws ^8.18（与 backend 的 WebSocket 长连接）。
- **配置/校验**：js-yaml ^4.1、zod ^4.4。
- **Agent/MCP**：`@anthropic-ai/claude-agent-sdk` 0.3.181（多平台 optionalDependencies 经 pnpm overrides 统一）、`@modelcontextprotocol/sdk` ^1.29。
- **打包分发**：@vercel/ncc ^0.44（单文件 bundle）；openapi-typescript ^7.13（类型生成）。

## 9. 跨端通信通道小结

- **backend ↔ daemon**：WebSocket（daemon 主动连；`ws-client.ts`/`hub-client.ts`）+ REST 注册/心跳；outbox 韧性（`src/resilience/outbox.ts`）。
- **frontend ↔ backend**：REST / SSE（`src/lib/api.ts` + TanStack Query + `fetch-sse.ts`；Next.js `app/api/` BFF：daemon/daemon-chat/workspaces）。
- **daemon ↔ 本机 Agent**：stdio / 自定义 JSON 协议（`src/adapters/`：stream-json/jsonl/ndjson/json-rpc/pi-json/text）。
- **平台 ↔ 外部 Agent**：MCP 网关（SSE 传输 + webhooks，`mcp_gateway` 模块）。
