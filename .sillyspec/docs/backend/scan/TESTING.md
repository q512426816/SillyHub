---
source_commit: fcbf3fa7
updated_at: 2026-06-22T18:12:26Z
generator: sillyspec-scan
author: qinyi
created_at: 2026-06-23 02:12:26
---

# Backend 测试约定（TESTING）

> 基于 `backend/conftest.py`、`pyproject.toml [tool.pytest.ini_options]`、`tests/` 与 `app/modules/*/tests/` 目录实测。

## 测试框架与配置

- **pytest ≥ 8 + pytest-asyncio**：`asyncio_mode = "auto"`，所有 `async def test_*` 自动作为协程测试运行，无需 `@pytest.mark.asyncio` 装饰。
- **testpaths = ["tests", "app"]**：同时收集顶层集成测试（`backend/tests/`）和模块内单测（`app/modules/*/tests/`）。
- **python_files = ["test_*.py"]**；`addopts = "-ra"`。
- **pytest-cov ≥ 5** 提供覆盖率；**anyio ≥ 4** 用于异步安全测试；**aiosqlite ≥ 0.20** 提供测试用内存 SQLite。
- README 推荐覆盖率门禁：`uv run pytest -q --cov=app --cov-fail-under=60`。

## 运行命令

- 全量测试：`cd backend && uv run pytest`
- 带覆盖率：`cd backend && uv run pytest -q --cov=app --cov-fail-under=60`
- Lint：`cd backend && uv run ruff check . && uv run ruff format --check .`
- 类型：`cd backend && uv run mypy app`

## 测试隔离策略（`backend/conftest.py`）

测试**不依赖**真实 Postgres / Redis，全部 hermetic：

1. **环境变量预注入**：在 `from app.*` 任何 import 之前设置 `DATABASE_URL`（指向 dummy PG URL，实际走内存 SQLite）、`REDIS_URL=redis://localhost:6379/15`、`SECRET_KEY`、`ENVIRONMENT=test`、`SILLYSPEC_MASTER_KEY`、`SPEC_DATA_ROOT=<tempdir>`。
2. **`_reset_settings_cache`（autouse）**：每个测试前 `get_settings.cache_clear()` 并 monkey-patch `Settings.__init__`，把 `spec_data_root` 默认到 tempdir（避免 CI 无 `/data` 写权限），测试后还原。
3. **`db_engine` fixture**：创建内存 SQLite（`sqlite+aiosqlite:///:memory:`），显式 import 全部 feature `model` 模块以注册表到 `BaseModel.metadata`，`create_all` 建表。
4. **`db_session` fixture**：基于 `db_engine` 的 `async_sessionmaker`，`expire_on_commit=False`。
5. **`_redirect_session_factory`（autouse）**：把 `get_session_factory()` 指向测试引擎，保证 SSE/后台任务短会话也落到内存 SQLite（不触碰真实 PG）。
6. **`client` fixture**：`httpx.AsyncClient` + `ASGITransport(app=app)`，用 `app.dependency_overrides[get_session]` 把会话工厂替换到测试引擎；结束清理 override。
7. **`auth_admin_token` / `auth_headers`**：内存创建平台管理员用户并签发 JWT，返回 `{"Authorization": "Bearer ..."}`。
8. **`_isolate_permission_timers`（autouse）**：每个异步测试前后清理 daemon `permission_service._permission_timers` 单例，避免悬挂 task 跨测试泄漏。

## 测试目录结构

- **顶层**：`backend/tests/test_config.py`、`test_health.py`、`tests/core/`（如 `test_auth_deps_principal.py`）、`tests/modules/<feature>/`。
- **模块内**：`app/modules/<feature>/tests/test_*.py`，与顶层并存，均被 `testpaths=["tests","app"]` 收集。
- PPM 子域：`app/modules/ppm/common/tests/`（如 `test_crud.py`）。
- daemon：`app/modules/daemon/tests/`（含 protocol / ws / session 测试）。

## fixtures 摘要

| fixture | 作用域 | 用途 |
| --- | --- | --- |
| `db_engine` | function | 内存 SQLite 引擎 + 建表 |
| `db_session` | function | `AsyncSession` |
| `client` | function | `httpx.AsyncClient` 绑定 ASGI app |
| `auth_admin_token` | function | 平台管理员 JWT |
| `auth_headers` | function | `{"Authorization": "Bearer ..."}` |
| `_reset_settings_cache` | autouse | 清 Settings 缓存 + tempdir spec root |
| `_redirect_session_factory` | autouse | 重定向 `get_session_factory` 到测试引擎 |
| `_isolate_permission_timers` | autouse | 清理 daemon 权限定时器单例 |

模块内自定义 fixture 示例：`worktree/tests/test_router.py` 的 `mock_git` / `mock_exec_env` / `mock_cipher`。

## 测试风格

- 异步测试函数名以 `test_` 开头，参数注入 fixture（`db_session`、`client: AsyncClient`、`auth_headers`）。
- 测试模块放宽 ruff 规则（`N802/N803/N806/E402/B017`），允许大写命名、import 顺序、`pytest.raises(Exception)` 宽泛断言。
- 跨用户权限场景显式构造第二个用户/会话（如 `test_cross_user_release_403`），不依赖 fixture 默认管理员。
- 涉及 Redis pub/sub（AgentRun SSE、daemon WS hub）的测试若触碰真实 Redis 会脆弱或被跳过（CONCERNS 已记）。
