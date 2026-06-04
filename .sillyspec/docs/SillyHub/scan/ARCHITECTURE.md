# SillyHub 架构文档

author: scan-agent
created_at: 2026-06-03T12:00:00

## 1. 总体架构

SillyHub 采用经典的前后端分离架构：

- **后端**：Python FastAPI 应用，提供 RESTful JSON API，监听 8000 端口
- **前端**：Next.js 14 (App Router) SPA + SSR，监听 3000 端口
- **通信**：前端通过 Next.js rewrites 代理 `/api/*` 请求到后端；SSE 用于 Agent 运行时实时日志流

```
┌─────────────┐     /api/* 代理      ┌──────────────────────────┐
│   Next.js    │ ──────────────────→ │      FastAPI (uvicorn)    │
│   前端 :3000  │                      │          后端 :8000       │
└─────────────┘                      └───────┬──────────────────┘
                                              │
                                    ┌─────────┴─────────┐
                                    │                   │
                              ┌─────▼─────┐     ┌─────▼─────┐
                              │ PostgreSQL │     │   Redis    │
                              │   :5432    │     │   :6379    │
                              └───────────┘     └───────────┘
```

## 2. 后端架构

### 2.1 分层结构

后端采用 **模块化单体（Modular Monolith）** 模式，每个业务域封装为独立模块：

```
app/
├── main.py              # 应用入口 + 路由注册 + lifespan
├── core/                # 横切关注点（配置、DB、安全、错误处理）
│   ├── config.py        # Pydantic Settings（环境变量驱动）
│   ├── db.py            # Async SQLAlchemy engine + session factory
│   ├── redis.py         # 进程级 Redis 单例
│   ├── security.py      # JWT + bcrypt 密码哈希
│   ├── auth_deps.py     # FastAPI 依赖注入（get_current_user / require_permission）
│   ├── errors.py        # 统一错误信封 + 异常处理器
│   ├── audit_hooks.py   # SQLAlchemy 事件钩子自动审计日志
│   └── telemetry.py     # OpenTelemetry bootstrap（V1 no-op）
├── models/
│   └── base.py          # SQLModel 基类（共享 metadata）
└── modules/             # 21 个业务模块
    ├── agent/           # AI Agent 执行引擎
    ├── workspace/       # 工作区 + 组件管理
    ├── change/          # 变更管理 + 阶段状态机
    ├── task/            # 任务管理
    ├── workflow/        # 工作流 FSM + 审计 + Spec Guardian
    ├── worktree/        # Worktree 租约管理
    ├── auth/            # 认证 + RBAC
    └── ...              # 其余 15 个模块
```

### 2.2 核心数据流

**Agent 执行流程**（最核心的业务流程）：

```
用户触发变更 → ChangeService.transition_with_dispatch()
  → SillySpecStageDispatchService.dispatch_next_step()
    → AgentService.start_stage_dispatch()
      → WorktreeService.acquire_lease()（如需 worktree）
      → ContextBuilder 构建 AgentSpecBundle
      → ClaudeCodeAdapter.run_with_bundle()（子进程执行 Claude Code CLI）
        → Redis Pub/Sub 实时推送日志到前端
      → ExecutionCoordinatorService.save_checkpoint()
      → sync_stage_status() → auto_dispatch_next_step()（自动链式调度）
```

### 2.3 模块关系图

```
workspace ◄──────┐
    │            │ (WorkspaceRelation)
    ├── components    │
    ├── relations    │
    └── topology     │
                   │
change ──► task ──► agent ◄── worktree
  │                                    │
  ├── dispatch (stage agent)           ├── claude_code adapter
  ├── documents                       ├── context_builder
  └── stage FSM                       └── coordinator
        │
workflow ──► audit_hooks (SQLAlchemy events)
        ──► spec_guardian (transition validation)

auth ──► rbac ──► permissions (StrEnum)
                 ──► auth_deps (FastAPI Depends)

git_identity ──► providers/github (OAuth)
tool_gateway ──► tool_policy (工具白名单)
release ◄─── change
incident ◄─── agent
knowledge ◄─── workspace
scan_docs ◄─── workspace
spec_workspace ◄─── workspace
spec_profile ──► policy/provider
settings ◀── platform config
archive ◀── change lifecycle end
runtime ◀── workspace monitoring
health ◀── heartbeat
```

## 3. 前端架构

### 3.1 技术选型

- **框架**：Next.js 14 (App Router)，支持 SSR + Client Components
- **状态管理**：Zustand（持久化 session store）+ React Query（服务端数据缓存）
- **UI**：Tailwind CSS + Radix 风格的组件（button, badge, input）
- **可视化**：@xyflow/react（组件拓扑图）
- **Markdown**：@uiw/react-markdown-preview

### 3.2 路由结构

```
src/app/
├── (auth)/login/                # 登录页
├── (dashboard)/                 # 需要认证的仪表盘路由组
│   ├── layout.tsx                # Dashboard 布局
│   ├── workspaces/               # 工作区列表
│   │   └── [id]/                 # 工作区详情
│   │       ├── page.tsx          # 概览
│   │       ├── components/       # 组件管理 + 拓扑图
│   │       ├── changes/          # 变更管理
│   │       │   └── [cid]/tasks/  # 任务列表 + 详情
│   │       ├── agent/            # Agent 运行管理
│   │       ├── incidents/        # 事件管理
│   │       ├── releases/         # 发布管理
│   │       ├── scan-docs/        # Scan 文档查看
│   │       ├── knowledge/        # 知识库
│   │       ├── audit/            # 审计日志
│   │       ├── approvals/        # 审批
│   │       └── runtime/          # 运行时监控
│   └── settings/                 # 平台设置
└── api/                          # Next.js API Routes（仅 SSE 代理）
    └── workspaces/[workspaceId]/agent/runs/[runId]/stream/
```

### 3.3 前端数据层

每个后端模块对应一个 `src/lib/*.ts` API 客户端文件，统一通过 `apiFetch()` 调用后端：

```
src/lib/
├── api.ts              # 核心 fetch wrapper（token 注入、错误处理、自动刷新）
├── auth.ts / workspaces.ts / changes.ts / tasks.ts / ...
├── agent.ts / agent-stream.ts   # Agent SSE 实时日志
├── workflow.ts
└── utils.ts
```

## 4. 关键设计决策

### 4.1 模块化单体 vs 微服务
采用模块化单体模式：所有模块在同一进程内运行，通过 Python import 直接调用，降低了分布式系统的复杂性。模块边界通过清晰的目录结构和依赖方向（core ← modules，模块间禁止循环依赖）来维护。

### 4.2 SQLModel + Async SQLAlchemy
使用 SQLModel 作为 ORM 层，统一 Pydantic schema 和 SQL 表定义。数据库访问全部通过 `AsyncSession` 进行异步操作。

### 4.3 Agent 子进程模型
Claude Code 作为子进程执行（非 in-process），通过 stream-json 协议捕获完整对话日志，通过 Redis Pub/Sub 实时推送给前端。这种设计隔离了 Agent 运行时的稳定性问题。

### 4.4 统一错误信封
所有 API 错误返回统一的 JSON 结构 `{code, message, request_id, details}`，前端 `ApiError` 类直接映射。

### 4.5 自动审计
通过 SQLAlchemy `after_insert/update/delete` 事件钩子自动记录所有模型变更到 `audit_logs` 表，无需业务代码显式写入。
