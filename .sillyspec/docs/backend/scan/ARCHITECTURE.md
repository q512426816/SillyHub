---
author: qinyi
created_at: 2026-05-31T23:30:00
---

# SillyHub Backend — 架构总览

## 1. 技术栈

| 层级 | 技术选型 | 版本约束 | 用途 |
|------|----------|----------|------|
| Web 框架 | FastAPI | >=0.115 | ASGI 异步 Web 框架 |
| ASGI 服务器 | Uvicorn | >=0.30 | 生产级 HTTP 服务器 |
| ORM | SQLModel + SQLAlchemy[asyncio] | >=0.0.22 / >=2.0 | 类型安全的 ORM 层 |
| 数据库 | PostgreSQL (asyncpg) | >=0.29 | 主存储，ACID 事务 |
| 缓存/队列 | Redis (redis.asyncio) | >=5.0 | 进度流、租约锁、幂等键 |
| 数据校验 | Pydantic v2 | >=2.8 | Schema 定义与请求校验 |
| 配置管理 | pydantic-settings | >=2.4 | 环境变量注入 |
| 认证 | python-jose (HS256 JWT) | >=3.3 | Access Token 签发/验证 |
| 密码哈希 | bcrypt (native) | — | 密码存储（cost=12） |
| 凭证加密 | PyNaCl (xchacha20-poly1305) | >=1.5 | 对称加密 Git 凭证 |
| HTTP 客户端 | httpx | >=0.27 | 异步外部请求 |
| 日志 | structlog | >=24.4 | JSON 结构化日志 |
| 遥测 | OpenTelemetry (stub) | — | V1 no-op，V2 接入 |
| 迁移 | Alembic | >=1.13 | 31 个版本迁移 |
| 数据解析 | python-frontmatter | >=1.1 | YAML frontmatter 解析 |
| 构建系统 | Hatchling | — | PEP 621 wheel 打包 |
| Lint | Ruff | >=0.6 | E/F/I/B/UP/N/SIM/RUF/BLE |
| 类型检查 | mypy | >=1.11 | 静态类型检查 |
| 测试 | pytest + pytest-asyncio | >=8 / >=0.23 | 异步测试框架 |

## 2. 架构概览

SillyHub Backend 采用**异步 FastAPI 单体 + 模块化 feature-slice** 架构。

核心设计理念：

- **横切关注点集中**：`app/core/` 统一管理配置、数据库连接、认证依赖、错误处理、日志、遥测、凭证加密、审计钩子
- **模块自治**：21 个功能模块各自封装 model/router/service/schema，通过 `main.py` 扁平注册到 FastAPI
- **权限显式声明**：无全局中间件注入身份，每个受保护路由通过 `Depends()` 显式声明所需权限
- **变更驱动**：10 阶段 Change 工作流引擎是系统的核心状态机，驱动 Task 创建、Agent 调度、代码变更、审核归档全流程
- **Agent fire-and-forget**：Claude Code 以子进程方式运行，三层 session 隔离（进程级、租约级、用户级），结果通过 Redis 流推送

## 3. 核心模块关系图

