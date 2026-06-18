---
author: qinyi
created_at: 2026-06-10T00:00:00
---

# Backend 项目概览

## 项目简介

**multi-agent-platform-api** 是 SillyHub 多 Agent 协作平台的后端 API 服务。它提供工作空间管理、SillySpec 文档驱动开发流程、AI Agent 调度与执行、守护进程管理、Git 操作网关等核心功能。

该项目是 SillySpec 方法论的实现载体，支持从需求分析到代码实现的完整文档驱动开发流程，通过 AI Agent（Claude Code）自动化执行开发任务。

### 核心能力
- **工作空间管理** — 多项目工作空间、拓扑关系、自动扫描
- **SillySpec 流程** — 变更生命周期管理（brainstorm -> plan -> execute -> verify -> archive）
- **AI Agent 调度** — Claude Code 集成，支持多种执行策略
- **守护进程系统** — WebSocket 实时通信，任务租约与分发
- **Git 操作网关** — 安全的 Git 命令执行与审计
- **RBAC 权限** — 用户/角色/权限/工作空间级别的细粒度访问控制
- **工作流状态机** — 变更和任务的有限状态机管理
- **工具执行网关** — 受控的 shell 命令执行与策略限制

## 技术栈

### 运行时
- **Python 3.12** + **FastAPI** >= 0.115
- **uvicorn** (async, standard extras)
- **SQLModel** + **SQLAlchemy** (async, asyncpg driver)
- **PostgreSQL** (async via asyncpg)
- **Redis** (async)
- **structlog** (JSON structured logging)

### 认证与安全
- **python-jose** (JWT HS256)
- **bcrypt** (密码哈希)
- **pynacl** (NaCl secretbox 对称加密)

### 开发工具
- **ruff** (lint + format)
- **mypy** (类型检查)
- **pytest** + **pytest-asyncio** + **pytest-cov** (测试)
- **Alembic** (数据库迁移)
- **hatchling** (构建)
- **pre-commit** (Git hooks)

### 外部依赖
- **@anthropic-ai/claude-code** 2.1.158 (AI Agent CLI)
- **sillyspec** 3.18.2 (SillySpec CLI)

### 容器化
- **Docker** 多阶段构建（Python 3.12 slim）
- 集成 Node.js 20 (运行 Claude Code)
- 非 root 运行，健康检查

## 项目规模

- **源码目录**：`app/` 下 20 个功能模块
- **数据库表**：33 张
- **API 端点**：约 130 个（GET/POST/PUT/PATCH/DELETE/WS）
- **Service 类**：26 个
- **Alembic 迁移**：38 个
- **测试文件**：约 40 个

## 启动与运行

```bash
# 开发环境
cd backend
uv sync --all-extras
cp .env.example .env                  # 配置 DATABASE_URL 等
uv run alembic upgrade head           # 运行迁移
uv run uvicorn app.main:app --reload  # 启动服务 (端口 8000)

# Docker
docker build -t backend .
docker run -p 8000:8000 backend
```

## API 文档
- Swagger UI: `http://localhost:8000/api/docs`
- ReDoc: `http://localhost:8000/api/redoc`
- OpenAPI JSON: `http://localhost:8000/api/openapi.json`

## 与前端的关系
- 前端 Next.js 应用通过 REST API 与后端通信
- CORS 默认允许 `http://localhost:3000`
- 认证使用 Bearer JWT token
- 所有 API 前缀 `/api/`

## 与 Daemon 的关系
- Daemon（`sillyhub-daemon/`）通过 WebSocket 与后端通信
- 后端负责任务调度、租约管理、状态追踪
- Daemon 负责任务执行、心跳上报、结果同步
