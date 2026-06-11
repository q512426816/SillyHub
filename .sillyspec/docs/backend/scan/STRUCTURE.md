---
author: qinyi
created_at: 2026-06-10T00:00:00
---

# Backend 目录结构

## 顶层目录

```
backend/
├── app/                    # 应用源码
│   ├── __init__.py         # 版本号 __version__
│   ├── main.py             # FastAPI 入口，create_app() + lifespan
│   ├── core/               # 基础设施层（配置、DB、Redis、日志、安全）
│   ├── models/             # SQLModel 基类
│   └── modules/            # 功能模块（垂直切片）
├── migrations/             # Alembic 数据库迁移
│   ├── env.py
│   ├── script.py.mako
│   └── versions/           # 38 个迁移文件（按日期命名）
├── tests/                  # 集成测试
│   ├── test_config.py
│   ├── test_health.py
│   └── modules/            # 按模块组织的集成测试
├── pyproject.toml          # 项目配置 + 工具配置
├── ruff.toml               # ruff 额外配置
├── Dockerfile              # 多阶段 Docker 构建
├── README.md
└── .venv/                  # 虚拟环境（gitignore）
```

## 核心层 (`app/core/`)

| 文件 | 说明 |
|------|------|
| `config.py` | pydantic-settings 配置单例，包含数据库/Redis/认证/工作树等配置项 |
| `db.py` | 异步 SQLAlchemy 引擎 + session 工厂 + 审计上下文注入 |
| `redis.py` | 全局异步 Redis 客户端 |
| `logging.py` | structlog JSON 日志配置 |
| `errors.py` | AppError 基类 + 30+ 领域错误定义 + 全局异常处理器 |
| `security.py` | JWT (HS256) + bcrypt 密码 + refresh token |
| `auth_deps.py` | FastAPI 认证依赖（get_current_user, require_permission） |
| `crypto.py` | NaCl secretbox 对称加密（凭证存储） |
| `audit_hooks.py` | SQLAlchemy event hooks 审计日志 |
| `telemetry.py` | OpenTelemetry stub |
| `paths.py` | 路径解析工具 |
| `spec_paths.py` | Spec 数据路径解析 |
| `layout_migration.py` | 布局迁移工具 |
| `tests/` | core 层单元测试 |

## 功能模块 (`app/modules/`)

共 20 个模块，按字母排序：

| 模块 | 路由前缀 | 主要功能 | 关键文件 |
|------|----------|----------|----------|
| agent | /api | AI Agent 调度与执行 | router, service, coordinator, adapters/claude_code |
| archive | /api | 变更归档 | router, service |
| auth | /api/auth | 登录/登出/RBAC | router, service, model (User/Session/Role/RolePermission/UserWorkspaceRole) |
| change | /api/workspaces/{id} | SillySpec 变更生命周期 | router, service, dispatch, model (Change/ChangeDocument) |
| change_writer | /api | 变更文档生成 | router, service |
| daemon | /api/daemon | 守护进程管理 + WebSocket | router, service, ws_hub, lease_service, protocol, model (DaemonRuntime/DaemonTaskLease) |
| git_gateway | /api | Git 操作代理 | router, service, model (GitOperationLog) |
| git_identity | /api/git | Git 凭证管理 | router, service, providers/github, model (GitIdentity) |
| health | /api | 健康检查 | router, schema |
| incident | /api | 事件管理 | router, service, model (Incident/Postmortem) |
| knowledge | /api/workspaces/{id} | 知识库 | router, service |
| release | /api | 发布管理 | router, service, model (Release/ReleaseApproval) |
| runtime | /api/workspaces/{id} | 运行时进度 | router, service |
| scan_docs | /api/workspaces/{id} | 扫描文档 | router, service, model (ScanDocument) |
| settings | /api | 平台设置 + 用户管理 | router, model (PlatformSetting) |
| spec_profile | (内部) | Spec Profile 配置 | policy, provider, model (SpecProfileManifest/SpecConflict) |
| spec_workspace | /api | Spec 工作空间 | router, service, bootstrap, model (SpecWorkspace) |
| task | /api/workspaces/{id} | 任务管理 | router, service, model (Task) |
| tool_gateway | /api | 工具执行 + 策略 | router, policy_router, service, tool_policy, model (ToolOperationLog/ToolPolicy) |
| workflow | /api | 工作流状态机 | router, service, fsm, model (ChangeReview/AuditLog) |
| worktree | /api/workspaces/{id} | Git worktree 租约 | router, service, model (WorktreeLease) |
| workspace | /api/workspaces | 工作空间 + 拓扑 | router, service, parser, topology, relation_service, model (Workspace/WorkspaceRelation) |

## 数据库表清单（33 张）

| 表名 | 所属模块 | 说明 |
|------|----------|------|
| users | auth | 用户表 |
| sessions | auth | 会话表 |
| roles | auth | 角色表 |
| role_permissions | auth | 角色权限表 |
| user_workspace_roles | auth | 用户-工作空间角色表 |
| workspaces | workspace | 工作空间表 |
| workspace_relations | workspace | 工作空间关系表 |
| change_workspaces | workspace | 变更-工作空间 M2N |
| task_workspaces | workspace | 任务-工作空间 M2N |
| agent_run_workspaces | workspace | Agent运行-工作空间 M2N |
| changes | change | 变更表 |
| change_documents | change | 变更文档表 |
| tasks | task | 任务表 |
| agent_runs | agent | Agent 运行表 |
| agent_run_logs | agent | Agent 运行日志表 |
| scan_documents | scan_docs | 扫描文档表 |
| daemon_runtimes | daemon | 守护进程运行时表 |
| daemon_task_leases | daemon | 守护进程任务租约表 |
| worktree_leases | worktree | Worktree 租约表 |
| git_operation_logs | git_gateway | Git 操作日志表 |
| git_identities | git_identity | Git 凭证表 |
| tool_operation_logs | tool_gateway | 工具操作日志表 |
| tool_policies | tool_gateway | 工具策略表 |
| releases | release | 发布表 |
| release_approvals | release | 发布审批表 |
| incidents | incident | 事件表 |
| postmortems | incident | 事后分析表 |
| change_reviews | workflow | 变更评审表 |
| audit_logs | workflow | 审计日志表 |
| platform_settings | settings | 平台设置表 |
| spec_workspaces | spec_workspace | Spec 工作空间表 |
| spec_profile_manifests | spec_profile | Spec Profile 表 |
| spec_conflicts | spec_profile | Spec 冲突表 |

## 迁移文件

38 个 Alembic 迁移文件，按日期命名（`YYYYMMDDHHMM_description.py`），涵盖从初始建表到最新字段的所有 schema 变更。
