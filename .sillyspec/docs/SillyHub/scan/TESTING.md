---
author: qinyi
created_at: 2026-08-18 01:06:26
source_commit: 744e3de4
updated_at: 2026-08-17T17:06:26Z
generator: sillyspec-scan
---

# 测试（Testing）

SillyHub 三端（backend / frontend / sillyhub-daemon）各自独立测试栈，根 `Makefile` 聚合统一入口：`make test` = backend-test + frontend-test + daemon-test；`make lint` = backend-lint（ruff check + format check + mypy）+ frontend-lint + daemon-typecheck。仓库根当前无 `package.json`，测试全部在子项目内运行。

## 测试栈

| 端 | 框架 | 配置入口 | 要点 |
|---|---|---|---|
| backend | pytest | `backend/pyproject.toml [tool.pytest.ini_options]` | `asyncio_mode=auto`；`testpaths=["tests","app"]` 同时发现集成套件与模块内单测；`addopts="-ra -o dist=loadscope"`（xdist 按模块分组绑 worker，消除跨模块状态交叉 flaky） |
| frontend | vitest 2.0 + jsdom | `frontend/vitest.config.ts` + `package.json` scripts | `clearMocks` 自动清调用计数；`testTimeout=15000` 治全量并行超时；纯逻辑测试经 `environmentMatchGlobs` 白名单切 node 环境省 jsdom 启动 |
| daemon | vitest（node 环境） | `sillyhub-daemon/vitest.config.ts` | forks 池 `maxForks: 8`（I/O 密集用例限并行防磁盘争用）；`testTimeout=30000`；`test` script 带 `--passWithNoTests` |

测试依赖（`backend/pyproject.toml [project.optional-dependencies].dev`）：pytest-asyncio / pytest-xdist（`-n auto` 并行，全量从约 50 分钟压到分钟级）/ pytest-cov / pytest-rerunfailures（CI flaky 重试兜底）/ aiosqlite（单测 DB）。frontend dev 依赖 @testing-library/react + @testing-library/jest-dom + jsdom（`frontend/package.json`）。

## 测试规模（Glob 实测，source_commit 744e3de4；含 2026-08-29-change-delete-closure-and-spec-pull 增量）

- **backend**：`backend/tests/` 下 76 个 `test_*.py`（另 11 个 `__init__.py`）+ `backend/app/**/tests/` 模块内 291 个 `test_*.py`，合计约 367 个测试文件；conftest.py 共 13 个（根 `backend/conftest.py` + ppm 各子域 / file / mcp_gateway / change / daemon / workspace.member_runtimes / platform_sync 共 12 个模块级 fixture）。CI 注释口径：全量 4000+ 用例（`.github/workflows/backend-ci.yml` 超时注释，2026-08-15）。2026-08-29 变更新增 8 个：`tests/test_platform_deleted_hidden_migration.py`（迁移冒烟）+ 模块内 7 个（`change/tests/test_reparse_delete_closure.py`、`test_delete_change.py`；`platform_sync/tests/test_change_deleted_guard.py`、`test_spec_bundle.py`；`spec_workspace/tests/test_platform_deleted_guard.py`、`test_soft_delete_change_dir.py`、`test_quicklog_reconcile.py`），并改写 `test_reparse_scoped_zero_delete.py` 为「scope 内消失可删 / scope 外不删」双断言。
- **frontend**：160 个 `frontend/src/**/*.test.ts(x)`，覆盖页面（`app/`）、组件（`components/`）、lib 钩子与纯函数（`lib/__tests__/`）、store、middleware。2026-08-29 变更新增 3 个（`delete-change-confirm` / `change-activity-badge` / 详情页 `page-last-signal`），扩展列表页与 `workspace-config-card` 既有用例。
- **daemon**：142 个 `sillyhub-daemon/tests/**/*.test.ts`（interactive 会话与驱动、policy、adapters、resilience、task-runner、spec 同步等）；spikes 探索性测试另走 `vitest.spikes.config.ts`（`include=['spikes/**/*.test.ts']`，串行 forks ≤2），不进 CI 主套件。2026-08-29 变更新增 `test_bundle_metadata_compat.test.ts`（bundle 含 PLATFORM-BUNDLE.json 后 pullSpecBundle/spec_version 判定兼容回归，daemon 源码零改动前提）。

