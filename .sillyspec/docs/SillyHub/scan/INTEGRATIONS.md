---
author: qinyi
created_at: 2026-07-27 00:35:31
source_commit: 5a00fc7e
updated_at: 2026-07-26T16:35:31Z
generator: sillyspec-scan
---

# 集成(Integrations)

按类型分组列出 SillyHub 对外部依赖、服务、SDK 的集成。来源:`backend/pyproject.toml`、`frontend/package.json`、`sillyhub-daemon/package.json`、`deploy/docker-compose.yml` 及源码 grep。

## 1. 数据存储 / 缓存 / 对象存储

| 集成 | 用途 | 客户端 / 镜像 | 出处 |
|---|---|---|---|
| PostgreSQL 16 | 主关系库(用户/工作区/变更/任务/PPM 等全量业务) | asyncpg + SQLAlchemy[asyncio] + SQLModel;镜像 `postgres:16-alpine` | backend/pyproject.toml;compose `postgres` 服务 |
| Alembic | DB 迁移(`backend/migrations/versions/`) | alembic(随 backend 启动 `alembic upgrade head`) | backend/pyproject.toml;compose `backend.command` |
| Redis 7 | 缓存 / 会话 / 权限缓存 / lease 协调 / Pub-Sub | redis-py(`redis>=5.0`);镜像 `redis:7-alpine`(AOF) | backend/app/core/redis.py;compose `redis` 服务 |
| MinIO(S3 兼容) | 平台文件中心对象存储(文件/图片/spec 包) | aiobotocore>=3.8,<4;镜像 `minio/minio:latest` | backend/pyproject.toml;compose `minio` 服务(`STORAGE_BACKEND=minio`) |

## 2. LLM / Agent / MCP

| 集成 | 用途 | SDK / 通道 | 出处 |
|---|---|---|---|
| Anthropic Claude | 执行 Agent 任务、交互式会话 | `@anthropic-ai/claude-agent-sdk` 0.3.181(随 daemon);daemon 同时 spawn 本地 `claude` CLI(默认 `CLAUDE_CODE_VERSION=2.1.158`) | sillyhub-daemon/package.json;compose `backend.build.args`;`src/interactive/claude-sdk-driver.ts` |
| Codex | 备选 Agent(OpenAI Codex app-server 协议) | daemon 内 `codex-app-server-driver.ts`(自定义适配,未引第三方 SDK) | sillyhub-daemon/src/interactive/ |
| MCP(Model Context Protocol) | daemon 作为 MCP server 暴露工具;同时按 workspace 注入 MCP 配置 | `@modelcontextprotocol/sdk` ^1.29.0;backend 侧 `tool_gateway` 模块 | sillyhub-daemon/package.json;`src/mcp-server.ts` `mcp-config.ts` |
| 模型供应商切换(cc-switch) | 运行期切换 Claude 模型 / API 端点 / PI | backend `llm_provider` 模块 + 前端 `components/llm-providers/` | backend/app/modules/llm_provider/;frontend/src/components/llm-providers/ |

注:backend 本身不直接 import Anthropic SDK,仅通过 `ANTHROPIC_*` 环境变量传递凭证,实际推理由 daemon 驱动的 Claude 子进程完成。

## 3. 后端核心框架 / 工具库(Python)

来源:`backend/pyproject.toml`。
- **Web 框架**:FastAPI>=0.115 + uvicorn[standard]>=0.30(WebSocket,`--ws-max-size 100MB`)。
- **数据校验 / 配置**:pydantic>=2.8、pydantic-settings>=2.4。
- **鉴权 / 加密**:python-jose[cryptography]>=3.3(JWT)、passlib[bcrypt]>=1.7、pynacl>=1.5。
- **HTTP 客户端**:httpx>=0.27(调 GitHub / daemon 回写 / 外部 LLM 网关)。
- **日志 / 可观测**:structlog>=24.4;OpenTelemetry(可选,`OTEL_ENDPOINT`)。
- **文档解析**:python-frontmatter>=1.1(spec/知识库 frontmatter)、openpyxl>=3.1 + Pillow>=10(PPM 问题清单 Excel 导入 / 图像)。
- **表单 / 系统信息**:python-multipart>=0.0.9、psutil>=5.9。
- **测试 / 静态检查(dev)**:pytest + pytest-asyncio + pytest-xdist + pytest-cov、aiosqlite(单测用 SQLite)、ruff、mypy、anyio。

