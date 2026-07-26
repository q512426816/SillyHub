---
author: qinyi
created_at: 2026-07-27 00:35:31
source_commit: 6e78b29a
updated_at: 2026-07-26T16:35:31Z
generator: sillyspec-scan
---

# 测试(Testing)

SillyHub 三端各自独立测试栈,统一目标:变更后零回归才允许合入主干。所有静态检查(ruff / mypy / 两端 tsc)要求全绿,作为"零静态债务"基线。产品根 `package.json` 的 `test` 仅为占位(默认 `echo && exit 1`),所有测试在 3 个子项目内运行,或经根 `Makefile` 聚合。

## 测试栈

| 端 | 框架 | 配置入口 | 关键依赖 |
|---|---|---|---|
| backend | pytest | `backend/pyproject.toml [tool.pytest.ini_options]`(`testpaths=["tests","app"]`,`asyncio_mode=auto`) | pytest-asyncio / pytest-xdist(`-n auto` 并行) / pytest-cov / aiosqlite(单测 DB) |
| frontend | vitest 2.0 + jsdom | `frontend/package.json` scripts.`test`="vitest run" | @testing-library/react / @testing-library/jest-dom / openapi-typescript(类型生成) |
| daemon | vitest(node 环境) | `sillyhub-daemon/vitest.config.ts` + `vitest.spikes.config.ts` | forks 池(`maxForks: 8`) / 30s testTimeout |

## 测试规模(实测,source_commit 6e78b29a)

- **backend**:68 个集成测试(`backend/tests/test_*.py`)+ 193 个模块内单测(`backend/app/modules/*/tests/test_*.py`)= **261 个测试文件**,另配 10 个 `conftest.py` fixture。基线 **2955 passed / 10 skipped / 5 xfailed**(`docs/code-quality-hardening-2026-07-24.md` §0)。
- **frontend**:**115 个测试文件**(`frontend/src/**/*.test.ts(x)`)。基线 **1059 passed / 29 todo / 1 file skipped**。
- **daemon**:**117 个测试文件**(`sillyhub-daemon/tests/**/*.test.ts`,分布 interactive 28 / policy 7 / adapters 7 / resilience 4 / spec-transport-tar-sync 3 等);探索性 spike 代码另走 `vitest.spikes.config.ts`(`include=['spikes/**/*.test.ts']`),**不进 CI 主套件**。基线 **1951 passed / 1~2 flaky 超时**。

## 覆盖与门禁

- backend 覆盖率目标 **≥ 60%**(`README.md` 开发指南 + `.sillyspec/.runtime/local.yaml` `backend_test` 带 `--cov-fail-under=60`);ruff + mypy 全绿是零容忍静态基线(`pyproject.toml [tool.mypy]` strict=false 但 `warn_unused_ignores=true`)。
- frontend `pnpm gen:types:check`(`package.json` scripts)= 生成 `api-types.ts` 后 `git diff --exit-code`,守护前端类型与后端 OpenAPI 不漂移;tsc `--noEmit` + ESLint 必过。
- daemon tsc 全绿;spec-sync(task-09)与 lease.kind 分流(D-002)为已知脆弱区,单文件/隔离均 <100ms,满载并行下偶发 30s 超时,重跑即过(`vitest.config.ts` 注释)。
- SillySpec `test_strategy=module`:每个变更在 verify 阶段按受影响模块触发对应测试,而非全量跑。

## 已知测试坑(动手前必读)

- backend 全量 pytest 未并行时约 **12 分钟**,超过 SillySpec verify 默认 10 分钟 gate;必须用 `pytest -n auto` 并行压到分钟级(`pyproject.toml [tool.pytest.ini_options]` 注释 + memory)。
- main 分支 backend 存在**预存非业务 errors**(瞬时/环境性),全量失败先排除环境与 worktree overlay 污染,而非假定回归。
- **PPM 前端变更 verify 必踩**:SillySpec CLI 按路径子串把 `frontend/components/ppm` 或 `lib/ppm` 关联到 ppm 后端测试,405 passed 但 ~700s 超 600s 默认 timeout 阻断(非失败);解法 `SILLYSPEC_TEST_TIMEOUT_MS=900000` 后台重跑。
- **SQLite(单测) vs PostgreSQL(生产)方言差异**:`with_for_update` 在 SQLite 为 no-op(测不到并发行锁),`date_trunc` 等需方言分支;并发正确性与 PG 特性只能在生产环境验证。断言不绑死 SQL 函数名。
- 改 FastAPI router 必跑对应 `test_router`(参数顺序 SyntaxError service 测覆盖不到,重建容器 import 才暴露);`asyncpg` Windows 装不上时用 Docker 起 Postgres、本地后端连容器。
- SillySpec verify/archive 实测要 `local.yaml` `modules` 块(非 `module_paths`),否则 fallback 全量;`archive step5 --change` 移动后找不到致 db 分裂,改用不带 `--change` + `status=archived` 判完成。

## 常用命令

- 后端:`make backend-test`(或 `cd backend && uv run pytest -n auto`)
- 前端:`make frontend-test`(或 `cd frontend && pnpm test`)
- daemon:`cd sillyhub-daemon && pnpm test`(spike 单独:`pnpm vitest run --config vitest.spikes.config.ts`)
- 全量:`make test`(后端 + 前端) / `make lint`(后端 ruff+mypy + 前端 ESLint)
- backend 测试须用 `backend/.venv/Scripts/python.exe`(非全局/项目根 .venv,全局缺 aiobotocore)
