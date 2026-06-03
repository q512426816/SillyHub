---
author: qinyi
created_at: 2026-06-03T00:00:00
---

# Backend (FastAPI) — 架构文档

## 技术栈

| 类别       | 技术 / 库                          | 版本          |
|------------|-------------------------------------|---------------|
| 语言       | Python                              | >=3.12        |
| Web 框架   | FastAPI + Uvicorn                   | >=0.115       |
| ORM        | SQLModel + SQLAlchemy (async)       | >=0.0.22 / >=2.0 |
| 数据库     | PostgreSQL                          | 16-alpine     |
| 缓存       | Redis                               | 7-alpine      |
| 迁移       | Alembic                             | >=1.13        |
| 数据验证   | Pydantic + pydantic-settings        | >=2.8 / >=2.4 |
| 认证       | python-jose + passlib[bcrypt] + pynacl | >=3.3 / >=1.7 / >=1.5 |
| HTTP 客户端 | httpx                              | >=0.27        |
| 日志       | structlog                           | >=24.4        |
| 驱动       | asyncpg                             | >=0.29        |
| 包管理     | uv + hatchling                      | hatchling     |
| 测试       | pytest + pytest-asyncio + pytest-cov | >=8           |
| Lint       | ruff + mypy                         | >=0.6 / >=1.11 |

## 架构概览

### 分层架构

```
backend/
├── app/
│   ├── main.py              # FastAPI 应用入口，注册所有路由 + 中间件
│   ├── core/                # 基础设施层（DB、Redis、配置、安全、日志）
│   ├── models/              # 共享 BaseModel 基类
│   └── modules/             # 业务模块（按领域拆分）
│       └── <module>/
│           ├── model.py     # SQLModel 数据模型
│           ├── schema.py    # Pydantic 请求/响应 Schema
│           ├── router.py    # APIRouter 路由定义
│           ├── service.py   # 业务逻辑
│           └── tests/       # 模块级单元测试
├── alembic.ini              # Alembic 配置
├── migrations/              # 数据库迁移脚本
├── pyproject.toml           # 项目元数据 + 依赖 + 工具配置
└── tests/                   # 集成测试套件
```

### 核心设计模式

1. **模块化架构**：每个业务领域独立为 `app/modules/<module>/`，包含 model / schema / router / service
2. **异步优先**：全链路 async（asyncpg + AsyncSession + async def service）
3. **共享 BaseModel**：所有模型继承 `app.models.base.BaseModel(SQLModel)`，确保统一的 Alembic 元数据
4. **依赖注入**：FastAPI Depends 注入数据库 session、认证用户、审计上下文
5. **审计钩子**：`core/audit_hooks.py` 捕获所有 `BaseModel(table=True)` 变更并写入 AuditLog
6. **SSE 流式输出**：Agent 模块通过 Server-Sent Events 支持异步 AgentRun 实时输出
7. **Agent 适配器模式**：`agent/adapters/claude_code.py` 实现 Claude Code CLI 适配器，支持可扩展的 Agent 后端

### API 路由注册（main.py）

所有模块路由在 `app/main.py` 统一注册，包括：
- auth, agent, archive, change, change_writer
- git_gateway, git_identity, health, incident, knowledge
- release, runtime, scan_docs, settings, spec_workspace
- task, tool_gateway (router + policy_router), workflow
- workspace, worktree (router + lease_router)

## 数据模型（摘要）

### 模型总览

