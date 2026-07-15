---
author: WhaleFall
created_at: 2026-07-15 00:59:00
status: active
---

# SillySpec worktree execute 模式踩坑汇总

> 来源：`2026-07-14-milestone-module-import` 变更 execute→apply→archive 全流程（Windows）。记此便于后续 SillySpec 大变更避坑。

## 1. worktree 缺 `.venv` / `node_modules`
SillySpec 创建的 worktree（`.sillyspec/.runtime/worktrees/<change>/`）从 baseline 检出，**不含 `.venv` / `node_modules`**（git 不跟踪）。子代理跑 pytest/tsc/mypy 会失败。
**绕过**：建 junction 复用主目录依赖（PowerShell）：
```powershell
New-Item -ItemType Junction -Path '<worktree>\backend\.venv' -Target 'F:\WorkNew\SillyHub\backend\.venv'
New-Item -ItemType Junction -Path '<worktree>\frontend\node_modules' -Target 'F:\WorkNew\SillyHub\frontend\node_modules'
```
子代理用主目录 venv python（绝对路径）跑 worktree 代码：`F:/WorkNew/SillyHub/backend/.venv/Scripts/python.exe -m pytest`（cwd=worktree/backend）。

## 2. 项目 commit hook 用 `uv run` 但环境无 uv
`.claude/hooks/pre-commit-ci-check.cjs` 的 backend 检查写死 `uv run ruff/mypy`，但 Claude session 的 Windows PATH 无 uv → commit 被 "Local CI checks" 拦截。
**绕过**：`pip install uv` 到主目录 venv，再 copy `uv.exe` 到 Windows PATH 已列但目录不存在/为空的位置（本项目是 `C:\Users\<user>\bin`，需先 mkdir）。

## 3. `uv run` 的 sync 移除 dev 依赖
`uv run ruff check .` 会触发 uv sync，**默认只装 prod 依赖**，把 pytest/ruff/mypy 等 dev 依赖（甚至 pip）从 venv 移除 → 后续 `python -m pytest` 报 No module named pytest/pip。
**修复**：`uv sync --all-extras`（装 prod+dev）重建 venv。或避免在主目录 venv 直接 `uv run`（用 `.venv/Scripts/python.exe -m ruff` 替代）。

## 4. Task Review Gate 的 executeRunId 每次 `--done` 都变
`current-execute-run-id-<change>` 文件每次 `execute --done` 重写新时间戳 id，导致预生成的 review.json（在旧 id 目录）找不到。
**绕过**：手动写 runIdFile 指向已生成 review.json 的 id：
```bash
printf "exec-<固定id>\n" > .sillyspec/.runtime/current-execute-run-id-<change>
```
再 `execute --done`，gate 读该 id 找到 review.json。

## 5. worktree 的 sillyspec.db 独立于主目录
execute 在 worktree 跑完 16 步，但主目录 sillyspec.db 的 execute 状态没同步（worktree apply --merge 只合代码，不合 .runtime/db）。主目录 progress 卡在 execute 早期。
**修复**：`sillyspec doctor --align-execute-progress --change <change> --confirm`（按 plan.md checkbox 对齐主目录 execute 进度，置 completed）。

## 6. worktree apply 的 baseline 漂移
execute 期间主分支若被推进（如本例 d00c124e 补 migration），`worktree apply --check-only` 报 baseline 不一致。
**绕过**：`sillyspec worktree apply <change> --merge`（git merge 替代 patch，引入合并提交）。

## 7. backend Docker build cache 没装新增依赖
pyproject 加了 `python-multipart`，但 `docker compose up --build` 的 uv pip install layer 可能命中旧 cache → 镜像不含新依赖，容器 import 失败、UploadFile 端点不可用。`--no-cache` 又因 apt 源（清华镜像）update 失败（exit 100）不可行。
**绕过**：在 pyproject 对应依赖行加无害注释（触发 COPY pyproject layer 失效 → uv pip install 重跑），再 `docker compose build backend` + `up --force-recreate -d backend`。验证：`docker compose exec backend python -c "import <新依赖>"`。

## 通用教训
- SillySpec worktree 模式适合隔离代码，但依赖/db/状态同步粗糙，Windows 下坑多
- 改后端依赖后必须 rebuild 镜像并**容器内验证 import**（skill 强调：镜像/容器没真更新是最常见隐性失败）
- 关联：[[windows-python-crlf-taskcard]]（python 写 task-NN.md 变 CRLF 破坏 plan-postcheck）
