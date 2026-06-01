---
author: qinyi
created_at: 2026-05-31T23:30:00
---

# 架构总览

> 最后更新：2026-05-31
> 范围：SillyHub monorepo 顶层架构视角

## 1. 系统全景

SillyHub 是一个面向多人、多项目、多 Agent 场景的全生命周期执行管理系统。系统以 SillySpec 规范为内核，将变更管理、工作空间隔离、Agent 调度、Git 操作审计等产品化为 Web 平台。

架构层次从上到下：

```text
┌─────────────────────────────────────────────────────┐
│                    用户层                            │
│  Web UI (Next.js)  ←→  REST API (FastAPI)           │
├─────────────────────────────────────────────────────┤
│                  业务服务层                           │
│  变更管理 · 工作空间 · 工作树 · Agent · 认证 · RBAC  │
├──────────────────┬──────────────────────────────────┤
│  SillySpec 引擎  │        数据层                    │
│  变更工作流 FSM   │  PostgreSQL (pgvector/RLS)       │
│  10 阶段调度     │  Redis (缓存/会话/消息)           │
├──────────────────┴──────────────────────────────────┤
│               基础设施层                             │
│  Git Gateway · Worktree · Claude Code Adapter        │
│  Docker Compose · frp 隧道 · OpenTelemetry           │
└─────────────────────────────────────────────────────┘
```

## 2. Monorepo 结构

项目采用单仓库双子项目的经典 monorepo 组织：

- **backend/** — FastAPI 3.12 应用，vertical slice 模块化
- **frontend/** — Next.js 14 App Router SPA
- **deploy/** — Docker Compose 编排文件及环境模板
- **.sillyspec/** — SillySpec 工作区元数据（变更包、项目组、知识库）
- **.github/workflows/** — 独立的 backend-ci / frontend-ci 流水线

两个子项目各自拥有独立的包管理器（uv / pnpm）、CI 流水线和 lint 配置，但共享同一 Git 仓库和 SillySpec 变更管理体系。

## 3. 子项目关系

```text
frontend ──── HTTP REST ────→ backend
  │                            │
  │  NEXT_PUBLIC_API_BASE_URL  │  CORS 白名单
  │                            │
  └────────────────────────────┘
         共享 PostgreSQL + Redis
```

- **frontend** 通过 `NEXT_PUBLIC_API_BASE_URL` 连接 backend，所有 API 调用经 `src/lib/api.ts` 统一封装
- **backend** 在 CORS 层面白名单允许前端 origin
- Docker 部署时，frontend 通过 Docker 内部网络 `http://backend:8000` 访问后端
- 容器启动顺序：PostgreSQL → Redis → backend（等待健康检查通过）→ frontend

## 4. 核心数据流

### 4.1 变更生命周期

```text
用户 → frontend → POST /workspaces/{id}/changes/create
  → ChangeWriterService → 创建 .sillyspec/changes/change/<key>/
  → DB 写入 Change + ChangeDocument
  → 返回变更包信息

用户 → frontend → POST /changes/{id}/documents/generate
  → markdown_builder 模板生成
  → 文件系统写入 + DB upsert

Agent → Claude Code → worktree 隔离环境
  → GitGatewayService (白名单审计)
  → git add/commit/push
  → change_writer.create_pull_request()
  → GitHub REST API
```

### 4.2 Agent 调度流

```text
用户发起变更阶段推进 → workflow FSM 状态转换
  → AgentDispatchService 选择 Agent (Claude Code)
  → 创建 AgentRun 记录
  → Claude Code subprocess 执行（worktree 隔离）
  → 实时日志流回前端 (SSE)
  → 结果回写 DB → 状态推进
```

### 4.3 SillySpec 工作流引擎

变更管理通过有限状态机（FSM）驱动 10 个阶段：

1. propose → 2. clarify → 3. brainstorm → 4. plan → 5. review
6. execute → 7. verify → 8. approve → 9. archive → 10. close

每个阶段可触发 Agent 自动派发，也可人工推进。`workflow` 模块中的 `SpecGuardian` 保证 SillySpec 文档完整性。

## 5. 部署架构

### 5.1 本地开发

```text
宿主机
├─ docker compose dev (PostgreSQL 16 + Redis 7)
├─ uvicorn --reload :8000 (backend)
└─ pnpm dev :3000 (frontend)
```

### 5.2 生产容器化

```text
docker compose (deploy/docker-compose.yml)
├─ postgres:16-alpine    (持久卷 pgdata)
├─ redis:7-alpine        (持久卷 redisdata)
├─ backend               (alembic migrate + uvicorn :8000)
│  ├─ /host-projects     (挂载宿主机项目目录供扫描)
│  ├─ /data/sillyspec-worktrees
│  └─ /data/spec-workspaces
└─ frontend              (Next.js :3000)
```

### 5.3 外部暴露

- 前端通过 frp 隧道暴露到公网
- 后端 API 可选暴露（当前主要供前端内部调用）
- Claude Code 通过自定义 `ANTHROPIC_BASE_URL` 代理（智谱 API）访问大模型

## 6. 关键架构决策

| 决策 | 理由 |
|------|------|
| Vertical slice 模块化 | 每个业务功能独立目录，职责清晰 |
| subprocess 而非 SDK 调用 Claude Code | 避免重依赖，更贴近 CLI 交互模式 |
| 白名单 Git 操作 | 安全默认，只允许已知安全命令 |
| worktree 隔离 | 多用户共享服务器时确保 Git 身份和文件隔离 |
| SQLModel (ORM) | 兼顾 SQLModel 的 Pydantic 校验和 SQLAlchemy 能力 |
| Alembic 迁移前置 | 容器启动时自动 upgrade head，避免版本不一致 |
| Redis AOF 持久化 | 重启后缓存数据不丢失 |

## 7. 模块依赖图（简化）

```text
workspace ← change ← workflow ← agent
    ↓          ↓
  worktree  change_writer → git_gateway
    ↓                          ↓
git_identity              git_identity
                              ↓
                         credential cipher
```

核心模块约 20 个垂直切片，详见 `.sillyspec/docs/backend/modules/`。