| 模块 | 表名 | 说明 | 字段数(约) |
|------|------|------|-----------|
| **auth** | `User` | 用户账户 | 33 (模块总计) |
| | `Session` | 用户会话 | |
| | `Role` | 角色 | |
| | `RolePermission` | 角色权限 | |
| | `UserWorkspaceRole` | 用户-工作区-角色关联 | |
| **workspace** | `Workspace` | 工作区（项目） | 33 (模块总计) |
| | `WorkspaceRelation` | 工作区关系 | |
| | `ChangeWorkspace` | 变更-工作区关联 | |
| | `TaskWorkspace` | 任务-工作区关联 | |
| | `AgentRunWorkspace` | Agent运行-工作区关联 | |
| **change** | `Change` | 变更（SillySpec 核心） | 29 (模块总计) |
| | `ChangeDocument` | 变更文档 | |
| **agent** | `AgentRun` | Agent 运行记录 | 28 (模块总计) |
| | `AgentRunLog` | Agent 运行日志 | |
| **task** | `Task` | 任务 | 18 |
| **incident** | `Incident` | 事件 | 25 (模块总计) |
| | `Postmortem` | 事后总结 | |
| **release** | `Release` | 发布 | 22 (模块总计) |
| | `ReleaseApproval` | 发布审批 | |
| **workflow** | `ChangeReview` | 变更评审 | 14 (模块总计) |
| | `AuditLog` | 审计日志 | |
| **spec_workspace** | `SpecWorkspace` | SillySpec 工作区配置 | 10 |
| **spec_profile** | `SpecProfileManifest` | Spec Profile 清单 | 15 (模块总计) |
| | `SpecConflict` | Spec 冲突 | |
| **worktree** | `WorktreeLease` | Worktree 租约 | 14 |
| **git_identity** | `GitIdentity` | Git 身份配置 | 13 |
| **git_gateway** | `GitOperationLog` | Git 操作日志 | 9 |
| **tool_gateway** | `ToolOperationLog` | 工具操作日志 | 9 |
| | `ToolPolicy` | 工具策略 | (tool_policy.py) |
| **scan_docs** | `ScanDocument` | 扫描文档 | 8 |
| **settings** | `PlatformSetting` | 平台设置 | 4 |

**合计约 32 张数据库表**，覆盖认证、工作区管理、变更生命周期、Agent 调度、任务跟踪、发布审批、审计等完整业务域。

## 模块划分

### 核心基础设施 (`app/core/`)

| 文件 | 职责 |
|------|------|
| `config.py` | 应用配置（Pydantic BaseSettings） |
| `db.py` | 异步 SQLAlchemy 引擎 + Session 工厂 + 审计上下文注入 |
| `redis.py` | Redis 连接管理 |
| `auth_deps.py` | FastAPI 认证依赖（JWT 校验、当前用户提取） |
| `security.py` | 密码哈希、JWT 令牌生成 |
| `crypto.py` | 加密工具（SILLYSPEC_MASTER_KEY） |
| `audit_hooks.py` | 数据变更审计钩子 |
| `logging.py` | structlog 日志配置 |
| `errors.py` | 全局异常处理器注册 |
| `telemetry.py` | OpenTelemetry 初始化 |
| `spec_paths.py` | SillySpec 文件路径工具 |
| `layout_migration.py` | 布局迁移工具 |

### 业务模块 (`app/modules/`)

| 模块 | 路由前缀 | 职责 |
|------|----------|------|
| **auth** | `/auth` | 用户认证（登录/登出/刷新）、JWT、RBAC |
| **workspace** | `/workspaces` | 项目工作区 CRUD、扫描、拓扑关系 |
| **change** | `/workspaces/{id}/change` | 变更全生命周期管理 |
| **change_writer** | (spec-workspace) | 变更文档写入 |
| **task** | `/workspaces/{id}/task` | 任务 CRUD |
| **agent** | `/agent` | Agent 运行调度、Claude Code 适配器、SSE 流 |
| **spec_workspace** | `/workspaces/{id}/spec-workspace` | SillySpec 工作区管理、bootstrap |
| **spec_profile** | -- | Spec Profile 与冲突检测 |
| **scan_docs** | `/workspaces/{id}/scan-docs` | 项目扫描文档查询 |
| **runtime** | `/workspaces/{id}/runtime` | 运行时进度、用户输入、产物 |
| **knowledge** | `/workspaces/{id}/knowledge` | 知识库与快速日志 |
| **workflow** | `/workflow` | 变更评审、审批流程 |
| **release** | `/releases` | 发布管理与审批 |
| **incident** | `/incidents` | 事件管理与事后总结 |
| **git_gateway** | `/git_gateway` | Git 操作代理与日志 |
| **git_identity** | `/git` | Git 身份管理 |
| **tool_gateway** | `/tool_gateway` | 工具网关（操作代理 + 策略管理） |
| **worktree** | `/workspaces/{id}` | Git Worktree 租约管理 |
| **archive** | `/archive` | 变更归档 |
| **settings** | `/settings` | 平台设置与用户管理 |
| **health** | `/health` | 健康检查与版本信息 |
