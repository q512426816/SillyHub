---
author: qinyi
created_at: 2026-08-18 01:06:26
source_commit: 744e3de4
updated_at: 2026-08-17T17:06:26Z
generator: sillyspec-scan
---

# 目录结构（Structure）

> 范围：`backend/`（不含 `.venv/`、`.pytest_cache/`、`__pycache__/`、`uv.lock`）。基于 `ls`/`Glob`/`Grep` 实测于 commit `744e3de4`（上次扫描 `6e78b29a`，2026-07-26）。
> 本次增量：新增模块 `mcp_gateway`（对外 MCP 服务器）与 `platform_sync`（SillySpec CLI 回传）→ 27→29 个业务目录；`app/core/` 新增 `ssrf.py` / `monitoring.py`（13→15 个 .py）且 core 自带 `tests/`；迁移 116→144；`tests/` 由 5 个顶层文件扩为 76 个（core/e2e/modules 分层）；backend 根新增 `openapi.json` + `scripts/dump_openapi.py`（前端类型契约）与 `templates/`。

## 目录树

```
backend/
├── pyproject.toml              # 项目元数据 + 依赖 + ruff/mypy/pytest 配置（mcp>=1.29,<2 为本次新增依赖）
├── ruff.toml                   # 仅 extend pyproject（便于子目录调用 ruff）
├── README.md                   # backend 速查命令 + 布局 + 约定
├── conftest.py                 # 顶层 pytest fixtures（SQLite 内存引擎、httpx client、auth token）
├── alembic.ini                 # Alembic 配置
├── create_tables.py            # 建表脚本（开发/初始化用）
├── seed_workbench_demo.py      # PPM 工作台演示数据 seed
├── docker-entrypoint.sh        # 容器入口
├── Dockerfile                  # 多阶段构建（uv venv + node/claude-code/sillyspec + 非 root 运行）
├── openapi.json                # 静态导出的 OpenAPI schema（scripts/dump_openapi.py 产出，前端 gen:types 消费）
├── templates/
│   └── weekly-plan-template.xlsx  # PPM 周计划导出模板
├── test_alembic.db             # 开发期 SQLite 产物（勿提交语义，随工作区漂移）
├── uv.lock                     # uv 依赖锁
├── hooks/
│   └── scan_write_guard.py     # 扫描文档写入守卫钩子
├── scripts/                    # 辅助脚本（见下）
├── migrations/
│   ├── env.py                  # Alembic 异步运行环境
│   └── versions/               # 144 个 revision .py（含多份 merge head），命名 YYYYMMDDHHMM_<desc>.py
├── tests/                      # 顶层集成/E2E 测试（76 个 test_*.py，与模块内测试并存）
└── app/
    ├── __init__.py             # 导出 __version__
    ├── main.py                 # create_app() 入口：lifespan（含 mcp.session_manager）、中间件、
    │                           #   include_router 聚合全部路由、内联 daemon-chat 快聊 router、mount_mcp(app)
    ├── core/                   # 横切关注点（15 个 .py + tests/，见下表）
    ├── models/
    │   └── base.py             # BaseModel(SQLModel) 公共基类
    └── modules/                # 29 个业务目录（含 ppm 子域包，见下表）
```

## `app/core/` 目录职责（15 个 .py + core/tests/）

| 文件 | 职责 |
| --- | --- |
| `config.py` | `Settings(BaseSettings)` + `get_settings()`（`@lru_cache`）；DB/Redis/SECRET_KEY/CORS/S3/OTEL/COMMIT_SHA/SPEC_DATA_ROOT/WORKTREE/litellm 等全部配置项 |
| `db.py` | 进程级 `AsyncEngine` + `async_sessionmaker` + `get_session` 依赖 + `dispose_engine` |
| `redis.py` | `redis.asyncio` 连接管理（`from_url` / `get_redis` / `close_redis`），单例复用 |
| `permission_cache.py` | 基于 Redis 的权限缓存 |
| `logging.py` | structlog `configure_logging`（idempotent）+ `get_logger`，事件式 key=value + JSONRenderer |
| `monitoring.py` | 轻量性能监控四件套：慢请求中间件 / 事件循环堵塞看门狗 / 慢 SQL 日志 /（新增） |
| `telemetry.py` | OTEL stub（仅 `otel_endpoint` 设置时初始化） |
| `security.py` | JWT 编解码（python-jose，HS256）+ `passlib[bcrypt]` 口令哈希 |
| `crypto.py` | NaCl SecretBox 主密钥加解密（`v1:` 前缀密文），供凭据/上游 api_key 落库加密 |
| `ssrf.py` | SSRF 统一入口 façade：mcp webhook 回调 / worktree git clone / http_get 工具三入口经此校验（复用 tool_gateway IP 原语）（新增） |
| `auth_deps.py` | `get_current_user` / `require_permission(_any)` / `get_current_principal` / `require_platform_admin` |
| `errors.py` | `AppError` 基类 + 领域错误码（文案已中文化）+ `register_exception_handlers` |
| `audit_hooks.py` | SQLAlchemy 事件钩子 → `audit_logs` |
| `paths.py` | `resolve_spec_data_root` 等路径工具 |
| `spec_paths.py` | spec 存储路径计算 |
| `tests/` | core 自带单测（audit/auth_deps/config l10n 等） |

