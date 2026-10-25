# 视觉证据 — 2026-10-25-marquee-inactive-awaiting-fix

## 现象（用户反馈 2026-10-25）

子代理都已结束，卡片内嵌流动条仍显示「等待模型响应 ✨ 转圈」。

## 根因

「等待模型响应」合成条目假设组件处于运行中宿主（外部跑马灯由消费方门控仅运行中轮渲染）；
子代理卡片在终态后仍渲染内嵌流动条，latest 非 running 即触发等待条目——子代理早已结束，假等永不停。

## 修复

- `TurnLiveMarquee` 新增 `active?: boolean`（默认 true）：`isAwaiting = active && latest 非 running`，
  等待 interval 随之不启动；
- `SubagentBlockView` 内嵌条传 `active={running}`（卡片自身状态）；
- 外部会话跑马灯不传 active，行为零变化。

## 核验

- 测试：turn-live-marquee 32 用例（新增「active=false 无等待条目」）+
  turn-segment-views 96 用例（新增「终态卡片内嵌条无等待」）全绿；lint / typecheck 通过
  （turn-segment-views 一条 `summaryOf` 警告为并行会话存量，非本变更引入）。
- 真码原型复验（端口 3005）：终态子代理卡片（agent done）内嵌流动条文本
  「搜索 · Grep … 800ms · 运行命令 · Bash … 1s · LIVE」——**无「等待模型响应」**
  （修复前同场景多出「等待模型响应 · 2.0s」转圈）；Drawer 详情正常。
