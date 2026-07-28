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

---

## 补充（qinyi，2026-07-28 追加）：同根因的轻度版表现 + 项目规则层面的回避决策

**轻度版现象**（2026-07-28 ql-008-375b 实测）：step3 `--done` 后，CLI **不会**丢历史/frontmatter（与 WhaleFall 重度版不同），但会**重写当前条目的骨架字段**——把我手动精修过的 `## ql-... | 时间 | 真实标题` 标题行，重写成 `--input`/`--output` 拼出来的简版标题；并把「状态：进行中」翻成「已完成」。我手写的四段式正文（需求/根因/方案/结果）和文件其余历史**保留**未丢。

**根因同上**：CLI 在 `--done` 收尾时把 QUICKLOG 当「只含当前会话 ql」重写。区别只在写入强度——轻度版只重写当前条目的骨架字段（标题/状态），重度版（WhaleFall 那次）连带把整文件历史清空。推测强度差异与 CLI 版本或当时文件状态有关，根因待工具方统一修。

**项目规则层面的回避决策**：CLAUDE.md 原第 20 条「QUICKLOG 必须用丰富格式」要求每次 `quick --done` 后手动把 CLI 写的简版改写成四段式。但与上述 CLI 行为**直接冲突**——人工精修会被 `--done` 重写覆盖（轻度版正是踩此）。2026-07-28 经用户确认**删除该条规则**，从源头消除冲突：项目不再要求人工精修 QUICKLOG，接受 CLI 的简版写入为准；真正根治仍需工具方修 `--done` 不重写用户已手改的字段（只翻「状态：」即可）。

**当前状态**：坑仍活跃（CLI 仍会重写），但项目侧通过删规则已回避人工精修被覆盖的矛盾。重度版（丢历史）仍需靠本文件「规避」段的 `git checkout HEAD` 恢复法应对。
