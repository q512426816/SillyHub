---
author: flow-machine-draft
created_at: 2026-10-22T04:04:55.020Z
---
# 提案书（Proposal）— 2026-10-22-askuser-card-inline

## 动机

任务原话转写：会话页 AskUser 提问卡悬浮改内嵌滚动

动机：pending AskUser 询问卡当前为 sticky 钉顶悬浮（turn-timeline.tsx sticky top-0 + indigo 半透明背景条），长日志滚动时始终悬浮占据顶部；用户反馈应直接嵌入当前内容流、可随内容上下滚动。

成功标准：
- 会话页 pending AskUser 提问卡嵌入内容流渲染（非 sticky 钉顶悬浮），随日志上下滚动
- 全部最小化时容器仍仅作挂载占位（无视觉框），右下角胶囊行为不变
- 待决策 pill 定位还原（滚顶+ring 闪烁）功能不回退
- 受影响测试通过，tsc 零错

## 变更范围

按成功标准机械推导，共 4 条验收面：
1. 会话页 pending AskUser 提问卡嵌入内容流渲染（非 sticky 钉顶悬浮），随日志上下滚动
2. 全部最小化时容器仍仅作挂载占位（无视觉框），右下角胶囊行为不变
3. 待决策 pill 定位还原（滚顶+ring 闪烁）功能不回退
4. 受影响测试通过，tsc 零错

## 成功标准（可验证）

1. 会话页 pending AskUser 提问卡嵌入内容流渲染（非 sticky 钉顶悬浮），随日志上下滚动
2. 全部最小化时容器仍仅作挂载占位（无视觉框），右下角胶囊行为不变
3. 待决策 pill 定位还原（滚顶+ring 闪烁）功能不回退
4. 受影响测试通过，tsc 零错
