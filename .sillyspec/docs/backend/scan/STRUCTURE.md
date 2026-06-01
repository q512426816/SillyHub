---
author: qinyi
created_at: 2026-05-31T23:30:00
---

# SillyHub Backend — 目录结构

## 1. 顶层目录树

```
backend/
├── app/                          # 应用主包
│   ├── __init__.py               # 版本号定义 (__version__)
│   ├── main.py                   # FastAPI 应用入口 + lifespan + 路由注册
│   ├── models/
│   │   ├── __init__.py
│   │   └── base.py               # BaseModel(SQLModel) — 所有 table model 的基类
│   ├── core/                     # 横切关注点（10 个文件）
│   │   ├── __init__.py
│   │   ├── config.py             # Settings(BaseSettings) — 所有运行时配置
│   │   ├── db.py                 # async engine + session factory + audit 注入
│   │   ├── auth_deps.py          # get_current_user / require_permission 依赖
│   │   ├── errors.py             # AppError 层级 + 异常处理器注册
│   │   ├── security.py           # JWT + bcrypt + refresh token
│   │   ├── redis.py              # 全局 Redis 客户端
│   │   ├── logging.py            # structlog JSON 日志配置
│   │   ├── telemetry.py          # OpenTelemetry bootstrap (V1 stub)
│   │   ├── crypto.py             # CredentialCipher (PyNaCl xchacha20)
│   │   └── audit_hooks.py        # SQLAlchemy Mapper event 自动审计
│   └── modules/                  # 21 个功能模块
│       ├── __init__.py
│       ├── agent/                # Agent 调度引擎
│       ├── archive/              # 变更归档
│       ├── auth/                 # 认证 + RBAC
│       ├── change/               # 变更管理 + 分派
│       ├── change_writer/        # Markdown 变更文档构建
│       ├── git_gateway/          # Git 操作网关
│       ├── git_identity/         # Git 凭证管理
│       ├── health/               # 健康检查
│       ├── incident/             # 事件管理
│       ├── knowledge/            # 知识库
│       ├── release/              # 发布管理
│       ├── runtime/              # Runtime 文件解析
│       ├── scan_docs/            # 扫描文档
│       ├── settings/             # 平台设置
│       ├── spec_profile/         # Spec 配置文件
│       ├── spec_workspace/       # Spec 工作空间
│       ├── task/                 # 任务管理
│       ├── tool_gateway/         # 工具网关 + 策略
│       ├── workflow/             # 工作流 FSM + 审计
│       ├── workspace/            # Workspace 管理
│       └── worktree/             # Worktree 租约
├── migrations/                   # Alembic 迁移（31 个版本）
│   ├── env.py
│   ├── script.py.mako
│   └── versions/
├── tests/                        # 集成测试
│   ├── conftest.py               # (根级，不存在)
│   ├── test_config.py
│   ├── test_health.py
│   └── modules/
│       ├── agent/
│       └── change/
├── conftest.py                   # 全局测试 fixtures
├── create_tables.py              # 手动建表脚本（开发用）
├── pyproject.toml                # 项目配置 + 依赖声明
├── alembic.ini                   # Alembic 配置
├── Dockerfile                    # 容器构建
├── docker-entrypoint.sh          # 容器入口（迁移 + 启动）
├── CLAUDE.md                     # Claude Code 工作指引
├── .env / .env.example           # 环境变量
├── ruff.toml                     # Ruff lint 配置
└── uv.lock                       # uv 锁文件
```

## 2. 模块内部结构（标准 feature-slice）

大多数模块遵循统一的四层结构：

```
modules/<name>/
├── __init__.py          # 模块初始化 + router 导出
├── model.py             # SQLModel table 定义
├── schema.py            # Pydantic request/response schema
├── router.py            # FastAPI 路由定义
├── service.py           # 业务逻辑
└── tests/               # 模块内单元测试
    ├── __init__.py
    ├── test_router.py
    └── test_*.py
```

## 3. 各模块特殊文件说明

### 3.1 agent/（最复杂的模块）

```
agent/
├── base.py                  # AgentAdapter ABC + AgentSpecBundle + TaskContext
├── service.py               # AgentService — run 生命周期管理 (828 行)
├── coordinator.py           # ExecutionCoordinatorService — 幂等/锁/指纹/恢复
├── context_builder.py       # 从 change/task/component 构建 AgentSpecBundle
├── diff_collector.py        # 文件变更收集
├── model.py                 # AgentRun + AgentRunLog
├── schema.py                # API schema
├── coordinator_schema.py    # 协调器专用 schema
├── router.py                # POST /runs, GET /runs/{id}, POST /runs/{id}/kill
└── adapters/
    ├── __init__.py
    └── claude_code.py       # ClaudeCodeAdapter — claude CLI 子进程管理
```

