---
author: flow-machine-draft
created_at: 2026-10-25T06:44:52.990Z
---
# 设计记录（Design Record）— 2026-10-25-marquee-inactive-awaiting-fix

## 做法概述

本变更怎么解决问题？改哪里、为什么选这个方案（一两段）。

根因：「等待模型响应」合成条目假设组件处于**运行中**宿主（外部跑马灯由消费方门控只在运行中轮渲染）；
但子代理卡片在子代理终态后仍渲染内嵌流动条（SubagentBlockView 无条件挂载），latest 非 running 即触发等待条目——
子代理早已结束，转圈永远不停。

修复：`TurnLiveMarquee` 新增 `active?: boolean`（默认 true）；`isAwaiting = active && latest.status !== "running"`，
等待 interval 依赖 isAwaiting（active=false 自然不启动）。`SubagentBlockView` 内嵌条传 `active={running}`
（卡片自身状态：终态 → 无等待、条目显示总耗时）。外部消费点不传 active，零变化。

## 接口契约

动了哪些函数/端点/命令/文件格式？对外可见的签名或行为变化是什么（含「无」的说明）？

- `TurnLiveMarqueeProps` 新增可选 `active?: boolean`（默认 true）。
- `SubagentBlockView` 内嵌流动条传 `active={running}`；其余 props / 导出 / 后端接口：**无变化**。

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）

1. 乱序/迟到到达：输入或事件乱序时，本设计的假设还成立吗？
   - 成立。active 取卡片自身状态；终态后迟到的 children 更新只影响条目内容，不复活等待条目。
2. 并发写：两个执行体同时操作同一数据/文件会发生什么？
   - 无写面；纯展示开关。
3. 切换/生命周期：会话、请求或变更中途切换/中断时状态是否安全？
   - 安全。running→终态翻转时 active 变 false，等待条目卸载、interval 清理（既有 cleanup）。
4. 作用域：跨工作区/跨仓/多实例时数据会不会串台？
   - 不涉及数据。

## 风险与死路

本方案最大的风险是什么？试过但放弃的方案及放弃理由？

- 风险：子代理运行中但内部全部工具完成时（等 LLM），等待条目照常显示——这正是期望行为（子代理还在跑）。
- 放弃方案：① 终态卡片不渲染内嵌流动条（用户要求框内持续展示内部过程，只是不要假等待）；② 等待条目由宿主自行渲染（重复逻辑）。
