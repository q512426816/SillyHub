# SillyHub 目录结构文档

author: scan-agent
created_at: 2026-06-03T12:00:01

## 1. 顶层目录

```
sillyhub/
├── backend/              # Python FastAPI 后端（独立 pyproject.toml）
├── frontend/             # Next.js 前端（独立 package.json）
├── deploy/               # Docker Compose 配置
│   ├── docker-compose.dev.yml     # 开发环境（仅 Postgres + Redis）
│   └── docker-compose.yml         # 生产环境（全栈）
├── docs/                 # 项目文档
├── spikes/               # 技术探索 / 实验性代码
├── .sillyspec/           # SillySpec 规范空间（规范、变更、文档）
├── .github/              # GitHub CI/CD 配置
├── .claude/              # Claude Code 配置
├── .editorconfig          # 编辑器格式化配置
├── .gitignore
├── CLAUDE.md              # Claude Code 任务指令
├── Makefile               # 统一开发命令入口
└── README.md
```

## 2. 后端结构 (`backend/`)

```
backend/
├── pyproject.toml         # uv 项目配置 + 依赖声明 + 工具链配置
├── uv.lock               # uv 锁文件
├── alembic.ini            # Alembic 迁移配置
├── conftest.py           # pytest 全局 fixtures（内存 SQLite + httpx.AsyncClient）
├── .env                  # 环境变量（仅开发环境加载）
├── migrations/
│   ├── env.py            # Alembic 迁移环境
│   ├── script.py.mako    # 迁移模板
│   └── versions/         # 38 个增量迁移文件（按时间戳命名）
│       ├── 202605251400_create_health_probe.py
│       ├── 202605280900_create_auth_and_rbac.py
│       ├── 202605260900_create_workspaces.py
│       ├── 202605270900_create_components_and_relations.py
│       ├── 202605290900_create_scan_documents.py
│       ├── 202605300900_create_changes.py
│       ├── 202605310900_create_tasks.py
│       ├── 202606010900_create_git_identities.py
│       ├── 202606020900_create_worktree_leases.py
│       ├── 202606030900_create_git_operation_logs.py
│       ├── 202606040900_create_workflow.py
│       ├── 202606050900_create_agent_runs.py
│       └── ...           # 更多迁移
├── app/
│   ├── __init__.py       # 版本号定义
│   ├── main.py           # FastAPI 应用工厂 + 路由注册 + lifespan
│   ├── core/             # 横切基础设施层（12 个模块）
│   │   ├── config.py             # Pydantic Settings（数据库/Redis/JWT/CORS 等配置）
│   │   ├── db.py                 # Async SQLAlchemy engine + session factory + 审计上下文注入
│   │   ├── redis.py              # 进程级 Redis 异步客户端
│   │   ├── security.py           # JWT HS256 + bcrypt 密码哈希 + refresh token
│   │   ├── auth_deps.py          # FastAPI 认证/授权依赖注入
│   │   ├── errors.py             # 统一错误类 + 异常处理器注册
│   │   ├── audit_hooks.py        # SQLAlchemy 事件钩子自动审计
│   │   ├── logging.py            # structlog 结构化日志配置
│   │   ├── telemetry.py          # OpenTelemetry bootstrap（V1 stub）
│   │   ├── crypto.py             # NaCl 加密工具
│   │   ├── layout_migration.py   # 工作区布局迁移
│   │   └── spec_paths.py         # SillySpec 路径解析
│   ├── models/
│   │   └── base.py       # SQLModel 基类（共享 metadata）
│   └── modules/          # 21 个业务模块
│       ├── __init__.py
│       ├── workspace/             # 工作区管理
│       │   ├── model.py           # Workspace, WorkspaceRelation, Component 等 SQLModel
│       │   ├── router.py          # REST 路由
│       │   ├── service.py         # 业务逻辑
│       │   ├── schema.py          # Pydantic 请求/响应 schema
│       │   ├── parser.py          # YAML 解析器
│       │   ├── scanner.py         # 工作区扫描器
│       │   ├── topology.py        # 拓扑图构建
│       │   ├── relation_schema.py # 关系 schema
│       │   ├── relation_service.py# 关系业务逻辑
│       │   └── tests/             # 9 个测试文件
│       ├── change/                # 变更管理
│       │   ├── model.py           # Change, ChangeDocument, StageEnum + TRANSITIONS
│       │   ├── router.py          # REST + transition 路由
│       │   ├── service.py         # 变更生命周期
│       │   ├── dispatch.py        # 阶段自动调度引擎
│       │   ├── schema.py          # 请求/响应 schema
│       │   ├── parser.py          # 文档解析器
│       │   └── tests/
│       ├── task/                  # 任务管理
│       │   ├── model.py           # Task SQLModel
│       │   ├── router.py / service.py / schema.py / parser.py
│       │   └── tests/
│       ├── agent/                 # AI Agent 执行引擎
│       │   ├── base.py            # AgentAdapter 抽象基类 + AgentSpecBundle
│       │   ├── model.py           # AgentRun SQLModel
│       │   ├── router.py          # REST 路由
│       │   ├── service.py         # Agent 启动/终止/状态管理
│       │   ├── coordinator.py      # ExecutionCoordinator（幂等/乐观锁/checkpoint）
│       │   ├── coordinator_schema.py
│       │   ├── context_builder.py  # CLAUDE.md 构建器
│       │   ├── diff_collector.py   # 工作区 diff 收集
│       │   ├── adapters/
│       │   │   └── claude_code.py # Claude Code CLI 适配器（stream-json 协议）
│       │   └── tests/             # 7 个测试文件
│       ├── workflow/              # 工作流引擎
│       │   ├── model.py           # AuditLog, ChangeReview, FSM 状态
│       │   ├── fsm.py             # TaskFSM（已废弃 ChangeFSM）
│       │   ├── service.py         # 工作流服务
│       │   ├── spec_guardian.py   # 阶段转换前置校验
│       │   ├── router.py / schema.py
│       │   └── tests/
│       ├── worktree/              # Worktree 租约
│       │   ├── model.py / router.py / service.py / schema.py
│       │   ├── exec_env.py        # 执行环境管理
│       │   ├── git_runner.py      # Git 操作运行器
│       │   └── tests/
│       ├── auth/                  # 认证 + RBAC
│       │   ├── model.py           # User, Role, UserRole, RefreshToken
│       │   ├── router.py / service.py / schema.py
│       │   ├── permissions.py      # Permission StrEnum（25 个权限）
│       │   └── rbac.py            # 权限检查逻辑
│       ├── git_identity/          # Git 身份管理
│       │   ├── model.py / router.py / service.py / schema.py
│       │   └── providers/          # GitHub OAuth provider
│       ├── git_gateway/           # Git 操作网关
│       │   ├── model.py / router.py / service.py / schema.py
│       │   └── tests/
│       ├── tool_gateway/          # 工具执行网关
│       │   ├── model.py / router.py / service.py / schema.py
│       │   ├── policy_router.py / policy_schema.py / tool_policy.py
│       │   └── tests/
│       ├── scan_docs/             # Scan 文档管理
│       │   ├── model.py / router.py / service.py / schema.py / parser.py
│       │   └── tests/
│       ├── spec_workspace/         # Spec 工作区管理
│       │   ├── model.py / router.py / service.py / schema.py
│       │   ├── bootstrap.py / validator.py
│       │   └── tests/
│       ├── spec_profile/          # Spec 配置 profile
│       │   ├── model.py / schema.py / policy.py / provider.py
│       │   └── tests/
│       ├── release/               # 发布管理
│       ├── incident/              # 事件管理
│       ├── knowledge/             # 知识库
│       ├── change_writer/         # 变更文档写入器
│       ├── archive/               # 归档管理
│       ├── runtime/               # 运行时监控
│       ├── settings/              # 平台设置
│       └── health/               # 健康检查
```

