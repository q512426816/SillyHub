---
author: flow-machine-draft
created_at: 2026-10-25T06:44:52.990Z
---
# 提案书（Proposal）— 2026-10-25-marquee-inactive-awaiting-fix

## 动机

任务原话转写：修复终态子代理卡片内嵌流动条仍显示等待转圈

动机：子代理已结束后卡片内嵌流动条仍显示「等待模型响应」转圈——等待条目是为运行中场景设计的，终态宿主不该出现。

成功标准：
- TurnLiveMarquee 新增 active 属性（默认 true）：active=false 时不再追加「等待模型响应」合成条目，走秒 tick 也不为等待而启动
- SubagentBlockView 按卡片自身运行态传 active：子代理终态后内嵌流动条无等待条目、无转圈；运行中行为不变
- 外部会话跑马灯不传 active，行为零变化
- 新增终态不显示等待条目用例；现有全部用例通过；lint与typecheck通过

## 变更范围

按成功标准机械推导，共 4 条验收面：
1. TurnLiveMarquee 新增 active 属性（默认 true）：active=false 时不再追加「等待模型响应」合成条目，走秒 tick 也不为等待而启动
2. SubagentBlockView 按卡片自身运行态传 active：子代理终态后内嵌流动条无等待条目、无转圈；运行中行为不变
3. 外部会话跑马灯不传 active，行为零变化
4. 新增终态不显示等待条目用例；现有全部用例通过；lint与typecheck通过

## 成功标准（可验证）

1. TurnLiveMarquee 新增 active 属性（默认 true）：active=false 时不再追加「等待模型响应」合成条目，走秒 tick 也不为等待而启动
2. SubagentBlockView 按卡片自身运行态传 active：子代理终态后内嵌流动条无等待条目、无转圈；运行中行为不变
3. 外部会话跑马灯不传 active，行为零变化
4. 新增终态不显示等待条目用例；现有全部用例通过；lint与typecheck通过
