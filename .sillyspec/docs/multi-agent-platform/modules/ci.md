---
schema_version: 1
doc_type: module-card
module_id: ci
source_commit: ba87eec
author: qinyi
created_at: 2026-06-24T01:16:42
---
# ci

## 定位

multi-agent-platform 的持续集成组件，以 GitHub Actions workflow 实现代码质量门禁与自动化测试。定义"代码进入主干前必须通过的检查"，把 backend 与 frontend 的 lint/typecheck/test/build 串成可重复的流水线。依赖 backend、frontend、build 的命令定义，本身不产出制品、不负责部署。

技术栈：GitHub Actions、ubuntu-latest runner、astral-sh/setup-uv、pnpm、ruff、mypy、pytest、next lint/tsc/build、vitest。

## 契约摘要

两个独立 workflow，分别覆盖前后端：

- `.github/workflows/backend-ci.yml`（name: backend-ci）
- `.github/workflows/frontend-ci.yml`（name: frontend-ci）

触发：push / PR。运行环境：ubuntu-latest。

## 关键逻辑

- **backend-ci 步骤**：setup-uv@v8.1.0 → `uv python install 3.12` → `uv sync --all-extras` → `uv run ruff check .` → `uv run ruff format --check .` → `uv run mypy app` → `uv run pytest -q --cov=app --cov-fail-under=60`。
- **frontend-ci 步骤**：`pnpm install --frozen-lockfile` → `pnpm lint` → `pnpm typecheck` → `pnpm test` → `pnpm build`。
- **门禁一致性**：CI 跑的命令与根 Makefile 的 `backend-test`/`backend-lint`/`frontend-*` 同源，本地 `make lint && make test` 通过基本等于 CI 通过。
- **覆盖率硬门**：backend 要求 `--cov-fail-under=60`，低于则 CI 红。

## 注意事项

- backend CI 当前步骤未显式起 DB service container，依赖 DB 的用例需确认是否在 CI 中跳过或需补 service。
- 改 ci workflow 的触发分支过滤要同步检查，避免漏跑或误跑。
- 新增子项目（如 daemon）若要独立门禁，需新增对应 workflow，不要塞进现有两个。
- CI 配置变更属低频但高影响，改完建议先在分支上观察一次完整运行。

## 人工备注
<!-- MANUAL_NOTES_START -->
<!-- MANUAL_NOTES_END -->
