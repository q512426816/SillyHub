---
author: flow-machine-draft
created_at: 2026-10-16T08:03:37.013Z
---
# 决策记录（Decisions）— 2026-10-16-session-pill-dock-drag

## D-001@v1: 设计期风险与放弃方案（底稿）
- 类型：process
- 状态：confirmed
- 答案：最大风险：拖拽与点击手势冲突（按住 pill 移动一点算点击还是拖拽）。口径=位移阈值 6px（小于阈值放行 click）+ 松手后 250ms 吞 click 时间窗（比布尔位稳：拖出元素外松手 click 不触发，布尔位会误吞下一次真点击）——两者均沿用悬浮球实测过的先例。 试过但放弃：a) pointer capture 实现拖拽——jsdom 无实现（测试不可达）且 capture 会劫持 click 目标破坏 pill 点击；b) 拖动过程每次 setPos 都持久化——localStorage 高频写（悬浮球现状），改为松手单点写；c) 保留 hover 双触发——用户明确要求纯点击防误触；d) 沿用挂载点 absolute 容器改竖排——拖不出面板且受祖先裁剪，改 portal body fixed。
