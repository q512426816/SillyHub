---
author: qinyi
created_at: 2026-06-03T20:35:00+08:00
---

# Backend -- 架构文档

## 分层架构

```
backend/
├── app/
│   ├── main.py              # FastAPI 应用入口：注册路由 + 中间件 + 生命周期
│   ├── __init__.py           # 版本号 __version__ = "0.1.0"
│   ├── core/                 # 基础设施层
│   │   ├── config.py         # Settings(BaseSettings) -- 全部配置集中管理
│   │   ├── db.py             # AsyncEngine + AsyncSession 工厂 + 审计上下文注入
│   │   ├── redis.py          # Redis 单例（进程级共享）
│   │   ├── security.py       # JWT + bcrypt + refresh token
│   │   ├── crypto.py         # PyNaCl 凭证加密 (xchacha20-poly1305)
│   │   ├── auth_deps.py      # FastAPI Depends -- get_current_user / require_permission
│   │   ├── errors.py         # AppError 异常族 + 全局异常处理器
│   │   ├── logging.py        # structlog JSON 日志
│   │   ├── telemetry.py      # OpenTelemetry 占位（V2 待实现）
│   │   ├── audit_hooks.py    # ORM 变更审计钩子
│   │   ├── spec_paths.py     # SillySpec v4 目录布局路径解析器
│   │   └── layout_migration.py
│   ├── models/
│   │   └── base.py           # BaseModel(SQLModel) -- 所有表模型的统一基类
│   └── modules/              # 业务模块层（21 个领域模块）
│       └── <module>/
│           ├── model.py      # SQLModel 数据模型（表定义）
│           ├── schema.py     # Pydantic 请求/响应 DTO
│           ├── router.py     # APIRouter 路由定义
│           ├── service.py    # 业务逻辑（核心用例）
│           ├── parser.py     # 文件系统解析器（部分模块）
│           └── tests/        # 模块级单元测试
├── migrations/               # Alembic 数据库迁移
│   ├── env.py                # 异步迁移入口
│   └── versions/             # 33 个迁移版本文件
├── tests/                    # 顶层集成测试
├── pyproject.toml            # 项目配置 + 依赖 + 工具链
├── ruff.toml                 # ruff 配置（extend pyproject.toml）
├── alembic.ini               # Alembic 配置
├── Dockerfile                # 多阶段 Docker 构建
└── .env.example              # 环境变量模板
```

## 核心设计模式

### 1. 模块化架构

每个业务领域独立为 `app/modules/<module>/`，遵循统一结构：`model.py` + `schema.py` + `router.py` + `service.py`。模块之间通过 Service 类调用，避免 router 直接操作数据库。

### 2. 异步优先

全链路 async：`asyncpg` 异步驱动 + `AsyncSession` + `async def` service 方法。后台任务通过 `asyncio.create_task` 派发（fire-and-forget），使用独立的 `get_session_factory()` 获取新 session。

### 3. 依赖注入

FastAPI `Depends()` 机制贯穿全局：
- `get_session` -- 注入 AsyncSession（含审计上下文自动注入）
- `get_current_user` -- 提取 Bearer Token，返回 User 对象
- `require_permission(Permission.X)` -- RBAC 权限校验，返回已授权的 User
- `require_permission_any(Permission.X)` -- 不需要 workspace_id 的全局权限检查

### 4. 共享 BaseModel

所有 ORM 模型继承 `app.models.base.BaseModel(SQLModel)`，确保 Alembic autogenerate 扫描统一的 `metadata`。在 `migrations/env.py` 中显式 import 每个模块的 model 以注册表。

### 5. 审计追踪

- `core/db.py` 的 `get_session` 依赖会自动从 JWT 提取 `actor_id` 和 `workspace_id` 注入 `session.info["audit_context"]`
- `core/audit_hooks.py` 注册 SQLAlchemy 事件钩子（after_insert/update/delete），自动写入 `workflow/model.py` 的 `AuditLog` 表
- 审计钩子通过 `register_audit_hooks(engine)` 在应用启动后注册

### 6. Agent 适配器模式

`AgentAdapter` 抽象基类定义统一接口，`ClaudeCodeAdapter` 为具体实现。通过 `ADAPTERS` 注册表 + `AGENT_TYPE_ALIASES` 别名映射支持多种 Agent 后端。当前仅 `claude_code` 一种实现。

### 7. SSE 实时流

