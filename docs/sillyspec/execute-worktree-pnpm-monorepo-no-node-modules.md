---
author: qinyi
created_at: 2026-07-26 22:25:00
---

# execute worktree 对 pnpm monorepo deps 检测 n/a（实际无 node_modules）

## 现象

sillyspec execute 启动 worktree（mode=worktree）后，`sillyspec worktree meta` 的 `depsStatus: "n/a"`，`sillyspec worktree doctor` 也不报该 worktree 的 deps 问题（只报其它 stale worktree）。但 worktree 实际**没有 node_modules**（根 + frontend + sillyhub-daemon 全 MISSING）——git worktree 只跟踪 git 文件，node_modules 不在 git。

## 影响

在 worktree 跑 `pnpm test` / `pnpm run typecheck` / `pnpm run lint` 全部 module not found 失败。execute 各 step 的验证（typecheck/单测）无法在 worktree 内执行，review gate 的"对照 git diff + 跑测试"受阻。

## 根因

sillyspec 的 deps gate 对 **generic monorepo（local.yaml `project.type: generic`）+ pnpm workspace** 检测失效：depsStatus 恒 `n/a`，不触发 install/link。worktree 创建时只 `git worktree add`，不处理 deps（对比 in-place 模式有 deps gate，见 finished/execute-inplace-deps-gate.md）。

## 绕过（已验证 2026-07-26 ungate-workspace-entry）

用 PowerShell directory junction 把主仓库 node_modules 链接到 worktree。**注意：`mklink /J` 经 git bash 的 MSYS 路径转换会破坏语法**（报中文乱码"文件、目录或卷标语法不正确"），必须用 PowerShell：

```bash
powershell -NoProfile -Command "New-Item -ItemType Junction -Path '<worktree>\node_modules' -Target '<主仓库>\node_modules'"
powershell -NoProfile -Command "New-Item -ItemType Junction -Path '<worktree>\frontend\node_modules' -Target '<主仓库>\frontend\node_modules'"
# 改 daemon 时也 link sillyhub-daemon/node_modules
```

junction 不需管理员权限（区别于 symlink）。链接后 worktree 跑 `pnpm -C <worktree>/frontend run typecheck/test/lint` 正常（用主仓库 deps + worktree src，单测 1117 全绿证实可行）。

验证链接生效：`test -e "<worktree>/frontend/node_modules/.bin/tsc" && echo OK`。

## 待工具修复

sillyspec worktree 创建时应识别 pnpm monorepo（local.yaml `modules/frontend`、`modules/sillyhub-daemon` 等）并自动 `pnpm install` 或 link node_modules 到 worktree；deps gate 不应 `n/a`，应 `linked`/`installed`。修复后本绕过可移除此文件到 finished/。

## 相关

- `docs/sillyspec/finished/execute-inplace-deps-gate.md`（in-place 模式 deps gate，worktree 模式缺失）
- meta.json `depsStatus` / `depsMethod` / `depsSource` 字段
