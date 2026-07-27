# SillyHub — 多智能体协作管理平台

SillyHub（仓库 `multi-agent-platform`）将 [SillySpec](https://github.com/nicepkg/sillyspec) 规范驱动开发方法论产品化，提供一个多用户、多项目、多 Agent 全生命周期的协作平台。通过 Web 界面管理工作空间（Git 仓库）、编排 AI Agent、跟踪结构化变更规格、协调团队协作。

产品形态：**模块化单体 backend（FastAPI）+ Next.js 前端 + 本地 daemon（Node.js）** 的全栈 Web 应用，PostgreSQL 持久化、Redis 缓存/实时、MinIO 对象存储。

> 项目状态：**未正式上线**（仅 PPM 项目管理模块已上线），允许重置开发/测试数据，不要求历史兼容。

## 核心功能

- **工作空间管理** — 注册 Git 仓库为工作空间，扫描 `.sillyspec` 目录结构，拓扑可视化
- **5 段变更生命周期** — `brainstorm → plan → execute → verify → archive`（scan/propose/quick 已移除）
- **AI Agent 编排** — 运行 Claude Code / Codex 执行任务，实时 SSE 流式输出、中断恢复、上下文指纹、双层审批门禁
- **多 Provider 适配** — 12 种宿主 Agent 探测（claude / codex / copilot / opencode / hermes / gemini / pi / cursor / kimi / kiro / antigravity / openclaw），6 种协议适配器
- **Git Worktree 隔离** — 每个变更在独立 worktree 中执行，互不干扰
- **本地 Daemon** — 轻量 Node.js 守护进程，负责宿主机 Agent 检测、任务执行、交互式会话、文件系统代理
- **平台文件中心** — MinIO/S3 兼容对象存储，StorageBackend 抽象 + 文件上传/下载/元数据
- **LLM 提供商管理** — cc-switch 式多提供商切换（启停 / set-default）
- **多用户认证** — JWT + bcrypt + RBAC，Git 凭据网关（共享服务器多用户隔离）
- **PPM 项目计划管理** — 项目 / 计划节点 / 任务执行 / 问题清单 / 看板（约 20 张表，已上线）
- **知识库 / 事件 / 发布** — 内置知识库管理、事件追踪复盘、发布审批工作流

## 技术栈

| 层 | 技术 |
|---|---|
| 后端 | Python 3.12 + FastAPI + SQLModel + SQLAlchemy(async) + Alembic + Pydantic v2 + structlog |
| 认证 | python-jose(JWT) + passlib[bcrypt] + PyNaCl |
| 前端 | Next.js 14.2.5(App Router) + React 18.3.1 + TypeScript 5.5 + Ant Design 6 + @xyflow/react 12 + TanStack Query + Zustand + Tailwind 3.4 + ECharts |
| 数据库 | PostgreSQL 16(生产,asyncpg) / aiosqlite(单测) |
| 缓存 | Redis 7（Pub/Sub 运行日志扇出 + 凭据/token 缓存） |
| 对象存储 | MinIO（S3 兼容，aiobotocore 异步客户端） |
| Daemon | Node.js ≥20 + TypeScript 5.5（ESM / pnpm）+ `@anthropic-ai/claude-agent-sdk` 0.3.181 + `@modelcontextprotocol/sdk` + `ws`；HTTP 用 Node 20 原生 `fetch` |
| 部署 | Docker Compose（`deploy/docker-compose.yml`，5 服务） |
| 包管理 | uv(后端) / pnpm 9.6.0(前端 + daemon) |

## 架构概览

```
浏览器 ──HTTP/REST(/api/*) + SSE(quick-chat 流)──▶ backend(FastAPI)
                                                       │  │
                                         PostgreSQL ◀──┘  └──▶ Redis pub/sub(运行日志扇出)
                       sillyhub-daemon(Node) ──WebSocket(/ws)──▶│
                            │ daemon 主动拨号 backend
                            ▼ spawn + 内置 MCP server
                       Claude Code / Codex Agent
                       读写宿主文件系统 / .sillyspec 文档 / skills
```

- **backend 是唯一持久化与鉴权中心**；daemon 是执行边缘节点，主动连 backend 的 `/ws`（无独立 HTTP 服务），通过 WS 双向消息 + lease 轮询领取任务。
- **daemon 不在 compose 中** — 始终在本机宿主运行；backend 容器经 bind mount `/data/spec-workspaces` 与宿主 daemon 共享 spec 文档。
- **单一 API 真相** — backend 的 OpenAPI（`/api/openapi.json`）；前端与 daemon 各自 `scripts/gen-api-types.mjs` 生成类型（`frontend/src/lib/api-types.ts`、`sillyhub-daemon/src/api-types.ts`），CI 用 `gen:types:check` 卡类型漂移。

### backend 分层（`backend/app/`）

- `core/` — 横切基础设施：`db`(异步会话)、`redis`、`config`、`security`/`crypto`、`auth_deps`、`audit_hooks`、`errors`(AppError)、`logging`/`telemetry`。
- `models/` — SQLModel 基类。
- `modules/` — 按业务域拆分的 vertical slice（~27 个）：每个模块典型含 `router.py` + `service.py` + `model.py` + `schema.py` + `tests/`。

  覆盖：`auth` `admin` `workspace`(+members/member_runtimes) `change` `change_writer` `workflow` `scan_docs` `task` `runtime` `agent` `daemon`(+dist) `worktree` `git_identity` `git_gateway` `tool_gateway`(+policy) `spec_workspace` `spec_profile` `knowledge` `skills` `llm_provider` `file` `storage` `incident` `release` `health` `settings`，以及 `ppm/` 子域（project/plan/task/problem/kanban/workbench，统一前缀 `/api/ppm`）。

## 目录结构

```
multi-agent-platform/
├── backend/                  # FastAPI 后端（Python 3.12，uv 管理）
│   ├── app/
│   │   ├── main.py           # 入口，挂载所有 router / 中间件 / 生命周期
│   │   ├── core/             # 配置、数据库、Redis、认证、加密、日志、审计
│   │   ├── models/           # SQLModel 基类
│   │   └── modules/          # ~27 个业务模块（vertical slice）
│   ├── migrations/           # Alembic 迁移（versions/ + env.py）
│   ├── tests/                # core / modules / e2e + 顶层集成测试
│   ├── Dockerfile  alembic.ini  pyproject.toml  uv.lock
├── frontend/                 # Next.js 14 前端（pnpm 管理）
│   ├── src/
│   │   ├── app/              # App Router（(auth)/(dashboard)/api/m 路由组）
│   │   ├── components/       # 按域分子目录的 UI 组件
│   │   ├── lib/              # API 客户端 + api-types.ts + 各 use-* hook
│   │   ├── stores/           # Zustand（session / workspace / kanban）
│   │   ├── styles/  middleware.ts
│   ├── next.config.mjs  tailwind.config.ts  tsconfig.json  vitest.config.ts
│   └── Dockerfile  package.json  pnpm-lock.yaml
├── sillyhub-daemon/          # 本地任务执行守护（Node.js ≥20，ESM）
│   ├── src/
│   │   ├── cli.ts daemon.ts ws-client.ts hub-client.ts
│   │   ├── task-runner.ts  interactive/（claude-sdk-driver / codex-app-server-driver）
│   │   ├── mcp-server.ts mcp-config.ts  host-fs-handler.ts  spec-sync.ts
│   │   ├── credential.ts credential-injector.ts（CLAUDE_CONFIG_DIR 隔离）
│   │   ├── adapters/（json-rpc/jsonl/ndjson/stream-json/pi-json/text）
│   │   ├── policy/  resilience/（outbox + 错误分类）
│   │   └── api-types.ts      # 由 backend OpenAPI 生成
│   ├── scripts/              # build-bundle.sh（@vercel/ncc 单文件打包）
│   └── package.json  tsconfig.json  vitest.config.ts
├── deploy/                   # docker-compose.yml / .dev.yml / .env / 镜像产物
├── docs/                     # 项目文档（审计 / 设计 / SillySpec 工具坑）
├── scripts/  spikes/  .claude/（skills + hooks + agents）
├── .sillyspec/               # SillySpec 工作区（changes / docs / knowledge / quicklog / db）
├── Makefile                  # 顶层统一入口（~22 个 target）
├── ROADMAP.md  AGENTS.md  meta.json
└── README.md
```

## 快速开始

### 前置工具

| 工具 | 版本 | 说明 |
|---|---|---|
| Docker Desktop | ≥ 24 | 运行 Postgres + Redis + MinIO（及完整容器化部署） |
| Python | 3.12 | 后端运行时 |
| [uv](https://github.com/astral-sh/uv) | ≥ 0.4 | 后端包管理（替代 pip/poetry） |
| Node.js | ≥ 20 | 前端 + daemon 运行时 |
| pnpm | 9.6 | 前端 + daemon 包管理（`corepack enable pnpm`） |
| Git | ≥ 2.40 | 必须 |

### 1. 克隆项目

```bash
git clone <your-fork-url> multi-agent-platform
cd multi-agent-platform
```

### 2. 启动基础设施（Postgres + Redis）

```bash
make dev-up
```

### 3. 启动后端

```bash
cd backend
cp .env.example .env              # DATABASE_URL / REDIS_URL 与 deploy/.env 对齐
uv sync --all-extras
uv run alembic upgrade head
uv run uvicorn app.main:app --reload --port 8000
```

验证：`curl http://localhost:8000/api/health`（应返回 `db: up`）
API 文档：`http://localhost:8000/api/docs`（Swagger）/ `/api/redoc` / `/api/openapi.json`

### 4. 启动前端

```bash
cd frontend
cp .env.example .env.local        # 默认指向 http://localhost:8000
pnpm install
pnpm dev                          # http://localhost:3000
```

打开 `http://localhost:3000`，默认账号 `admin / admin123`（按 username 登录）。

### 5. 全栈容器化部署（可选）

```bash
cp deploy/.env.example deploy/.env    # 至少修改 SECRET_KEY
make up                               # 构建并启动 postgres/redis/minio/backend/frontend
# 访问 http://localhost:3000
make down
```

> daemon 不在 compose 中。本机使用时单独构建运行：`cd sillyhub-daemon && pnpm install && pnpm bundle`，再由平台从 backend 拉取分发（`install.sh`）。

## 开发指南

### 常用命令

```bash
make help                        # 查看所有可用命令

# 后端
make backend-install             # 安装依赖
make backend-run                 # 启动开发服务器（热重载）
make backend-test                # 运行 pytest（异步 + xdist 并行）
make backend-lint                # ruff + mypy 检查
make backend-format              # ruff 格式化
make backend-migrate             # 运行数据库迁移

# 前端
make frontend-install            # 安装依赖
make frontend-run                # 启动开发服务器
make frontend-test               # vitest 测试
make frontend-lint               # ESLint 检查
make frontend-typecheck          # TypeScript 类型检查
make frontend-build              # 构建生产包

# 全量
make test                        # 后端 + 前端测试
make lint                        # 后端 + 前端 lint
```

### 添加后端业务模块（vertical slice）

```
backend/app/modules/<feature>/
├── router.py        # APIRouter — 路由定义
├── schema.py        # Pydantic v2 输入/输出模型
├── service.py       # 业务逻辑（不依赖 HTTP / DB session）
├── model.py         # SQLModel 表定义（如有）
└── tests/           # 测试
```

1. 创建 `app/modules/<feature>/` 目录
2. 在 `app/main.py` 中 `app.include_router(router, prefix="/api")`
3. 如需新表：写 SQLModel → `uv run alembic revision --autogenerate` → 审查迁移文件（注意多变更并行时 migration 链分叉风险）
4. 补充测试，`make backend-lint backend-test` 全绿后提 PR

### 添加前端页面

1. 在 `frontend/src/app/<route>/page.tsx` 新建路由
2. 共享 UI 组件放 `src/components/`（antd 6 + Tailwind 共存）
3. API 调用统一走 `src/lib/api.ts`；类型用 `src/lib/api-types.ts`（OpenAPI 生成）
4. 全局状态用 Zustand（`src/stores/`），服务端状态用 TanStack Query
5. 改动 API 后跑 `pnpm gen:types` 同步类型，`make frontend-lint frontend-typecheck frontend-test frontend-build` 全绿后提 PR

## 文档与深入

- `ROADMAP.md` — 里程碑 / 活跃变更 / 已知技术债
- `docs/agent-platform-deep-audit-2026-07-12.md` — 能力审计 + P0~P3 方案（带 file:line）
- `docs/code-quality-hardening-2026-07-24.md` — 代码质量加固记录 + DEFER 清单
- `.claude/CLAUDE.md` — 项目规则与协作约定（开发必读）
- `.sillyspec/docs/<项目>/scan/` — sillyspec-scan 生成的架构/结构/约定等扫描文档（PROJECT / ARCHITECTURE / STRUCTURE / CONVENTIONS / INTEGRATIONS / TESTING / CONCERNS）
- `.sillyspec/docs/SillyHub/modules/` — 模块卡片（每个业务模块的职责说明）
- `.sillyspec/docs/SillyHub/glossary.md` — 项目术语表

## 常见问题

- **`asyncpg` 在 Windows 装不上** — 用 Docker 起 Postgres，本地后端连容器即可
- **`pnpm: command not found`** — `corepack enable pnpm`
- **`make` 在 Windows 没有** — 使用 Git Bash，或直接照搬 Makefile 里的命令
- **`/api/health` 返回 `db: down`** — 检查 `DATABASE_URL` 是否指向已启动的 Postgres，确认已运行 `alembic upgrade head`
- **类型报错对不上后端** — 后端改了 API 后，前端/daemon 需 `pnpm gen:types` 重新生成 `api-types.ts`
- **单测 SQLite 与生产 PostgreSQL 行为不一致** — 部分 SQL 方言（如 `date_trunc`）有差异，写测试时注意方言分支

## 文档维护

本文档由 `sillyspec-scan` 产物维护，内容基于全量代码扫描（非手写臆测）。

- 作者：qinyi
- 最近重写：2026-07-27（基于 `source_commit: 6e78b29a` 的扫描结果）
- 扫描文档来源：`.sillyspec/docs/SillyHub/scan/`（PROJECT / ARCHITECTURE / STRUCTURE）

## License

Private
