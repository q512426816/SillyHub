---
author: qinyi
created_at: 2026-06-19 12:50:59
source_commit: 0303536
updated_at: 2026-06-19T04:50:59Z
generator: sillyspec-scan
---

# Backend 目录结构（STRUCTURE）

> 范围：`backend/`（不含 `.venv/`、`.pytest_cache/`）。基于 `Glob`/`ls` 实测。

## 目录树

```
backend/
├── pyproject.toml              # 项目元数据 + 依赖 + ruff/mypy/pytest 配置
├── ruff.toml                   # 仅 extend = "pyproject.toml"（便于子目录调用 ruff）
├── README.md
├── conftest.py                 # 顶层 pytest fixtures（SQLite 内存引擎、httpx client、auth token）
├── alembic.ini                 # （由 env 推断存在）
├── app/
│   ├── __init__.py             # 导出 __version__
│   ├── main.py                 # create_app() 入口、lifespan、中间件、路由挂载、quick-chat 内联路由
│   ├── core/                   # 横切关注点
│   │   ├── config.py           # Settings(BaseSettings) + get_settings() 单例
│   │   ├── db.py               # AsyncEngine / async_sessionmaker / get_session 依赖
│   │   ├── redis.py            # redis.asyncio 连接管理（from_url / close_redis）
│   │   ├── logging.py          # structlog configure_logging / get_logger
│   │   ├── telemetry.py        # OTEL stub（仅 otel_endpoint 设置时初始化）
│   │   ├── security.py         # JWT 编解码（jose）+ AccessTokenError
│   │   ├── crypto.py           # NaCl SecretBox 主密钥加解密
│   │   ├── auth_deps.py        # get_current_user / require_permission / get_current_principal
│   │   ├── errors.py           # AppError 基类 + 所有领域错误码 + register_exception_handlers
│   │   ├── audit_hooks.py      # SQLAlchemy 事件钩子 → audit_logs
│   │   ├── paths.py            # resolve_spec_data_root 等路径工具
│   │   ├── spec_paths.py       # spec 存储路径计算
│   │   └── layout_migration.py # 数据目录布局迁移
│   ├── models/
│   │   └── base.py             # BaseModel(SQLModel) 公共基类
│   └── modules/                # 24 个业务模块（见下表）
├── migrations/
│   ├── env.py                  # Alembic 异步运行环境
│   └── versions/               # ~55 个 revision，命名 YYYYMMDDHHMM_<desc>.py
└── tests/                      # 顶层集成测试（与 app/modules/*/tests/ 并存，均被 pytest 收集）
    ├── test_config.py
    ├── test_health.py
    ├── core/
    └── modules/
        ├── admin/ auth/ agent/ change/ change_writer/ daemon/ workspace/
        └── ...（每个模块一个子目录）
```

## 模块说明（`app/modules/`，共 24 个）

| 模块 | 职责 | 关键文件 |
| --- | --- | --- |
| `health` | 健康探针 `/api/health` | `router.py` |
| `auth` | 用户/会话/角色/RBAC 权限/API Key/JWT 签发 | `model.py`、`service.py`、`api_key_service.py`、`rbac.py`、`permissions.py`、`router.py` |
| `admin` | 组织/用户组织关联/用户角色管理 | `model.py`、`router.py` |
| `workspace` | 项目工作区 + 多对多关系图 + 成员管理 | `model.py`、`router.py`、`members_router.py`、`parser.py`、`topology.py` |
| `change` | SillySpec 变更主实体 + 状态机（StageEnum/TRANSITIONS） | `model.py`、`router.py`、`service.py`、`dispatch.py` |
| `task` | 变更下的任务 | `model.py`、`router.py` |
| `change_writer` | 变更文档落盘 | `service.py`、`router.py` |
| `workflow` | 变更评审 + 审计日志 + 旧 FSM（已 deprecated） | `model.py`、`router.py`、`fsm.py` |
| `agent` | Agent 运行编排 + 日志/会话 + 协调器 + 适配器 + diff 收集 | `model.py`、`service.py`、`router.py`、`coordinator.py`、`placement.py`、`adapters/`、`diff_collector.py` |
| `daemon` | Daemon 运行时注册 + 任务租约 + WebSocket RPC + 会话历史 | `model.py`、`service.py`、`router.py`、`ws_hub.py` |
| `worktree` | git worktree 租约（acquire/release/extend） | `model.py`、`router.py`、`git_runner.py` |
| `git_gateway` | Git 操作网关 + 操作审计日志 | `model.py`、`router.py`、`service.py` |
| `git_identity` | Git 身份管理（含 GitHub OAuth provider） | `model.py`、`router.py`、`providers/{base,github}.py` |
| `tool_gateway` | 工具调用网关 + 工具策略 + 操作日志 | `model.py`、`router.py`、`policy_router.py`、`tool_policy.py` |
| `scan_docs` | 项目扫描文档存储/查询 | `model.py`、`schema.py`、`router.py` |
| `spec_workspace` | spec 工作区 + bundle 同步 | `model.py`、`router.py` |
| `spec_profile` | spec profile（部分 TODO 未实现） | `model.py`、`schema.py`、`policy.py`、`provider.py` |
| `release` | 发布管理 + 发布审批 | `model.py`、`router.py`、`service.py` |
| `incident` | 事件 + 复盘 | `model.py`、`router.py`、`service.py` |
| `archive` | 变更归档 | `router.py`、`service.py` |
| `knowledge` | 知识库 | `schema.py`、`router.py` |
| `runtime` | 运行时信息 | `router.py` |
| `settings` | 平台设置（key/value） | `model.py`、`router.py` |
| *(prompts)* | `app/modules/change/prompts/*.md` —— SillySpec 各阶段 prompt 模板（brainstorm/plan/execute/verify/scan/quick/archive/clarifying/propose） | 非 Python，文档资源 |

## 按文件类型统计

- `router.py`：22 个（不含 `main.py` 内联的 `qc_router`）
- `service.py`：20 个
- `schema.py`：22 个
- `model.py`：通过 grep 命中 19 个显式 `__tablename__` 定义文件（部分模块如 `health`/`knowledge` 无表）
- 测试文件：124 个（`tests/` + `app/modules/*/tests/`，均被 pytest 收集）
- Alembic 迁移：~55 个 revision（含 `merge_heads`、`rename_system_roles_to_zh` 等数据迁移）
