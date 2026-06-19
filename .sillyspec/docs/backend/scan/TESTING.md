---
author: qinyi
created_at: 2026-06-19 12:50:59
source_commit: 0303536
updated_at: 2026-06-19T04:50:59Z
generator: sillyspec-scan
---

# Backend 测试约定（TESTING）

> 基于 `backend/conftest.py`、`pyproject.toml [tool.pytest.ini_options]`、124 个测试文件的 grep/ls 实测。

## 测试框架与配置

- **pytest ≥ 8 + pytest-asyncio**：`asyncio_mode = "auto"`，所有 `async def test_*` 自动作为协程测试运行，无需 `@pytest.mark.asyncio` 装饰。
- **testpaths = ["tests", "app"]**：同时收集顶层集成测试（`backend/tests/`）和模块内单测（`app/modules/*/tests/`）。
- **python_files = ["test_*.py"]**；`addopts = "-ra"`。
- **pytest-cov ≥ 5** 提供覆盖率；**anyio ≥ 4** 用于异步安全测试；**aiosqlite ≥ 0.20** 提供测试用内存 SQLite。

## 运行命令

- 全量：`cd backend && uv run pytest`
- Lint：`cd backend && uv run ruff check .`
- 类型：`cd backend && uv run mypy app/`

## 测试隔离策略（`backend/conftest.py`）

测试**不依赖**真实 Postgres / Redis，全部 hermetic：

1. **环境变量预注入**：在 `from app.*` 任何 import 之前设置 `DATABASE_URL`（指向一个不会被实际连接的 dummy PG URL，测试全走内存 SQLite）、`REDIS_URL=redis://localhost:6379/15`、`SECRET_KEY`、`ENVIRONMENT=test`、`SILLYSPEC_MASTER_KEY`、`SPEC_DATA_ROOT=<tempdir>`。
2. **`_reset_settings_cache`（autouse）**：每个测试前 `get_settings.cache_clear()` 并 monkey-patch `Settings.__init__`，把 `spec_data_root` 默认到 tempdir（避免 CI 无 `/data` 写权限），测试后还原。
3. **`db_engine` fixture**：创建内存 SQLite（`sqlite+aiosqlite:///:memory:`），显式 import 全部 feature `model` 模块以注册表到 `BaseModel.metadata`，`create_all` 建表。
4. **`db_session` fixture**：基于 `db_engine` 的 `async_sessionmaker`，`expire_on_commit=False`。
5. **`client` fixture**：`httpx.AsyncClient` + `ASGITransport(app=app)`，用 `app.dependency_overrides[get_session]` 把会话工厂替换到测试引擎；结束清理 override。
6. **`auth_admin_token` / `auth_headers`**：内存创建平台管理员用户并签发 JWT，返回 `{"Authorization": "Bearer ..."}`，用于受保护路由测试。

## 测试覆盖面（按 `tests/modules/` + `app/modules/*/tests/`）

模块级测试目录覆盖（部分）：

- **auth**：`test_api_key_lifecycle.py`、`test_api_key_router.py`、`test_api_key_service.py`、`test_permissions.py`、`test_seed.py`。
- **core**：`test_auth_deps_principal.py`（验证 `get_current_principal` JWT/API-Key 双路径）。
- **admin**：`test_users_router.py`、`test_organizations_router.py`、`test_roles_router.py`、`test_module_skeleton.py`。
- **agent**：`test_coordinator.py`、`test_context_builder.py`、`test_diff_collector.py`、`test_m2n_agent_run.py`、`test_scan_dispatch.py`、`test_spec_bundle_stage_dispatch.py`、`test_stage_dispatch.py`、`test_tool_failure_monitor.py`、`test_work_dir_strategy.py`、`test_agent_session_model.py`。
- **change**：`test_archive_gate.py`、`test_dispatch.py`、`test_dispatch_chain.py`、`test_dispatch_stage_config.py`、`test_e2e_stage_dispatch.py`、`test_auto_dispatch.py`、`test_router_transition.py`；模块内 `test_transition_response.py`。
- **daemon**：`test_protocol_session_contract.py`、模块内 `test_ws_rpc.py`、`test_ws_hub_permission.py`、`test_session_history.py`、`test_session_router.py`。
- **workspace**：`test_scan_generate.py`、`test_scan_generate_service.py`、`test_members_router.py`、`test_migration_path_source.py`、`test_model_path_source.py`、`test_schema_path_source.py`、`test_path_source_server.py`；模块内 `test_scanner.py`、`test_m2n_change.py`、`test_m2n_task.py`。
- **worktree**：模块内 `test_router.py`（`mock_git` / `mock_exec_env` / `mock_cipher` fixtures，覆盖 acquire/release/extend/list/跨用户 403）。
- **release / incident / git_gateway / tool_gateway / change_writer**：各有 `test_router.py` + `test_service.py`；`git_gateway` 含 `test_dangerous.py`。
- **scan_docs / spec_workspace / spec_profile**：`test_bundle_sync.py`、`test_policy.py`、`test_markdown_builder.py`。
- 顶层：`test_config.py`、`test_health.py`。

## 测试风格

- 异步测试函数名以 `test_` 开头，参数注入 fixture（`db_session`、`client: AsyncClient`、`auth_headers`）。
- 测试模块放宽 ruff 规则（`N802/N803/N806/E402/B017`），允许大写命名、import 顺序、`pytest.raises(Exception)` 宽泛断言。
- 跨用户权限场景显式构造第二个用户/会话（如 `test_cross_user_release_403`），不依赖 fixture 默认管理员。
