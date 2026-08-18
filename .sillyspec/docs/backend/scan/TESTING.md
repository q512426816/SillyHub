---
author: qinyi
created_at: 2026-08-18 01:06:26
source_commit: 744e3de4
updated_at: 2026-08-17T17:06:26Z
generator: sillyspec-scan
---

# 测试（Testing）

## 运行命令

- 本机（根 `Makefile` 的 `backend-test` 目标）：`cd backend && uv run pytest -q --cov=app --cov-fail-under=60`。解释器走 `uv run`（backend/.venv），勿用全局 Python（缺 aiobotocore 等依赖）。
- CI（`.github/workflows/backend-ci.yml`）：`uv run pytest -n auto -q --cov=app --cov-fail-under=60 --reruns 2 --reruns-delay 1`。`--reruns 2` 为 CI 专用：2 核低资源下 xdist + async fixture + in-memory SQLite 偶发竞态（task/change/runtime reparse created=0 → StopIteration），本机 20 核全量 3931 passed 复现不了，靠重试兜底（`backend/pyproject.toml` dev 依赖注释与 workflow 注释均已核实一致）。
- 静态检查随 CI 同跑：`ruff check .` → `ruff format --check .` → `mypy app`。

## pytest 配置（backend/pyproject.toml [tool.pytest.ini_options]）

- `asyncio_mode = "auto"`：全异步用例免逐个装饰器。
- `testpaths = ["tests", "app"]` + `python_files = ["test_*.py"]`：同时收顶层集成套件与各模块内单元测试。
- `addopts = "-ra -o dist=loadscope"`：xdist 并行时按模块/类把测试整体绑到同一 worker（非默认 round-robin），消除跨模块状态交叉导致的 reparse created=0 flaky（2026-08-13 ql-002 定位，pyproject 注释在案）；仅 `-n` 激活时生效。
- 并行：`pytest-xdist>=3.5`，全量 `-n auto` 把 ~50min 压到分钟级（20 核，pyproject 注释）。
- 重试：`pytest-rerunfailures>=14.0`，只有 CI 显式加 `--reruns 2 --reruns-delay 1`，本机不加（无重试成本）。

## 测试布局与规模（Glob 实测）

- 顶层 `backend/tests/`：76 个 `test_*.py`，按 `modules/<域>/`、`core/`、`e2e/` 分组。
- 模块内 `backend/app/modules/**/test_*.py`：278 个（垂直切片自带测试，agent / daemon / ppm / workspace 等大模块占多）。
- 合计 354 个测试文件；`conftest.py` 共 13 个（根 1 个 + 模块级 12 个：ppm 六域、file、mcp_gateway、change、daemon、workspace.member_runtimes、platform_sync）。

## 测试环境策略（根 backend/conftest.py，hermetic）

- import 前注入安全默认 env（`DATABASE_URL`、`SILLYSPEC_MASTER_KEY`、`AUTH_BCRYPT_ROUNDS=4`、`ENVIRONMENT=test`），不依赖真实 Postgres/Redis 起本职服务。
- `db_engine` / `db_session`：每测试全新 in-memory 异步 SQLite（aiosqlite）+ 建表（docstring 明示 "fresh in-memory async SQLite engine"）；autouse `_redirect_session_factory` 把 get_session 指向测试引擎。
- `client`：httpx AsyncClient（ASGITransport）全 wired，做 HTTP 级测试。
- `_reset_redis_state`（autouse）：每测试重建 redis 进程级单例绑定当前 event loop + `FLUSHDB` 清 db15（根因是登录失败计数/captcha 跨测试残留 + 连接池绑旧 loop，fixture docstring 有完整说明）；redis 不可用时 best-effort 跳过、限流降级放行。
- 其余 autouse 隔离族：`_reset_settings_cache`、`_isolate_permission_timers`、`_isolate_background_tasks`、`_reset_lazy_singletons`。
- 身份与数据：`auth_admin_token` / `auth_headers` 提供管理员身份；`seed_spec_root` / `seed_spec_root_fn` 造 `.sillyspec` 目录树。

