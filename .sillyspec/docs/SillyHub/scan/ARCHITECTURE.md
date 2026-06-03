---
author: qinyi
created_at: 2026-06-03T20:35:00+08:00
---

# ARCHITECTURE.md — SillyHub 整体架构

## Monorepo 结构

SillyHub 采用 monorepo 结构，所有代码在一个 Git 仓库中管理：

```
multi-agent-platform/          ← monorepo 根目录
├── backend/                   ← FastAPI 后端（Python 3.12）
│   ├── app/                   ← 应用源码
│   │   ├── core/              ← 基础设施层（config, db, auth, errors, crypto, redis, spec_paths）
│   │   ├── models/            ← SQLModel 数据模型
│   │   └── modules/           ← 业务模块（23 个子模块）
│   ├── migrations/            ← Alembic 数据库迁移（32 个版本文件）
│   ├── tests/                 ← 测试代码
│   ├── Dockerfile             ← 后端多阶段构建（node-tools → builder → runtime）
│   └── pyproject.toml         ← Python 项目配置
├── frontend/                  ← Next.js 前端（TypeScript）
│   ├── src/
│   │   ├── app/               ← Next.js App Router 页面（20+ 路由）
│   │   ├── components/        ← React 组件（app-shell, ui/ 基础组件）
│   │   ├── lib/               ← API 客户端（30+ 模块 API 封装）和工具函数
│   │   └── stores/            ← Zustand 状态管理
│   ├── Dockerfile             ← 前端多阶段构建（deps → builder → runtime）
│   └── package.json
├── deploy/                    ← Docker Compose 部署
│   ├── docker-compose.yml     ← 全栈部署（postgres + redis + backend + frontend）
│   ├── docker-compose.dev.yml ← 开发依赖（仅 postgres + redis）
│   └── .env.example           ← 环境变量模板
├── docs/                      ← 项目文档（设计分析、QA、参考资料）
├── spikes/                    ← 技术调研记录（3/3 PASS）
└── .sillyspec/                ← SillySpec 文档系统
```

## 前后端关系

### 通信方式

- 前端通过 **REST API** 调用后端（`/api/*` 路径前缀）
- 前端 Next.js 提供 **API 代理 rewrite**：将 `/api/:path*` 转发到后端服务
- Agent 运行支持 **SSE（Server-Sent Events）** 实时流式推送
- Docker 部署时前端通过 `INTERNAL_API_BASE_URL` 直接访问后端容器

### API 架构

后端 API 统一挂载在 `/api` 前缀下，由 `app/main.py` 中的 `create_app()` 注册所有路由。当前注册了 23 个路由模块：

| 路由模块 | 路径前缀 | 功能 |
|----------|----------|------|
| health | /api | 健康检查 |
| workspace | /api | 工作区管理 |
| auth | /api | 认证与 RBAC |
| change | /api | 变更管理 |
| scan_docs | /api | 扫描文档 |
| task | /api | 任务管理 |
| git_identity | /api | Git 身份管理 |
| agent | /api | Agent 运行 |
| worktree | /api | Worktree 管理 |
| lease | /api | Worktree 租约 |
| git_gateway | /api | Git 操作网关 |
| change_writer | /api | 变更写入 |
| workflow | /api | 工作流引擎 |
| incident | /api | 事件管理 |
| knowledge | /api | 知识库 |
| release | /api | 发布管理 |
| runtime | /api | 运行时管理 |
| tool_gateway | /api | 工具网关 |
| policy | /api | 工具策略 |
| archive | /api | 归档管理 |
| settings | /api | 平台设置 |
| spec_workspace | /api | SillySpec 工作区 |
| spec_profile | — | SillySpec 配置（内部使用） |

### 前端路由结构

```
/                           → 首页（工作区列表）
/login                      → 登录页
/workspaces                 → 工作区列表
/workspaces/[id]            → 工作区详情（含子页面）
  /agent                    → Agent 交互页（SSE 流式）
  /approvals                → 审批管理
  /audit                    → 审计日志
  /changes                  → 变更列表
    /[cid]                  → 变更详情
      /tasks                → 任务列表
        /[tid]              → 任务详情
  /components               → 组件管理
    /topology               → 组件拓扑图
  /create-change            → 创建变更
  /incidents                → 事件列表
    /[iid]                  → 事件详情
  /knowledge                → 知识库
  /releases                 → 发布列表
  /runtime                  → 运行时
  /scan-docs                → 扫描文档
/settings                   → 平台设置
/settings/git-identities    → Git 身份管理
/api/workspaces/[id]/agent/runs/[runId]/stream → SSE 流式代理 Route Handler
```

## 部署架构

### 生产部署（docker-compose.yml）

