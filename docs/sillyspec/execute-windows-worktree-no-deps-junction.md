---
author: WhaleFall
created_at: 2026-08-05 14:20:00
status: active
---

# execute worktree Windows 全新 checkout 无 deps（doctor --fix 不装）

## 现象
execute 阶段 SillySpec 自动创建 git worktree（全新 checkout），但 worktree 目录**无 node_modules / .venv**（git 不跟踪）。子代理在 worktree 跑 tsc/mypy/pytest/pnpm 全失败（command not found / No module named）。

`sillyspec worktree doctor --fix` 只清理 stale worktree，**不装 node_modules/.venv**（doctor 只检查 worktree 元数据，不装依赖）。

## 根因
worktree 是独立 git checkout（独立工作目录），node_modules/.venv 不在 git，全新 worktree 没装。doctor --fix 不处理这层（它修 worktree 元数据 + stale，不装项目依赖）。

## 绕过方案（本次用）
Windows 用 junction（`mklink /J`，不需管理员）把主仓库依赖目录共享到 worktree（秒级）：
```bash
# PowerShell 创建 junction（cmd mklink /J 在 git-bash 路径转义失败，用 PowerShell）
powershell -NoProfile -Command "New-Item -ItemType Junction -Path '<worktree>/sillyhub-daemon/node_modules' -Target '<main>/sillyhub-daemon/node_modules'"
powershell -NoProfile -Command "New-Item -ItemType Junction -Path '<worktree>/frontend/node_modules' -Target '<main>/frontend/node_modules'"
powershell -NoProfile -Command "New-Item -ItemType Junction -Path '<worktree>/backend/.venv' -Target '<main>/backend/.venv'"
```
junction 不被 git 跟踪，不影响 worktree apply（apply 只取代码 commit）。

## 建议（工具修复）
- execute worktree 创建后自动 link 或 install 依赖（worktree doctor --fix 加 deps install/link 步骤）
- 或 worktree 文档明确：Windows 全新 worktree 需手动共享依赖（junction / symlink / 重装）

## 关联
2026-08-05-daemon-start-time 变更 execute 阶段踩到。worktree apply 不受影响（junction 不在 commit）。