### 3.2 workspace/（最大模块）

```
workspace/
├── model.py                 # Workspace + WorkspaceRelation + M2N 关联表
├── relation_schema.py       # 关联专用 schema
├── relation_service.py      # workspace 间关系 CRUD
├── topology.py              # 拓扑查询（上游/下游遍历）
├── scanner.py               # 前端框架检测
├── parser.py                # .sillyspec/workspace.toml 解析
├── service.py               # Workspace CRUD + soft-delete
├── router.py                # + relation_router
├── schema.py
└── tests/                   # 12 个测试文件
```

### 3.3 change/（工作流核心）

```
change/
├── model.py                 # Change + ChangeDocument + 10 阶段 TRANSITIONS
├── service.py               # 变更 CRUD + 阶段流转
├── dispatch.py              # Stage dispatch — 根据 Change 阶段触发 Agent 任务
├── parser.py                # 变更目录解析
├── router.py                # change_router
├── schema.py
└── tests/
```

### 3.4 workflow/（FSM + 审计）

```
workflow/
├── model.py                 # AuditLog
├── fsm.py                   # FSM 类 + ChangeFSM / TaskFSM 实例
├── spec_guardian.py         # Spec 自动校验逻辑
├── service.py               # 工作流服务
├── router.py
├── schema.py
└── tests/
```

### 3.5 auth/（认证 + RBAC）

```
auth/
├── model.py                 # User + Role + RolePermission + UserWorkspaceRole
├── rbac.py                  # has_permission / collect_permissions
├── permissions.py           # Permission(StrEnum) — 22 个权限枚举
├── service.py               # login / register / refresh / bootstrap_admin
├── router.py
├── schema.py
└── (无 tests/ — 通过集成测试覆盖)
```

### 3.6 git_identity/

```
git_identity/
├── model.py                 # GitIdentity
├── service.py               # CRUD + access check
├── providers/
│   ├── __init__.py
│   ├── base.py              # IdentityProvider ABC
│   └── github.py            # GitHub provider
└── tests/
```

### 3.7 tool_gateway/

```
tool_gateway/
├── model.py                 # ToolPolicy
├── tool_policy.py           # ToolPolicyService — 7 种工具策略检查
├── service.py               # 工具执行服务
├── router.py                # tool_gateway_router
├── policy_router.py         # policy_crud_router
├── schema.py
├── policy_schema.py
└── tests/
```

### 3.8 worktree/

```
worktree/
├── model.py                 # WorktreeLease
├── service.py               # acquire / release / extend / GC
├── exec_env.py              # ExecEnvBuilder — 环境构建
├── git_runner.py            # GitRunner — git 命令封装
├── router.py                # worktree_router + lease_router
├── schema.py
└── tests/
```

### 3.9 spec_workspace/

```
spec_workspace/
├── model.py                 # SpecWorkspace
├── service.py               # CRUD + 同步状态管理
├── validator.py             # Spec 校验逻辑
├── bootstrap.py             # 初始化引导
├── router.py
├── schema.py
└── tests/
```

### 3.10 spec_profile/

```
spec_profile/
├── model.py                 # SpecProfile
├── provider.py              # SpecProfileProvider — 配置文件读取
├── policy.py                # 策略规则
├── schema.py
└── tests/
```

## 4. core/ 文件职责

| 文件 | 职责 | 行数 |
|------|------|------|
| config.py | Settings(BaseSettings) — 数据库URL、Redis URL、JWT密钥、CORS等 | 118 |
| db.py | 异步 engine/session factory + audit_context 注入 + get_session 依赖 | 137 |
| auth_deps.py | get_current_user / get_optional_user / require_permission / require_platform_admin | 124 |
| errors.py | AppError 基类 + ~20 个领域异常 + register_exception_handlers | 308 |
| security.py | JWT 签发/验证 + bcrypt 哈希 + refresh token | 175 |
| redis.py | 全局 Redis 客户端懒初始化 | 35 |
| logging.py | structlog JSON 配置 | 46 |
| telemetry.py | OTEL bootstrap (V1 no-op) | 21 |
| crypto.py | CredentialCipher — PyNaCl xchacha20-poly1305 加解密 | 83 |
| audit_hooks.py | SQLAlchemy after_insert/update/delete 自动审计 | 297 |