## `app/modules/` 目录职责（29 个业务目录）

每个模块常规含 `router.py`（HTTP 路由）、`service.py`（业务）、`schema.py`（Pydantic IO）、`model.py`（SQLModel 表）、`tests/`（co-located 单测）；大模块额外拆子目录。

| 模块 | 职责 | 关键文件 |
| --- | --- | --- |
| `health` | 健康探针 `/api/health` | `router.py`、`schema.py` |
| `auth` | 用户/会话/角色/RBAC/API Key/JWT/验证码 | `model.py`、`service.py`、`api_key_service.py`、`captcha_service.py`、`rbac.py`、`permissions.py`、`router.py` |
| `admin` | 组织/用户组织关联/用户角色管理（按职责拆 service） | `model.py`、`router.py`、`organizations_service.py`、`roles_service.py`、`users_service.py`、`services/` |
| `workspace` | 项目工作区 + 多对多关系图 + 成员管理 + 成员运行时 | `model.py`、`router.py`、`members_router.py`、`members_service.py`、`relation_service.py`、`member_runtimes/` |
| `change` | SillySpec 变更主实体 + 状态机 + dispatch + prompt 模板 | `model.py`、`router.py`、`service.py`、`dispatch.py`、`parser.py`、`prompts/*.md` |
| `task` | 变更下的任务 | `model.py`、`router.py`、`service.py` |
| `change_writer` | 变更文档落盘 | `service.py`、`router.py`、`schema.py` |
| `workflow` | 变更评审 + 审计日志 + spec_guardian | `model.py`、`router.py`、`service.py`、`fsm.py`、`spec_guardian.py` |
| `agent` | Agent 运行编排：协调器/mission/execution/delegation/diff 收集/post-scan/context/control/orchestrator/profile | `coordinator.py`、`orchestrator.py`、`mission.py`、`execution.py`、`delegation.py`、`finalizer.py`、`control.py`、`placement.py`、`borrow_resolver.py`、`mcp_tools.py`、`skills_bundle_service.py`、`adapters/`、`profile/`（agent_profile_router） |
| `daemon` | Daemon 运行时 + 任务租约 + WebSocket RPC + 远程分发 + 会话历史 + llm-proxy 透传 + 写回 | `router.py`（`/ws` websocket + `/llm-proxy/*`）、`ws_hub.py`、`protocol.py`、`lease_service.py`、`permission_service.py`、`dist_router.py`、`change_write_router.py`、`model_error.py` + 子目录 `audit/`、`host_fs/`、`lease/`、`patch/`、`reaper/`、`run_sync/`、`runtime/`、`session/`（见下） |
| `mcp_gateway` | 对外 MCP 服务器（FastMCP streamable HTTP mount `/mcp`）+ McpToken 管理 + mission 级 SSE（新增） | `server.py`（`mcp` 实例 + `mount_mcp`）、`auth.py`、`sse.py`、`tools.py`、`model.py`、`router.py`（workspace mcp-tokens CRUD）、`service.py` |
| `platform_sync` | SillySpec CLI 进度/文档/审批回传 + spec 文件增量同步（manifest/sync）+ shpsync_ token（新增） | `router.py`（progress/documents/approval + `/changes/-/spec-manifest`、`/changes/-/spec-sync`）、`workspace_router.py`（token 管理）、`auth.py`、`token_service.py`、`token_model.py`、`service.py` |
| `llm_provider` | LLM 提供方管理（cc-switch 式启停）+ LiteLLM admin API 客户端（openai 格式供应商注册/注销） | `model.py`、`router.py`、`service.py`、`schema.py`、`litellm_client.py`（httpx）、`probe.py`、`usage_handlers.py` |
| `worktree` | git worktree 租约（acquire/release/extend）+ lease router | `model.py`、`router.py`、`lease_router`、`service.py`、`git_runner.py` |
| `git_gateway` | Git 操作网关 + 操作审计日志 | `model.py`、`router.py`、`service.py` |
| `git_identity` | Git 身份管理（含 GitHub OAuth provider，出站 httpx） | `model.py`、`router.py`、`service.py`、`providers/{base,github}.py` |
| `tool_gateway` | 工具调用网关 + 工具策略 + 操作日志（出站 httpx） | `model.py`、`router.py`、`policy_router.py`、`policy_schema.py`、`service.py` |
| `scan_docs` | 项目扫描文档存储/查询 | `model.py`、`schema.py`、`router.py`、`service.py` |
| `spec_workspace` | spec 工作区 + bundle 同步（含 StreamingResponse 流式端点）+ bootstrap | `model.py`、`router.py`、`service.py`、`bootstrap.py` |
| `spec_profile` | spec profile | `model.py`、`schema.py` |
| `release` | 发布管理 + 发布审批 | `model.py`、`router.py`、`service.py` |
| `incident` | 事件 + 复盘 | `model.py`、`router.py`、`service.py` |
| `knowledge` | 知识库 | `schema.py`、`router.py`、`service.py`、`parser.py` |
| `runtime` | 运行时信息 | `router.py`、`schema.py`、`service.py` |
| `settings` | 平台设置（key/value） | `model.py`、`router.py`、`service.py` |
| `skills` | 自定义 skills 管理 | `model.py`、`router.py`、`service.py`、`schema.py` |
| `file` | 平台文件中心（经 storage 后端读写 S3） | `model.py`、`router.py`、`service.py`、`schema.py` |
| `storage` | 对象存储抽象 + MinIO 实现（无 router，纯库层） | `base.py`（`StorageBackend` 接口）、`minio_backend.py`、`factory.py`（单例 + Depends） |
| `ppm`（子域，已上线） | 项目/计划/任务/问题/看板/工作台，统一 `/api/ppm` 前缀 | `common/`、`project/`、`plan/`、`task/`、`problem/`、`kanban/`、`workbench/`（各含 model/router/service/schema/tests）+ `data_scope.py` |

