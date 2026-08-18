---
author: qinyi
created_at: 2026-08-18 01:06:26
source_commit: 744e3de4
updated_at: 2026-08-17T17:06:26Z
generator: sillyspec-scan
---

# 架构（Architecture）

> 子项目：`backend/`（包名 `multi-agent-platform-api`）——多 Agent 协作平台的 FastAPI 后端。
> 本文为 `--force-rescan` 全量重扫快照，依据 `backend/` 实际源码（commit `744e3de4`）。
> 上一版基于 6e78b29a（2026-07-26）；此后新增 platform_sync / mcp_gateway / agent profile 层、安全整改（SSRF/写通道 403）、性能整改、错误文案中文化、审计钩子挂载等，均已按当前代码重新核实。

## 技术栈

来源：`backend/pyproject.toml`、`backend/app/core/*.py`。

- **语言/运行时**：Python ≥ 3.12（`requires-python = ">=3.12"`），hatchling 构建，wheel 只打包 `app`。
- **Web 框架**：FastAPI ≥ 0.115，ASGI 服务器 uvicorn[standard] ≥ 0.30。
  - 应用工厂 `create_app()`（`app/main.py`），`lifespan` 启动钩子（详见「请求流」）。
  - 文档：`/api/docs`（Swagger）、`/api/redoc`、`/api/openapi.json`。
  - 中间件：CORS、`x-request-id` 透传、`monitoring_middleware`（慢请求 >1s 打 `slow.request`）、统一异常处理（`core/errors.py`）。
- **数据建模/校验**：Pydantic ≥ 2.8 + pydantic-settings ≥ 2.4；SQLModel ≥ 0.0.22。
- **ORM/数据库**：SQLAlchemy[asyncio] ≥ 2.0，异步驱动 asyncpg ≥ 0.29（PostgreSQL）；测试用 aiosqlite ≥ 0.20。
  - 引擎与会话工厂：`core/db.py`（`get_engine`/`get_session_factory`/`get_session`）。连接池 `pool_size=20 / max_overflow=30 / pool_timeout=30s / recycle=300s`；asyncpg 会话级超时：`statement_timeout=30s`、`idle_in_transaction_session_timeout=120s`（ql-20260728-008 由 10s 放宽，防误杀事务内 await 慢外部调用的合法长事务）、`lock_timeout=5s`。
- **缓存/消息**：Redis ≥ 5.0（`core/redis.py`：API key 正负缓存、RBAC 权限缓存、SSE pub/sub、daemon 心跳）。
- **对象存储**：aiobotocore ≥ 3.8,<4（S3 兼容，默认 MinIO；`modules/storage/factory.py` + `minio_backend.py`）。
- **对外 MCP 服务**：官方 `mcp>=1.29,<2`（v1 线；v2.0.0 移除 FastMCP 属 breaking，pyproject 注释锁定依据）。FastMCP streamable HTTP 子 app 以 ASGI mount 挂在 `/mcp`。
- **迁移**：Alembic ≥ 1.13，`backend/migrations/versions/` 共 **144 个** version 文件（含 10 个 merge revision 合并并行 head）。
- **认证/加密**：python-jose[cryptography] ≥ 3.3（JWT）、passlib[bcrypt] ≥ 1.7（口令）、pynacl ≥ 1.5（`core/crypto.py`，git 凭证箱）。
- **可观测性**：structlog ≥ 24.4（`core/logging.py` JSON 日志）；`core/monitoring.py`（慢请求中间件 + slow.query >500ms SQL 事件监听 + 事件循环堵塞看门狗 100ms 自检 + pg_stat_activity 采样）；`core/telemetry.py` 当前为 **stub**（`otel_endpoint` 配置存在但仅打日志，未引入 OpenTelemetry 依赖）。
- **HTTP 客户端**：httpx ≥ 0.27（LLM provider 转发、daemon 通信）。
- **工具库**：python-frontmatter（变更/文档解析）、openpyxl + Pillow（PPM Excel 导入/导出与图像）、python-multipart（文件上传）、psutil。
- **代码质量**：ruff（line-length 100，py312；中文串/裸 except 等按 ignore 豁免）、mypy（py312 非 strict，禁中文 `# type:ignore`）、pytest + pytest-asyncio + pytest-xdist（`addopts="-o dist=loadscope"` 按模块分组到 worker，消除跨模块状态污染 flaky）+ pytest-rerunfailures（CI 兜底）。testpaths 同时覆盖 `tests/` 与 `app/`（模块内单测）。

## 架构概览

### 分层

来源：`backend/app/` 目录结构、`app/main.py`。