## 3. 前端结构 (`frontend/`)

```
frontend/
├── package.json           # 依赖声明（pnpm）
├── pnpm-lock.yaml
├── next.config.mjs        # Next.js 配置（rewrites 代理 /api/*）
├── tsconfig.json
├── postcss.config.mjs      # PostCSS + Tailwind
├── Dockerfile              # 生产 Docker 镜像
├── .env.local              # 本地环境变量
└── src/
    ├── app/                        # Next.js App Router
    │   ├── layout.tsx              # 根布局（中文 lang）
    │   ├── page.tsx                # 首页
    │   ├── globals.css             # 全局样式（Tailwind）
    │   ├── (auth)/login/page.tsx  # 登录页
    │   ├── (dashboard)/            # 仪表盘路由组
    │   │   ├── layout.tsx          # Dashboard 布局
    │   │   └── workspaces/
    │   │       ├── page.tsx        # 工作区列表
    │   │       └── [id]/
    │   │           ├── page.tsx     # 工作区概览
    │   │           ├── components/page.tsx + topology/page.tsx
    │   │           ├── changes/[cid]/tasks/[tid]/page.tsx
    │   │           ├── agent/page.tsx
    │   │           ├── incidents/[iid]/page.tsx
    │   │           ├── releases/page.tsx
    │   │           ├── scan-docs/page.tsx
    │   │           ├── knowledge/page.tsx
    │   │           ├── audit/page.tsx
    │   │           ├── approvals/page.tsx
    │   │           ├── runtime/page.tsx
    │   │           └── create-change/page.tsx
    │   └── api/                     # Next.js Route Handlers（仅 SSE 代理）
    │       └── workspaces/[workspaceId]/agent/runs/[runId]/stream/route.ts
    ├── components/                  # UI 组件
    │   ├── ui/                      # 基础 UI 组件（badge, button, input）
    │   ├── app-shell.tsx            # 应用外壳
    │   ├── workspace-card.tsx       # 工作区卡片
    │   ├── component-detail-drawer.tsx
    │   ├── workspace-scan-dialog.tsx
    │   ├── health-card.tsx
    │   └── sillyspec-step-progress.tsx
    ├── lib/                         # API 客户端层（20+ 文件）
    │   ├── api.ts                   # 核心封装（token 注入 + 错误处理）
    │   ├── auth.ts / workspaces.ts / changes.ts / tasks.ts
    │   ├── agent.ts / agent-stream.ts
    │   ├── workflow.ts / releases.ts / incidents.ts
    │   ├── git-gateway.ts / git-identities.ts
    │   ├── tool-gateway.ts / scan-docs.ts / knowledge.ts
    │   ├── change-writer.ts / archive.ts / audit.ts
    │   ├── approvals.ts / runtime.ts / settings.ts
    │   ├── spec-workspaces.ts / components.ts / worktree.ts
    │   ├── health.ts / utils.ts
    │   └── __tests__/               # 前端单元测试
    │       ├── api.test.ts
    │       ├── agent.test.ts
    │       └── spec-workspaces.test.ts
    ├── stores/
    │   └── session.ts              # Zustand session store（localStorage 持久化）
    └── test/
        └── setup.ts                # Vitest 全局 setup
```

## 4. 部署结构 (`deploy/`)

```
deploy/
├── docker-compose.dev.yml   # 开发环境：PostgreSQL 16 + Redis 7（后端/前端本地运行）
└── docker-compose.yml       # 生产环境：全栈容器化部署
    ├── postgres             # PostgreSQL 16 Alpine
    ├── redis                # Redis 7 Alpine（AOF 持久化）
    ├── backend              # FastAPI + Claude Code CLI + SillySpec CLI
    └── frontend             # Next.js standalone
```

## 5. 文件统计

| 分类 | 文件数 | 说明 |
|------|--------|------|
| 后端 Python 源码 | ~160 | 含 core/ + modules/ + models/ + main.py |
| 后端测试 | 182 | test_*.py |
| 后端迁移 | 38 | Alembic versions |
| 后端配置 | ~6 | pyproject.toml, alembic.ini, conftest.py 等 |
| 前端 TS/TSX | ~70 | 含 pages, components, lib |
| 前端测试 | 159 | *.test.ts（含 node_modules 里的） |
| 前端配置 | ~8 | package.json, next.config, tsconfig 等 |
| 部署配置 | 2 | docker-compose 文件 |
| 根目录配置 | ~8 | Makefile, CLAUDE.md, README 等 |
