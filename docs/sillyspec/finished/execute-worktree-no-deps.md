---
author: WhaleFall
created_at: 2026-08-07 23:18:00
status: active
---

# execute worktree 不自动装 deps（node_modules / venv）

## 现象
execute worktree 模式（git worktree 隔离代码改动）创建的 worktree 没有 node_modules（sillyhub-daemon / frontend）也没 venv（backend），且 worktree 内 python 不在 PATH。子代理在 worktree 跑 `tsc --noEmit` / `ruff check` / `pytest` 全失败（command not found 或缺依赖），导致 task verify 段无法执行、review 只能 cannot_verify 或纯静态审。

## 根因
git worktree 只 checkout 跟踪文件，node_modules / .venv 在 .gitignore 不被 worktree 继承；execute worktree 创建逻辑（worktree.js）只 sync baseline 文件（.sillyspec/changes 文档），不装项目依赖。

## 绕过方案（本次用）
手动在 worktree 装 deps（主仓库有完整 deps，复用 store 较快）：
- backend：`cd <worktree>/backend && uv sync`（uv.lock 在 worktree，uv 自带 python 管理）
- sillyhub-daemon：`cd <worktree>/sillyhub-daemon && pnpm install`（复用 pnpm store，hardlink，~10s）
- frontend：`cd <worktree>/frontend && pnpm install`（670 pkgs，复用 store ~2min）

装完后子代理可在 worktree 跑 tsc/ruff/pytest 真实验证。或前几个 Wave 子代理只改代码不验证（worktree 无 deps），最后 step 11 装 deps 统一验证。

## 建议（工具修复）
- execute worktree 创建后自动装 deps（uv sync + pnpm install），或在 step 2「加载上下文」检测并提示装；
- 或 worktree 的 node_modules / .venv junction/symlink 到主仓库（共享 deps，零拷贝）；
- 或子代理 prompt 检测 worktree 无 deps 时自动 fallback 主仓库验证（apply 后）。

## 关联
2026-08-07-inject-wait-session-ready execute worktree 无 deps，手动 uv sync + pnpm install（frontend 1m54s）；Wave 1-2 子代理只静态 review（worktree 无 deps），Wave 3 装好 deps 后 task-10/11/12 真跑 ruff/vitest/pytest。

## 补充（2026-08-09，backend venv 必须 `--all-extras`）
`cd <worktree>/backend && uv sync` **不够**：pytest / aiobotocore 等声明在 `[project.optional-dependencies]` 的 test 组，`uv sync` 默认不装 optional 组 → worktree venv 有 90 个基础包但**缺 pytest 本身 + aiobotocore**。现象迷惑：
- `uv run python -c "import aiobotocore"` 先报缺、手动 `uv pip install` 后能 import；
- 但 `uv run pytest` 仍报 `ModuleNotFoundError: aiobotocore`（conftest db_engine fixture 间接 import storage/minio_backend）——因为 `uv run pytest` 走的是**系统 PATH 的 pytest**（非 venv，缺 aiobotocore），而 `uv run python -m pytest` 报 `No module named pytest`（venv 缺 pytest）。

**正确绕过**：`cd <worktree>/backend && uv sync --all-extras`（装齐 optional test 组：pytest/pytest-asyncio/pytest-cov/pytest-xdist + aiobotocore）。之后 `uv run pytest` 与 `uv run python -m pytest` 都用 venv、全绿。

诊断要点：pytest ERROR（非 FAIL）+ ModuleNotFound 在 conftest/db_engine 链路 → 先怀疑 worktree venv 缺 optional test 组，而非代码问题。`uv sync` 报 "Checked N packages" 但实际少装，不可信，以 `uv run python -c "import pytest"` 为准。