```
                         ┌──────────────┐
                         │   main.py    │
                         │  (FastAPI)   │
                         └──────┬───────┘
                                │
                    ┌───────────┴───────────┐
                    │      app/core/        │
                    │ ┌─────┐ ┌────┐ ┌───┐ │
                    │ │conf │ │ db │ │err│ │
                    │ │auth │ │red │ │log│ │
                    │ │secu │ │cry │ │aud│ │
                    │ └─────┘ └────┘ └───┘ │
                    └───────────┬───────────┘
                                │
        ┌──────────┬────────────┼────────────┬──────────┐
        ▼          ▼            ▼            ▼          ▼
   ┌────────┐ ┌────────┐ ┌──────────┐ ┌──────────┐ ┌────────┐
   │ auth   │ │workspace│ │  change   │ │  agent   │ │workflow│
   │ rbac   │ │scanner │ │ dispatch  │ │coordinator│ │  fsm   │
   │ perms  │ │parser  │ │ 10-stage  │ │adapter   │ │ spec_  │
   └────────┘ │relation│ └────┬──┬───┘ │context   │ │guardian│
              │topology│      │  │     │diff_coll │ └────┬───┘
              └────────┘      ▼  ▼     └────┬─────┘      │
                         ┌────────┐       │              │
                         │  task  │◄──────┘              │
                         │ parser │◄─────────────────────┘
                         └───┬────┘
                             │
              ┌──────────────┼──────────────┐
              ▼              ▼              ▼
        ┌──────────┐ ┌───────────┐ ┌────────────┐
        │ worktree │ │git_gateway│ │git_identity│
        │ lease    │ │ whitelist │ │ credential │
        │ exec_env │ │ subprocess│ │ encryption │
        └──────────┘ └───────────┘ └────────────┘
              │
              ▼
        ┌──────────┐  ┌──────────┐  ┌──────────┐
        │  tool_   │  │ release  │  │ incident │
        │ gateway  │  │ approve  │  │postmortem│
        │ policy   │  │ deploy   │  │          │
        └──────────┘  └──────────┘  └──────────┘

   辅助模块（无 DB 依赖）:
        health · knowledge · scan_docs · runtime
        settings · archive · change_writer · spec_workspace
```

## 4. 数据流

### 4.1 请求生命周期

```
HTTP Request
    → CORS Middleware
    → Request-ID Middleware (x-request-id)
    → Router (prefix=/api)
        → Depends(get_session)  # 注入 DB session + audit_context
        → Depends(get_current_user) / Depends(require_permission)  # 可选
    → Service Layer
        → 业务逻辑 + AppError
    → Response (JSON envelope: {code, message, request_id, details})
```

### 4.2 Agent 执行数据流

```
POST /api/agent/runs
    → AgentService.start_run()
        → 创建 AgentRun (pending)
        → WorktreeService.acquire() → 获取 WorktreeLease
        → AgentService._execute_run_background()
            → ContextBuilder → 构建 AgentSpecBundle (CLAUDE.md + spec docs)
            → ClaudeCodeAdapter.execute()
                → 启动 claude CLI 子进程 (stream-json)
                → Redis pub/sub 推送进度
                → 收集 stdout/stderr → AgentRunLog
            → DiffCollector → 收集文件变更
    → 返回 AgentRun (running)
```

### 4.3 Change 工作流数据流

```
draft → clarifying → design_review → ready_for_dev
    → in_dev → technical_verification → business_review
        → accepted → archived
        ↘ rework_required → clarifying / design_review / in_dev
```

每个阶段有明确的角色触发权限（business_user, agent, reviewer, system），状态机在 `ChangeFSM` 中强制校验。

### 4.4 审计数据流

```
Router → Depends(get_session)
    → session.info["audit_context"] = {actor_id, workspace_id}
    → Service → session.commit()
        → SQLAlchemy after_insert/update/delete hooks
            → _write_audit_log() → audit_logs 表
```

审计钩子通过 `app/core/audit_hooks.py` 中的 SQLAlchemy Mapper event 实现，自动捕获所有 `BaseModel(table=True)` 的变更。

## 5. 关键设计决策

1. **单进程 + 异步 I/O**：避免多进程复杂性，通过 async/await 实现高并发
2. **无全局认证中间件**：路由级 `Depends()` 声明，health 等公开端点无需认证
3. **Platform Admin 超级角色**：`is_platform_admin` 在 RBAC 检查时直接 bypass，简化 V1
4. **双层 FSM**：Change 有 10 阶段业务状态机，Task 有 7 阶段执行状态机，分别独立管理
5. **Git 凭证加密存储**：PyNaCl xchacha20-poly1305 对称加密，密钥版本化支持轮换
6. **Redis 流式进度**：Agent 执行进度通过 Redis pub/sub 实时推送，前端通过 SSE 订阅
