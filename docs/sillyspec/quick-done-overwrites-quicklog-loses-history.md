---
author: WhaleFall
created_at: 2026-07-28 11:56:50
---

# quick --done 把 QUICKLOG 整文件覆盖成只剩当前 ql（丢历史 + frontmatter）

## 现象
2026-07-28 执行 quick ql-20260728-005，`sillyspec run quick --done`（step3）后，`.sillyspec/quicklog/QUICKLOG-WhaleFall.md` 从 504 行（frontmatter + ql-20260721~ql-004 全部历史）被覆盖成只剩 7 行——只有当前 ql-005 简版，frontmatter（author/created_at）和所有历史 ql 条目全部消失。

## 复现
- quick 启动时 CLI 写 ql-005「进行中」条目，此时文件正常（含历史）
- step1 / step2 `--done` 正常
- **step3 `--done` 之后**，QUICKLOG 被重写成只有 ql-005（7 行）
- 推测：CLI 在 step3 `--done` 收尾时把 QUICKLOG 当成「只含当前会话 ql」整体重写，而非在原文件上追加/更新条目

## 影响
- 丢失全部历史 QUICKLOG 记录（除非已 commit 到远程仓库）
- 丢失 frontmatter（违反 author/created_at 强约束）
- 若此时不察直接 `git add` + commit，历史记录永久丢失

## 规避（已验证有效）
1. quick `--done` 后，先 `wc -l .sillyspec/quicklog/QUICKLOG-*.md` 或 `git diff HEAD -- .sillyspec/quicklog/QUICKLOG-*.md` 检查行数是否骤降
2. 若骤降（被覆盖）：`git checkout HEAD -- .sillyspec/quicklog/QUICKLOG-*.md` 从最近 commit 恢复完整版本（前提：之前 commit 过完整版本）
3. 在恢复的完整文件末尾**手动追加**本次 ql 条目（丰富格式，参照 ql-20260721 样板），不要依赖 CLI 写入
4. 再 `git add` + commit

## 关联
- 与 `feedback_quicklog_rich_format` 强相关：本就要求 `--done` 后手动改写 ql 为丰富格式——改写前先确认文件完整，顺带规避此坑
- 2026-07-28 ql-005 触发，靠 `git checkout HEAD` 从 commit `1ff3755f` 恢复完整 504 行后追加 ql-005，未丢数据
