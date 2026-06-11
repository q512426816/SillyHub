# SillyHub 项目概述文档

author: qinyi
created_at: 2026-06-03T12:00:06

## 项目简介

SillyHub 是一个基于 SillySpec 规范驱动的多 Agent 协作平台。它提供了完整的工作区管理、变更管理、AI Agent 执行引擎和规范文档系统，旨在将软件工程流程中的规格编写、任务分解、代码实现和验证通过 AI Agent 自动化串联起来。

项目名称：Multi-Agent Platform (SillyHub)
项目类型：全栈 Web 应用（模块化单体架构）
开源协议：私有项目

## 技术栈

### 后端
- Python 3.12+ / FastAPI 0.115+ / SQLModel + SQLAlchemy 2.0 (async) / PostgreSQL 16 / Redis 7
- 认证: JWT (python-jose) + bcrypt / 加密: NaCl / 迁移: Alembic
- 代码质量: Ruff + Mypy / 测试: pytest + pytest-asyncio

### 前端
- Node 20+ / Next.js 14 (App Router) / React 18 / TypeScript 5.5 / Tailwind CSS 3.4
- 状态管理: Zustand / 数据获取: useEffect + useState
- 测试: Vitest + Testing Library + Playwright

### Daemon
- Python 3.12+ / httpx / websockets / Click CLI
- 5 种通信协议后端，支持 12 种 Agent provider

### 部署
- Docker Compose (PostgreSQL 16 + Redis 7 + Backend + Frontend)
- 本地开发: uvicorn (backend) + next dev (frontend)

SillyHub 是一个基于 SillySpec 规范驱动的多 Agent 协作平台。它提供了完整的工作区管理、变更管理、AI Agent 执行引擎和规范文档系统，旨在将软件工程流程中的规格编写、任务分解、代码实现和验证通过 AI Agent 自动化串联起来。

项目名称：Multi-Agent Platform (SillyHub)
项目类型：全栈 Web 应用（模块化单体架构）
开源协议：私有项目

## 2. 技术栈

### 2.1 后端技术栈

- **语言**：Python 3.12+
- **框架**：FastAPI 0.115+
- **ORM**：SQLModel 0.0.22 + SQLAlchemy 2.0 (async)
- **数据库**：PostgreSQL 16（AsyncPG 驱动）
- **缓存/消息**：Redis 7（Pub/Sub）
- **认证**：JWT HS256 (python-jose) + bcrypt
- **加密**：NaCl (PyNaCl)
- **迁移**：Alembic
- **日志**：structlog
- **HTTP 客户端**：httpx（测试用）
- **包管理**：uv
- **代码质量**：Ruff (lint + format) + Mypy (type check)
- **测试**：pytest + pytest-asyncio + pytest-cov
- **运行时**：uvicorn

### 2.2 前端技术栈

- **语言**：TypeScript 5.5
- **框架**：Next.js 14.2 (App Router)
- **UI 库**：React 18.3
- **状态管理**：Zustand 4.5 (持久化) + React Query 5 (服务端缓存)
- **样式**：Tailwind CSS 3.4 + PostCSS
- **可视化**：@xyflow/react 12.10 (拓扑图)
- **Markdown**：@uiw/react-markdown-preview
- **校验**：Zod 3.23
- **图标**：lucide-react
- **测试**：Vitest 2.0 + Testing Library + jsdom
- **包管理**：pnpm 9.6
- **Lint**：ESLint 8 + eslint-config-next

### 2.3 基础设施

- **容器化**：Docker + Docker Compose
- **数据库**：PostgreSQL 16 Alpine
- **缓存**：Redis 7 Alpine (AOF 持久化)
- **Agent 执行**：Claude Code CLI（子进程模式，stream-json 协议）

## 3. 功能特性

### 3.1 工作区管理
- 注册和管理多个代码工作区（支持 YAML 定义导入）
- 工作区扫描：自动检测 `.sillyspec` 结构、组件、变更目录
- 组件管理：识别工作区内的软件组件（微服务、库等）
- 工作区关系：定义组件间依赖关系（depends_on, consumes_api_from 等）
- 拓扑可视化：@xyflow/react 渲染工作区关系图
- 多工作区支持：一个 AgentRun 可关联多个工作区（M:N）

