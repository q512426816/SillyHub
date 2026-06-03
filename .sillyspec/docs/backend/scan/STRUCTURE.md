---
author: qinyi
created_at: 2026-06-03T20:35:00+08:00
---

# Backend -- 目录结构和文件组织

## 顶层目录

```
backend/
├── app/                     # 应用源码
│   ├── __init__.py          # __version__ = "0.1.0"
│   ├── main.py              # FastAPI 应用工厂 create_app() + lifespan
│   ├── core/                # 基础设施层（13 个文件）
│   ├── models/              # 共享模型基类（2 个文件）
│   └── modules/             # 业务模块（21 个模块）
├── migrations/              # Alembic 迁移
│   ├── env.py               # 异步迁移入口
│   ├── script.py.mako       # 迁移模板
│   └── versions/            # 33 个迁移版本
├── tests/                   # 集成测试
│   ├── test_config.py
│   ├── test_health.py
│   └── modules/             # 按模块组织的集成测试
├── .venv/                   # 虚拟环境（gitignore）
├── pyproject.toml           # 项目配置
├── ruff.toml                # Ruff 配置（extend pyproject.toml）
├── alembic.ini              # Alembic 配置
├── Dockerfile               # Docker 多阶段构建
├── .env.example             # 环境变量模板
└── README.md
```

## app/core/ 基础设施

| 文件 | 职责 |
|------|------|
| `__init__.py` | 包标记 |
| `config.py` | `Settings(BaseSettings)` -- 全部运行时配置，`get_settings()` 返回进程级单例 |
| `db.py` | AsyncEngine 懒创建、`async_sessionmaker`、`get_session` FastAPI 依赖（含审计上下文注入）、`dispose_engine` 关闭 |
| `redis.py` | `get_redis()` 懒创建 Redis 单例、`close_redis()` 关闭连接池 |
| `security.py` | `_PasswordHasher(bcrypt)`、`create_access_token / decode_access_token`（HS256 JWT）、`generate_refresh_token / hash_refresh_token / verify_refresh_token` |
| `crypto.py` | `CredentialCipher` -- PyNaCl (xchacha20-poly1305) 加密/解密工具，支持 key_id 版本化 |
| `auth_deps.py` | `get_current_user`、`get_optional_user`、`require_permission(Permission)`、`require_permission_any(Permission)` -- FastAPI 依赖 |
| `errors.py` | `AppError` 基类 + 30+ 领域异常子类、`register_exception_handlers` 注册 4 个全局处理器 |
| `logging.py` | `configure_logging` + `get_logger` -- structlog JSON 日志（stderr + JSONRenderer） |
| `telemetry.py` | `init_telemetry` -- OpenTelemetry 占位（V2 待实现） |
| `audit_hooks.py` | SQLAlchemy ORM 变更审计钩子（after_insert/update/delete） |
| `spec_paths.py` | `SpecPathResolver` -- SillySpec v4 目录布局路径解析（changes/、archive/、.runtime/、docs/） |
| `layout_migration.py` | 一次性布局迁移（legacy changes/change/ -> v4 changes/） |

## app/modules/ 业务模块

### 模块文件统计

| 模块 | 有 router | 有 model | 有 service | 有 schema | 有 parser | 有测试 | 职责 |
|------|-----------|----------|------------|-----------|-----------|--------|------|
| agent | Y | Y | Y | Y | - | Y | AgentRun 生命周期、Claude Code 适配器、SSE 流、Coordinator |
| workspace | Y | Y | Y | Y | Y | Y | 工作区 CRUD、路径映射、关联管理、拓扑、reparse |
| change | Y | Y | Y | Y | Y | Y | 变更主实体、文档管理、状态流转、Agent dispatch |
| workflow | Y | Y | Y | Y | - | Y | 审批流程、FSM、审计日志、spec_guardian |
| tool_gateway | Y | Y | Y | Y | - | Y | 工具调用策略、file_read/write/list/search/shell_exec |
| git_gateway | Y | Y | Y | Y | - | Y | Git 操作代理、白名单、输出脱敏 |
| git_identity | Y | Y | Y | Y | - | Y | Git 凭据管理、GitHub OAuth provider |
| change_writer | Y | - | Y | Y | - | Y | Agent 驱动的代码写入、Markdown builder |
| scan_docs | Y | Y | Y | Y | Y | Y | 文档树扫描、文件内容读取 |
| spec_workspace | Y | Y | Y | Y | - | Y | SpecWorkspace 配置管理、validator |
| spec_profile | - | Y | - | Y | - | Y | Profile 清单、Policy 冲突检测 |
| worktree | Y | Y | Y | Y | - | Y | Git worktree 租约管理、acquire/release/extend/GC |
| task | Y | Y | Y | Y | Y | Y | 任务 CRUD、看板、reparse、M:N 同步 |
| release | Y | Y | Y | Y | - | Y | 发布管理、多审批人、部署窗口 |
| incident | Y | Y | Y | Y | - | Y | 事件生命周期、事后总结 |
| knowledge | Y | - | Y | Y | Y | Y | 知识库 + Quicklog（只读文件系统） |
| runtime | Y | - | Y | Y | - | Y | 运行时状态（读 .sillyspec/.runtime/） |
| archive | Y | - | Y | Y | - | Y | 变更归档、知识蒸馏 |
| settings | Y | Y | - | Y | - | - | 平台设置 + 用户管理 |
| auth | Y | Y | Y | Y | - | - | JWT 认证、RBAC 权限、bootstrap |
| health | Y | - | - | Y | - | - | 健康检查端点 |

