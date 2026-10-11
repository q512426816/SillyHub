# task-06 回归验证记录 — 2026-10-11-apikey-mcp-copy-delete

执行时间：2026-10-11 15:2x–15:4x（本地，Windows / Git Bash）

## 后端

| 项 | 命令 | 结果 |
| --- | --- | --- |
| 迁移链 | `python -m alembic heads` + `pytest tests/test_migrations_graph.py` | head=20261011160000；2 passed |
| ruff | `python -m ruff check app/modules/auth app/modules/mcp_gateway migrations/versions/2026101160000* tests/modules/auth` | All checks passed（pre-commit ruff-format 拦截后已按 hook 指定 `uv run ruff format` 修复 3 文件并复跑） |
| mypy | `python -m mypy`（5 个改动 py 文件） | Success: no issues found in 5 source files |
| pytest 子集 | `pytest app/modules/mcp_gateway tests/modules/auth tests/core/test_auth_deps_principal.py -q --no-cov` | **355 passed, 2 xfailed**（xfail 为预存标记，与本变更无关） |
| format 后复跑 | `pytest tests/modules/auth/test_api_key_router.py app/modules/mcp_gateway/tests/test_router.py -q --no-cov` | 27 passed |

## 前端

| 项 | 命令 | 结果 |
| --- | --- | --- |
| node_modules 健康 | `pnpm exec tsc --version`（修复前失败 → `pnpm install --force` 后 5.5.4） | 已修复（CLAUDE.md 规则 21 预警场景） |
| gen:types | `pnpm gen:types` | openapi.json + api-types.ts 再生成，`plaintext_recoverable` / 两个 PlaintextResponse DTO 均入列 |
| ESLint | `pnpm exec next lint --file`（6 个改动文件） | 无新增 warning（runtimes 页 3 个 no-unused-vars 为 HEAD 基线预存债，行号 755/1016/1230 均在 CopyDaemonCommand 之外，经 stash 对照确认） |
| vitest 子集 | runtimes + settings/api-keys + mcp-tokens 页面测试、lib api-keys/mcp-tokens、create-dialog 共 11 文件 | **105 passed** |
| tsc | `pnpm exec tsc --noEmit` | exit 0（测试文件 2 处 noUncheckedIndexedAccess 索引访问已修） |

## FR 对照

- FR-01：lib 5 分支用例 + CopyDaemonCommand 4 用例（剪贴板含完整明文、渲染面打码、自动创建回显、非 admin 回退）绿。
- FR-02：router 3 用例（roundtrip/404/409/flag）+ api-keys 页 5 用例（复制/禁用降级/删除矩阵）绿。
- FR-03：mcp router 7 用例（含跨 workspace 404）+ mcp 页 11 用例（复制/删除）绿。
- FR-04：两侧 hard-delete 用例（已吊销 204 行消失 / 活跃 409 / 未知 404）绿。
- FR-05：存量 hash-only 409 + `plaintext_recoverable=false` 禁用降级 + master key 缺失创建降级用例绿。
