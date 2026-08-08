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
