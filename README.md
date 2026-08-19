# SillyHub — 多智能体协作管理平台

让 AI Agent 真正在团队里落地写代码。

SillyHub 把规范驱动开发（[SillySpec](https://github.com/q512426816/sillyspec)）从单人命令行工具，升级成一个团队级协作平台：管理工作空间、编排多个 AI Agent、跟踪结构化变更规格、协调多人协作与审批。Agent 写的每一行代码都有规可循、有迹可查、有人把关。

## 为什么用 SillyHub

- **让 Agent 写代码不再黑箱** — 变更规格驱动（需求 → 设计 → 计划 → 执行 → 验收 → 归档），每一步都有结构化文档和评审门禁，结果可追溯、可复盘
- **多 Agent、多 Provider 统一编排** — 一套平台调度 Claude Code / Codex 等 12 种宿主 Agent，6 种协议适配，新增 Agent 只加驱动不碰控制面
- **团队协作开箱即用** — 多用户、多项目、多工作空间，RBAC 权限 + Git 凭据网关，共享服务器也能安全隔离
- **本地执行，安全可控** — 轻量 Node.js daemon 在开发者本机执行任务，宿主文件系统策略引擎 + worktree 隔离，不越权、不互扰
- **实时可视** — SSE 流式输出、组件拓扑图、运行日志、看板，Agent 在干什么一目了然
- **全栈一体** — 前端、后端、daemon、对象存储、数据库一栈打通，Docker Compose 一键起

## ✨ 用 SillySpec 构建 SillyHub

> **吃自己的狗粮** — SillyHub 自身就用 [SillySpec](https://github.com/q512426816/sillyspec) 规范驱动开发:需求澄清（brainstorm）→ 方案与任务拆解（plan）→ 代码实现（execute）→ 验收验证（verify），每一次变更的结构化规格都沉淀在 `.sillyspec/`。本项目用什么方法论管理 Agent 协作，就用什么方法论构建自己——它的每一次演进，本身就是 SillySpec 能力的活样本。

## 核心能力

- **工作空间管理** — 注册 Git 仓库为工作空间，自动扫描规范目录，组件拓扑可视化
- **变更全生命周期** — brainstorm → plan → execute → verify → archive，状态机驱动，阶段评审门禁
- **AI Agent 编排** — 实时流式执行、中断恢复、上下文指纹、双层审批（工具级 + 阶段级）
- **多 Provider 适配** — claude / codex / copilot / opencode / hermes / gemini / pi / cursor / kimi / kiro / antigravity / openclaw
- **Git Worktree 隔离** — 每个变更在独立 worktree 执行，并行不冲突
- **平台文件中心** — MinIO/S3 兼容对象存储，上传 / 下载 / 流式分发
- **LLM 提供商管理** — 多提供商切换（启停 / 设默认），对接 cc-switch 风格配置
- **PPM 项目计划管理** — 项目 / 计划节点 / 任务执行 / 问题清单 / 看板，完整的项目交付域
- **知识库 · 事件 · 发布** — 经验沉淀、线上事件复盘、发布审批工作流

## 技术栈

| 层 | 技术 |
|---|---|
| 后端 | Python 3.12 · FastAPI · SQLModel · SQLAlchemy(async) · Alembic · Pydantic v2 · structlog |
| 前端 | Next.js 14(App Router) · React 18 · TypeScript 5 · Ant Design 6 · @xyflow/react · TanStack Query · Zustand · Tailwind · ECharts |
| 数据库 | PostgreSQL 16 · Redis 7（缓存 + Pub/Sub） |
| 对象存储 | MinIO（S3 兼容） |
| Daemon | Node.js ≥20 · TypeScript · `@anthropic-ai/claude-agent-sdk` · `@modelcontextprotocol/sdk` · `ws` |
| 部署 | Docker Compose |
| 包管理 | uv（后端）· pnpm（前端 + daemon） |

## 架构概览

```
浏览器 ──HTTP/REST + SSE──▶ backend(FastAPI) ──▶ PostgreSQL / Redis / MinIO
                                 ▲
                                 │ WebSocket
                          sillyhub-daemon(Node,本机)
                                 │ spawn + MCP
                                 ▼
                       Claude Code / Codex … Agent
```

- **backend** 是持久化与鉴权中心；**daemon** 是本机执行边缘节点，主动连 backend 调度任务、读写宿主文件系统。
- **单一 API 真相**：前后端与 daemon 共享 backend 的 OpenAPI，类型自动生成，CI 卡漂移。

详见 `.sillyspec/docs/SillyHub/scan/ARCHITECTURE.md`。

## 快速开始

### 前置工具

Docker Desktop ≥24 · Python 3.12 · [uv](https://github.com/astral-sh/uv) ≥0.4 · Node.js ≥20 · pnpm 9 · Git ≥2.40

### 启动

```bash
git clone <your-fork-url> multi-agent-platform
cd multi-agent-platform

make dev-up                     # 起 Postgres + Redis

cd backend
cp .env.example .env
uv sync --all-extras
uv run alembic upgrade head
uv run uvicorn app.main:app --reload --port 8000

cd ../frontend
cp .env.example .env.local
pnpm install
pnpm dev                        # http://localhost:3000
```

默认管理员账号按 `deploy/.env` 的 `PLATFORM_BOOTSTRAP_ADMIN_*` 配置（部署前务必设置为强口令）。后端 API 文档:`http://localhost:8000/api/docs`。

### 全栈容器化

```bash
cp deploy/.env.example deploy/.env   # 必改项见下行
make up                              # postgres / redis / minio / litellm + litellm-db / backend / frontend
# 部署前必改：SECRET_KEY、POSTGRES_PASSWORD、S3_ACCESS_KEY/SECRET_KEY、
# LITELLM_MASTER_KEY、LITELLM_DB_PASSWORD、PLATFORM_BOOTSTRAP_ADMIN_PASSWORD
```

## 项目结构

```
multi-agent-platform/
├── backend/            # FastAPI 后端（app/core + app/modules 业务域 vertical slice）
├── frontend/           # Next.js 14（src/app · components · lib · stores）
├── sillyhub-daemon/    # 本地执行守护（task-runner · interactive · mcp · policy · resilience）
├── deploy/             # Docker Compose 编排
├── docs/               # 设计与文档
├── scripts/            # 仓库级脚本（scan 漂移检查等）
├── .github/            # CI（backend / frontend / daemon / scan-drift）
├── .sillyspec/         # 规范驱动工作区（changes · docs · knowledge）
└── Makefile            # 统一开发入口
```

## 开发

```bash
make help                 # 全部命令
make test                 # 后端 + 前端 + daemon 测试
make lint                 # 后端 + 前端 lint + daemon typecheck
make backend-run          # 后端热重载
make frontend-run         # 前端 dev
```

新增后端模块走 vertical slice（`router.py / service.py / model.py / schema.py / tests/`），在 `app/main.py` 注册。新增前端页面用 antd + Tailwind，API 走 `lib/api.ts`，类型由 `pnpm gen:types` 从后端 OpenAPI 生成。

更多约定见 `.claude/CLAUDE.md` 与 `.sillyspec/docs/SillyHub/scan/`。

## License

Private
