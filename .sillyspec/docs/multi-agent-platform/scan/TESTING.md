---
source_commit: ba87eec
updated_at: 2026-06-23T16:35:30Z
created_at: 2026-06-24T00:35:30
author: qinyi
generator: sillyspec-scan
---

# multi-agent-platform — 测试说明（组件视角）

## 总览

根项目本身**没有任何测试**（根 `package.json` 的 `test` 是默认 `echo "Error: no test specified" && exit 1` 占位）。
所有测试分布在 3 个子项目内独立运行，命令必须在对应子项目目录下执行，或通过根 `Makefile` 的聚合 target 调用。
测试策略总体为 **module（按模块就近测试）**：backend `testpaths` 同时发现 `tests/` 顶层套件与各模块本地 `app/modules/*/tests/`，daemon/frontend 测试文件与源码同级放置。

## 各组件测试策略

### backend — pytest（pytest-asyncio + pytest-cov）

- 测试框架：pytest（dev extras：`pytest>=8`、`pytest-asyncio`、`pytest-cov>=5`）
- 配置：`backend/pyproject.toml` 的 `[tool.pytest.ini_options]`
  - `asyncio_mode = "auto"`（自动将 `async def test_` 视为协程用例）
  - `addopts = "-ra"`
  - `testpaths = ["tests", "app"]`（同时发现顶层集成套件与各模块 `app/modules/*/tests/` 本地单测）
  - `python_files = ["test_*.py"]`
- 顶层 conftest：`backend/conftest.py`
- 运行命令（`backend/` 下）：`uv run pytest`，或从根目录 `make backend-test`
- 实测统计（`rg "def test_|async def test_"`，已排除 `backend/.venv`）：
  - 测试函数数：**1757**
  - 测试文件数：**153**

### frontend — vitest（@testing-library/react + jsdom）

- 测试框架：vitest 2.x（dev dep），配合 `@testing-library/react`、`jsdom`
- 配置：`frontend/package.json` 的 `scripts.test = "vitest run"`、`scripts.test:watch = "vitest"`
- 测试文件分布：`frontend/src/**/*.test.ts(x)`、`frontend/src/**/__tests__/*.test.ts(x)`
- 测试 setup：`frontend/src/test/setup.ts`
- 运行命令（`frontend/` 下）：`pnpm test`，或从根目录 `make frontend-test`（即 `pnpm test --run`）
- 实测统计（`rg "describe\(|it\(|test\("`）：测试文件数 **36**
- E2E：声明了 `@playwright/test`（1.60）依赖，但**仓库内无 `playwright.config.*`**，E2E 用例未配置；另声明了 `puppeteer`（24.43）用于运行时浏览器自动化，二者均未形成独立 E2E 套件

### sillyhub-daemon — vitest（--passWithNoTests）

- 测试框架：vitest 2.x（dev dep）
- 配置：`sillyhub-daemon/package.json` 的 `scripts.test = "vitest run --passWithNoTests"`、`scripts.test:watch = "vitest"`
- 测试目录：`sillyhub-daemon/tests/`，含子目录 `adapters/`、`interactive/`、`fixtures/`、`helpers/`
- 运行命令（`sillyhub-daemon/` 下）：`pnpm test`
- `interactive/` 子目录聚焦 Claude SDK driver、session 恢复、权限解析、并发注入等交互式会话逻辑（16 个测试文件）
- 实测统计（`rg "describe\(|it\(|test\("`）：测试文件数 **65**
- 注意：`test` 脚本带 `--passWithNoTests`，无匹配文件时不会失败

## CI 现状（GitHub Actions）

仓库 `.github/workflows/` 下有两条按路径触发的工作流：

| 工作流 | 触发路径 | 作业步骤 | 测试命令 |
| --- | --- | --- | --- |
| `backend-ci.yml` | `backend/**` | ruff check → ruff format check → mypy → pytest | `uv run pytest -q --cov=app --cov-fail-under=60` |
| `frontend-ci.yml` | `frontend/**` | lint → typecheck → test → build | `pnpm test` |

- backend CI 强制覆盖率门槛 **60%**（`--cov-fail-under=60`），环境变量 `ENVIRONMENT=test`，测试库 `platform_test`、Redis DB 15
- daemon **无独立 CI 工作流**（`.github/workflows/` 下无 daemon 相关 yaml）
- 两条工作流均按路径过滤，互不交叉触发

## 测试文件数量汇总

| 子项目 | 框架 | 测试文件数 | 测试函数数 | 命令 |
| --- | --- | --- | --- | --- |
| backend | pytest + asyncio + cov | 153 | 1757 | `cd backend && uv run pytest` |
| frontend | vitest + testing-library | 36 | — | `cd frontend && pnpm test` |
| sillyhub-daemon | vitest（--passWithNoTests） | 65 | — | `cd sillyhub-daemon && pnpm test` |
| 根 | — | 0（占位） | 0 | 无（根 `make test` = backend-test + frontend-test） |

## 注意事项

- 所有命令默认在各子项目目录下运行；根目录下只能用 `make backend-test` / `make frontend-test` / `make test` 聚合 target。
- backend 测试同时发现 `tests/` 与 `app/` 两处（`testpaths` 配置），153 个文件已排除 `backend/.venv`。
- daemon 的 `test` 脚本带 `--passWithNoTests`，无匹配文件时不会失败；目前实际有 65 个文件匹配。
- frontend 的 `playwright` 依赖虽已声明但仓库内无配置文件，E2E 未落地。
- daemon 无 CI 工作流，测试只在本地运行。
