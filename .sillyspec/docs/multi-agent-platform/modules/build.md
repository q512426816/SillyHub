---
schema_version: 1
doc_type: module-card
module_id: build
source_commit: ba87eec
author: qinyi
created_at: 2026-06-24T01:16:42
---
# build

## 定位

multi-agent-platform 的构建与本地任务编排层，以根 `Makefile` 为统一入口，把 backend（uv/hatchling）、frontend（pnpm/next/tsc）、sillyhub-daemon（pnpm/tsc/ncc）、deploy（docker compose）四类工具链收敛成一套记忆负担最小的命令。不是独立产物，而是"开发者每天用的快捷方式集合"，被 ci 复用、被开发者日常依赖。

技术栈：GNU Make、uv（Python）、hatchling（backend 构建后端，见 pyproject）、pnpm、Next.js build、tsc、@vercel/ncc、Docker。

## 契约摘要

Makefile 暴露的目标（均为顶层 phony-like target）：

- **组合编排**：`dev-up` / `dev-down` / `dev-logs` / `dev-reset`（开发态 docker compose 全栈）、`up` / `down` / `logs`、`test`（=backend-test + frontend-test）、`lint`（=backend-lint + frontend-lint）。
- **backend 系列**：backend-install、backend-run、backend-test、backend-lint、backend-format、backend-migrate。
- **frontend 系列**：frontend-install、frontend-run、frontend-test、frontend-lint、frontend-typecheck、frontend-build。
- **`help`**：列出全部目标。

底层配置来源：`backend/pyproject.toml`（uv/依赖/hatchling/ruff/mypy/pytest/pytest-xdist）、`frontend/package.json`（pnpm scripts）、`sillyhub-daemon/package.json`、`deploy/docker-compose.yml`。

- **并行测试**：backend 已引入 `pytest-xdist`（ql-20260723-010-32d6），全量用 `cd backend && uv run pytest -n auto` 可并行（20 核约 7min，单进程约 50min）；默认 `uv run pytest` 仍为单进程。CI/本地视机器核数选择 `-n auto`。

## 关键逻辑

- **职责代理**：Makefile 不重复定义工具行为，只转发到各子项目原生命令（uv run / pnpm / docker compose），保证 Make 与原生命令行为一致。
- **测试/门禁对齐**：`backend-test`、`frontend-test`、`backend-lint`、`frontend-lint` 与 ci workflow 跑的命令同源，本地过了 CI 基本过。
- **迁移入口**：`backend-migrate` 统一 Alembic 迁移执行点（alembic upgrade head），避免手动执行出错。
- **环境隔离**：dev 系列用 `deploy/docker-compose.dev.yml`，部署系列用 `deploy/docker-compose.yml`，文件参数固定互不串扰。

## 注意事项

- Makefile 是事实上的"项目操作手册"，新增子项目工具链要同步加 target，否则开发者绕过 Make 用原生命令造成行为漂移。
- 提交代码被 pre-commit hook 拦截时（如 ruff format），可用 `backend/.venv/bin/ruff format` 处理 staged 文件再 add 再 commit，不要绕过 hook。
- `dev-reset` 会清数据（项目允许），生产慎用。
- Makefile 依赖 `uv`、`pnpm`、`docker compose`，Windows 用户需通过 Git Bash 运行。

## 人工备注
<!-- MANUAL_NOTES_START -->
<!-- MANUAL_NOTES_END -->