```
backend/app/
├── main.py              # FastAPI 入口：create_app / lifespan / include_router / mount_mcp
├── core/                # 基础设施（横切，与业务无关）
│   ├── config.py        # Settings(pydantic-settings，唯一运行配置源)
│   ├── db.py            # 异步 engine + session factory + 连接池/会话超时参数
│   ├── redis.py         # Redis 连接
│   ├── security.py      # JWT 签发/校验
│   ├── crypto.py        # NaCl 对称加密(git 凭证等)
│   ├── auth_deps.py     # get_current_user / get_current_principal 等 FastAPI 依赖
│   ├── permission_cache.py  # RBAC 三键权限缓存 + 熔断器
│   ├── audit_hooks.py   # SQLAlchemy after_insert/update/delete 自动审计钩子
│   ├── ssrf.py          # assert_public_url / assert_safe_repo_url(SSRF 防护)
│   ├── monitoring.py    # 慢请求/慢查询/事件循环看门狗/pg 采样
│   ├── paths.py / spec_paths.py  # 路径解析(spec_data_root 等，按 sys.platform 分支)
│   ├── errors.py        # AppError 家族 + 统一异常处理器
│   └── logging.py / telemetry.py
├── schemas/             # 跨模块共享 schema
└── modules/             # 业务模块(各模块自管 router/service/queries/models)
```

请求路径分层：路由层（`router.py`）→ 权限依赖（`require_permission_any` 等，走 `permission_cache` Redis 缓存）→ 服务层（`service.py`）→ 查询层（`queries.py`/repo）→ SQLModel 表模型（`model.py`）→ DB。

### 业务模块（`app/modules/`，共 29 个一级模块 + ppm 6 子域 + agent/profile 子包）

| 模块 | 职责 |
|---|---|
| `auth` | 用户、Session、Role/RolePermission、ApiKey（`shk_live_` 前缀）、UserWorkspaceRole；登录、RBAC 种子 |
| `admin` | 组织（organizations）、UserRole、用户/角色/组织管理 |
| `workspace` | 工作区、TaskWorkspace、AgentRunWorkspace、PPM 项目-工作区链接、拓扑；`member_runtimes/` 成员 daemon 运行时绑定 |
| `agent` | AgentRun / RunLog / Session / Mission / Dependency / Artifact / BorrowAudit；派发、协调、适配器；`profile/` AgentProfile 配置层（agent 层档案，含系统默认 claude/codex 启动补种） |
| `task` | 平台级任务 + parser |
| `change` | SillySpec 变更（Change/ChangeDocument/ChangeSessionLink/ChangeEvent）、阶段派发（dispatch）、gate 决策对账、读时进度投影（projection.py + quicklog 解析） |
| `change_writer` | 变更文档 markdown 写回 |
| `scan_docs` | 扫描文档 + 冲突历史 |
| `spec_workspace` / `spec_profile` | spec 工作区策略 + 文件清单（spec_file_manifest，仓库导入流式 SSE）/ profile manifest / conflict |
| `platform_sync` | SillySpec CLI ↔ 平台进度同步层：progress/changes/documents/approval/quicklog 9 端点 + spec-manifest/spec-sync 增量同步 + workspace 级 `shpsync_` token 签发/吊销 |
| `daemon` | DaemonInstance / Runtime / TaskLease / SessionDialog / ChangeWrite；WS hub、lease、host_fs delegate、分发（dist_router）、审计（audit/）、session、run_sync、patch、reaper |
| `worktree` | WorktreeLease + git_runner + exec_env |
| `git_gateway` / `git_identity` | Git 操作网关 / Git 凭证（provider: github） |
| `tool_gateway` | 工具策略（ToolPolicy，含 assert_public_hostname SSRF 原语）+ 操作日志 |
| `llm_provider` | LlmProvider（cc-switch 式启停） |
| `mcp_gateway` | 对外 MCP 服务：McpToken/McpWebhook、FastMCP server（tools/sse）、`/mcp` mount + Bearer 鉴权中间件 |
| `skills` | CustomSkill admin CRUD |
| `release` | Release / ReleaseApproval |
| `incident` | Incident / Postmortem（状态机走 `ppm/common/fsm.assert_transition`，非法转换 422） |
| `knowledge` | 知识库 parser/router |
| `runtime` | 运行时视图（spec_root 解析） |
| `workflow` | ChangeReview / AuditLog + spec_guardian |
| `settings` | PlatformSetting |
| `file` + `storage` | 平台文件中心（file 表）+ S3/MinIO 后端工厂（base/factory/minio_backend） |
| `ppm/project` | PpmProject 维护/客户/成员/干系人 |
| `ppm/plan` | 计划三级 + PsProjectPlan 模板体系 |
| `ppm/task` | PlanTask / TaskExecute / WorkHour |
| `ppm/problem` | 问题清单 + 变更 + 流程任务/日志 |
| `ppm/kanban` | 看板评论/子任务 |
| `ppm/workbench` | 工作台聚合（待办、可切换用户） |
| `health` | `/api/health` 探针 |

