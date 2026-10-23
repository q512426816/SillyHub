---
author: flow-machine-draft
created_at: 2026-10-23T03:46:27.543Z
---
# 决策记录（Decisions）— 2026-10-23-diff-dialog-copy-fallback

## D-001@v1: 设计期风险与放弃方案（底稿）
- 类型：process
- 状态：confirmed
- 答案：答：最大风险是复制文本与 DiffView 视觉行的对齐预期——用户可能期望复制的内容可直接 `git apply`，但平台没有 hunk header（`@@ -a,b +c,d @@`）与文件头，纯前缀文本不能直接应用。缓解：按钮 label 与段标题明确语义（「复制该段 diff」），脚注保持「仅行级内容」表述；不伪造 header 是刻意选择。 试过放弃的方案：① 直接复制原始 edit_patch JSON——粘贴出去不可读且与脚注「完整内容」语义不符，放弃；② 给 diffRowsToText 拼造 unified header（用 rows 行号推 @ 头）——hunk 边界信息已丢（分隔伪行是视觉标记），拼造可能错位误导 git apply，放弃；③ 升级 DiffView 为内置复制（改共享组件签名）——DiffView 现有 5+ 消费方（agent-log 工具卡、daemon tool-args-detail）都有自己的复制兜底，改共享件会牵动面过大，本变更在弹窗消费侧挂按钮即可，放弃。
