---
author: qinyi
created_at: 2026-07-27 00:35:31
source_commit: 6e78b29a
updated_at: 2026-07-26T16:35:31Z
generator: sillyspec-scan
---

# 目录结构(Structure)

> 范围:`backend/`(不含 `.venv/`、`.pytest_cache/`、`__pycache__/`、`uv.lock`)。基于 `Glob`/`Grep`/`ls` 实测于 commit `6e78b29a`(上次扫描 `ba87eec`)。
> 本次增量:新增模块 `file` / `llm_provider` / `skills` / `storage`(MinIO);移除旧 `archive` 模块;`ppm` 新增 `workbench` 子域;迁移由 63 增至 116;`app/core/` 由 `layout_migration.py` 改为 `permission_cache.py`。

## 目录树

```
backend/
├── pyproject.toml              # 项目元数据 + 依赖 + ruff/mypy/pytest 配置
├── ruff.toml                   # 仅 extend = "pyproject.toml"(便于子目录调用 ruff)
├── README.md                   # backend 速查命令 + 布局 + 约定(pyproject 的 long_description)
├── conftest.py                 # 顶层 pytest fixtures(SQLite 内存引擎、httpx client、auth token)
├── alembic.ini                 # Alembic 配置
├── create_tables.py            # 建表脚本(开发/初始化用)
├── seed_workbench_demo.py      # PPM 工作台演示数据 seed 脚本(新增)
├── docker-entrypoint.sh        # 容器入口
├── Dockerfile                  # 多阶段构建(uv venv + node/claude-code/sillyspec + 非 root 运行)
├── uv.lock                     # uv 依赖锁
├── app/
│   ├── __init__.py             # 导出 __version__
│   ├── main.py                 # create_app() 入口、lifespan、中间件、include_router 聚合全部路由
│   ├── core/                   # 横切关注点(13 个 .py,见下表)
│   ├── models/
│   │   └── base.py             # BaseModel(SQLModel) 公共基类
│   └── modules/                # 27 个业务目录 + ppm 子域(见下表)
├── hooks/
│   └── scan_write_guard.py     # 扫描文档写入守卫钩子
├── migrations/
│   ├── env.py                  # Alembic 异步运行环境
│   └── versions/               # 116 个 revision(含多份 merge head),命名 YYYYMMDDHHMM_<desc>.py
├── scripts/                    # 辅助脚本
└── tests/                      # 顶层集成测试(与 app/modules/*/tests/ 并存,均被 pytest 收集)
    ├── test_config.py
    ├── test_health.py
    ├── test_gate_e2e.py
    ├── test_session_zombie_migration.py
    └── test_daemon_dist.py
```

## `app/core/` 目录职责(13 个 .py)

| 文件 | 职责 |
| --- | --- |
| `config.py` | `Settings(BaseSettings)` + `get_settings()`(`@lru_cache` 单例);含 DB/Redis/SECRET_KEY/CORS/S3/OTEL/COMMIT_SHA/SPEC_DATA_ROOT/WORKTREE/HOST_PATH_PREFIX 等全部配置项 |
| `db.py` | 进程级 `AsyncEngine`(`create_async_engine`)+ `async_sessionmaker` + `get_session` 依赖 + `dispose_engine` |
| `redis.py` | `redis.asyncio` 连接管理(`from_url` / `get_redis` / `close_redis`),单例复用 |
| `permission_cache.py` | 基于 Redis 的权限缓存(新增,替代旧 `layout_migration.py`) |
| `logging.py` | structlog `configure_logging`(idempotent)+ `get_logger`,事件式 key=value + JSONRenderer |
| `telemetry.py` | OTEL stub(仅 `otel_endpoint` 设置时初始化) |
| `security.py` | JWT 编解码(`python-jose`,HS256)+ `passlib[bcrypt]` `password_hasher` + `create_access_token` + `AccessTokenError` |
| `crypto.py` | NaCl SecretBox 主密钥加解密(`v1:` 前缀密文,`pynacl`) |
| `auth_deps.py` | `get_current_user` / `require_permission` / `require_permission_any` / `get_current_principal` / `require_platform_admin` |
| `errors.py` | `AppError` 基类 + 领域错误码 + `register_exception_handlers` |
| `audit_hooks.py` | SQLAlchemy 事件钩子 → `audit_logs` |
| `paths.py` | `resolve_spec_data_root` 等路径工具 |
| `spec_paths.py` | spec 存储路径计算 |

## `app/modules/` 目录职责(27 个业务目录 + ppm 子域)

每个模块常规含 `router.py`(HTTP 路由)、`service.py`(业务)、`schema.py`(Pydantic IO)、`model.py`(SQLModel 表)、`tests/`(co-located 单测)。

