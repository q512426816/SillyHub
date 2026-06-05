---
author: qinyi
created_at: 2026-06-03T20:35:00+08:00
---

# Backend -- 项目概述

## 项目信息

- **名称**: multi-agent-platform-api (SillyHub Backend)
- **描述**: AI 驱动的多 Agent 协作平台后端 API
- **版本**: 0.1.0
- **Python**: >=3.12
- **状态**: 开发中，未正式上线

## 项目目标

为 SillyHub 多 Agent 协作平台提供 RESTful API 后端。核心能力：

1. **Workspace 管理** -- 注册、扫描、解析 SillySpec 项目工作区，支持父子工作区关系和拓扑图
2. **Change 工作流** -- 管理变更全生命周期（draft -> propose -> plan -> execute -> verify -> accepted），含状态机、Agent 自动调度
3. **Task 管理** -- 变更内的任务看板（draft / ready / in_progress / review / done），支持 M:N 工作区关联
4. **Agent 调度** -- 通过 Claude Code CLI 适配器执行 Agent 任务，支持 SSE 实时日志流、幂等性、乐观锁、断点续跑
5. **RBAC 权限** -- 基于角色的细粒度权限控制（platform / workspace / change / task / code / deploy / tool 七大域）
6. **Git 集成** -- Worktree 租约隔离、Git 操作网关（白名单 + 输出脱敏）、Git 身份管理（GitHub OAuth）
7. **DevOps 工具链** -- Release 管理（多审批人 + 部署窗口）、Incident 追踪、变更归档 + 知识蒸馏

## 技术栈

| 分类 | 技术 | 版本 |
|------|------|------|
| 语言 | Python | >=3.12 |
| Web 框架 | FastAPI + Uvicorn | >=0.115 / >=0.30 |
| ORM | SQLModel + SQLAlchemy (async) | >=0.0.22 / >=2.0 |
| 数据库 | PostgreSQL (asyncpg) | >=0.29 |
| 缓存 | Redis (async) | >=5.0 |
| 迁移 | Alembic | >=1.13 |
| 数据验证 | Pydantic + pydantic-settings | >=2.8 / >=2.4 |
| 认证 | python-jose + bcrypt | >=3.3 |
| 加密 | PyNaCl | >=1.5 |
| 日志 | structlog | >=24.4 |
| HTTP 客户端 | httpx | >=0.27 |
| 文档解析 | python-frontmatter | >=1.1 |
| 包管理 | uv + hatchling | - |
| Lint / Format | Ruff | >=0.6 |
| 类型检查 | mypy | >=1.11 |
| 测试 | pytest + pytest-asyncio + pytest-cov + aiosqlite | >=8 |
| 部署 | Docker (多阶段构建) | - |
| Agent CLI | Claude Code CLI | 2.1.158 |
| Spec CLI | SillySpec CLI | 3.16.2 |

## API 路径前缀

所有端点挂载在 `/api` 下：

| 路径 | 模块 | 用途 |
|------|------|------|
| `/api/health` | health | 健康检查 |
| `/api/version` | health | 版本信息 |
| `/api/auth/*` | auth | 登录/刷新/登出/me |
| `/api/workspaces` | workspace | 工作区 CRUD |
| `/api/workspaces/{id}/changes` | change | 变更管理 |
| `/api/workspaces/{id}/tasks` | task | 任务管理 |
| `/api/workspaces/{id}/scan-docs` | scan_docs | 扫描文档 |
| `/api/workspaces/{id}/runtime` | runtime | 运行时状态 |
| `/api/workspaces/{id}/knowledge` | knowledge | 知识库 |
| `/api/agents/*` | agent | Agent 运行 |
| `/api/settings` / `/api/users` | settings | 平台配置 |
| `/api/releases` | release | 发布管理 |
| `/api/incidents` | incident | 事件管理 |
| `/api/archive` | archive | 变更归档 |

## 关键指标

| 指标 | 数值 |
|------|------|
| Python 源文件（不含 .venv） | 约 200+ |
| 业务模块 | 21 |
| 数据表 | 约 30+ |
| API Router | 22 |
| 数据库迁移 | 33 个版本文件 |