### 展开示例：`daemon/`（最复杂模块，二级结构）

```
daemon/
├── router.py              # /ws WebSocket、/llm-proxy/{path} 透传、会话/租约 HTTP 端点
├── ws_hub.py              # 按 daemon_id 路由的 WS 连接池（下行 RPC）
├── protocol.py            # WS 消息格式
├── lease_service.py       # 租约 claim/start/heartbeat/complete
├── permission_service.py  # 权限下行
├── dist_router.py         # daemon 安装包分发（install.sh/ps1、mcp-server.js 等）
├── change_write_router.py # 变更写回
├── audit/  host_fs/  lease/  patch/  reaper/  run_sync/  runtime/  session/   # 各含 service(+router)+tests
└── tests/                 # 40+ 测试文件
```

### 展开示例：`agent/`（编排核心，二级结构）

`agent/` 平铺 `coordinator.py` / `orchestrator.py` / `mission(_schema).py` / `execution.py` / `delegation.py` / `finalizer.py` / `control.py` / `context_builder.py` / `diff_collector.py` / `post_scan_validator.py` / `borrow_resolver.py` / `mcp_tools.py`，外加两个子包：`adapters/`（适配器）与 `profile/`（AgentProfile 配置层，含独立 `router.py` 注册为 `/api` 下 agent_profile_router）。

## `scripts/` 辅助脚本

`dump_openapi.py`（静态导出 OpenAPI → `backend/openapi.json`，前端类型生成源）、`cleanup_daemon_instances.py`、`fix_unused_ignores.py`、`migrate_from_ruoyi.py`、`resync_modules.py`、`resync_ps_project_plan.py`。

## tests/ 组织方式（双层收集，`testpaths = ["tests", "app"]`）

- **顶层 `tests/`（集成/E2E，76 个 test_*.py，约 720 个测试函数）**：按层分目录——
  - 根级 4 个：`test_config.py`、`test_health.py`、`test_daemon_dist.py`、`test_session_zombie_migration.py`；
  - `tests/core/`（4 个：audit_hooks/auth_deps/config l10n 等）、`tests/e2e/`（`test_three_member_collaboration.py`）、`tests/modules/`（按模块镜像：admin/agent/auth/change/daemon/ppm/scan_docs/settings/spec_workspace/workspace + `test_permission_cache.py`）。
- **模块内 co-located（`app/**/tests/`，284 个 test_*.py，共 36 个 tests/ 目录）**：`app/modules/*/tests/` 23 个模块顶层目录 + 嵌套的 `app/core/tests`、daemon 子域 4 个（audit/host_fs/lease/reaper）、ppm 7 个子域、`workspace/member_runtimes/tests`。
- 运行配置：`asyncio_mode=auto`，`addopts = "-ra -o dist=loadscope"`（xdist 按模块分组防状态污染），CI 叠加 `--reruns 2`（pytest-rerunfailures）。

## 按文件类型统计

- Alembic 迁移：**144 个** revision .py（`migrations/versions/`，含多份 merge head 收敛并行分支）。
- `table=True` SQLModel 表：**83 处**（不含 tests，随 platform_sync/mcp_gateway/agent_profile 持续增加）。
- router 注册（`app/main.py` create_app 内 `include_router`）：约 40 个（含 daemon-chat 快聊 router 内联定义于 main.py、`mount_mcp(app)` 挂载 `/mcp` ASGI 子应用）。