### 鉴权四轨

来源：`core/auth_deps.py`、`core/security.py`、`platform_sync/auth.py`、`platform_sync/token_service.py`、`mcp_gateway/auth.py`。

| 通道 | 形态 | 依据 |
|---|---|---|
| JWT | `Authorization: Bearer <access_token>`（`?token=` query 回退已删除，防进访问日志） | `core/security.py` 签发/校验 + `core/auth_deps.py` |
| API Key | `X-API-Key: <shk_live_...>`（header-only） | `core/auth_deps.py` → `auth/api_key_service.py` |
| 平台同步 token | `Authorization: Bearer <shpsync_...>`，workspace 级；platform_sync 端点 Bearer 三路分流（`shpsync_`/`shk_live_`/JWT）；**写通道仅 shpsync_ 放行**，其余 403 PermissionDenied | `platform_sync/token_service.py`（sha256 直存 + hash O(1) 查表 + GitHub secret scanning 前缀规则）+ `platform_sync/auth.py` |
| McpToken | `/mcp` 子 app 的 `McpAuthMiddleware` 只认 `Authorization: Bearer <McpToken>`，与 `/api` 通道物理隔离（CC-06）；scope 校验 `require_mcp_scope` | `mcp_gateway/auth.py` + `mcp_gateway/service.py`（正/负缓存） |

### 请求流

来源：`main.py` lifespan（L81-190）。

1. ASGI 入口 → CORS → `x-request-id` → monitoring（slow.request）→ 异常处理器。
2. `get_session` 依赖：从连接池取 `AsyncSession`，审计上下文（actor/workspace）注入 `session.info`。
3. 启动期 lifespan 依序：日志/遥测初始化 → 事件循环看门狗 → `register_audit_hooks`（挂 SQLAlchemy 事件，遍历表模型挂 after_insert/update/delete，幂等）→ `bootstrap_admin_and_seed_rbac` → 清孤儿 agent run → gate 任务对账重入队（`reconcile_pending_gate_decisions`）→ AgentProfile 系统默认补种 + 角色模板回收 → 对象存储单例初始化 → `mcp.session_manager.run()`（FastMCP streamable HTTP session 常驻；Starlette Mount 不跑子 app lifespan，必须在父 lifespan 手动驱动）。
4. 关停期：停看门狗 → 存储后端 `aclose` → dispose engine → close redis。

### 关键机制

- **进度投影**：`change/projection.py` 读时投影——以 `changes.current_stage` 落库值为基，结合 stages 完成态推导展示阶段（brainstorm→PLAN_REVIEW / verify→HUMAN_TEST 等）；平台侧 `platform_change_progress` 表（CLI 镜像）由 platform_sync `POST /changes/{name}/progress` 写入，读端点取 latest_progress 覆盖 CLI 镜像。落库值与投影值可能短暂不一致（双轨设计）。
- **SSE 通道**（`text/event-stream` + StreamingResponse，EventSource 帧格式）：`main.py` Quick Chat 流式（`stream_quick_chat`，参数化路由前注册保匹配优先）；`agent/router.py`；`daemon/router.py` session SSE；`mcp_gateway/sse.py` mission worker_status 帧；`spec_workspace/router.py` 仓库导入流式读（不再返回 JSON）。
- **spec 文件增量同步**：`platform_sync` `GET /changes/-/spec-manifest`（服务器权威清单）+ `POST /changes/-/spec-sync`（增量 diff 推送），落库 `spec_file_manifest`；替代旧 tar 全量覆盖。
- **审计钩子**：`core/audit_hooks.py` `register_audit_hooks(engine)` 在 lifespan 挂载（2026-08-14 audit-system-completion），自动捕获表级 insert/update/delete 产生 `audit_logs` 行；actor/workspace 从 `session.info` 取。
- **SSRF 防护**：`core/ssrf.py` `assert_public_url`（scheme 白名单 + host 解析公网校验，IPv4+IPv6+`asyncio.to_thread` 防 DNS 阻塞）、`assert_safe_repo_url`；`ToolPolicyService.assert_public_hostname` 为底层原语。
- **错误文案中文化**：用户面报错 250+ 处中文化，`tests/core/test_error_message_l10n.py` 守护测试防回退。
- **性能整改落点**（perf-remediation）：reparse `to_thread` 化、批量回写、IN 预取、`load_only` 列裁剪、`scandir` 单遍目录扫描、daemon 门控等。