## 4. 前端核心依赖(npm)

来源:`frontend/package.json`(pnpm@9.6.0,Node>=20)。
- **框架**:next 14.2.5、react / react-dom 18.3.1。
- **UI 组件库**:antd ^6.4.4 + @ant-design/icons + @ant-design/nextjs-registry;Radix UI(avatar/dialog/dropdown-menu);lucide-react。
- **样式**:tailwindcss 3.4.7 + tailwindcss-animate + tailwind-merge + class-variance-authority + clsx;@fontsource/inter。
- **数据层**:@tanstack/react-query ^5.51(服务端状态)、zustand ^4.5(客户端状态)。
- **图表 / 可视化**:echarts ^6.1 + echarts-for-react;@xyflow/react ^12.10(流程图/拓扑)。
- **Markdown**:@uiw/react-markdown-preview。
- **校验 / 工具**:zod ^3.23、dayjs ^1.11。
- **类型生成 / 测试(dev)**:openapi-typescript(由 backend openapi.json 生成 `src/lib/api-types.ts`)、typescript 5.5.4、vitest 2 + @testing-library + jsdom、@playwright/test、puppeteer。

## 5. Daemon 核心依赖(npm)

来源:`sillyhub-daemon/package.json`(Node>=20,ESM)。
- **CLI**:commander ^12.1。
- **传输**:ws ^8.18(与 backend 的 WebSocket 长连接)。
- **配置 / 校验**:js-yaml ^4.1、zod ^4.4。
- **打包分发**:@vercel/ncc ^0.44(单文件 bundle)。
- **Agent / MCP**:`@anthropic-ai/claude-agent-sdk` 0.3.181(多平台 optionalDependencies 经 pnpm overrides 统一指向 npm 主包)、`@modelcontextprotocol/sdk` ^1.29。

## 6. 外部服务 / 平台集成

| 集成 | 用途 | 实现位置 |
|---|---|---|
| Git / GitHub | 仓库克隆、worktree 操作、Git 凭证管理、变更提交 | backend `git_gateway` / `git_identity` / `worktree` 模块;httpx 调 GitHub API;daemon `host-fs-handler.ts` `roots-rpc.ts` |
| SillySpec CLI | 文档驱动开发工具(brainstorm/plan/execute/verify/archive),内置在 backend 镜像(`SILLYSPEC_VERSION` 可 pin) | compose `backend.build.args.SILLYSPEC_VERSION`;backend `spec_workspace` / `change` / `workflow` 模块 |
| Claude Code CLI | daemon spawn 本机 `claude`(版本默认 2.1.158,随镜像分发) | compose `backend.build.args.CLAUDE_CODE_VERSION`;daemon `spawn-env.ts` `interactive/claude-sdk-driver.ts` |
| Docker / Compose | 本机与服务器统一部署(postgres/redis/minio/backend/frontend 五服务) | `deploy/docker-compose.yml`;镜像 `multi-agent-platform-backend:latest` / `-frontend:latest` |
| OpenTelemetry(可选) | 链路追踪上报 | `OTEL_ENDPOINT` 环境变量;backend/app/core/telemetry.py |

## 7. 跨端通信通道

- **backend ↔ daemon**:WebSocket(daemon 主动连 backend,长连接;`ws-client.ts` / `hub-client.ts`),配 lease 轮询 + outbox 韧性(`src/resilience/outbox.ts`)。REST 回调用于注册(`POST /api/daemon/register`)与心跳上报。
- **frontend ↔ backend**:REST / WebSocket(`src/lib/api.ts` + Tanstack Query;Next.js `app/api/` BFF 代理)。构建期注入 `NEXT_PUBLIC_API_BASE_URL`(浏览器,默认 `http://localhost:8000`)与 `INTERNAL_API_BASE_URL`(SSR,默认 `http://backend:8000`)。
- **daemon ↔ 本机 Agent**:stdio / 自定义 JSON 协议(经 `src/adapters/` 多协议适配:stream-json / jsonl / ndjson / json-rpc / pi-json / text)。
