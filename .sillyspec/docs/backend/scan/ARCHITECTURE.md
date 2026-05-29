---
author: qinyi
created_at: 2026-05-29T17:36:30
---

# ARCHITECTURE — backend

## 技术栈

| 层 | 技术 | 版本 |
|----|------|------|
| 语言 | Python | 3.12+ |
| 框架 | FastAPI (async) | 0.115+ |
| ORM | SQLModel + SQLAlchemy 2.0 (async) | 0.0.22+ |
| 数据库 | PostgreSQL (asyncpg) | 16 |
| 缓存 | Redis | 5.0+ |
| 迁移 | Alembic | 1.13+ |
| 认证 | JWT (python-jose) + bcrypt (passlib) + NaCl | — |
| 配置 | pydantic-settings | 2.4+ |
| 日志 | structlog | 24.4+ |
| 遥测 | OpenTelemetry | — |
| 测试 | pytest + pytest-asyncio + aiosqlite | 8+ |
| Lint | Ruff + mypy | — |
| 构建 | Docker 多阶段 (uv) | — |

## 架构概览

**模块化 feature-slice 架构**：

```
backend/app/
  core/          横切关注点（config, db, auth, logging, redis, telemetry, errors）
  models/        共享基类（BaseModel）
  modules/       功能模块，每个自包含
    <feature>/
      model.py   ORM 表定义
      router.py  API 端点
      service.py 业务逻辑
      schemas.py 请求/响应 Pydantic schemas
```

### 关键模式

- **应用工厂**: `create_app()` + lifespan handler 管理启动/关闭
- **延迟单例**: engine、session factory、settings 通过 `@lru_cache`
- **依赖注入**: FastAPI `Depends`（DB session、当前用户、权限检查）
- **RBAC**: workspace 级别的角色和权限

### 中间件

| 中间件 | 用途 |
|--------|------|
| `CORSMiddleware` | CORS 配置，允许 credentials，暴露 x-request-id |
| `request_id_middleware` | 读取或生成 UUID，附加到 request.state 和 response header |

### 依赖注入链

| 依赖 | 用途 |
|------|------|
| `get_session` | 异步 AsyncSession，异常时自动回滚 |
| `get_settings` | 缓存的 Settings 单例 |
| `get_current_user` | 验证 JWT，返回 User 模型 |
| `require_permission(Permission.X)` | RBAC 权限检查 |

## 数据模型（摘要）

24+ 张表，23 个 Alembic 迁移文件（20260525-20260613）。

| 模块 | 表名 | 字段数 |
|------|------|--------|
| auth | `users` | ~10 |
| auth | `sessions` | ~6 |
| auth | `roles` | ~4 |
| auth | `role_permissions` | ~3 |
| auth | `user_workspace_roles` | ~4 |
| workspace | `workspaces` | ~8 |
| workspace | `workspace_relations` | ~5 |
| workspace | `change_workspaces` | ~3 |
| workspace | `task_workspaces` | ~3 |
| workspace | `agent_run_workspaces` | ~3 |
| change | `changes` | ~10 |
| change | `change_documents` | ~5 |
| task | `tasks` | ~12 |
| agent | `agent_runs` | ~14 |
| agent | `agent_run_logs` | ~7 |
| workflow | `change_reviews` | ~8 |
| workflow | `audit_logs` | ~7 |
| release | `releases` | ~10 |
| release | `release_approvals` | ~6 |
| incident | `incidents` | ~10 |
| incident | `postmortems` | ~7 |
| scan_docs | `scan_documents` | ~8 |
| git_identity | `git_identities` | ~8 |
| git_gateway | `git_operation_logs` | ~8 |
| tool_gateway | `tool_operation_logs` | ~8 |
| worktree | `worktree_leases` | ~10 |
| settings | `platform_settings` | ~5 |
| spec_profile | `spec_profile_manifests` | ~6 |
| spec_profile | `spec_conflicts` | ~6 |
| spec_workspace | `spec_workspaces` | ~6 |

## API 路由模块（19 个模块，`/api` 前缀）

| 模块 | 说明 |
|------|------|
| health | 健康检查 |
| auth | 登录、注册、token 刷新 |
| workspace | Workspace CRUD + 关系 |
| change | 变更管理 |
| change_writer | 变更写入 |
| scan_docs | 文档扫描 |
| task | 任务管理 |
| git_identity | Git 身份管理 |
| git_gateway | Git 操作网关 |
| agent | Agent 运行管理 |
| worktree / lease | Worktree CRUD + 租约 |
| release | 发布管理 |
| incident | 事件追踪 |
| archive | 归档操作 |
| settings | 平台设置 |
| spec_workspace | Spec workspace 管理 |
| spec_profile | Spec profile 管理 |
| tool_gateway | 工具操作网关 |
| workflow | 工作流/审批 |
| runtime | 运行时操作 |
| knowledge | 知识库 |
