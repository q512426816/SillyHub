---
author: qinyi
created_at: 2026-10-09 05:44:00
---
# 任务清单（Tasks）— 2026-10-09-attachment-inline-reference

> 任务注册表唯一真相（plan Step 2 展开）；plan.md Wave 段以纯 ID 引用。

- [x] task-01: 附件引用纯函数库 attachment-refs.ts（buildAttRefToken/allocateAttRefToken/stripAttRefTokens/substituteAttRefsForSend/parseInlineAttRefs）+ 单测（同名唯一化/不重排/孤儿降级/uuid 口径）
- [x] task-02: 镜像高亮层 InputRefOverlay（标签样式+×角标）与历史渲染 InlineAttRefText 组件 + 各自单测
- [x] task-03: 单聊输入区接入——chip 右击 contextmenu 插入末尾、attTokenMap 状态与 onAttTokenMapChange 回传、handleRemove 联动剥离、镜像层挂载 + session-input-bar 用例
- [ ] task-04: 单聊发送置换 7 点位接线（page:2773/2909 组装 + page:830 定时 + page:3067 团队触发；dialog:1068/1220 组装 + dialog:307 定时）+ 置换用例
- [ ] task-05: 群聊闭环——group-chat-panel 输入区接入（右击/映射/镜像层/联动）+ handleSend 置换 + 群聊用例
- [ ] task-06: 历史渲染接入——turn-segment-views 正文段与群聊气泡接 InlineAttRefText + 点击开 FilePreviewModal + 用例
