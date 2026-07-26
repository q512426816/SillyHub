---
author: qinyi
created_at: 2026-07-27 00:35:31
source_commit: 6e78b29a
updated_at: 2026-07-26T16:35:31Z
generator: sillyspec-scan
---

# 测试(Testing)

## 框架与工具链

- **运行器**：pytest（`>=8`）+ pytest-asyncio（`asyncio_mode = "auto"`，全异步用例自动 `@pytest.mark.asyncio`）。
- **覆盖率**：pytest-cov，CI/Makefile 门禁 `--cov=app --cov-fail-under=60`（见 `backend/README.md`、根 `Makefile` 的 `backend-test`）。
- **并行化**：pytest-xdist，全量用 `-n auto` 把 ~50min 压到分钟级（`pyproject.toml` 注释 ql-20260723-010-32d6）。
- **静态检查**：ruff（lint + format，line-length=100，py312）+ mypy（pydantic 插件，`warn_unused_ignores`，多条 `disable_error_code`）。
- **配置出处**：`backend/pyproject.toml` 的 `[tool.pytest.ini_options]` / `[tool.ruff]` / `[tool.mypy]`。

## 测试布局与规模（实测）

- `testpaths = ["tests", "app"]`、`python_files = ["test_*.py"]` —— 既收顶层集成套件，也收各模块 `app/modules/<feature>/tests/` 内的单元测试。
- 顶层 `backend/tests/`：68 个 `test_*.py`（含 `tests/modules/<mod>/`、`tests/e2e/`、`tests/core/`）。
- 模块内 `backend/app/**/tests/test_*.py`：193 个（垂直切片自带测试，PPM/daemon/agent 等大模块占多）。
- 合计 **261 个测试文件**；非测试源码 `app/**/*.py`（排除 tests）共 273 个。
- `conftest.py` 共 9 个：根 `backend/conftest.py` + 8 个模块级（file / ppm 全系 / workspace.member_runtimes）。

## 测试环境策略（hermetic）

根 `conftest.py` 明确要求 **不依赖真实 Postgres/Redis**：

1. 在 import 前注入安全默认 env（`DATABASE_URL` 指 platform_test、`REDIS_URL` db=15、`SECRET_KEY`、`SILLYSPEC_MASTER_KEY`、`ENVIRONMENT=test`）。
2. 启动内存异步 SQLite 引擎（aiosqlite）并 override `get_session`，DB 用例自洽。
3. 提供完全 wired 的 `httpx.AsyncClient`（`ASGITransport`）做 HTTP 级测试。
4. `AUTH_BCRYPT_ROUNDS=4`（生产 12）：哈希正确性不变，只为省去全量累积的分钟级 setup 开销。
5. `SPEC_DATA_ROOT` 指向 tempfile，规避 CI 无 `/data` 写权限。
6. autouse fixture：`_reset_settings_cache` 清 Settings 缓存 + `_redirect_session_factory` 把 `get_session_factory` 指向测试引擎 + `_isolate_permission_timers` 清 daemon 权限定时器单例。

## 已知基线与运行命令

- 基线（`docs/code-quality-hardening-2026-07-24.md` 六批改后）：**backend 2955 passed / 10 skipped / 5 xfailed**，ruff ✅ / mypy ✅（494 文件全绿，零静态债务）。
- 日常命令：`uv run pytest -q --cov=app --cov-fail-under=60`（venv 路径 `backend/.venv/Scripts/python.exe`，勿用全局解释器，缺 aiobotocore）。
- SillySpec gate 用 `.sillyspec/local.yaml` 的 `test_strategy: module`：按 `git diff --name-only` 命中子模块跑对应 test（如 `app/modules/ppm`），未命中不跑，避免被 main 上预存的非业务模块 error 阻塞。

## 已知坑（均来自审计/记忆文档，引用可核）

- **全量 ~12min 超 gate 默认 10min timeout**：用 `SILLYSPEC_TEST_TIMEOUT_MS` 抬高（sillyspec 3.24+ 已可配，`local.yaml` 坑 2 已解）。
- **main 分支存在预存非业务模块 errors**：非 PPM 模块的预存失败与当前变更无关，gate 用子模块粒度规避（`local.yaml` 注释）。
- **单测 SQLite vs 生产 PostgreSQL 方言差异**：`date_trunc` 等需方言分支；aiosqlite 存本地 naive 时间做比较要转本地；断言不要绑死 SQL 函数名。
- **模块级 `NOW = datetime.now()` 坑**：模块级常量在 collection 时计算，全量 pytest 下 collection→执行 >120s 会使 "≈now" 断言失败；断言应用 test 内 `datetime.now()`。
- **过度 mock 遮蔽真实问题**：例如 `test_run_sync_gate_decision_task` 把 `_run_gate_via_delegate` 整个 AsyncMock 掉，致 H2 事务边界分支零覆盖（已补 `test_delegate_run_command.py` 聚焦回归）。
- **Redis 未真正隔离**：conftest 仅 setdefault `REDIS_URL`，无 fake/in-memory redis fixture；触碰 pub/sub（AgentRun SSE、daemon WS hub）的测试若撞真实 Redis 会脆弱。
