---
author: qinyi
created_at: 2026-06-04T08:54+08:00
---

# 项目简介

SillyHub (multi-agent-platform) 是一个 AI 驱动的多 Agent 协作管理平台，旨在将 SillySpec 文档驱动开发生命周期产品化。

平台不重新定义 SillySpec，而是将 `.sillyspec` 目录结构、变更包、项目组组件、运行态、知识库和 Git 执行边界，封装为多人、多项目、多 Agent 的全生命周期执行管理系统。

核心特性包括：
- 多工作区管理：支持独立 SillySpec 工作区扫描与关系拓扑
- 变更全流程跟踪：从 brainstorm → plan → execute → verify 的状态机管理
- Agent 协调器：管理 Claude Code 等 Agent 的执行、上下文、工作目录隔离
- Git 凭据隔离：通过 Git Identity + Worktree Lease 解决多用户单服务器 Git 操作冲突
- 文档生成与扫描：自动生成项目架构文档（7 份扫描输出 + 模块映射）
- 知识库集成：支持将变更文档转化为可复用的知识模板

项目采用 SillySpec 文档驱动开发流程，新增功能需经过 `brainstorm` → `plan` → `execute` → `verify` 完整流程，小修复走 `quick` 流程。

## 技术栈

### 后端 (FastAPI)
- **框架**: FastAPI 0.115+ with Uvicorn
- **Python 版本**: 3.12+
- **数据层**:
  - SQLModel 0.0.22+ (ORM)
  - SQLAlchemy 2.0+ (asyncio)
  - asyncpg 0.29+ (PostgreSQL 驱动)
  - Alembic 1.13+ (数据库迁移)
  - Redis 5.0+ (缓存/会话)
- **安全**: python-jose[cryptography] 3.3+, passlib[bcrypt] 1.7+, PyNaCl 1.5+
- **日志**: structlog 24.4+
- **HTTP 客户端**: httpx 0.27+
- **前端解析**: python-frontmatter 1.1+
- **测试**: pytest 8+, pytest-asyncio 0.23+, pytest-cov 5+
- **代码质量**: Ruff 0.6+ (lint/format), MyPy 1.11+ (type check)

### 前端 (Next.js 14)
- **框架**: Next.js 14.2.5 (App Router)
- **运行时**: Node.js 20+, React 18.3.1
- **语言**: TypeScript 5.5.4
- **样式**: Tailwind CSS 3.4.7, tailwindcss-animate 1.0.7
- **状态管理**: Zustand 4.5.0 (客户端), TanStack Query 5.51.0 (服务端)
- **UI 组件**:
  - lucide-react 0.400.0 (图标)
  - @xyflow/react 12.10.2 (流程图)
  - @uiw/react-markdown-preview 5.2.1 (Markdown 渲染)
  - class-variance-authority, clsx, tailwind-merge (样式工具)
- **验证**: Zod 3.23.0
- **测试**: Vitest 2.0, @testing-library/react 16.0.0, @testing-library/jest-dom 6.4.6, jsdom 24.1.0
- **代码质量**: ESLint 8.57.0
- **包管理**: pnpm 9.6.0

### 基础设施
- **数据库**: PostgreSQL 16 (支持 pgvector, RLS)
- **缓存**: Redis 7
- **容器化**: Docker Compose (单机起步)
- **Git 集成**: libgit2 / subprocess + 自研 Git Tool Gateway
- **凭据加密**: libsodium secretbox (PyNaCl)，主密钥外部注入
- **监控**: OpenTelemetry SDK (计划中)
- **Agent 执行**: subprocess + 自研 Adapter，首发 Claude Code CLI

### 部署
- **本地开发**: Docker Compose (deploy/docker-compose.dev.yml)
- **生产部署**: Docker Compose (deploy/docker-compose.yml)
- **端口配置**: 后端 8000, 前端 3000, PostgreSQL 5432, Redis 6379

## 项目结构

```
multi-agent-platform/
├── backend/                 # FastAPI 后端
│   ├── app/
│   │   ├── modules/         # 23+ 业务模块
│   │   │   ├── agent/       # Agent 协调器、上下文构建、执行
│   │   │   ├── workspace/   # 工作区管理、扫描、拓扑
│   │   │   ├── change/      # 变更状态机、分发、路由
│   │   │   ├── task/        # 任务解析、路由
│   │   │   ├── git_gateway/ # Git 工具网关、危险操作
│   │   │   ├── git_identity/# Git 凭据加密
│   │   │   ├── tool_gateway/# 工具调用策略
│   │   │   ├── workflow/    # 工作流 FSM、审计钩
│   │   │   ├── spec_workspace/ # SillySpec 工作区验证
│   │   │   ├── spec_profile/ # 规范配置文件
│   │   │   ├── change_writer/ # Markdown 文档生成
│   │   │   ├── scan_docs/   # 扫描文档服务
│   │   │   ├── knowledge/   # 知识库
│   │   │   ├── archive/     # 归档服务
│   │   │   ├── incident/    # 事件管理
│   │   │   ├── release/     # 发布管理
│   │   │   ├── runtime/     # 运行时配置
│   │   │   ├── worktree/    # Worktree 执行环境
│   │   │   ├── auth/        # 认证授权
│   │   │   └── health/      # 健康检查
│   │   ├── main.py          # FastAPI 应用入口
│   │   └── __init__.py
│   ├── tests/               # 集成测试
│   ├── conftest.py          # Pytest fixtures
│   └── pyproject.toml       # 后端配置
├── frontend/                # Next.js 前端
│   ├── src/
│   │   ├── app/             # App Router 页面
│   │   │   ├── api/         # API 路由
│   │   │   ├── (auth)/      # 认证相关页面组
│   │   │   ├── (dashboard)/ # 仪表盘页面组
│   │   │   ├── globals.css
│   │   │   ├── layout.tsx
│   │   │   └── page.tsx
│   │   ├── components/      # UI 组件
│   │   ├── lib/             # 工具函数、API 客户端
│   │   └── __tests__/       # 前端测试
│   ├── package.json
│   └── vitest.config.ts
├── deploy/                  # Docker Compose 部署配置
│   ├── docker-compose.yml
│   ├── docker-compose.dev.yml
│   └── .env.example
├── .sillyspec/              # SillySpec 工作区元数据
│   ├── changes/             # 变更包 (当前/归档)
│   ├── projects/             # 项目组成员配置
│   ├── docs/                # 文档输出
│   └── progress.json        # 当前进度
├── .github/workflows/       # CI 配置
│   ├── backend-ci.yml
│   └── frontend-ci.yml
├── Makefile                 # 统一开发命令
└── README.md                # 快速启动指南
```

## 开发命令速查

```bash
# 启动开发环境
make dev-up                  # 启动 Postgres + Redis
make backend-up               # 启动后端 (reload)
make frontend-up              # 启动前端 (dev)

# 测试与质量
make test                    # 后端 + 前端测试
make backend-test            # pytest
make frontend-test           # vitest
make lint                    # ruff + eslint
make typecheck               # mypy + tsc

# 部署
make up                      # Docker Compose 全链路
make down                    # 停止容器
make logs                    # 查看日志
```