### 模块标准结构

```
modules/<module>/
├── __init__.py        # 包标记（有时含 router re-export）
├── model.py           # SQLModel 表定义（继承 BaseModel, table=True）
├── schema.py          # Pydantic 请求/响应 Schema（不含 table=True）
├── router.py          # APIRouter 路由定义
├── service.py         # 业务逻辑类（接收 AsyncSession）
├── parser.py          # 文件系统解析器（部分模块有）
├── tests/
│   ├── __init__.py
│   └── test_*.py      # pytest 测试
└── <sub-packages>/    # 部分模块有子包
```

### 模块特有子结构

- **agent/adapters/** -- Agent 适配器（`claude_code.py`）
- **agent/** -- `base.py`（ABC + AgentSpecBundle）、`coordinator.py`（执行协调器）、`context_builder.py`、`diff_collector.py`、`coordinator_schema.py`
- **workspace/** -- `scanner.py`（文件系统扫描）、`parser.py`（projects.yaml 解析）、`topology.py`（拓扑图构建）、`relation_schema.py`、`relation_service.py`
- **git_identity/providers/** -- `base.py` + `github.py`（OAuth provider 抽象）
- **change/** -- `dispatch.py`（Agent 阶段调度）、`parser.py`
- **workflow/** -- `fsm.py`（任务状态机）、`spec_guardian.py`（流转守卫）
- **tool_gateway/** -- `tool_policy.py`（策略引擎 + ToolPolicyService + SSRF 防护）

## tests/ 集成测试

```
tests/
├── __init__.py
├── test_config.py                          # Settings 解析规则
├── test_health.py                          # 健康检查端点
└── modules/
    ├── __init__.py
    ├── agent/
    │   ├── test_coordinator.py
    │   ├── test_context_builder.py
    │   ├── test_spec_bundle_stage_dispatch.py
    │   ├── test_stage_dispatch.py
    │   └── test_work_dir_strategy.py
    ├── change/
    │   ├── test_auto_dispatch.py
    │   ├── test_dispatch.py
    │   ├── test_dispatch_chain.py
    │   ├── test_dispatch_stage_config.py
    │   ├── test_e2e_stage_dispatch.py
    │   └── test_router_transition.py
    ├── change_writer/
    │   └── test_router.py
    └── workspace/
        ├── test_scan_generate.py
        └── test_scan_generate_service.py
```

## migrations/ 数据库迁移

```
migrations/
├── env.py                                  # 异步迁移入口（显式 import 所有模块 model）
├── script.py.mako                          # 迁移模板
└── versions/
    ├── __init__.py
    ├── 202605251400_create_health_probe.py
    ├── 202605260900_create_workspaces.py
    ├── 202605270900_create_components_and_relations.py
    ├── 202605280900_create_auth_and_rbac.py
    ├── 202605290900_create_scan_documents.py
    ├── 202605300900_create_changes.py
    ├── 202605301700_add_word_count_to_change_documents.py
    ├── 202605310900_create_tasks.py
    ├── 202605311700_add_change_approval_fields.py
    ├── 202606010900_create_git_identities.py
    ├── 202606020900_create_worktree_leases.py
    ├── 202606030900_create_git_operation_logs.py
    ├── 202606040900_create_workflow.py
    ├── 202606050900_create_agent_runs.py
    ├── 202606060900_create_tool_operation_logs.py
    ├── 202606070900_create_releases.py
    ├── 202606080900_create_incidents.py
    ├── 202606090900_create_platform_settings.py
    ├── 202606100900_create_spec_workspaces.py
    ├── 202606101000_create_spec_profile.py
    ├── 202606110900_add_agent_run_audit_fields.py
    ├── 202606120900_agent_runs_nullable_task_lease.py
    ├── 202606130900_workspace_graph.py
    ├── 202606140900_create_missing_tables.py
    ├── 202606150900_add_execution_coordinator_fields.py
    ├── 202606160900_add_tool_policies.py
    ├── 202606170900_add_change_workflow_fields.py
    ├── 202606180900_add_change_id_to_agent_runs.py
    ├── 202606190900_unify_workflow_stages.py
    ├── 202606200900_created_to_draft.py
    ├── 202606210900_scan_docs_path_index.py
    └── 4d9236aa3abb_merge_heads.py
```

迁移命名规则：`YYYYMMDDHHMM_<描述>.py`，按时间顺序递增。
