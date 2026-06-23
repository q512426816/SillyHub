---
source_commit: ba87eec
updated_at: 2026-06-23T16:32:31Z
created_at: 2026-06-24T00:32:31
author: qinyi
generator: sillyspec-scan
---

# SillyHub — 测试说明

## 总览

SillyHub 产品根**无测试**（根 `package.json` 的 `test` 为默认 `echo ... && exit 1` 占位）。所有测试在 3 个子项目内独立运行，命令须在对应子项目目录执行，或通过根 `Makefile` 聚合 target。

SillySpec 流程约定（`.sillyspec/.runtime/local.yaml`）：

- `test_strategy = module`（测试策略按模块粒度执行）
- `backend_test = "cd backend && uv run pytest -q --cov=app --cov-fail-under=60"`（覆盖率门槛 **≥ 60%**）
- `frontend_test = "cd frontend && pnpm test"`

## backend — pytest

- 测试框架：pytest ≥8 + pytest-asyncio ≥0.23 + pytest-cov ≥5（`backend/pyproject.toml` dev extras）
- pytest 配置（`backend/pyproject.toml [tool.pytest.ini_options]`）：
  - `asyncio_mode = "auto"`（异步测试自动套 event loop）
  - `testpaths = ["tests", "app"]`（同时发现顶层集成套件与各模块本地单测）
  - `python_files = ["test_*.py"]`
- 顶层 conftest：`backend/conftest.py`
- 运行命令（`backend/` 下）：`uv run pytest`，根目录：`make backend-test`
- 测试函数数（`def test_` / `async def test_`，已排除 `.venv`）：**1757 个**
- 测试目录：`backend/tests/`（顶层集成）+ 各模块 `backend/app/modules/*/tests/`（本地单测）

## frontend — vitest

- 测试框架：vitest ^2.0.0（dev），配合 `@testing-library/react` ^16、`@testing-library/jest-dom` ^6.4、`jsdom`、`@playwright/test` ^1.60、`puppeteer` ^24.43
- 配置：`frontend/package.json` scripts `test = "vitest run"`、`test:watch = "vitest"`
- 运行命令（`frontend/` 下）：`pnpm test`，根目录：`make frontend-test`（`pnpm test --run`）
- 测试文件分布：`frontend/src/**/*.test.ts(x)` 与 `frontend/src/**/__tests__/*.test.ts(x)`（覆盖组件、lib 工具、daemon/agent/ppm/hooks 等）
- 测试文件数（`*.test.ts` / `*.test.tsx`，已排除 `node_modules` / `.next` / `dist`）：**36 个**

## sillyhub-daemon — vitest

- 测试框架：vitest ^2.0.0（dev）
- 配置：`sillyhub-daemon/package.json` scripts `test = "vitest run --passWithNoTests"`、`test:watch = "vitest"`
- 运行命令（`sillyhub-daemon/` 下）：`pnpm test`
- 测试目录：`sillyhub-daemon/tests/`（含 `adapters/`、`interactive/` 子目录）
- 测试文件数（`*.test.ts` / `*.spec.ts`，已排除 `node_modules` / `dist`）：**65 个**

## 测试数量汇总

| 子项目 | 框架 | 测试量 | 运行命令 |
| --- | --- | --- | --- |
| backend | pytest + pytest-asyncio | 1757 个测试函数（cov ≥ 60） | `cd backend && uv run pytest` |
| frontend | vitest + Testing Library | 36 个测试文件 | `cd frontend && pnpm test` |
| sillyhub-daemon | vitest | 65 个测试文件 | `cd sillyhub-daemon && pnpm test` |
| 根（SillyHub 产品根） | — | 0（仅占位） | 无 |

## E2E 现状

- frontend 同时声明 `@playwright/test` ^1.60 与 `puppeteer` ^24.43 两套浏览器自动化依赖，但仓库内**未见独立 `playwright.config.*` / `e2e/` 目录**（无 playwright 配置文件），E2E 尚未形成独立测试套件；puppeteer/playwright 当前主要作为依赖引入，未见根级 E2E 运行脚本。

## 注意事项

- 所有命令默认在各子项目目录下运行；根目录只能用 `make backend-test` / `make frontend-test` 聚合 target（`make test` = `backend-test + frontend-test`）。
- backend 的 `testpaths` 同时覆盖 `tests/` 与 `app/`，统计的 1757 个测试函数已排除 `backend/.venv`。
- daemon 的 `test` 脚本带 `--passWithNoTests`，无匹配文件时不会失败。
- backend 测试用 `aiosqlite`（dev），生产用 `asyncpg` + PostgreSQL，存在 async 驱动方言差异风险（详见 CONCERNS.md）。
- SillySpec `test_strategy=module`：每个变更在 verify 阶段按受影响模块触发对应测试，而非全量跑。
