---
author: flow-machine-draft
created_at: 2026-10-23T01:22:36.798Z
---
# 提案书（Proposal）— 2026-10-22-askuser-dock-inputbar

## 动机

任务原话转写：AskUser 问答卡迁至底部输入框位置

动机：会话页 AskUser 问答卡内嵌在内容流顶部用户看不到（上轮 2026-10-22-askuser-card-inline 遗留位置问题）；改为渲染在底部输入框位置：pending 期间互斥替换 SessionInputBar（输入框不可用），答完自动恢复输入框；卡区固定最大高度，超出内部滚动。

成功标准：
- pending AskUser 问答卡渲染于真会话底部输入框位置（互斥替换 SessionInputBar，session-panel-page 与 session-panel-dialog 两挂载点同款），时间线滚动区不再渲染 pending 卡
- 问答卡区有固定最大高度（约 45vh 量级），内容超出时区内上下滚动；提交回答或 resolved 后输入框自动恢复
- 最小化（收起为右下角胶囊）与待决策 pill 定位还原能力保留，pill 点击还原+高亮闪烁（不再滚顶）
- ended/failed 会话不渲染问答区，输入框正常显示
- TurnTimeline 移除 pending 卡渲染与相关 props，群聊面板零变化，受影响测试全绿 + tsc 零错

## 变更范围

按成功标准机械推导，共 5 条验收面：
1. pending AskUser 问答卡渲染于真会话底部输入框位置（互斥替换 SessionInputBar，session-panel-page 与 session-panel-dialog 两挂载点同款），时间线滚动区不再渲染 pending 卡
2. 问答卡区有固定最大高度（约 45vh 量级），内容超出时区内上下滚动；提交回答或 resolved 后输入框自动恢复
3. 最小化（收起为右下角胶囊）与待决策 pill 定位还原能力保留，pill 点击还原+高亮闪烁（不再滚顶）
4. ended/failed 会话不渲染问答区，输入框正常显示
5. TurnTimeline 移除 pending 卡渲染与相关 props，群聊面板零变化，受影响测试全绿 + tsc 零错

## 成功标准（可验证）

1. pending AskUser 问答卡渲染于真会话底部输入框位置（互斥替换 SessionInputBar，session-panel-page 与 session-panel-dialog 两挂载点同款），时间线滚动区不再渲染 pending 卡
2. 问答卡区有固定最大高度（约 45vh 量级），内容超出时区内上下滚动；提交回答或 resolved 后输入框自动恢复
3. 最小化（收起为右下角胶囊）与待决策 pill 定位还原能力保留，pill 点击还原+高亮闪烁（不再滚顶）
4. ended/failed 会话不渲染问答区，输入框正常显示
5. TurnTimeline 移除 pending 卡渲染与相关 props，群聊面板零变化，受影响测试全绿 + tsc 零错
