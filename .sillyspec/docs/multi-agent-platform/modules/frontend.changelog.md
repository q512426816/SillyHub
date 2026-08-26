# frontend 变更索引

> 自动生成。正文历史已迁出，详见 frontend.md。
> author: qinyi
> created_at: 2026-08-26 10:20:00

- ql-20260826-008-55ce | 团队任务块展开内容被裁剪且无滚动条修复：TeamTaskBlock 根节点补 shrink-0——父层（session-panel 两渲染点会话团队任务列表 flex-col + max-h-220px + overflow-y-auto）内 flex 子项默认 shrink:1 被压扁，配合块自身 overflow-hidden 裁掉底部分身行、父层永不溢出（滚动条不出现）；shrink-0 保持自然高度让限高滚动真正生效。补回归用例 1 个（jsdom 无真实布局，断言根节点 shrink-0 class），team-block 27 + session-panel-team 12 测试全绿，tsc 0。