`AgentService.stream_run_logs()` 通过 Redis Pub/Sub 订阅 `agent_run:{run_id}` 频道，向客户端推送 SSE 事件，含 keepalive 心跳和 done 终止事件。

## 请求生命周期

```
客户端请求
  -> CORS 中间件（allow_origins from Settings）
  -> request_id 中间件（生成/透传 x-request-id）
  -> FastAPI 路由匹配
  -> Depends(get_session) 注入 DB session + 审计上下文
  -> Depends(require_permission) JWT 解码 + RBAC 检查
  -> Router 调用 Service 方法
  -> Service 执行业务逻辑（DB 读写 + 文件系统操作）
  -> 异常被 AppError handler 捕获，统一 JSON 响应
  -> 响应头附加 x-request-id
```

## 数据模型关系

```
User --1:N--> Session
User --M:N--> Workspace (via UserWorkspaceRole -> Role -> RolePermission)
Workspace --M:N--> Workspace (via WorkspaceRelation, 有向边)
Workspace --1:N--> Change
Workspace --M:N--> Change (via ChangeWorkspace, affected_components)
Change --1:N--> ChangeDocument
Change --1:N--> Task
Workspace --M:N--> Task (via TaskWorkspace)
Task --1:N--> AgentRun
Workspace --M:N--> AgentRun (via AgentRunWorkspace)
Workspace --1:N--> WorktreeLease
Workspace --1:N--> ScanDocument
Workspace --1:1--> SpecWorkspace
```

## 模块一览

| 模块 | 路由前缀 | 核心职责 |
|------|----------|----------|
| health | `/api` | 健康检查（DB + Redis 探针） |
| auth | `/api/auth` | JWT 认证、登录/刷新/登出/me、RBAC 种子 |
| workspace | `/api/workspaces` | 工作区 CRUD、扫描、reparse、拓扑关系 |
| change | `/api/workspaces/{id}/changes` | 变更生命周期、文档管理、状态流转、Agent dispatch |
| change_writer | `/api/workspaces/{id}/change-writer` | Agent 驱动的代码写入 |
| task | `/api/workspaces/{id}/tasks` | 任务 CRUD、看板、reparse |
| agent | `/api/agents` | AgentRun 创建/查询/终止、SSE 日志流 |
| spec_workspace | `/api/workspaces/{id}/spec-workspace` | SillySpec 工作区配置 |
| spec_profile | -- | Spec Profile 与冲突检测（无路由） |
| scan_docs | `/api/workspaces/{id}/scan-docs` | 项目扫描文档 |
| runtime | `/api/workspaces/{id}/runtime` | 运行时进度（读 SillySpec .runtime/） |
| knowledge | `/api/workspaces/{id}/knowledge` | 知识库 + Quicklog |
| workflow | `/api/workspaces/{id}/workflow` | 审批流程、审计日志 |
| release | `/api/releases` | 发布管理（多审批人 + 部署窗口） |
| incident | `/api/incidents` | 事件管理 + 事后总结 |
| git_gateway | `/api/git-gateway` | Git 操作代理（白名单 + 脱敏） |
| git_identity | `/api/git` | Git 身份管理 |
| tool_gateway | `/api/tool-gateway` | 工具操作代理 + 策略管理 |
| worktree | `/api/workspaces/{id}/worktrees` | Git worktree 租约管理 |
| archive | `/api/archive` | 变更归档 + 知识蒸馏 |
| settings | `/api/settings` + `/api/users` | 平台设置 + 用户管理 |

## 状态机

### Change 状态流转

StageEnum 定义 11 个阶段（8 个 SillySpec 主阶段 + 3 个 Hub 扩展）：

```
SillySpec 主阶段: scan -> brainstorm -> propose -> plan -> execute -> verify -> archive / quick
Hub 扩展阶段: draft -> rework_required -> accepted
```

合法流转通过 `TRANSITIONS` 字典定义，包含源阶段 -> 目标阶段 -> 允许角色映射：
```
draft -> propose / quick / execute / scan
scan -> brainstorm
brainstorm -> propose
propose -> plan / brainstorm (回退)
plan -> execute / propose (回退)
execute -> verify
verify -> accepted / rework_required
quick -> accepted / rework_required
rework_required -> propose / plan / execute
accepted -> archive
```

### AgentRun 状态

```
pending -> running -> completed / failed / killed
```

支持幂等重试（idempotency_key）、乐观锁（version）、上下文指纹（context_fingerprint）、断点续跑（resume_token）、检查点（checkpoint_data）。
