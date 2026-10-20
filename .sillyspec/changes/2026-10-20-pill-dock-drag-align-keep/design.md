---
author: flow-machine-draft
created_at: 2026-10-20T01:13:17.386Z
---
# 设计记录（Design Record）— 2026-10-20-pill-dock-drag-align-keep

## 做法概述

本变更怎么解决问题？改哪里、为什么选这个方案（一两段）。

用户实测:左停靠的 pill 组拖拽过程中内容固定右对齐,松手吸附后才恢复。根因:`onPointerMove` 的中间态走 `clampPos`,其返回值不携带吸附侧标记 `left`(2026-10-20-pill-dock-left-align 引入),渲染按 `pos.left` 缺省兜底 items-end。

方案:`clampPos` 返回值透传 `p.left`——拖拽中间态继承最近吸附态的侧别标记,渲染保持拖拽前对齐方向;松手吸附时 `snapPos` 重新判定并覆盖 left(既有行为)。核心改动一行,不新增状态、不动持久化格式。

## 接口契约

动了哪些函数/端点/命令/文件格式？对外可见的签名或行为变化是什么（含「无」的说明）？

`clampPos`(组件文件内纯函数)返回值从 `{x, y}` 变为 `{x, y, left}`(透传入参的 left;入参无 left 时透传 undefined,行为同旧)。该函数无组件外调用方。对外 props/DOM/data-testid/localStorage 存档格式(`{x,y}`)均无变化;唯一可见行为变化 = 拖拽过程中对齐方向不再固定右对齐,保持拖拽前吸附侧。

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）

1. 乱序/迟到到达：输入或事件乱序时，本设计的假设还成立吗？
   成立。pointermove 高频/乱序到达时每次 clampPos 幂等透传同一 left(源自拖拽前吸附态 pos),与事件顺序无关;松手(pointercancel 同款)由 snapPos 原子重判,单一定向收尾。

2. 并发写：两个执行体同时操作同一数据/文件会发生什么？
   不适用:本变更不新增任何写入面。localStorage 仍只在松手吸附时写一次,口径与 2026-10-20-pill-dock-left-align 相同。

3. 切换/生命周期：会话、请求或变更中途切换/中断时状态是否安全？
   安全。拖拽中断(pointercancel)走 endDrag→snapPos 收敛回吸附态,left 同步重判;left 始终为内存派生态,崩溃/刷新最坏情况 = 存档仍是合法 {x,y},重载后 snapPos 重推导,无脏态。

4. 作用域：跨工作区/跨仓/多实例时数据会不会串台？
   不适用:改动为组件内纯函数返回结构,无跨实例共享数据面。

## 风险与死路

本方案最大的风险是什么？试过但放弃的方案及放弃理由？

最大风险(声明边界):拖拽中把组拖到对面半边但未松手时,视觉位置在左/右而对齐仍是拖拽前方向——这是设计意图(对齐切换只在松手吸附时发生,避免拖拽中过中线来回翻转抖动),非缺陷。
放弃的方案:拖拽中实时按位置中线切换对齐——过中线时两个 pill 的对齐侧来回翻转,组框跟手移动叠加对齐抖动视觉混乱,且拖拽中位置本就是临时态,实时切换无信息增益。

## 文件变更清单

| 操作 | 路径 | 说明 |
|---|---|---|
| 修改 | frontend/src/components/daemon/session-floating-pill-dock.tsx | clampPos 返回值透传 p.left(拖拽中间态继承吸附侧标记) |
| 修改 | frontend/src/components/daemon/__tests__/session-floating-pill-dock.test.tsx | 新增左停靠拖拽中保持 items-start 用例;既有拖拽用例补拖拽中 items-end 断言 |
