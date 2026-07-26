---
author: qinyi
created_at: 2026-07-27 00:35:31
source_commit: 6e78b29a
updated_at: 2026-07-26T16:35:31Z
generator: sillyspec-scan
---

# 架构(Architecture)

> 子项目:`backend/`(包名 `multi-agent-platform-api`)——多 Agent 协作平台的 FastAPI 后端。
> 本文为 `--force-rescan` 重新生成的快照,依据 `backend/` 实际源码(commit `6e78b29a`)。

## 技术栈

来源:`backend/pyproject.toml`、`backend/app/core/*.py`。

- **语言/运行时**:Python ≥ 3.12(`requires-python = ">=3.12"`)。
- **Web 框架**:FastAPI ≥ 0.115,ASGI 服务器 uvicorn[standard] ≥ 0.30。
  - 应用工厂 `create_app()`(`app/main.py`),挂 `lifespan` 启动钩子(引导管理员+RBAC、清理孤儿 agent run、对账 gate 任务、初始化对象存储)。
  - 文档:`/api/docs`(Swagger)、`/api/redoc`、`/api/openapi.json`。
  - 中间件:CORS(`cors_allowed_origins`)、`x-request-id` 透传、统一异常处理(`core/errors.py`)。
- **数据建模/校验**:Pydantic ≥ 2.8 + pydantic-settings ≥ 2.4;SQLModel ≥ 0.0.22。
- **ORM/数据库**:SQLAlchemy[asyncio] ≥ 2.0,异步驱动 asyncpg ≥ 0.29(PostgreSQL);测试用 aiosqlite。
  - 引擎与会话工厂:`core/db.py`(`get_engine`/`get_session_factory`/`get_session`),连接池 `pool_size=20 / max_overflow=30 / recycle=300s`,asyncpg 下发 `statement_timeout=30s`、`idle_in_transaction_session_timeout=10s`、`lock_timeout=5s`。
- **缓存/消息**:Redis ≥ 5.0(`core/redis.py`,API key 正负缓存、RBAC 权限缓存、SSE pub/sub、daemon 心跳)。
- **对象存储**:aiobotocore ≥ 3.8(S3 兼容,默认 MinIO;`modules/storage/factory.py`)。
- **迁移**:Alembic ≥ 1.13,`backend/migrations/versions/`(117+ 个 version 文件,多 head 经 merge revision 合并)。
- **认证/加密**:python-jose[cryptography] ≥ 3.3(JWT)、passlib[bcrypt] ≥ 1.7(口令)、pynacl ≥ 1.5(`core/crypto.py`,git 凭证箱)、`core/security.py`(签发/校验 access token)。
- **可观测性**:structlog ≥ 24.4(`core/logging.py` JSON 日志)、`core/telemetry.py`(OpenTelemetry,`otel_endpoint`)、`core/audit_hooks.py`(审计上下文注入到 `session.info`)。
- **HTTP 客户端**:httpx ≥ 0.27(LLM provider 转发、daemon 通信)。
- **工具库**:python-frontmatter(变更/文档解析)、openpyxl + Pillow(PPM Excel 导入/导出与图像)、python-multipart(文件上传)、psutil。
- **代码质量**:ruff(lint+format,line-length 100)、mypy(py312,非 strict,禁中文 `# type:ignore`)、pytest + pytest-asyncio + pytest-xdist(`-n auto` 并行)。

## 架构概览

### 分层

来源:`backend/app/` 目录结构、`app/main.py` router 注册段。

```
backend/app/
├── main.py              # FastAPI 入口:create_app / lifespan / include_router
├── core/                # 基础设施(与业务无关)
│   ├── config.py        # Settings(pydantic-settings,唯一运行配置源)
│   ├── db.py            # 异步 engine + session factory + 审计上下文注入
│   ├── redis.py         # Redis 连接
│   ├── security.py      # JWT 签发/校验
│   ├── crypto.py        # NaCl 对称加密(git 凭证等)
│   ├── auth_deps.py     # require_permission_any 等 FastAPI 依赖
│   ├── permission_cache.py  # RBAC 三键权限缓存 + 熔断器
│   ├── audit_hooks.py   # 审计 actor/workspace 注入
│   ├── paths.py / spec_paths.py  # 路径解析(spec_data_root 等)
│   ├── errors.py        # 统一异常处理器
│   ├── logging.py / telemetry.py
├── schemas/             # 跨模块共享 schema(待补充细目)
└── modules/             # 业务模块(各模块自管 router/service/queries/models)
```

### 业务模块(`app/modules/`)

来源:`ls backend/app/modules/` + `app/main.py` 的 `include_router` 调用。共 28 个一级模块(PPM 下含 6 个子域):

