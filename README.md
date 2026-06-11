# SillyHub — 多智能体协作管理平台

SillyHub 将 [SillySpec](https://github.com/nicepkg/sillyspec) 规范驱动开发方法论产品化，提供多用户、多项目、多 Agent 的全生命周期管理系统。

通过 Web 界面管理工作空间（Git 仓库），编排 AI Agent（首发 Claude Code），跟踪结构化变更规格，协调团队协作。

## 核心功能

- **工作空间管理** — 注册 Git 仓库为工作空间，扫描 `.sillyspec` 目录结构
- **变更生命周期** — proposal → design → plan → tasks → execute → verify 完整流程
- **AI Agent 编排** — 运行 Claude Code Agent 执行任务，实时 SSE 流式输出
- **Git Worktree 隔离** — 每个变更在独立 worktree 中执行，互不干扰
- **多用户认证** — JWT + bcrypt + RBAC 权限控制
- **Git 凭据网关** — 共享服务器部署下的多用户 Git 凭据隔离
- **本地 Daemon** — 轻量守护进程，负责宿主机 Agent 检测和任务执行
- **拓扑可视化** — 基于流程图的组件拓扑交互视图
- **知识库 / 事件 / 发布** — 内置知识库管理、事件追踪、发布工作流

## 技术栈

| 层 | 技术 |
|---|---|
| 后端 | Python 3.12 + FastAPI + SQLModel + Alembic + Redis |
| 前端 | Next.js 14 (App Router) + TypeScript + shadcn/ui + TanStack Query + Zustand |
| 数据库 | PostgreSQL 16 |
| 缓存 | Redis 7 |
| Agent | Claude Code CLI |
| Daemon | Python，WebSocket 协议通信 |
| 部署 | Docker Compose |

## 架构概览

```
┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│   Frontend   │────▶│    Backend   │────▶│  PostgreSQL  │
│   Next.js    │     │   FastAPI    │     │              │
└──────────────┘     └──────┬───────┘     └──────────────┘
       │                    │
       │ SSE (proxied)      │ WebSocket
       │                    ▼
       │             ┌──────────────┐
       │             │   Daemon     │
       │             │ (per host)   │
       │             └──────┬───────┘
       │                    │ subprocess
       │                    ▼
       │             ┌──────────────┐
       └─────────────│  AI Agents   │
                     │ Claude Code  │
                     └──────────────┘
```

## 快速开始

### 前置工具

| 工具 | 版本 | 说明 |
|---|---|---|
| Docker Desktop | ≥ 24 | 运行 Postgres + Redis（及完整容器化部署） |
| Python | 3.12 | 后端运行时 |
| [uv](https://github.com/astral-sh/uv) | ≥ 0.4 | Python 包管理（替代 pip/poetry） |
| Node.js | 20 | 前端运行时 |
| pnpm | 9 | 前端包管理（`corepack enable pnpm`） |
| Git | ≥ 2.40 | 必须 |

### 1. 克隆项目

```bash
git clone <your-fork-url> multi-agent-platform
cd multi-agent-platform
```

### 2. 启动基础设施

```bash
make dev-up    # docker compose 启动 Postgres + Redis
```

### 3. 启动后端

```bash
cd backend
cp .env.example .env           # DATABASE_URL / REDIS_URL 与 deploy/.env 对齐
uv sync --all-extras
uv run alembic upgrade head
uv run uvicorn app.main:app --reload --port 8000
```

验证：`curl http://localhost:8000/api/health`

### 4. 启动前端

```bash
cd frontend
cp .env.example .env.local     # 默认指向 http://localhost:8000
pnpm install
pnpm dev                       # http://localhost:3000
```

打开 `http://localhost:3000`，登录后即可使用。

### 5. 全链路容器化部署（可选）

```bash
cp deploy/.env.example deploy/.env   # 至少修改 SECRET_KEY
make up                              # 构建并启动全部服务
# 访问 http://localhost:3000
make down
```

## 项目结构

```
multi-agent-platform/
├── backend/                  # FastAPI 后端
│   ├── app/
│   │   ├── core/             # 配置、数据库、Redis、认证、加密、日志
│   │   └── modules/          # 24 个业务模块（vertical slice）
│   ├── alembic/              # 数据库迁移
│   ├── tests/                # 测试
│   └── Dockerfile
├── frontend/                 # Next.js 14 前端
│   ├── src/
│   │   ├── app/              # App Router 页面
│   │   ├── components/       # 共享 UI 组件
│   │   ├── lib/              # API 客户端（33 个模块）
│   │   └── stores/           # Zustand 状态管理
│   └── Dockerfile
├── sillyhub-daemon/          # 本地守护进程包
│   └── sillyhub_daemon/
│       ├── daemon.py         # 主守护进程
│       ├── agent_detector.py # Agent 检测（12 种运行时）
│       ├── task_runner.py    # 任务执行器
│       └── client.py         # WebSocket 客户端
├── deploy/                   # Docker Compose + 环境变量模板
├── .sillyspec/               # SillySpec 工作区元数据
│   ├── changes/              # 变更包（活跃 + 归档）
│   ├── docs/                 # 项目文档
│   └── knowledge/            # 知识库索引
└── Makefile                  # 开发工作流命令
```

## 开发指南

### 常用命令

```bash
make help                     # 查看所有可用命令

# 后端
make backend-install          # 安装依赖
make backend-run              # 启动开发服务器（热重载）
make backend-test             # 运行测试（pytest，覆盖率 ≥ 60%）
make backend-lint             # ruff + mypy 检查
make backend-format           # ruff 格式化
make backend-migrate          # 运行数据库迁移

# 前端
make frontend-install         # 安装依赖
make frontend-run             # 启动开发服务器
make frontend-test            # 运行测试
make frontend-lint            # ESLint 检查
make frontend-typecheck       # TypeScript 类型检查
make frontend-build           # 构建生产包

# 全量
make test                     # 后端 + 前端测试
make lint                     # 后端 + 前端 lint
```

### 添加后端业务模块

后端按 vertical slice 组织，每个模块一个独立目录：

```
backend/app/modules/<feature>/
├── router.py        # APIRouter — 路由定义
├── schema.py        # Pydantic 输入/输出模型
├── service.py       # 业务逻辑（不依赖 HTTP / DB session）
├── models.py        # SQLModel 表定义（如有）
└── tests/           # 测试
```

步骤：

1. 创建 `app/modules/<feature>/` 目录
2. 在 `app/main.py` 中 `app.include_router(router, prefix="/api")`
3. 如需新表：写 SQLModel → `uv run alembic revision --autogenerate` → 审查迁移文件
4. 补充测试，确保覆盖率 ≥ 60%
5. `make backend-lint backend-test` 全绿后提 PR

### 添加前端页面

1. 在 `frontend/src/app/<route>/page.tsx` 新建路由
2. 共享 UI 组件放 `src/components/`，shadcn 组件放 `src/components/ui/`
3. API 调用统一走 `src/lib/api.ts`
4. 全局状态用 Zustand（`src/stores/`），服务端状态用 TanStack Query
5. `make frontend-lint frontend-typecheck frontend-test frontend-build` 全绿后提 PR

## 常见问题

- **`asyncpg` 在 Windows 装不上** — 用 Docker 起 Postgres，本地后端连容器即可
- **`pnpm: command not found`** — `corepack enable pnpm`
- **`make` 在 Windows 没有** — 使用 Git Bash，或直接照搬 Makefile 里的命令
- **`/api/health` 返回 `db: down`** — 检查 `DATABASE_URL` 是否指向已启动的 Postgres，确认已运行 `alembic upgrade head`

## License

Private