| 模块 | 职责 | 关键文件 |
| --- | --- | --- |
| `health` | 健康探针 `/api/health` | `router.py`、`schema.py` |
| `auth` | 用户/会话/角色/RBAC/API Key/JWT 签发 | `model.py`、`service.py`、`api_key_service.py`、`rbac.py`、`permissions.py`、`router.py` |
| `admin` | 组织/用户组织关联/用户角色管理(按职责拆 service) | `model.py`、`router.py`、`organizations_service.py`、`roles_service.py`、`users_service.py`、`services/` |
| `workspace` | 项目工作区 + 多对多关系图 + 成员管理 | `model.py`、`router.py`、`members_router.py`、`members_service.py`、`relation_service.py` |
| `change` | SillySpec 变更主实体 + 状态机 + dispatch + prompt 模板 | `model.py`、`router.py`、`service.py`、`dispatch.py`、`parser.py`、`prompts/*.md` |
| `task` | 变更下的任务 | `model.py`、`router.py`、`service.py` |
| `change_writer` | 变更文档落盘 | `service.py`、`router.py`、`schema.py` |
| `workflow` | 变更评审 + 审计日志 + spec_guardian | `model.py`、`router.py`、`service.py`、`fsm.py`、`spec_guardian.py` |
| `agent` | Agent 运行编排:协调器/mission/execution/delegation/diff收集/post-scan/context/control;`adapters/` 目录 | `coordinator.py`、`placement.py`、`base.py`、`mission.py`、`execution.py`、`delegation.py`、`diff_collector.py`、`post_scan_validator.py`、`context_builder.py`、`control.py`、`finalizer.py`、`adapters/` |
| `daemon` | Daemon 运行时 + 任务租约 + WebSocket RPC + 远程分发 + 会话历史 + 写回 | `service.py`、`lease_service.py`、`ws_hub.py`、`protocol.py`、`dist_router.py`、`change_write_router.py`、`permission_service.py`、`model.py`、`router.py`(`/ws` websocket) |
| `worktree` | git worktree 租约(acquire/release/extend) | `model.py`、`router.py`、`service.py`、`git_runner.py` |
| `git_gateway` | Git 操作网关 + 操作审计日志 | `model.py`、`router.py`、`service.py` |
| `git_identity` | Git 身份管理(含 GitHub OAuth provider,出站 httpx) | `model.py`、`router.py`、`service.py`、`providers/{base,github}.py` |
| `tool_gateway` | 工具调用网关 + 工具策略 + 操作日志(出站 httpx) | `model.py`、`router.py`、`policy_router.py`、`policy_schema.py`、`service.py` |
| `scan_docs` | 项目扫描文档存储/查询 | `model.py`、`schema.py`、`router.py`、`service.py` |
| `spec_workspace` | spec 工作区 + bundle 同步 | `model.py`、`router.py`、`service.py` |
| `spec_profile` | spec profile | `model.py`、`schema.py` |
| `release` | 发布管理 + 发布审批 | `model.py`、`router.py`、`service.py` |
| `incident` | 事件 + 复盘 | `model.py`、`router.py`、`service.py` |
| `knowledge` | 知识库 | `schema.py`、`router.py`、`service.py` |
| `runtime` | 运行时信息 | `router.py`、`schema.py`、`service.py` |
| `settings` | 平台设置(key/value) | `model.py`、`router.py`、`service.py` |
| `skills` | 自定义 skills 管理(新增) | `model.py`、`router.py`、`service.py`、`schema.py` |
| `llm_provider` | LLM 提供方管理(cc-switch 式启停,新增) | `model.py`、`router.py`、`service.py`、`schema.py` |
| `file` | 平台文件中心(新增) | `model.py`、`router.py`、`service.py`、`schema.py` |
| `storage` | 对象存储抽象 + MinIO 实现(新增,见 INTEGRATIONS) | `base.py`(`StorageBackend` 接口)、`minio_backend.py`(`MinioStorage`)、`factory.py`(单例 + Depends) |
| `ppm`(子域,已上线) | 项目/计划/任务/问题/看板/工作台,统一 `/api/ppm` 前缀;common 为共享 | `common/`、`project/`、`plan/`、`task/`、`problem/`、`kanban/`、`workbench/`(各含 model/router/service/schema/tests) |

## 按文件类型统计

- `router.py`:约 28 个(27 模块 + ppm 子域内 7 个独立 router:kanban/plan/problem/project/task/workbench + common 无 router;另含 workspace `members_router`、tool_gateway `policy_router`)。
- `service.py`:约 30 个(含 daemon 多 service、workspace members/relation、admin 3 service、ppm 7 子域 service)。
- Alembic 迁移:**116 个** revision 文件(含多份 `merge_*_heads.py`:合 daemon-entity-binding/policy、orchestration/ppm、align-change/collaborative 等并行分支)。
- `table=True` SQLModel 表:66+ 张(随 ppm/daemon/file/storage 持续增加)。
- 测试发现:`pytest testpaths = ["tests", "app"]`,顶层 `tests/` + 各模块 `tests/` 双层收集(`asyncio_mode=auto`)。