| 模块 | 职责 |
|---|---|
| `auth` | 用户、Session、Role/RolePermission、ApiKey、UserWorkspaceRole;登录、RBAC 种子 |
| `admin` | 组织(UserOrganization)、UserRole、用户/角色/组织管理 |
| `workspace` | 工作区、TaskWorkspace、AgentRunWorkspace、拓扑、成员运行时绑定 |
| `workspace/member_runtimes` | WorkspaceMemberRuntime(每个成员的 daemon 绑定) |
| `agent` | AgentRun / RunLog / Session / Mission / Dependency / Artifact / BorrowAudit;派发、协调、适配器 |
| `task` | 平台级任务 + parser |
| `change` | SillySpec 变更(Change/ChangeDocument)、阶段派发、gate 决策、投影 |
| `change_writer` | 变更文档 markdown 写回 |
| `scan_docs` | 扫描文档 + 冲突历史 |
| `spec_workspace` / `spec_profile` | spec 工作区策略 / profile manifest / conflict |
| `daemon` | DaemonInstance / Runtime / TaskLease / SessionDialog / ChangeWrite;WS hub、lease、host_fs delegate、分发(dist_router)、审计、session、run_sync、patch |
| `worktree` | WorktreeLease + git_runner + exec_env |
| `git_gateway` / `git_identity` | Git 操作网关 / Git 凭证(provider: github) |
| `tool_gateway` | 工具策略(ToolPolicy)+ 操作日志 |
| `llm_provider` | LlmProvider(cc-switch 式启停) |
| `skills` | CustomSkill admin CRUD |
| `release` | Release / ReleaseApproval |
| `incident` | Incident / Postmortem |
| `knowledge` | 知识库 parser/router |
| `runtime` | 运行时视图(spec_root 解析) |
| `workflow` | ChangeReview / AuditLog + spec_guardian |
| `settings` | PlatformSetting |
| `file` + `storage` | 平台文件中心(File)+ S3/MinIO 后端工厂 |
| `ppm/project` | PpmProject 维护/客户/成员/干系人 |
| `ppm/plan` | PlanNode 三级 + PsProjectPlan 模板体系 |
| `ppm/task` | PlanTask / TaskExecute / WorkHour |
| `ppm/problem` | 问题清单 + 变更 + 流程任务/日志 |
| `ppm/kanban` | 看板评论/子任务 |
| `ppm/workbench` | 工作台聚合(待办、可切换用户) |
| `health` | `/api/health` 探针 |

### 请求流

来源:`main.py` 中间件 + `core/db.py` `get_session`。

1. ASGI 入口 → CORS → `x-request-id` 中间件 → 异常处理器。
2. `get_session` 依赖:从连接池取 `AsyncSession`,从 Bearer token 解出 `audit_context`(actor_id / workspace_id)注入 `session.info`。
3. 路由层(`router.py`)→ 权限依赖(`require_permission_any` 等,走 `permission_cache` Redis 缓存)→ 服务层(`service.py`)→ 查询层(`queries.py`)→ SQLModel 表模型(`model.py`)。
4. 启动期 `lifespan` 引导:管理员与 RBAC 种子、清理孤儿 agent run、对账 gate 任务、初始化对象存储单例。

### 路由前缀约定

- 大多数业务路由挂在 `/api` 前缀下(workspace、auth、change、agent、daemon、task、llm_provider、tool_gateway、settings、admin 等)。
- `/api/workspaces/{workspace_id}/...` 是工作区作用域的统一入口;`members_router` 与 `member_runtimes_router` 作为同级兄弟挂载(避免 `workspace_id` 参数重复)。
- PPM 五个子域统一挂在 `/api/ppm`。
- 文件中心:`/api/file`。
- daemon 分发端点(`daemon_dist_router`,install.sh 等)无 `/api` 前缀,匹配 `install.sh` 契约。
- Quick Chat(`/api/daemon-chat*`)在参数化工作区路由之前注册以保匹配优先。

## DB Schema(表名 + 说明 + 字段数)

来源:`grep "class \w+\(.*table=True.*\)"` + 模型文件 `Field(` 计数。字段数为该表所在 `model.py` 的列定义近似(同文件多表时按行段估算,标注 "~")。

### 认证与组织
| 表名 | 说明 | 字段数 |
|---|---|---|
| `users` | 平台用户 | ~16 |
| `sessions` | 登录会话(含 rotate) | ~10 |
| `roles` | 角色 | ~5 |
| `role_permissions` | 角色-权限 | ~3 |
| `api_keys` | API Key(正负缓存节流) | ~12 |
| `user_workspace_roles` | 用户-工作区-角色 | ~5 |
| `organizations` | 组织树 | ~5 |
| `user_organizations` | 用户-组织 | ~3 |
| `user_roles` | 用户-角色(admin) | ~3 |

### 工作区与拓扑
| 表名 | 说明 | 字段数 |
|---|---|---|
| `workspaces` | 工作区 | ~15 |
| `task_workspaces` | 任务-工作区(M:N) | ~5 |
| `agent_run_workspaces` | AgentRun-工作区(M:N) | ~5 |
| `workspace_member_runtimes` | 成员 daemon 运行时绑定 | ~10 |

