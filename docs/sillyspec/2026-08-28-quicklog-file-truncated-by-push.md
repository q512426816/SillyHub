# quicklog-push 疑似成功后本地 QUICKLOG 被整体清空（仅剩当条）

- 日期：2026-08-28
- 状态：活跃坑（未定位到 CLI 代码，先记录现象与规避）
- author: WhaleFall
- created_at: 2026-08-28 11:10:00

## 现象

quick 会话 quick-e75c7b0e（ql-20260828-011-1ec7）生命周期内，`.sillyspec/quicklog/QUICKLOG-WhaleFall.md` 从 510 行（46 条历史条目）被重写为 11 行（仅剩当次新条目）。step3 --done 落盘后 `git add` 提交时 diff 显示 -513 行，历史条目全部消失。

对照：上一次 quick 会话 quick-1938ac56（ql-20260828-009-4a13）启动时输出过 `[quicklog-push] ql-20260828-009-4a13 推送失败: 超时（文件链路兜底）`，其后文件保持完整追加；quick-e75c7b0e 启动时无推送失败提示（疑似平台 push 成功），随后文件被截断。

## 怀疑方向

quicklog-push 成功路径可能带「已上传条目本地清理」逻辑，清理时把整个文件重写为仅剩当前会话条目；或写文件时未先读旧内容直接整体覆盖。

## 规避

- 每次 quick `--done` 提交前，`git diff` 检查 QUICKLOG 删除行数：删除远大于当条条目体积即触发恢复流程。
- 恢复方法：`git show <上一提交>:​.sillyspec/quicklog/QUICKLOG-WhaleFall.md` 为基底，合并当次新条目写回。

## 已实证恢复

d1752d11（2026-08-28）：从 9fe3df78 恢复 46 条历史 + ql-20260828-011-1ec7 合并，47 条目 521 行。
