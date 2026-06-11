---
author: qinyi
created_at: 2026-06-10T17:00:02
---

# 目录结构 — multi-agent-platform

## 根目录

```
multi-agent-platform/           # Monorepo 根
+-- Makefile                    # 统一开发命令入口 (dev-up, test, lint, up, down)
+-- README.md                   # 项目说明
+-- backend/                    # FastAPI 后端
+-- frontend/                   # Next.js 前端
+-- sillyhub-daemon/            # Daemon CLI 工具
+-- deploy/                     # Docker Compose 编排
+-- scripts/                    # 运维脚本
+-- spikes/                     # 技术调研 / PoC
+-- docs/                       # 项目文档
+-- .claude/                    # Claude Code 配置 + skills
+-- .sillyspec/                 # SillySpec 文档系统
```

## backend/ — FastAPI 后端

```
backend/
+-- app/
|   +-- main.py                 # FastAPI 入口，注册所有模块路由 + lifespan
|   +-- __init__.py             # 版本号
|   +-- core/                   # 基础设施
|   |   +-- config.py           # Settings (pydantic-settings)
|   |   +-- db.py               # AsyncPG 引擎 + session 工厂
|   |   +-- redis.py            # Redis 连接
|   |   +-- auth_deps.py        # 认证依赖注入
|   |   +-- security.py         # JWT + 密码哈希
|   |   +-- crypto.py           # 加密工具
|   |   +-- errors.py           # 统一错误体系 (AppError + 子类)
|   |   +-- audit_hooks.py      # SQLAlchemy 事件钩子 -> AuditLog
|   |   +-- logging.py          # structlog 配置
|   |   +-- telemetry.py        # OpenTelemetry 初始化
|   |   +-- paths.py            # 路径解析
|   |   +-- spec_paths.py       # SillySpec 路径工具
|   |   +-- layout_migration.py # 数据布局迁移
|   +-- models/
|   |   +-- base.py             # BaseModel(SQLModel) — 所有表模型基类
|   +-- modules/                # 22 个业务模块
|       +-- agent/              # AI Agent 运行管理 (最大模块, ~71KB service.py)
|       |   +-- adapters/       # Agent 适配器 (claude_code.py)
|       |   +-- tests/          # 模块内测试
|       +-- auth/               # 认证与 RBAC
|       +-- workspace/          # 工作区管理
|       +-- change/             # 变更管理
|       +-- change_writer/      # 变更写入
|       +-- daemon/             # Daemon 运行时管理
|       +-- scan_docs/          # 扫描文档
|       +-- spec_workspace/     # SillySpec 工作区
|       +-- spec_profile/       # Spec Profile
|       +-- task/               # 任务管理
|       +-- workflow/           # 工作流 (审批/审计)
|       +-- release/            # 发布管理
|       +-- incident/           # 事件管理
|       +-- knowledge/          # 知识库
|       +-- git_identity/       # Git 身份管理
|       +-- git_gateway/        # Git 操作网关
|       +-- tool_gateway/       # 工具网关 + 策略
|       +-- runtime/            # 运行时管理
|       +-- archive/            # 归档
|       +-- health/             # 健康检查
|       +-- settings/           # 平台设置 + 用户管理
|       +-- worktree/           # Worktree 租约管理
+-- migrations/                 # Alembic 迁移 (20 个版本)
+-- tests/                      # 集成测试套件
+-- hooks/                      # Claude Code hooks (scan_write_guard)
+-- conftest.py                 # Pytest fixtures
+-- docker-entrypoint.sh        # Docker 入口脚本
+-- Dockerfile                  # 多阶段构建
+-- pyproject.toml              # 项目依赖 + 工具配置
+-- ruff.toml                   # Ruff 扩展配置
+-- alembic.ini                 # Alembic 配置
+-- .pre-commit-config.yaml     # Pre-commit hooks
```

## frontend/ — Next.js 前端

```
frontend/
+-- src/
|   +-- app/                    # Next.js App Router
|   |   +-- layout.tsx          # 根布局
|   |   +-- page.tsx            # 首页
|   |   +-- globals.css         # 全局样式
|   |   +-- (auth)/login/       # 登录页
|   |   +-- (dashboard)/        # 仪表盘路由组
|   |       +-- layout.tsx      # Dashboard 布局
|   |       +-- workspaces/     # 工作区列表 + 详情
|   |       +-- settings/       # 设置页 + git-identities
|   |       +-- runtimes/       # Daemon 运行时管理
|   +-- lib/                    # API 客户端 + 工具函数 (~27 个模块)
|   |   +-- api.ts              # 通用 apiFetch + base URL
|   |   +-- auth.ts             # 登录/登出/刷新 token
|   |   +-- agent.ts            # Agent Run CRUD + 流式日志
|   |   +-- workspaces.ts       # 工作区 API
|   |   +-- changes.ts          # 变更管理 API
|   |   +-- daemon.ts           # Daemon 运行时 API
|   |   +-- ...                 # 其余模块 API
|   |   +-- __tests__/          # lib 层单元测试
|   +-- components/             # 共享组件
|   |   +-- ui/                 # shadcn/ui 基础组件
|   |   +-- agent-log/          # Agent 日志组件
|   |   +-- app-shell.tsx       # 应用外壳 (导航)
|   |   +-- workspace-card.tsx  # 工作区卡片
|   |   +-- ...                 # 其他业务组件
|   +-- stores/
|   |   +-- session.ts          # Zustand session store
|   +-- test/
|       +-- setup.ts            # Vitest setup
+-- Dockerfile                  # 多阶段 standalone 构建
+-- package.json                # 依赖 + 脚本
+-- next.config.mjs             # API rewrites + standalone 模式
+-- tailwind.config.ts          # Tailwind 配置
+-- vitest.config.ts            # 测试配置
```

## sillyhub-daemon/ — Daemon CLI

```
sillyhub-daemon/
+-- sillyhub_daemon/
|   +-- __main__.py             # Click CLI 入口
|   +-- daemon.py               # Daemon 核心 (生命周期/心跳)
|   +-- agent_detector.py       # 检测 12 个 AI Agent provider
|   +-- task_runner.py          # 任务执行引擎
|   +-- client.py               # Backend HTTP/WS 客户端
|   +-- config.py               # Daemon 配置
|   +-- credential.py           # 凭证管理
|   +-- workspace.py            # 工作区管理
|   +-- protocol.py             # 通信协议定义
|   +-- version.py              # 版本信息
|   +-- backends/               # Agent 协议后端
|       +-- __init__.py         # Backend registry
|       +-- json_rpc.py         # JSON-RPC 协议
|       +-- jsonl.py            # JSON Lines 协议
|       +-- ndjson.py           # NDJSON 协议
|       +-- stream_json.py      # Streaming JSON 协议
|       +-- text.py             # 纯文本协议
+-- tests/                      # 17 个测试文件
+-- pyproject.toml
```

## deploy/ — 编排

```
deploy/
+-- docker-compose.yml          # 全栈编排 (postgres + redis + backend + frontend)
+-- docker-compose.dev.yml      # 开发依赖 (仅 postgres + redis)
+-- .env.example                # 环境变量模板
+-- .env                        # 本地环境变量 (gitignored)
```
