---
author: flow-machine-draft
created_at: 2026-10-30T00:49:06.115Z
---
# 设计记录（Design Record）— 2026-10-30-marquee-awaiting-loop-scroll

## 做法概述

本变更怎么解决问题？改哪里、为什么选这个方案（一两段）。

现状（frontend/src/components/daemon/turn-live-marquee.tsx MarqueeItemView）：条目内 ticker 为单份文本，rAF 从 offset=0 一次滚到 `marqueeTickerEnd(textWidth, viewWidth) = min(0, viewWidth - textWidth)`（文本末尾贴窗口右缘）即停。用户实测终态出现"末尾后一大段空白"（测量宽度与视觉宽度不一致的残局），且一次滚到末尾即停对每秒都在变的等待状态文本（秒数/token/30s 提示语追加）语义不佳——屏上常驻的恰是信息量最低的尾部提示语。

方案：MarqueeItemView 增加可选 prop `scrollMode: "once" | "loop"`（默认 "once"）；"loop" 模式渲染双份相同文本（第二份 aria-hidden，带固定间隔 padding，如 48px），rAF 以恒速 TICKER_LOOP_SPEED=72px/s 向左平移，offset ≤ -周期宽度时加回周期宽度无缝回卷（窗口内第一份末尾与第二份开头内容相同，视觉连续、永无空白区段）。跑马灯宿主渲染 marquee-awaiting 条目处传 `scrollMode="loop"`。回卷折算逻辑提为纯函数 wrapLoopOffset 供单测。

## 接口契约

动了哪些函数/端点/命令/文件格式？对外可见的签名或行为变化是什么（含「无」的说明）？

- MarqueeItemView（组件内部，未对外导出）新增可选 prop `scrollMode?: "once" | "loop"`，缺省 "once"——既有调用方行为不变。
- 新增导出纯函数 `wrapLoopOffset(offset: number, loopWidth: number): number`：offset 萊入 [-loopWidth, 0) 区间（宽度变化时折回），供测试与回卷共用。
- 新增导出纯函数 `loopScrollWidth(copyWidth, viewWidth, gapPx): number`（评审 P2 修复）：一份文字 ≤ 窗口宽返回 0（不起滚、静止显示开头），超窗返回周期宽度。
- 新增常量 TICKER_LOOP_SPEED = 72（px/s）与轮间隔 TICKER_LOOP_GAP_PX = 48（px，与第二份 paddingLeft 同源）；既有 TICKER_SPEED/marqueeTickerEnd/deriveLiveMarqueeEntries 导出签名不变。
- 无后端 / API / 数据格式变化（纯前端组件行为变更）。

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）

1. 乱序/迟到到达：输入或事件乱序时，本设计的假设还成立吗？

   文本（秒数每秒 tick、token 事件、>30s 追加提示语）更新导致的宽度变化可能发生在任意 offset：重测周期宽度后经 wrapLoopOffset 把 offset 折回 [-W, 0)（测量入口沿用现有 entry.text effect + ResizeObserver(text/win) 双通道），循环不中断。测量滞后一帧最多带来 1-2px 接缝抖动，可接受；周期宽度仅在文本变化时重测，无乱序累积。

2. 并发写：两个执行体同时操作同一数据/文件会发生什么？

   组件内 tickerRafRef 单飞守卫（rAF 进行中不重复起排）沿用现状；offset/period 存组件 ref，单实例单写者，无共享可变状态；React 渲染与 rAF 只经 DOM transform 交汇（最后一帧写入者胜，下一帧自愈），无竞态面。

3. 切换/生命周期：会话、请求或变更中途切换/中断时状态是否安全？

   卸载/条目消失（isAwaiting 翻 false）/running 翻 false 时沿用现有 stopTicker（cancelAnimationFrame）与 entry.id effect cleanup；isAwaiting 翻转导致条目卸载重挂时 offset 从 0 重新起滚（语义=新一轮等待，可接受）。页面切后台 rAF 自动暂停，恢复时 dt 夹 80ms 防跳帧（沿用现状）。

4. 作用域：跨工作区/跨仓/多实例时数据会不会串台？

   不适用：全部状态为组件实例内 ref/localStorage 无关，无跨会话、跨仓、多实例共享数据面。

## 风险与死路

本方案最大的风险是什么？试过但放弃的方案及放弃理由？

- 最大风险：jsdom 无真实布局，回卷视觉正确性（无缝、无空白）无法在单测里直接验证，只能靠纯函数 wrapLoopOffset/loopScrollWidth + 双份 DOM 结构断言覆盖；上线后需在真实页面肉眼确认一轮循环（视觉证据 visual-evidence.md 记录）。
- 评审 P2（短文本相位露白，turn-live-marquee.tsx loopScrollWidth 锚点）已实装修复：一份文字 ≤ 窗口宽时不起滚、静止显示开头（等待初期无 token 数据的常态阶段），文本增长超窗后自然起滚；48px 轮间隔空隙经过窗口属跑马灯轮次分隔的常态运动空白，非静止死白。
- 放弃方案 ①（单份文本滚到末尾后直接跳回开头继续）：末尾贴右缘时跳变突兀，且若滚过末尾继续左移，窗口右侧必然出现空白区段——正是用户本次抱怨的现象，故必须双份拼接。
- 放弃方案 ②（用户最初提议：删掉 inline-block class）：span 退回 display:inline 后 CSS transform 对 inline 非替换元素不生效，滚动"悄悄失效"，属碰巧坏掉式修法、代码意图不明，被否。
- 放弃方案 ③（所有 running 条目统一改循环）：thinking 流式文本持续增长，"循环一轮"与"跟随新末尾"语义冲突（慢速下一轮极长且内容一直在变），保持 once 模式；仅每秒变化、内容收敛的 marquee-awaiting 条目改 loop。
- 残留风险：文本每秒变化时周期宽度微变，回卷点可能有 1-2px 抖动；双份文本使 ticker DOM 文本量翻倍（单条目 <1KB 量级，无性能面问题）。

## 文件变更清单

| 操作 | 路径 | 说明 |
| --- | --- | --- |
| 修改 | frontend/src/components/daemon/turn-live-marquee.tsx | MarqueeItemView 增加 scrollMode="loop" 分支（双份 DOM + 恒速 rAF + wrapLoopOffset 回卷）；awaiting 渲染处接入 loop |
| 修改 | frontend/src/components/daemon/__tests__/turn-live-marquee.test.tsx | 新增循环模式用例（双份渲染、wrapLoopOffset 纯函数、reduced 静态）；既有断言不动 |
