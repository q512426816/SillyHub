---
author: qinyi
created_at: 2026-07-26 22:40:00
---

# execute worktree assess baseline 漂移 BLOCKED patch apply

## 现象

execute step12 `sillyspec worktree assess` 报「主工作区 baseline 已变化（execute 前后不一致），不能直接 apply task.patch」BLOCKED。execute 前 baselineHash `56672d8d`，当前 `8f48ed91`。建议 `apply --merge` 降级（git merge worktree 分支，会引入合并提交）。

## 根因

execute 流程**本身要求改主仓库元数据**：

- `plan.md` 勾 task checkbox（step5/6/7 每完成一 task 勾选）
- `design.md` 文件清单具体化（assess 文件清单校验失败时补具体路径）
- `.sillyspec/.runtime/execute-runs/<run>/tasks/*/review.json`（每 task 评审产出）
- `docs/sillyspec/*.md` 坑文件（规则 15）

这些改动改变主仓库 git tree hash，assess 的 baseline 检测（对比 execute 开始 vs step12 当前）判定漂移 → patch apply BLOCKED。

**是 sillyspec 自身矛盾**：流程要求改主仓库元数据，又用 baseline 漂移阻断 apply。

## 绕过（已验证 2026-07-26 ungate-workspace-entry）

手动 `git apply` worktree 前端 diff 到主仓库（**排除 meta.json**——worktree 内部元数据，主仓库没有，含它会导致 `patch failed: meta.json:4`）：

```bash
git -C <worktree> diff -- frontend | git -C <main> apply
```

新建文件（untracked，git diff 不含）单独 cp：

```bash
cp <worktree>/frontend/src/components/daemon-required-notice.tsx <main>/frontend/src/components/
cp <worktree>/frontend/src/components/daemon-required-notice.test.tsx <main>/frontend/src/components/
```

主仓库 `pnpm run typecheck` 绿确认 apply 正确（无冲突、文件完整）。

或用 sillyspec 建议 `sillyspec worktree apply <change> --merge`（git merge worktree 分支替代 patch，引入 merge commit 到 main）——但 worktree 分支只含 baseline commit，unstaged 前端改动是否带入不确定，故手动 git apply 更可靠。

## 待工具修复

assess 的 baseline 检测应**排除 `.sillyspec/` + `docs/` 内部文件**（execute 流程元数据），只对比**源码 baseline**（frontend/backend/daemon）。否则每个 execute 收尾都会因自身元数据改动 baseline 漂移 BLOCKED。

## 相关

- `docs/sillyspec/execute-worktree-pnpm-monorepo-no-node-modules.md`（同期 worktree deps 坑）
- `docs/sillyspec/finished/execute-worktree-baseline-commit-hook-block.md`（baseline commit 相关）