## 守护测试

- 错误文案中文化守护：`tests/core/test_error_message_l10n.py`（参数化断言用户面报错保持中文，防新代码回退英文硬编码；本轮只核实到 2 个测试函数带参数化展开，不虚构用例数）。
- 审计挂载守护：`tests/core/test_audit_hooks_effective.py`；登录/设置手工审计：`tests/modules/auth/test_login_audit.py`、`tests/modules/settings/test_settings_audit.py`。
- config/spec 传输：`tests/core/test_config_spec_transport.py`、`tests/test_config.py`。

## 覆盖域清单（backend/tests/ 主要文件，按域分组罗列）

- auth（15）：test_api_key_router / test_api_key_lifecycle / test_api_key_service / test_seed / test_change_password / test_login_username / test_login_captcha / test_login_audit / test_refresh_grace_window / test_refresh_token_index / test_business_member_role / test_ppm_permissions / test_permissions / test_bootstrap_password_strength / test_bootstrap_username_dedup
- agent（15）：test_execution / test_mission_derive / test_delegation / test_coordinator / test_control / test_stage_dispatch / test_spec_bundle_stage_dispatch / test_scan_interactive_dispatch / test_tool_failure_monitor / test_tool_kind / test_agent_run_log_tool_kind / test_placement_scan_mode / test_quick_chat_ownership / test_context_builder / test_work_dir_strategy
- daemon（7）：test_protocol_session_contract / test_session_sse / test_runtimes_usage_endpoint / test_migration_daemon_entity_binding / test_daemon_version_management / lease/test_complete_lease_stage_writeback / lease/test_provider_config_payload
- change（5）：test_archive_gate / test_dispatch / test_dispatch_stage_config / test_router_transition / test_parser_mtime
- workspace（10）：test_members_router / test_my_bindings_batch / test_generate_projects / test_scan_generate / test_scan_generate_service / test_component_catalog / test_members_service_business_member / test_member_runtimes / test_member_runtimes_model / test_migration_borrow_shared
- spec_workspace（2）：test_per_file_progress / test_apply_sync（spec 文件同步与逐文件进度）
- admin（6）：test_module_skeleton / test_organizations_router / test_roles_router / test_schema_username_login / test_users_dominance / test_users_router
- ppm（3）：test_router_smoke / test_project_workspace_link / test_project_member_manager_guard
- settings（2）/ scan_docs（1）：test_mcp_settings / test_settings_audit；test_source_columns
- core + e2e + 顶层（9）：test_auth_deps_principal / test_audit_hooks_effective / test_error_message_l10n / test_config_spec_transport / test_health / test_config / test_daemon_dist / test_session_zombie_migration / e2e/test_three_member_collaboration

## CI（.github/workflows/backend-ci.yml）

- 触发：push / pull_request（路径限 `backend/**` 与 workflow 自身）+ workflow_dispatch；ubuntu-latest，工作目录 backend。
- `timeout-minutes: 30`：2026-08-15 实测 15 分钟撞顶致 pytest 跑到 99% 被取消（测试零失败），全量 4000+ 用例 + 2 核 xdist + reruns 裕量放宽（workflow 注释在案）。
- 步骤：checkout → setup-uv（0.4.18）→ `uv python install 3.12` → `uv sync --all-extras` → ruff check → ruff format --check → mypy app → pytest（env 注入 DATABASE_URL/REDIS_URL/SECRET_KEY/ENVIRONMENT=test；实际用例仍由 conftest 换成内存 SQLite 引擎）。

## 已知坑

- CI flaky 兜底层：loadscope 挡大部分 + `--reruns 2` 重试，根因（2 核资源竞态）未根治（pyproject 注释明示）。
- 测试 SQLite vs 生产 PostgreSQL 方言差异：`date_trunc` 等需方言分支；断言勿绑死 SQL 函数名。
- 触碰 redis 限流/pub-sub 的用例依赖 `_reset_redis_state`；redis 不可用时相关路径静默降级，本机无 redis 的全量绿不等于覆盖了限流分支。
