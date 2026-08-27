---
author: qinyi
created_at: 2026-08-27 08:15:03
---

# execute 中途 task review.json 被草稿覆盖（task-review-draft 变体）+ git pathspec 方括号目录坑

> 状态：活跃（2026-08-26-mobile-workspace-page 会话实证）。前者与
> `finished/worktree-execute-apply-friction.md` 坑2（task-review-draft.test.mjs
> 已修「草稿生成/幂等/exec-id 同源」）相关但为**新变体**：修复假设草稿只在
> 「无 review 时兜底生成」，本会话实证**已存在真实 review 仍被草稿覆盖**。

## 坑 1：task review.json 被草稿覆盖（变体）

- 现象：Wave 步逐波 `--done` 时手写 16 份真实 review.json（真实 base/head/双
  pass/changedFiles），阶段推进到 step 9（对照设计检查）后抽查发现全部 16 份
  变为 `base==head==61e09e64`、`changedFiles: []`、`cannot_verify` 的
  "auto-generated draft from git diff" 草稿。
- 影响：Task Review Gate 若在草稿态校验会 fail-closed 阻断或降级
  cannot_verify；独立 QA 的「双 pass 任务只抽查」前提失实（本会话 QA 以全量
  静态+动态检查补偿）。
- 绕过方案（本会话实证有效）：在 execute 阶段**最后一个 --done 之前**统一重写
  全部 task review.json（真实 base/head），再跑 gate；不要在早期 --done 后假设
  review 仍是自己写的内容。
- 待工具修复方向：草稿生成仅当目标 review.json **不存在**时落盘；已存在文件
  一律不覆盖（fail-safe 写入）。

## 坑 2：git pathspec 方括号目录（Next.js [id]/[cid]/[sid]）add/commit

- 现象 A（glob 失配）：`git add "frontend/src/app/m/workspaces/[id]/sessions/page.tsx"`
  静默 staged 零文件 → 后续 `git commit` 报 "nothing added"。方括号在 git
  pathspec 里是字符类 glob（`[id]` 匹配单字符 i/d），与 Next.js 动态路由目录
  字面名 `[id]` 冲突；命中与否取决于目录内文件是否已被跟踪，行为不稳定。
- 现象 B（目录 add 扫子树）：`git add ".../[id]/changes"` 把未跟踪的 `[cid]/`
  子目录一并扫进 staged——per-task 拆分提交时会把下一个任务的文件裹进上一个
  commit。
- 正确做法：方括号路径一律用字面量魔法 `git add -- ":(literal)frontend/src/app/m/workspaces/[id]/sessions/page.tsx"`；
  per-task 提交用具体文件路径（literal），不用目录级 add。
