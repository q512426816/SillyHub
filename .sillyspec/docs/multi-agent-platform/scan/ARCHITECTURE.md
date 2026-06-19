---
author: qinyi
created_at: 2026-06-10T17:00:00
---

# 技术架构 — multi-agent-platform

## 技术栈

| 层级 | 技术 | 版本 |
|------|------|------|
| 后端框架 | FastAPI + Uvicorn | FastAPI >=0.115 |
| ORM | SQLModel + SQLAlchemy (async) | SQLModel >=0.0.22, SQLAlchemy >=2.0 |
| 数据库 | PostgreSQL | 16-alpine |
| 缓存 | Redis | 7-alpine |
| 数据库迁移 | Alembic | >=1.13 |
| 前端框架 | Next.js (App Router) | 14.2.5 |
| UI | React + Tailwind CSS | React 18.3, Tailwind 3.4 |
| 状态管理 | Zustand (persist middleware) | >=4.5 |
| 数据请求 | @tanstack/react-query | >=5.51 |
| Daemon CLI | Click + httpx + websockets | Click >=8.0, httpx >=0.27 |
| 构建工具 | uv (Python), pnpm (Node) | uv 0.4.18, pnpm 9.6.0 |
| 容器编排 | Docker Compose | v2 |
| Agent 集成 | Claude Code + SillySpec | claude-code 2.1.158, sillyspec 3.18.3 |
| 语言 | Python 3.12, TypeScript 5.5 | Node >=20 |

## 架构概览

```
                        +-----------------+
                        |  用户浏览器      |
                        +--------+--------+
                                 |
                          Next.js (3000)
                          /api/* -> rewrites
                                 |
                    +------------+------------+
                    |                         |
              Frontend Container        Backend Container (8000)
              (standalone build)         +-- FastAPI REST API
                                         +-- Claude Code agent adapter
                                         +-- SillySpec CLI integration
                                         +-- Docker volumes for worktrees/specs
                    |                    |
                    +----+-------+-------+
                         |       |       |
                    PostgreSQL  Redis  Host Mounts
                    (5432)     (6379)  /host-projects

              +-- SillyHub Daemon (CLI) --+
              |  本地运行于用户机器         |
              |  连接 Backend WebSocket   |
              |  执行 AI Agent 任务       |
              +---------------------------+
```

### 后端架构

后端采用 **模块化分层架构**，入口 `app/main.py` 注册所有模块路由。

- **core/** — 基础设施层：配置 (Settings)、数据库连接、Redis、认证、加密、错误体系、审计钩子、日志
- **models/** — 基础模型定义 (BaseModel)，所有 SQLModel 表继承此基类
- **modules/** — 业务模块，每个模块包含：
  - `model.py` — SQLModel 表定义
  - `router.py` — FastAPI 路由端点
  - `service.py` — 业务逻辑服务类
  - `schema.py` — Pydantic 请求/响应 schema
  - `tests/` — 模块内单元测试

### 前端架构

前端使用 Next.js 14 App Router，目录结构遵循 Next.js 约定：

- `(auth)/` — 认证相关页面 (login)
- `(dashboard)/` — 仪表盘页面 (workspaces, settings, runtimes)
- `lib/` — API 客户端函数（每个后端模块对应一个 `lib/*.ts` 文件）
- `components/` — 共享 UI 组件 + shadcn/ui 基础组件
- `stores/` — Zustand 状态管理（session store）

### Daemon 架构

SillyHub Daemon 是一个独立的 Python CLI 工具：

- `__main__.py` — Click CLI 入口
- `daemon.py` — Daemon 核心生命周期管理
- `agent_detector.py` — 自动检测本地 AI Agent 运行时（支持 12 个 provider）
- `backends/` — 多种协议后端（json_rpc, jsonl, ndjson, stream_json, text）
- `task_runner.py` — 任务执行引擎
- `client.py` — 与 Backend 通信的 HTTP/WS 客户端
- `workspace.py` / `config.py` / `credential.py` — 配置与工作区管理

### 数据流

1. 用户通过前端页面操作（创建 workspace、发起 agent run、审批 change）
2. 前端通过 `/api/*` rewrite 代理到后端 REST API
3. 后端通过 Agent Adapter 调用 Claude Code CLI 执行任务
4. Daemon 在本地运行，通过 WebSocket 与 Backend 通信执行远程任务
5. 所有数据变更通过 Audit Hooks 自动记录到 AuditLog 表

## 数据库设计

共 33 个 SQLModel 表，涵盖：
- 认证与 RBAC：User, Session, Role, RolePermission, UserWorkspaceRole (5 表)
- 工作区：Workspace, WorkspaceRelation, ChangeWorkspace, TaskWorkspace, AgentRunWorkspace (5 表)
- Agent 运行：AgentRun, AgentRunLog (2 表)
- 变更管理：Change, ChangeDocument (2 表)
- 工作流：ChangeReview, AuditLog (2 表)
- Daemon：DaemonRuntime, DaemonTaskLease (2 表)
- 其他：GitIdentity, GitOperationLog, ToolOperationLog, WorktreeLease, Release, ReleaseApproval, Incident, Postmortem, ScanDocument, Task, SpecWorkspace, SpecProfileManifest, SpecConflict, PlatformSetting, ToolPolicy (14 表)