```
                    ┌─────────────────────────────────┐
                    │        Docker Compose 网络        │
                    │                                   │
  用户浏览器 ──────→│  frontend (Next.js, port 3000)    │
                    │    │ rewrite /api/*               │
                    │    ↓                               │
                    │  backend (FastAPI, port 8000)      │
                    │    │             │                 │
                    │    ↓             ↓                 │
                    │  postgres:16   redis:7             │
                    │  (volume)      (volume)            │
                    │                                   │
                    │  挂载卷：                          │
                    │  - /host-projects → 宿主项目目录     │
                    │  - worktree-data → Agent 工作树     │
                    │  - spec-data → SillySpec 数据      │
                    │  - claude-data → Claude 配置       │
                    └─────────────────────────────────┘
```

### 开发模式（docker-compose.dev.yml）

仅启动 PostgreSQL 和 Redis 作为开发依赖，前端和后端在宿主机上直接运行（uvicorn --reload / next dev），加快迭代速度。

### 后端容器特性

- 多阶段构建：node-tools（Claude Code + SillySpec CLI）→ builder（uv 依赖安装）→ runtime（slim 镜像）
- 内嵌 Claude Code CLI 和 SillySpec CLI（通过 npm 全局安装）
- 非 root 用户运行（app 用户）
- 启动时自动执行 `alembic upgrade head` 数据库迁移
- 挂载宿主项目目录以读取 .sillyspec 树
- 支持 OTLP 遥测导出
- 健康检查：`curl -fsS http://127.0.0.1:8000/api/health`
- 路径重写：`HOST_PATH_PREFIX` / `CONTAINER_PATH_PREFIX` 环境变量

### 前端容器特性

- 多阶段构建：deps（pnpm install）→ builder（next build standalone）→ runtime（最小镜像）
- Next.js standalone 输出模式
- 非 root 用户运行（nextjs 用户）
- 健康检查：`wget -qO- http://127.0.0.1:3000`

## 后端模块架构

后端采用模块化设计，每个业务模块位于 `app/modules/` 下，结构统一：

```
app/modules/<module>/
├── router.py      ← FastAPI 路由定义
├── service.py     ← 业务逻辑
├── models.py      ← SQLModel 数据模型（部分模块）
└── schemas.py     ← Pydantic 请求/响应模型（部分模块）
```

核心基础设施层 `app/core/` 提供：

| 模块 | 职责 |
|------|------|
| config | pydantic-settings 配置管理（环境变量、SECRET_KEY、CORS 等） |
| db | 数据库连接池、会话工厂（asyncpg + SQLModel） |
| auth_deps | 认证依赖注入（JWT + RBAC 角色） |
| security | 密码哈希、JWT 令牌生成/验证 |
| crypto | 敏感数据加密/解密（NaCl secretbox） |
| errors | 统一异常体系（AppError 基类 + HTTP 异常映射） |
| redis | Redis 连接管理 |
| logging | structlog 日志配置 |
| telemetry | OpenTelemetry 初始化 |
| spec_paths | SillySpec 路径解析和布局迁移 |
| audit_hooks | 审计钩子 |
| layout_migration | 布局迁移工具 |

## 应用生命周期

```
应用启动 (lifespan)
  → configure_logging
  → init_telemetry
  → bootstrap_admin_and_seed_rbac（首次启动创建管理员 + RBAC 角色）
  → yield（服务运行中）
  → dispose_engine（关闭数据库连接池）
  → close_redis（关闭 Redis 连接）
```

## 数据库迁移

使用 Alembic 管理，当前有 32 个迁移版本文件，涵盖以下数据表：

- health_probe（健康探针）
- workspaces + components + relations（工作区、组件、关系拓扑）
- auth + rbac（用户、角色、权限）
- changes + tasks（变更、任务）
- git_identities + git_operation_logs（Git 身份、操作日志）
- agent_runs + worktree_leases（Agent 运行、工作树租约）
- scan_documents（扫描文档）
- workflow + releases + incidents（工作流、发布、事件）
- spec_workspaces + spec_profile（SillySpec 工作区、配置）
- tool_policies + tool_operation_logs（工具策略、操作日志）
- platform_settings（平台设置）

## 关键设计决策

1. **SillySpec 文档驱动**：所有功能变更必须先有文档（proposal + design + tasks），禁止先写代码再补文档
2. **主机项目挂载**：Docker 部署时通过卷挂载将宿主机项目目录映射到容器内，支持扫描 `.sillyspec` 目录
3. **Agent 集成**：通过 Claude Code CLI 作为 Agent 适配器（subprocess 模式），支持异步 AgentRun + SSE 流式输出
4. **路径重写**：容器内通过 `HOST_PATH_PREFIX` / `CONTAINER_PATH_PREFIX` 环境变量实现路径映射
5. **白名单安全**：Git 操作白名单审计 + Shell 注入防护 + 输出脱敏
6. **文件系统 + DB 双写**：SillySpec 文档以文件系统为主，DB 为查询加速
