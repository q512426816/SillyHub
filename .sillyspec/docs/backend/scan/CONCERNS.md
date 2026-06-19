---
author: qinyi
created_at: 2026-06-19 12:50:59
source_commit: 0303536
updated_at: 2026-06-19T04:50:59Z
generator: sillyspec-scan
---

# Backend 关注点与债务（CONCERNS）

> 基于 grep（`TODO|FIXME|XXX|HACK|deprecated`）、`pyproject.toml` 配置、`app/core/*` 摘录的真实债务。按严重程度 🔴 / 🟡 / 🟢 分组。

## 代码质量

- 🟡 **mypy 实质失效**：`strict = false` 且 `disable_error_code` 显式关闭 9 类（`attr-defined`、`union-attr`、`assignment`、`arg-type`、`valid-type`、`operator`、`call-overload`、`call-arg`、`unused-ignore`），`ignore_missing_imports = true`。类型检查约束极弱，新增代码的类型错误基本不会被拦截。建议逐步收窄 `disable_error_code` 列表。
- 🟡 **`main.py` 内联 quick-chat 路由（446 行）**：`/api/daemon-chat*` 四个端点（POST/GET/stream/kill/logs）直接定义在 `create_app` 闭包内，用裸 `sa_text` SQL 操作 `agent_runs` 表，绕过了模块四件套（service/model/schema）。维护成本高，SQL 与 ORM 模型易漂移。
- 🟢 **`spec_profile` 多处 TODO 未实现**（`app/modules/spec_profile/provider.py` 行 76/86/96、`policy.py` 行 61/97）：
  - `# TODO: implement actual discovery in follow-up task`
  - `# TODO: implement actual loading in follow-up task`
  - `# TODO: implement in follow-up task`
  - `# TODO: implement stage conflict detection`
  - `# TODO: implement document conflict detection`
  
  该模块功能尚未完成，调用方需注意返回值可能是占位。

- 🟢 **已废弃代码仍在仓库**：
  - `app/modules/workflow/fsm.py::ChangeFSM` 标记 `deprecated`，状态机迁至 `change.model.StageEnum + TRANSITIONS`；`test_fsm.py` 仍在测试 deprecated 路径（`_import_deprecated`）。
  - `app/modules/agent/coordinator.py` 的 `start_sillyspec_run` 等方法 `.. deprecated::`（行 481/551），日志记 `deprecated_method_called`。
  - `app/modules/agent/base.py` 行 39/143 含 `.. deprecated::` docstring。
  
  本项目未上线、不考虑兼容，可择机删除。

- 🟢 **错误类命名不一致**：抽象基类 `AppError(Exception)`（后缀 `Error`），但大量领域错误按事件命名（`WorkspaceNotFound`、`ChangeNotFound`），ruff 因此关闭 `N818`。属有意约定，但对新人阅读有门槛。

## 依赖风险

- 🟡 **OpenTelemetry 仍是 stub**：`app/core/telemetry.py` 仅 `log.info("telemetry.init", status="stub")`，未真正接入 exporter；若生产依赖链路追踪会落空。需确认是否纳入路线图或移除配置项。
- 🟡 **Redis 在测试中未真正隔离**：`conftest.py` 设置 `REDIS_URL=redis://localhost:6379/15`，但未提供 fake/in-memory redis fixture；涉及 pub/sub（AgentRun 日志 SSE、daemon WebSocket hub）的测试若触碰真实 Redis 会脆弱或被跳过。
- 🟡 **生产密钥管理依赖环境变量**：`SECRET_KEY`、`SILLYSPEC_MASTER_KEY`、`PLATFORM_BOOTSTRAP_ADMIN_PASSWORD` 全部走 env / `.env`，无 KMS/Vault 集成；容器编排需自行保证密钥注入与轮转。
- 🟢 **`psycopg` vs `asyncpg` 切换风险低**：依赖锁死 `asyncpg≥0.29` + `postgresql+asyncpg://` URL，但 `resolved_commit_sha` 在 `subprocess.check_output(["git", ...])` 失败时静默回退 `"unknown"`（生产容器可能无 git），健康端点的 version 字段可能无意义。
- 🟢 **bcrypt rounds 上限 15**：`auth_bcrypt_rounds: int = Field(12, ge=4, le=15)`，上线后若需提升到 15 以上需改约束。
- 🟢 **`passlib[bcrypt]` + `passlib-stubs`**：依赖列表里有 `types-passlib`（dev），但 `.venv` 中存在 `passlib-stubs`——类型来源可能重复，需确认一致性。

## 架构风险

- 🟡 **路由挂载顺序是隐式契约**：`_register_quick_chat(app)` 必须早于 `workspace_router`；`members_router` 必须兄弟挂载（不能 `include_router(prefix=...)`）。新人新增带 `{workspace_id}` 前缀的定长路由时极易踩坑（FastAPI 路由匹配不区分定长/参数优先级）。建议加单元测试断言挂载顺序，或迁移到显式 `include_router(prefix=..., name=...)`。
- 🟡 **裸 SQL 散落**：除 `main.py` quick-chat 外，需留意其他模块是否也绕过 ORM 直接 `sa_text`（grep 显示 quick-chat 是集中点），SQL 字段名与模型列名耦合，迁移易断裂。
- 🟢 **审计钩子全局生效**：`audit_hooks.py` 对所有 `BaseModel(table=True)` 生效，高写入表（如 `agent_run_logs`）会产生大量 audit 记录，需确认 `audit_logs` 表容量与清理策略。
