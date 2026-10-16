---
author: flow-machine-draft
created_at: 2026-10-16T06:31:11.229Z
---
# 设计记录（Design Record）— 2026-10-16-session-pill-dock-drag

## 做法概述

本变更怎么解决问题？改哪里、为什么选这个方案（一两段）。

新增 `SessionFloatingPillDock` 悬浮停靠组组件（`frontend/src/components/daemon/session-floating-pill-dock.tsx`）：portal 到 body 的 `position:fixed` 容器，`flex-col items-end` 把待决策 / 变更文件两个 pill 竖排成组；拖拽复用 floating-session-host 悬浮球的成熟模式（window 监听 pointermove/up 不依赖 pointer capture、6px 位移阈值、松手吸附、localStorage 持久化、250ms 拖后吞 click 时间窗），并补齐停靠组特有需求：松手恒吸附较近左右边缘（EDGE_GAP=16px）、纵向钳制窗内、ResizeObserver 按 pill 显隐引起的组尺寸变化重收敛防右缘溢出。挂载点（session-panel-page.tsx）由旧「absolute 悬浮行」换为该停靠组，两 pill 组件仅改 antd Popover `trigger` 从 `["hover","click"]` 到 `"click"`（用户需求：点击展开不再误触），aria-label 同步去「悬浮」字样。

选 portal body + fixed 而非沿用挂载点内 absolute 容器：拖动目标是「窗口范围内」任意位置，absolute 受面板祖先 overflow/transform 裁剪且出不了面板；fixed+portal 无此问题。

## 接口契约

动了哪些函数/端点/命令/文件格式？对外可见的签名或行为变化是什么（含「无」的说明）？

- 新增导出 `SessionFloatingPillDock({ children })`（frontend/src/components/daemon/session-floating-pill-dock.tsx），`data-testid="session-pill-dock"`。
- `SessionDecisionsHover` / `SessionChangeFilesHover`（embedded 形态）对外 props 不变；行为变化：Popover trigger 由 hover+click 改为纯 click；aria-label「悬浮查看会话待决策信息/悬浮查看会话关联的变更文件」改为「查看会话待决策信息/查看会话关联的变更文件」。
- 新增 localStorage 键 `sillyhub:session-pill-dock`（`{x,y}` 停靠位，仅拖拽结束时写入）。
- 后端 API / OpenAPI / 文件格式：无改动（gen:types 义务不触发）。

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）

4. 作用域：跨工作区/跨仓/多实例时数据会不会串台？

3. 切换/生命周期：会话、请求或变更中途切换/中断时状态是否安全？

2. 并发写：两个执行体同时操作同一数据/文件会发生什么？

1. 乱序/迟到到达：输入或事件乱序时，本设计的假设还成立吗？

1. 乱序/迟到到达：拖拽手势经 pointerId 过滤（多指/迟到 move 不串）；resize 与 ResizeObserver 收敛均走幂等 snapPos（存档值本就是吸附态，重放不漂移）；pill 数据异步迟到只改组尺寸，settle/RO 按新尺寸重收敛且保持吸附侧。
2. 并发写：localStorage 键仅拖拽结束单点写入（拖动过程不写）；停靠组为会话页单挂载点，页面内无并发写者；多标签页各拖各的后者覆盖前者——仅 UI 位置偏好，无数据破坏。
3. 切换/生命周期：拖拽中卸载（切会话/路由）由 effect cleanup 摘除 window 监听，未持久化的中间位丢弃回落存档/默认；SSR/水合首帧 pos=null 不渲染（createPortal 仅客户端执行），无水合不一致；拖拽结束才 persist。
4. 作用域：停靠位是浏览器全局偏好，跨工作区/跨会话共享同一位置（有意为之，同悬浮球先例）；两 pill 的数据面仍各自按 sessionId/workspaceId 隔离，不串台。

## 风险与死路

本方案最大的风险是什么？试过但放弃的方案及放弃理由？

最大风险：拖拽与点击手势冲突（按住 pill 移动一点算点击还是拖拽）。口径=位移阈值 6px（小于阈值放行 click）+ 松手后 250ms 吞 click 时间窗（比布尔位稳：拖出元素外松手 click 不触发，布尔位会误吞下一次真点击）——两者均沿用悬浮球实测过的先例。

试过但放弃：a) pointer capture 实现拖拽——jsdom 无实现（测试不可达）且 capture 会劫持 click 目标破坏 pill 点击；b) 拖动过程每次 setPos 都持久化——localStorage 高频写（悬浮球现状），改为松手单点写；c) 保留 hover 双触发——用户明确要求纯点击防误触；d) 沿用挂载点 absolute 容器改竖排——拖不出面板且受祖先裁剪，改 portal body fixed。
