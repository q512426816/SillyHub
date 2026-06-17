---
author: qinyi
created_at: 2026-06-10T17:00:03
---

# 外部集成 — multi-agent-platform

## 数据库与存储

### PostgreSQL 16
- **用途**: 主数据存储，所有业务表
- **连接方式**: asyncpg (异步驱动)，通过 `postgresql+asyncpg://` URL
- **连接池**: SQLAlchemy async engine，在 lifespan 中初始化/销毁
- **迁移管理**: Alembic，20 个迁移版本
- **Docker**: postgres:16-alpine，持久化到 pgdata volume

### Redis 7
- **用途**: 缓存、会话存储
- **连接方式**: `redis://` URL，通过 `core/redis.py` 管理
- **Docker**: redis:7-alpine，AOF 持久化，redisdata volume

### 文件系统
- **Host Mount**: 宿主机项目目录挂载到容器 `/host-projects`
- **Worktree Volume**: `worktree-data` -> `/data/sillyspec-workspaces`
- **Spec Volume**: `spec-data` -> `/data/spec-workspaces`
- **Claude Data**: `claude-data` -> `/app/.claude`

## AI Agent 集成

### Claude Code (Anthropic)
- **版本**: 2.1.158 (Docker 内安装)
- **用途**: 核心代码生成 Agent，通过 CLI 子进程调用
- **集成方式**: `backend/app/modules/agent/adapters/claude_code.py` (~37KB)
- **通信协议**: JSON-RPC over stdin/stdout (通过 Daemon backends)
- **认证**: ANTHROPIC_AUTH_TOKEN 环境变量
- **模型配置**: 支持配置 base URL、不同层级模型
- **API 代理**: 默认通过 `https://open.bigmodel.cn/api/anthropic` 代理

### SillySpec
- **版本**: 3.18.1 (Docker 内安装)
- **用途**: 文档驱动开发工具，管理变更工作流
- **集成方式**: CLI 调用 + spec 文件系统

### Daemon Agent Detector
- **用途**: 自动检测本地已安装的 AI Agent 运行时
- **支持的 Provider**: 12 个，包括 Claude Code、Cursor、Windsurf、Cline、Aider、Continue、Copilot 等
- **实现**: `sillyhub-daemon/sillyhub_daemon/agent_detector.py`

## 认证与安全

### JWT 认证
- **库**: python-jose (cryptography) + passlib (bcrypt)
- **流程**: 登录 -> access_token + refresh_token
- **加密**: PyNaCl (NaCl/libsodium)
- **前端存储**: Zustand persist -> localStorage

### Bootstrap Admin
- 环境变量配置初始管理员账户
- `PLATFORM_BOOTSTRAP_ADMIN_EMAIL/PASSWORD/DISPLAY_NAME`

### RBAC
- 角色 + 权限 + 工作区级别角色绑定
- User -> UserWorkspaceRole -> Role -> RolePermission

## 前端依赖

### UI 框架
- **Next.js 14**: App Router, standalone 输出, API rewrites
- **React 18**: 函数组件 + hooks
- **Tailwind CSS 3.4**: 原子化 CSS
- **shadcn/ui**: 组件库 (通过 components.json 配置)
- **Lucide React**: 图标库

### 数据管理
- **@tanstack/react-query 5**: 服务端状态管理
- **Zustand 4**: 客户端状态管理
- **Zod**: Schema 验证

### 可视化
- **@xyflow/react**: 流程图/拓扑图 (用于工作区组件拓扑)
- **@uiw/react-markdown-preview**: Markdown 渲染

## 通信协议

### REST API
- 后端暴露 RESTful API (FastAPI)
- 前端通过 Next.js rewrites 代理 `/api/*` -> `http://backend:8000/api/*`
- 内部通信: `INTERNAL_API_BASE_URL` (SSR/ISR)

### WebSocket
- Agent Run 日志流: `streamAgentRunLogs` (前端 SSE)
- Daemon <-> Backend: websockets 库

### Daemon 协议后端
- **JSON-RPC**: Claude Code 标准协议
- **JSONL**: JSON Lines 流式输出
- **NDJSON**: 换行分隔 JSON
- **Stream JSON**: 流式 JSON 输出
- **Text**: 纯文本输出

## DevOps

### Docker Compose
- 全栈: `deploy/docker-compose.yml` (4 services + 5 volumes)
- 开发: `deploy/docker-compose.dev.yml` (仅 postgres + redis)

### 监控
- OpenTelemetry: `OTEL_ENDPOINT` 配置
- 结构化日志: structlog
- 健康检查: `/api/health` 端点 + Docker HEALTHCHECK

### CI/CD Hooks
- Pre-commit: ruff-format + ruff-check
- Claude Code Hooks: `scan_write_guard.py` 阻止扫描期间的非法写入
