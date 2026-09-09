---
author: qinyi
created_at: 2026-09-08 15:35:00
---

# `sillyspec backfill-reviews --adopt` 把 per-task review mechanics 冲成 baseline..HEAD 且清空 changedFiles

> 状态：活跃（2026-09-08-cursor-interactive-session Wave 3 实证）。
> 与 `finished/2026-08-27-task-review-draft-overwrite-and-pathspec-brackets.md` 同类（mechanics 被冲掉），但是 `--adopt` 主动重算路径，不是草稿生成覆盖。

## 现象

手工写好 task-03 `review.json`（`base`=上一 task commit `cd19e4bd`，`head`=本 task commit `852cc2cb3`，`changedFiles` 两文件，双 pass），随后按 skill 跑：

```
sillyspec backfill-reviews --change 2026-09-08-cursor-interactive-session --adopt
```

CLI 报告「adopt: 重算代填 11 个已存在 review.json 的 mechanics 字段（verdict 原样保留）」。打开文件后：

- `base` 全部变成 worktree 基线 `7a91a097`（execute 启动 checkpoint）
- `head` 全部变成当前 HEAD `852cc2cb3`
- `changedFiles` 全部变成 `[]`
- `specVerdict`/`qualityVerdict`/`reviewerNotes` 保留（这点符合文案）

未完成的 task-04~11 草稿也被同一组 base/head 重写。

## 影响

- per-task commit 模式下 gate 用 `git diff base..head` 对账；base 被拉到基线后 diff 含 task-01/02 fixture，与本 task `allowed_paths` 对不齐，或 `changedFiles: []` 与非空 diff 不相交 → 判伪造阻断。
- skill 写「mechanics 可以瞎填占位，写完跑 `--adopt` 一键重算」——本会话 `--adopt` 不能替代手工填 per-task parent。

## 绕过

- **不要**在已按 per-task commit 填好真实 `base`/`head`/`changedFiles` 后再跑 `--adopt`。
- `--adopt` 跑完立刻打开刚写的 review.json 核对三字段；被冲则按 `git log` 手工写回：`base`=本 task 开始前 commit（`HEAD^` 当该 task 刚提交），`head`=本 task commit，`changedFiles`=`git diff --name-only base..head`。
- execute 最后一波 `--done` 前再抽查一遍，不要假设 mechanics 仍是自己写的。

## 待工具修复

`--adopt` 应按 task 卡 `head_commit` / 该 task 自己的 commit 切片重算，而不是所有 task 共用「基线..当前 HEAD」；已有非空 `changedFiles` 且 `base != head` 的真实 review 不应被清空。

## 处置记录（2026-09-09 定时收口，双层修复齐备，归档）

- **空切片不冲声明**（本坑 changedFiles 被清空面）：已被 2026-09-08 当日反馈修复进 main（task-review.js「切片空不冲声明」段——计算切片为空而原声明非空时保留原声明并留 reason），本轮复核在 HEAD。
- **base/head 共用全区间**（本坑 mechanics 被冲面）：本轮修复——`adoptTaskReviewMechanics` 主仓分支新增**卡锚点切片**：task 卡带 `head_commit`（配 `base_commit` 或回落 worktree 基线）时按 `git diff base..head` 切片，不再共用「基线..当前 HEAD」（跨仓路径本就按卡切片，主仓对齐）；卡无锚点回落 change 级（旧语义，兼容 wave 级提交形态）。
- **测试**：新增 `test/backfill-adopt-per-task-slice.test.mjs`（真实 git 提交链 e2e：per-task 双提交 + 卡锚点 + 手工真实 review → adopt 后 base/head/changedFiles 全保持、verdict/语义结论原样、不混入他 task 文件）6/6 绿；task-review 回归 29/29 绿。
- 绕过方案（填好后不再跑 --adopt / 跑完核对三字段）仍值得遵守，但机制上已不再需要。归档。