### Agent / 任务
| 表名 | 说明 | 字段数 |
|---|---|---|
| `agent_runs` | 一次 agent 执行(spec_strategy、provider、usage、gate 等) | ~45 |
| `agent_run_logs` | 执行日志(含 tool_kind、subagent、dedup_key) | ~14 |
| `agent_sessions` | 交互式会话(change/workspace 关联) | ~12 |
| `agent_missions` | 多 agent mission(团队编排) | ~12 |
| `agent_run_dependencies` | run 间依赖 | ~5 |
| `agent_artifacts` | 产出物 | ~6 |
| `daemon_borrow_audits` | 业务人员借用 daemon 审计 | ~7 |
| `tasks` | 平台级任务 | ~10 |

### 变更 / 工作流 / 文档
| 表名 | 说明 | 字段数 |
|---|---|---|
| `changes` | SillySpec 变更 | ~12 |
| `change_documents` | 变更文档(word_count) | ~6 |
| `change_reviews` | 评审 | ~5 |
| `audit_logs` | 审计日志 | ~5 |
| `scan_documents` | 扫描文档 | ~8 |
| `scan_doc_conflict_history` | 扫描冲突历史 | ~7 |
| `spec_workspaces` | spec 工作区策略 | ~7 |
| `spec_profile_manifests` | spec profile manifest | ~8 |
| `spec_conflicts` | spec 冲突 | ~5 |
| `platform_settings` | 平台设置 | ~3 |

### Daemon / 运行时 / 工具
| 表名 | 说明 | 字段数 |
|---|---|---|
| `daemon_instances` | daemon 实体(build_id、版本) | ~14 |
| `daemon_runtimes` | daemon 运行时(allowed_roots) | ~12 |
| `daemon_task_leases` | 任务租约 | ~12 |
| `session_dialog_requests` | 交互式对话请求 | ~10 |
| `daemon_change_writes` | 变更写回记录 | ~8 |
| `policy_audit_logs` | 工具策略审计 | ~6 |
| `worktree_leases` | worktree 租约 | ~10 |
| `tool_policies` | 工具策略 | ~7 |
| `tool_operation_logs` | 工具操作日志 | ~6 |
| `custom_skills` | 自定义技能 | ~5 |
| `git_identities` | Git 凭证 | ~8 |
| `git_operation_logs` | Git 操作日志 | ~6 |

### 发布 / 事件 / 文件
| 表名 | 说明 | 字段数 |
|---|---|---|
| `releases` | 发布 | ~10 |
| `release_approvals` | 发布审批 | ~5 |
| `incidents` | 事件 | ~10 |
| `postmortems` | 复盘 | ~5 |
| `files` | 平台文件中心(对象存储引用) | ~7 |
| `llm_providers` | LLM 提供方 | ~10 |

### PPM 子域
| 表名 | 说明 | 字段数 |
|---|---|---|
| `ppm_project_maintenance` | 项目维护 | ~12 |
| `ppm_customer_maintenance` | 客户维护 | ~6 |
| `ppm_project_members` | 项目成员(role_name) | ~10 |
| `ppm_project_stakeholders` | 项目干系人 | ~6 |
| `plan_nodes` / `plan_node_details` / `plan_node_modules` | 计划三级 | ~8 / ~8 / ~8 |
| `ps_project_plan` / `ps_plan_node*` | 项目计划模板体系 | ~10 / ~8 / ~8 / ~8 |
| `plan_tasks` | 计划任务(PPM) | ~20 |
| `task_executes` | 任务执行(数字状态) | ~15 |
| `work_hours` | 工时 | ~5 |
| `ppm_problem_lists` | 问题清单 | ~18 |
| `ppm_problem_changes` | 问题变更 | ~10 |
| `ppm_problem_list_process_*` / `ppm_problem_change_process_*` | 流程任务/日志 | ~6 each |
| `ppm_kanban_comments` / `ppm_kanban_subtasks` | 看板评论/子任务 | ~6 each |

> 说明:以上字段数为按 `Field(` 计数的近似值,主要反映模型规模;精确列定义以各 `model.py` 与 alembic 迁移为准。

## 迁移与部署

- Alembic 迁移目录:`backend/migrations/versions/`(117+ version 文件,含多个 merge revision 合并并行 head)。
- 部署形态:Docker Compose(后端 + 前端 + PostgreSQL + Redis + MinIO);`spec_data_root` / `worktree_base_dir` 按 `sys.platform` 默认 Windows=`C:/data/...`、Linux=`/data/...`。
- 配置入口:环境变量 > `backend/.env`(非生产)> 类默认值;`commit_sha` 缺失时由 `git rev-parse` 兜底。

## 备注

- 数据库方言分支:生产 PG(asyncpg,带会话超时)/ 测试 SQLite(aiosqlite,忽略 server_settings);断言避免绑死 SQL 函数名。
- daemon-client 模式下 spec 同步默认走 `tar`(backend 为真理源,daemon pull 缓存);`shared` 为 legacy 同机 bind mount 语义,server-local 移除后无合法消费者。