### 路由前缀约定

- 大多数业务路由挂 `/api`（workspace、auth、change、agent、daemon、task、llm_provider、tool_gateway、settings、admin、incident、release、knowledge、runtime、skills、worktree、git_*、workflow、spec_workspace 等）。
- `/api/workspaces/{workspace_id}/...` 为工作区作用域统一入口；`members_router` / `member_runtimes_router` / `ppm_project_link_router` 作为同级兄弟挂载（避免 workspace_id 参数重复）。
- platform_sync 双 router：主 router（`/api/changes...`、`/api/quicklog-entries`）+ workspace router（`/api/workspaces/...` token 签发/吊销）。
- PPM 五个子域统一挂 `/api/ppm`；文件中心 `/api/file`；mcp token 管理挂 `/api`（tags=mcp-tokens）。
- daemon 分发端点（`daemon_dist_router`，install.sh 等）无 `/api` 前缀，匹配 install.sh 契约。
- `/mcp`：FastMCP streamable HTTP 子 app（`mount_mcp(app)`：`streamable_http_app()` → 叠加 `McpAuthMiddleware` → `app.mount("/mcp", ...)`）。

## DB Schema（表名 + 说明 + 字段数）

来源：`grep __tablename__` 全量扫描（排除测试桩），共 **81 张表**。字段数为 `Field(` 计数近似（不含主键列时偏小 1），精确列以各 `model.py` 与 alembic 迁移为准。

### 认证与组织
| 表名 | 说明 | 字段数 |
|---|---|---|
| `users` | 平台用户 | ~16 |
| `sessions` | 登录会话（含 rotate） | ~10 |
| `roles` / `role_permissions` | 角色 / 角色-权限 | ~5 / ~3 |
| `api_keys` | API Key（shk_live_，正负缓存节流） | ~12 |
| `user_workspace_roles` | 用户-工作区-角色 | ~5 |
| `organizations` / `user_organizations` / `user_roles` | 组织树 / 用户-组织 / 用户-角色 | ~5 / ~3 / ~3 |

### 工作区
| 表名 | 说明 | 字段数 |
|---|---|---|
| `workspaces` | 工作区 | ~15 |
| `task_workspaces` / `agent_run_workspaces` | 任务/AgentRun-工作区（M:N） | ~5 / ~5 |
| `workspace_member_runtimes` | 成员 daemon 运行时绑定 | ~10 |
| `ppm_project_workspace` | PPM 项目-工作区链接 | ~2 |

### Agent / 任务
| 表名 | 说明 | 字段数 |
|---|---|---|
| `agent_runs` | 一次 agent 执行（spec_strategy、provider、usage、gate 等） | ~45 |
| `agent_run_logs` | 执行日志（tool_kind、subagent、dedup_key） | ~14 |
| `agent_sessions` | 交互式会话（change/workspace 关联） | ~12 |
| `agent_missions` | 多 agent mission（团队编排） | ~12 |
| `agent_run_dependencies` / `agent_artifacts` | run 间依赖 / 产出物 | ~5 / ~6 |
| `daemon_borrow_audit` | 业务人员借用 daemon 审计 | ~7 |
| `agent_profiles` | AgentProfile 配置层档案（含 is_system_default/provider） | ~17 |
| `tasks` | 平台级任务 | ~10 |

### 变更 / 工作流 / 文档
| 表名 | 说明 | 字段数 |
|---|---|---|
| `changes` / `change_documents` | SillySpec 变更 / 变更文档 | ~12 / ~6 |
| `change_session_links` | 变更-会话关联（会话驱动化） | ~4 |
| `change_events` | 变更事件流 | ~7 |
| `change_reviews` / `audit_logs` | 评审 / 审计日志 | ~5 / ~5 |
| `scan_documents` / `scan_doc_conflict_history` | 扫描文档 / 冲突历史 | ~8 / ~7 |
| `spec_workspaces` / `spec_file_manifest` | spec 工作区策略 / 平台管理文件清单（增量同步） | ~7 / ~7 |
| `spec_profile_manifests` / `spec_conflicts` | profile manifest / 冲突 | ~8 / ~5 |
| `platform_settings` | 平台设置 | ~3 |

