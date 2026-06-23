---
source_commit: ba87eec
updated_at: 2026-06-23T16:20:03Z
created_at: 2026-06-24T00:20:03
author: qinyi
generator: sillyspec-scan
---

# Backend 关注点与债务（CONCERNS）

> 基于 grep（`TODO|FIXME|deprecated|NotImplemented`）、`pyproject.toml` 配置、`app/main.py`、`app/core/*`、`app/modules/agent/model.py` 摘录的真实债务。按严重程度 🔴 严重 / 🟡 中等 / 🟢 轻微 分组。

## 代码质量

- 🔴 **AgentRunLog 表无 metadata 列（已知约束）**：`app/modules/agent/model.py` 第 274 行 `class AgentRunLog(BaseModel, table=True)` 表 `agent_run_logs` 仅有 5 列：`id / run_id / timestamp / channel / content_redacted`，**没有 metadata 列**。三层日志（tool_call / 结构化事件）的 metadata 在 daemon `submit_messages` 上报时丢失。模型注释（第 395 行附近）明确："intent metadata is stored; the source of truth remains AgentRun + Lease"。若需保留 tool_call 入参/出参等结构化字段，须先加迁移补列再改读写路径。这是当前 agent-run 调试链路的主要信息缺口。

- 🟡 **mypy 实质失效**：`[tool.mypy]` 中 `strict = false`，且 `disable_error_code` 显式关闭 9 类：`attr-defined / union-attr / assignment / arg-type / valid-type / operator / call-overload / call-arg / unused-ignore`，`ignore_missing_imports = true`。类型检查约束极弱，新增代码的类型错误基本不会被拦截。建议逐步收窄 `disable_error_code` 列表。
- 🟡 **`main.py` 内联 quick-chat 路由（约 290 行）**：`app/main.py`（共 458 行）第 119 行 `_register_quick_chat(app)` 在 `create_app` 闭包内定义 `/api/daemon-chat*` 四个端点（`POST /quick_chat`、`GET /get_quick_chat_result`、`GET /stream_quick_chat`、`POST /kill_quick_chat`、`GET /quick_chat_logs`），用裸 `sa_text` SQL 直接操作 `agent_runs` 表（行 152/167/200/228 等多处 `from sqlalchemy import text as sa_text`），绕过了模块四件套（service/model/schema）。维护成本高，SQL 字段名与 ORM 模型易漂移。
- 🟡 **裸 SQL 散落**：除 `main.py` quick-chat 外，SQL 字段名与模型列名耦合，迁移易断裂；需留意其他模块是否也绕过 ORM 直接 `sa_text`。

- 🟢 **`spec_profile` 多处 TODO 未实现**（实测命中）：
  - `app/modules/spec_profile/provider.py:76` — `# TODO: implement actual discovery in follow-up task`
  - `app/modules/spec_profile/provider.py:86` — `# TODO: implement actual loading in follow-up task`
  - `app/modules/spec_profile/provider.py:96` — `# TODO: implement in follow-up task`
  - `app/modules/spec_profile/policy.py:61` — `# TODO: implement stage conflict detection`
  - `app/modules/spec_profile/policy.py:97` — `# TODO: implement document conflict detection`

  该模块功能尚未完成，调用方需注意返回值可能是占位。
- 🟢 **NotImplementedError 占位**：`app/modules/git_identity/providers/base.py:22` `raise NotImplementedError`；`app/modules/agent/base.py:145` docstring 说明 `run` 抽象方法未实现会抛 `NotImplementedError`。
- 🟢 **已废弃代码仍在仓库**（本项目未上线、不考虑兼容，可择机删除）：
  - `app/modules/workflow/fsm.py:3` `.. deprecated::`，`ChangeFSM is deprecated. Use StageEnum + TRANSITIONS`（第 61/81 行）。
  - `app/modules/agent/coordinator.py:484/575` `.. deprecated::`，`start_sillyspec_run` 等方法记 `deprecated_method_called` 日志（第 503/509/580 行）。
  - `app/modules/agent/base.py:39/143` 含 `.. deprecated::` docstring。
  - `app/modules/workflow/tests/test_fsm.py` 专门测试 deprecated 路径的兼容性。
- 🟢 **错误类命名不一致**：抽象基类 `AppError(Exception)`（后缀 `Error`），但大量领域错误按事件命名（`WorkspaceNotFound`、`ChangeNotFound`），ruff 因此关闭 `N818`。属有意约定，但对新人阅读有门槛。

## 依赖风险

- 🟡 **OpenTelemetry 仍是 stub**：`app/core/telemetry.py` 仅 `log.info("telemetry.init", endpoint=..., status="stub")`（第 21 行），docstring 自述 "without having to depend on the OTEL SDK"，未真正接入 exporter；若生产依赖链路追踪会落空。需确认是否纳入路线图或移除 `otel_endpoint` 配置项。
- 🟡 **Redis 在测试中未真正隔离**：`conftest.py` 仅 `os.environ.setdefault("REDIS_URL", "redis://localhost:6379/15")`，未提供 fake/in-memory redis fixture；涉及 pub/sub（AgentRun 日志 SSE、daemon WebSocket hub）的测试若触碰真实 Redis 会脆弱或被跳过。
- 🟡 **生产密钥管理依赖环境变量**：`SECRET_KEY`、`SILLYSPEC_MASTER_KEY`、`PLATFORM_BOOTSTRAP_ADMIN_PASSWORD` 全部走 env / `.env`，无 KMS/Vault 集成；容器编排需自行保证密钥注入与轮转。
- 🟢 **`resolved_commit_sha` 静默回退**：`app/core/config.py:144` `resolved_commit_sha` 属性用 `subprocess.check_output(["git","rev-parse","--short=12","HEAD"])` 失败时 `return "unknown"`（第 162 行）；生产容器可能无 git，健康端点 version 字段可能无意义。
- 🟢 **bcrypt rounds 上限 15**：`app/core/config.py:48` `auth_bcrypt_rounds: int = Field(12, ge=4, le=15)`，上线后若需提升到 15 以上需改约束。
- 🟢 **`types-passlib` 类型来源**：dev 组含 `types-passlib`，若 `.venv` 同时存在 `passlib-stubs` 会重复，需确认一致性。

## 架构风险

- 🟡 **路由挂载顺序是隐式契约**：`app/main.py` 中 `_register_quick_chat(app)`（第 414 行）必须早于 `workspace_router`（第 415 行）；`members_router`（第 424 行）必须兄弟挂载（不能 `include_router(prefix=...)`，否则会 double-count 自带 prefix，代码注释明确记录这个 2026-06-16-workspace-members 的坑）。新人新增带 `{workspace_id}` 前缀的定长路由时极易踩坑（FastAPI 路由匹配不区分定长/参数优先级）。建议加单元测试断言挂载顺序。
- 🟢 **daemon facade 跨域引用**：`DaemonService` 通过 `self._facade` 反向注入实现跨子域调用，daemon 已拆 5 子包（lease/patch/run_sync/session/permission）。新增子包服务时需保持 facade 引用注入，否则跨域委托会 NPE。
- 🟢 **审计钩子全局生效**：`app/core/audit_hooks.py` 对所有 `BaseModel(table=True)` 生效（`_EXCLUDED_TABLES = {"audit_logs"}` 递归保护），高写入表（如 `agent_run_logs`）会产生大量 audit 记录，需确认 `audit_logs` 表容量与清理策略。实测 `table=True` 标注 **66 处**（约 60+ 张业务表）。