## 守护测试

- **错误文案中文化守护**：`backend/tests/core/test_error_message_l10n.py`——AST 扫描 `app/modules/` 下 `*router*.py` / `*service*.py` 及用户链路 core 文件的 raise / HTTPException detail，纯字面量与 f-string 常量段须含 CJK；机器对机器链路（daemon 内部 RPC、mcp_gateway 协议端点、platform_sync、storage）走排除清单，`PENDING_L10N_FILES` 渐进白名单逐步清空（依据 `.sillyspec/changes/archive/2026-08-15-error-message-l10n/design.md` §5.4）。
- **审计挂载守护**：`backend/tests/core/test_audit_hooks_effective.py`（audit_hooks 全表挂载 + 手工审计点有效，依据 `2026-08-14-audit-system-completion` 归档 change）。
- **类型漂移守护**：frontend 与 daemon 各有 `gen:types` / `gen:types:check` script（两端 `package.json`）——openapi-typescript 生成后 `git diff --exit-code`，前端 `src/lib/api-types.ts` / daemon `src/api-types.ts` 与后端 OpenAPI 漂移即红；daemon 侧同样纳入 CI。

## CI（.github/workflows/，共 3 个）

- **backend-ci.yml**：push / PR（paths `backend/**`）+ workflow_dispatch；步骤 = ruff check → ruff format --check → mypy app → `pytest -n auto -q --cov=app --cov-fail-under=60 --reruns 2 --reruns-delay 1`（PostgreSQL + Redis 服务容器，ENVIRONMENT=test）；job 超时 30 分钟（注释：全量 4000+ 用例 + 2 核 xdist + reruns 裕量，此前 15 分钟撞顶致 99% 被取消）。
- **frontend-ci.yml**：push / PR（paths `frontend/**`）+ workflow_dispatch；lint + build + test 一体 job，超时 15 分钟，pnpm 9.6.0 + Node 20。
- **scan-drift.yml**：PR + push main + workflow_dispatch；scan 文档 `source_commit` 漂移检测门，warn-only（`::warning` 文件注解 + 去重 PR 评论，不阻塞 merge）。

## 覆盖与门禁

- backend 覆盖率门 `--cov-fail-under=60` 同时落在根 `Makefile backend-test` 与 `backend-ci.yml`；ruff + mypy 全绿是静态基线（`[tool.mypy]` strict=false 但 `warn_unused_ignores=true`）。
- frontend 与 daemon 的 `typecheck`（tsc --noEmit）纳入 `make lint` 聚合。
- E2E：backend 有 `backend/tests/e2e/test_three_member_collaboration.py`（三成员协作端到端）；前端 devDeps 声明 `@playwright/test ^1.60` 与 `puppeteer ^24.43` 两套浏览器自动化依赖，但仓库内无 playwright 配置文件（Glob 无命中）——浏览器 E2E 套件实际未配置。

## 常用命令与已知坑

- 后端：`make backend-test`（= `cd backend && uv run pytest -q --cov=app --cov-fail-under=60`）；全量未并行时约 50 分钟量级，`-n auto`（xdist）压到分钟级（`pyproject.toml` dev 注释）。
- 前端：`make frontend-test`（= `cd frontend && pnpm test`，vitest run）。
- daemon：`make daemon-test`（= `cd sillyhub-daemon && pnpm test`）；spike 单独跑：`pnpm vitest run --config vitest.spikes.config.ts`。
- CI（2 核）低资源下 xdist + async fixture + in-memory SQLite 偶发竞态 flaky（reparse created=0 → StopIteration / 文件列表空），loadscope 已挡大部分、残余靠 `--reruns 2 --reruns-delay 1` 兜底；本机 20 核全量绿复现不了（`pyproject.toml` 与 `backend-ci.yml` 注释）——CI 红而本机同命令绿时先怀疑环境而非回归。
- frontend `testTimeout` 提到 15s、daemon 提到 30s：均为全量并行下 jsdom 启动累积 / 磁盘争用引发的 flaky 超时治理（两端 vitest 配置文件内注释说明），不影响单跑用例速度。
- backend 测试经 `uv run` 使用 `backend/.venv`；daemon CI 主套件不含 spikes 目录。
