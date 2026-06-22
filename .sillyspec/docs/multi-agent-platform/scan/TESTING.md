---
source_commit: fcbf3fa7
updated_at: 2026-06-22T17:56:21Z
generator: sillyspec-scan
author: qinyi
created_at: 2026-06-23 01:56:21
---

# multi-agent-platform — 测试说明

## 总览

根项目本身**没有任何测试**（根 `package.json` 的 `test` 是默认 `echo ... && exit 1` 占位）。
所有测试都在 3 个子项目内独立运行，**命令必须在对应子项目目录下执行**，或通过根 `Makefile` 的聚合 target。

## backend — pytest

- 测试框架：pytest（dev extras：`pytest>=8`、`pytest-asyncio`、`pytest-cov`）
- 配置：`backend/pyproject.toml` 的 `[tool.pytest.ini_options]`
  - `asyncio_mode = "auto"`
  - `testpaths = ["tests", "app"]`（同时发现顶层集成套件与模块本地单测）
  - `python_files = ["test_*.py"]`
- 顶层 conftest：`backend/conftest.py`
- 运行命令（在 `backend/` 下）：`uv run pytest`，或从根目录 `make backend-test`
- 测试目录：`backend/tests/`（顶层集成）+ 各模块 `backend/app/modules/*/tests/`（本地单测）
- 测试文件统计（`test_*.py`，已排除 `backend/.venv`）：**150 个**

## frontend — vitest

- 测试框架：vitest 2.x（dev dep），配合 `@testing-library/react`、`jsdom`、`@playwright/test`
- 配置：`frontend/package.json` 的 `scripts.test = "vitest run"`、`scripts.test:watch = "vitest"`
- 运行命令（在 `frontend/` 下）：`pnpm test`，或从根目录 `make frontend-test`（即 `pnpm test --run`）
- 测试文件分布：`frontend/src/**/*.test.ts(x)`、`frontend/src/**/__tests__/*.test.ts(x)`
- 测试文件统计（`*.test.ts` / `*.test.tsx`，已排除 `node_modules` / `.next` / `dist`）：**33 个**

## sillyhub-daemon — vitest

- 测试框架：vitest 2.x（dev dep）
- 配置：`sillyhub-daemon/package.json` 的 `scripts.test = "vitest run --passWithNoTests"`、`scripts.test:watch = "vitest"`
- 运行命令（在 `sillyhub-daemon/` 下）：`pnpm test`
- 测试目录：`sillyhub-daemon/tests/`（含 `adapters/`、`interactive/` 子目录）
- 测试文件统计（`*.test.ts` / `*.spec.ts`，已排除 `node_modules` / `dist`）：**62 个**

## 测试文件数量汇总

| 子项目 | 框架 | 测试文件数 | 命令 |
| --- | --- | --- | --- |
| backend | pytest | 150 | `cd backend && uv run pytest` |
| frontend | vitest | 33 | `cd frontend && pnpm test` |
| sillyhub-daemon | vitest | 62 | `cd sillyhub-daemon && pnpm test` |
| 根 | — | 0（仅占位） | 无 |

## 注意事项

- 所有命令默认在各子项目目录下运行；根目录下只能用 `make backend-test` / `make frontend-test` 等聚合 target。
- backend 测试同时发现 `tests/` 与 `app/` 两处（`testpaths` 配置），统计的 150 个已排除 `backend/.venv`。
- daemon 的 `test` 脚本带 `--passWithNoTests`，无匹配文件时不会失败。
