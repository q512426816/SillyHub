---
author: WhaleFall
created_at: 2026-07-15 20:05:00
status: fixed
---

# uv dev 工具与 dependency-groups 不一致（ruff/mypy 被 uv sync 移除）

## 现象
`.claude/hooks/pre-commit-ci-check.cjs` 用 `uv run ruff/mypy` 跑提交前检查。
偶发 `Failed to spawn: ruff / program not found`，导致所有 `git commit`/`git push` 被 hook 拦：
`Local CI checks failed; git commit was blocked: backend: ruff check / ruff format / mypy`。

## 根因
`backend/pyproject.toml` 存在**两套** dev 依赖声明：
- `[project.optional-dependencies] dev`（含 ruff/mypy/pytest/…）—— `pip install -e '.[dev]'` 使用
- `[dependency-groups] dev`（PEP 735，原只有 pre-commit/pymysql）—— **uv 使用**

`uv run` / `uv sync` 只认 `[dependency-groups]`，不装 `[project.optional-dependencies]`。
因此 uv sync 把已 pip 装入 `.venv` 的 ruff/mypy 视为「多余包」移除 → `uv run ruff` 找不到程序 → pre-commit hook 全量 backend 检查三项全挂。

> 即使提交内容只是 `.sillyspec/` 文档（无 backend/frontend 文件），hook 的 fallback 逻辑（`!hasBackend && !hasFrontend` 时强制 `hasBackend=hasFrontend=true`）仍会跑全量 backend 检查，故该坑会阻塞**任何**提交。

## 修复（2026-07-15）
```bash
cd backend && uv add --dev "ruff>=0.6" "mypy>=1.11"
```
把 ruff/mypy 加入 `[dependency-groups] dev`，与 `[project.optional-dependencies] dev` 对齐。
修复后 `uv run ruff check .` / `uv run ruff format --check .` / `uv run mypy app` 稳定可用，pre-commit hook 不再误拦。

## 备注
- 两套 dev 声明并存（optional 给 pip，groups 给 uv）是过渡状态；后续可评估统一到 `[dependency-groups]`。
- 若 pytest 等其他 dev 工具也出现 `uv run` 缺失，同理加入 `[dependency-groups] dev`。
- 触发场景：在 backend 目录用 `sillyspec run` 执行 verify（跑测试）后，hook 的 `uv run` 把 pip 装的 dev 工具 sync 掉。归档 2026-07-15-project-members-rebuild 时复现并修复。