### Daemon / 运行时 / 工具
| 表名 | 说明 | 字段数 |
|---|---|---|
| `daemon_instances` / `daemon_runtimes` | daemon 实体（build_id/版本）/ 运行时（allowed_roots） | ~14 / ~12 |
| `daemon_task_leases` / `daemon_change_writes` | 任务租约 / 变更写回记录 | ~12 / ~8 |
| `session_dialog_requests` | 交互式对话请求 | ~10 |
| `policy_audit_log` / `tool_policies` / `tool_operation_logs` | 工具策略审计 / 策略 / 操作日志 | ~6 / ~7 / ~6 |
| `worktree_leases` | worktree 租约 | ~10 |
| `custom_skills` | 自定义技能 | ~5 |
| `git_identities` / `git_operation_logs` | Git 凭证 / 操作日志 | ~8 / ~6 |

### 平台同步 / MCP
| 表名 | 说明 | 字段数 |
|---|---|---|
| `platform_change_progress` | CLI 进度镜像（latest_progress 投影源，id 主键 + change_name+workspace 复合唯一） | ~9 |
| `quicklog_entries` | QUICKLOG 条目上行 | ~6 |
| `platform_sync_tokens` | shpsync_ 同步 token（sha256 直存） | ~9 |
| `mcp_tokens` / `mcp_webhooks` | 对外 MCP token / webhook | ~9 / ~8 |

### 发布 / 事件 / 文件 / LLM
| 表名 | 说明 | 字段数 |
|---|---|---|
| `releases` / `release_approvals` | 发布 / 发布审批 | ~10 / ~5 |
| `incidents` / `postmortems` | 事件（FSM 状态机）/ 复盘 | ~10 / ~5 |
| `file` | 平台文件中心（对象存储引用） | ~7 |
| `llm_providers` | LLM 提供方 | ~10 |

### PPM 子域（22 张）
| 表名 | 说明 | 字段数 |
|---|---|---|
| `ppm_project_maintenance` / `ppm_customer_maintenance` | 项目维护 / 客户维护 | ~12 / ~6 |
| `ppm_project_member` / `ppm_project_stakeholder` | 项目成员 / 干系人 | ~10 / ~6 |
| `ppm_plan_node` / `ppm_plan_node_detail` / `ppm_plan_node_module` | 计划三级 | ~8 each |
| `ppm_ps_project_plan` / `ppm_ps_plan_node` / `ppm_ps_plan_node_detail` / `ppm_ps_plan_node_detail_process` | 项目计划模板体系 | ~10 / ~8 / ~8 / ~8 |
| `ppm_plan_task` / `ppm_task_execute` / `ppm_work_hour` | 计划任务 / 执行 / 工时 | ~20 / ~15 / ~5 |
| `ppm_problem_list` / `ppm_problem_change` | 问题清单 / 变更 | ~18 / ~10 |
| `ppm_problem_list_process_task` / `ppm_problem_change_process_task` / `ppm_problem_list_process_log` / `ppm_problem_change_process_log` | 流程任务/日志 | ~6 each |
| `ppm_kanban_comment` / `ppm_kanban_subtask` | 看板评论 / 子任务 | ~6 each |

## 迁移与部署

- Alembic 迁移目录：`backend/migrations/versions/` 共 **144 个** version 文件，含 10 个 merge revision（多并行 head 经 merge 收敛，如 `20260817100000_merge_quicklog_and_run_sender`）。
- 部署形态：Docker Compose（后端 + 前端 + PostgreSQL + Redis + MinIO）；`spec_data_root` / `worktree_base_dir` 按 `sys.platform` 分支（Windows=`C:/data/...`、Linux=`/data/...`）。
- 配置入口：环境变量 > `backend/.env`（非生产）> 类默认值；`commit_sha` 缺失时 `git rev-parse` 兜底。
- 其它配套：`create_tables.py`（建表工具）、`docker-entrypoint.sh`（迁移+启动）、`scripts/`（含 dump_openapi 等）、`seed_workbench_demo.py`（工作台演示数据）。

## 备注

- 数据库方言分支：生产 PG（asyncpg，带会话超时 server_settings）/ 测试 SQLite（aiosqlite，忽略 server_settings）；断言避免绑死 SQL 函数名。
- daemon-client 模式下 spec 文件同步已由 tar 全量覆盖升级为 manifest/sync 增量通道（platform_sync）；`shared` 为 legacy 同机 bind mount 语义，server-local 移除后无合法消费者。
- 旧版文档中部分表名为复数近似（如 `daemon_borrow_audits`/`policy_audit_logs`/`ppm_kanban_comments`/`files` 等），本次已按 `__tablename__` 实际值逐一修正。
- telemetry 为 stub：`otel_endpoint` 配置存在但未接 OpenTelemetry SDK，仅打 `telemetry.init` 日志。
