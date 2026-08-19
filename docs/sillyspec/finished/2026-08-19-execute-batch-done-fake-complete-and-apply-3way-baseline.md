---
author: qinyi
created_at: 2026-08-19 08:45:00
status: active
---

# execute 批量完成机制误标未实现 task + apply 3way 被 baseline 占位文件挡死

**发现日期**：2026-08-19（workspace-role-type change 收尾时实证）

## 缺陷一：execute 批量完成误标未实现 task

### 现象
task-08 **尚未实现**时，某次 execute `--done` 触发「批量完成」逻辑：CLI 自动勾掉 plan.md checkbox、写入 `cannot_verify` 草稿 review.json、创建 `verify-required-evidence.json`。表面看 execute 已完成，实际 task-08 代码不存在。

### 危害
与 [[sillyspec-worktree-execute-total-loss]] 同源的「进度绿但代码没落地」家族。若主代理不核验 git commit 实体，verify 会基于「已完成」假象推进。

### 绕过
- execute 标完成后逐 task `git cat-file` 核验 review.json 的 base/head 真实存在且 diff 非空
- `cannot_verify` 草稿 review 必须真实补做实现后替换（本 change task-08 如实补做，commit a9e3726a）
- 删除 stale 的 verify-required-evidence.json（否则 verify 阶段持续消费幽灵义务）

### 建议修复
批量完成触发前应校验 task 的 changedFiles diff 非空；`cannot_verify` 草稿不该由 CLI 主动生成——留空让 gate 挡住更安全（fail-closed 而非 fail-open）。

## 缺陷二：worktree apply 3way 对账把 baseline 专有文件判为冲突

### 现象
`sillyspec worktree apply` 报「以下文件与主干已提交推进重叠，无法自动合并」，但 `(未能获取冲突文件列表)` 连冲突文件都列不出。实际根因：CLI 3way 用的 base 是 **baseline checkpoint commit**（473a04e2，含 CLI 为满足 allowed_paths 校验而创建的 0 字节占位文件），而主仓 main 上这些占位文件从未存在 → main 侧视为 delete、分支侧视为 modify → add/delete 冲突。真实 merge-base（ed45bf54）下纯代码 diff 干净可直落。

### 危害
apply 被挡后 CLI 建议走 `--merge`（会引入合并提交污染历史）或手动解决——对这种「基点选择错误」型冲突，两条路都是过度处理。

### 绕过
`git diff <真实merge-base>..<worktree-head> -- backend frontend | git apply --3way` 直接落到主仓工作区（排除 .sillyspec 防止覆盖主仓已 staged 的新版 spec 文档）。落完用 `diff --strip-trailing-cr` 与 worktree 逐文件核对（CRLF 差异是 apply 过程换行归一，内容一致）。

### 建议修复
3way 的 base 应取 `git merge-base main <branch>` 而非 meta.json 的 baselineCommit；冲突文件列表获取失败时应打印原始 git 错误而非静默吞掉。