### 3.2 变更管理
- 变更全生命周期管理：draft → proposed → reviewed → approved → in_progress → completed → merged
- 阶段驱动：每个阶段可自动触发 Agent 执行
- Spec Guardian：阶段转换前的自动校验（文档存在性、字数要求等）
- 变更文档管理：MASTER.md、proposal、design、plan 等文档追踪
- 自动调度链：一个 AgentRun 完成后自动调度下一个阶段（最多 10 次连续调度）

### 3.3 AI Agent 执行引擎
- Claude Code 集成：通过子进程执行 Claude Code CLI
- Spec Bundle 驱动：Agent 接收完整的规范包（proposal + design + plan + constraints）
- 实时日志流：Redis Pub/Sub + SSE 推送到前端
- 对话捕获：完整记录 Agent 的思考、工具调用和结果
- 执行协调：幂等创建、乐观锁、上下文指纹、检查点、审批流程
- 中断恢复：支持通过 resume_token 恢复中断的 Agent 运行
- 跨工作区上下文：Agent 可获取关联工作区的规范文档摘要

### 3.4 工作流引擎
- Task FSM：draft → ready → in_progress → review → done（含 blocked/cancelled 分支）
- 自动审计：SQLAlchemy 事件钩子自动记录所有模型变更
- 变更审批流程

### 3.5 任务管理
- 任务分解和管理
- 任务与 Agent 运行绑定
- 任务状态跟踪

### 3.6 认证与权限
- JWT + Refresh Token 双令牌认证
- RBAC 权限模型（25 个权限，7 个域）
- 平台管理员引导
- 工作区级权限控制

### 3.7 Git 集成
- GitHub OAuth 身份管理
- Git 操作网关（输出自动脱敏）
- Git 操作日志记录

### 3.8 发布与事件管理
- 发布记录管理
- 事件（Incident）跟踪
- 运行时监控

### 3.9 规范文档系统
- Scan 文档管理（自动生成的架构文档）
- Spec 工作区管理（规范空间引导和校验）
- Spec Profile 配置
- 知识库
- 变更文档写入器

### 3.10 平台设置
- 平台级配置管理
- 健康检查端点

## 4. 快速上手

### 4.1 环境要求

- Python 3.12+
- Node.js 20+
- pnpm 9.6+
- uv（Python 包管理器）
- Docker + Docker Compose（用于 PostgreSQL 和 Redis）
- Claude Code CLI（用于 Agent 执行）

### 4.2 启动步骤

```bash
# 1. 克隆项目
git clone <repo-url> sillyhub && cd sillyhub

# 2. 启动基础设施（PostgreSQL + Redis）
make dev-up

# 3. 安装后端依赖
make backend-install

# 4. 执行数据库迁移
make backend-migrate

# 5. 安装前端依赖
make frontend-install

# 6. 启动后端（http://localhost:8000）
make backend-run

# 7. 启动前端（http://localhost:3000）
make frontend-run
```

### 4.3 环境变量

后端需要配置的环境变量（在 `backend/.env` 或系统环境变量中设置）：

```bash
DATABASE_URL=postgresql+asyncpg://platform:platform@localhost:5432/platform
REDIS_URL=redis://localhost:6379/0
SECRET_KEY=<随机密钥>
SILLYSPEC_MASTER_KEY=<sillyspec 主密钥>
PLATFORM_BOOTSTRAP_ADMIN_EMAIL=admin@example.com
PLATFORM_BOOTSTRAP_ADMIN_PASSWORD=<密码>
PLATFORM_BOOTSTRAP_ADMIN_DISPLAY_NAME=Admin
```

### 4.4 常用命令

```bash
make help             # 查看所有可用命令
make test             # 运行全部测试
make lint             # 运行全部 lint
make backend-test     # 运行后端测试
make frontend-test    # 运行前端测试
make backend-lint     # Ruff + Mypy
make frontend-lint    # ESLint
make frontend-typecheck  # TypeScript 类型检查
make backend-format   # 自动格式化代码
make dev-down         # 停止基础设施
make dev-reset        # 重置数据库和 Redis（危险）
```

### 4.5 API 文档

启动后端后访问：
- Swagger UI：http://localhost:8000/api/docs
- ReDoc：http://localhost:8000/api/redoc
- OpenAPI JSON：http://localhost:8000/api/openapi.json

## 5. 项目规模

- 后端业务模块：21 个
- 后端 Python 文件：~160 个
- 后端测试文件：182 个
- 数据库迁移：38 个
- 前端页面：~20 个
- 前端 API 客户端：20+ 个
- 前端 UI 组件：5 个基础组件 + 5 个业务组件
