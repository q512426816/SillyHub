---
author: flow-machine-draft
created_at: 2026-10-23T02:25:19.310Z
---
# 设计记录（Design Record）— 2026-10-23-live-turn-meta-time

## 做法概述

本变更怎么解决问题？改哪里、为什么选这个方案（一两段）。

根因两层：① 数据层——`session-panel/page-helpers.tsx` `enrichDisplayTurns` 的 `replyAt: t.replyAt ?? meta.finished_at ?? meta.started_at` 对运行中 run（finished_at=null）把 started_at 伪造成「答复完成时间」；② 渲染层——`turn-timeline.tsx` TurnRow 的 `metaDetail` 只认 replyAt，拿到伪造值就渲染「开始 X · 结束 X(=同一时刻) · 历时 00:00」。修复对应两层：数据层对活跃 run 保持 replyAt=null（对齐字段注释「运行中 null 不显示」与排序函数「运行中无 replyAt → Infinity 排末尾」的既有设计意图）；渲染层 metaDetail 增加 isLiveTurn 优先分支——「开始 HH:MM:SS · 历时 mm:ss(实时)」，历时由新小组件 TurnLiveElapsedText 每秒局部 tick（复刻 TurnStatusBar 渲染经济模式，tick 不外溢父级），终态后组件卸载清 interval、恢复既有三段。

## 接口契约

动了哪些函数/端点/命令/文件格式？对外可见的签名或行为变化是什么（含「无」的说明）？

- `RoundDividerProps.detail: string | undefined` → `ReactNode | undefined`（`src/components/chat/round-divider.tsx`；放宽不收紧，string ⊂ ReactNode，唯一传参消费方 turn-timeline 零迁移，渲染分支 `{detail && ...}` 对元素节点语义不变）。
- `enrichDisplayTurns`（`src/components/daemon/session-panel/page-helpers.tsx`）签名不变；行为变化——活跃 run（meta.status ∈ ACTIVE_RUN_STATUSES：running/pending/pending_approval）且 turn.replyAt / meta.finished_at 均缺时，产物 `replyAt` 由「快照 started_at」改为 `null`；终态/未知态回退链不变。
- 新增内部组件 `TurnLiveElapsedText`（turn-timeline.tsx，不导出）：props `{ startedAtMs: number }`，渲染「历时 mm:ss」（formatTurnDuration 既有格式）。
- 后端/HTTP 端点/文件格式：无改动。

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）

1. 乱序/迟到到达：输入或事件乱序时，本设计的假设还成立吗？

   成立。runs 快照与 SSE 终态事件乱序时：终态事件先到、快照仍标 running——渲染走 turn.status（isLiveTurn 优先于 replyAt），不受快照滞后影响；快照先带 finished_at 而日志流未收尾（status 仍 running）——isLiveTurn 优先，继续走秒，快照 finished_at 不被采信为结束时刻，收尾事件到达后自然切三段。两序均安全。

2. 并发写：两个执行体同时操作同一数据/文件会发生什么？

   纯前端渲染态派生，无共享可变写。setInterval 局部于组件实例；对话/全部视图 viewMode 互斥，同一轮同一时刻只渲染一处 detail，无双定时器。多会话并行（悬浮对话 + sessions 页）各持独立 TurnTimeline 实例，互不串台。

3. 切换/生命周期：会话、请求或变更中途切换/中断时状态是否安全？

   安全。轮次转终态 → metaDetail 变字符串 → TurnLiveElapsedText 卸载 → useEffect cleanup 清 interval（同 TurnStatusBar 既有模式）；会话切换/时间线卸载同理。turnStartedAt 因快照轮换变化时 tick 以新锚点重算（props 驱动）。

4. 作用域：跨工作区/跨仓/多实例时数据会不会串台？

   不会。改动均在会话渲染层与快照补齐纯函数内，sessions 页 / 悬浮对话 / runtimes 弹窗 / proto 预览共用同内核一次修复；backend / sillyhub-daemon 跨仓零触达。

## 风险与死路

本方案最大的风险是什么？试过但放弃的方案及放弃理由？

最大风险：RoundDivider 是 memo 组件，detail 从 string（值相等可命中 memo）变为运行中轮每渲染新建的 React 元素 → 该轮 RoundDivider memo 恒 miss。评估：仅单条运行中轮受影响、RoundDivider 渲染成本极小（几个 span），且运行中轮本就随流式 delta 高频重渲染（tokens meta 同步变化），无可感差异；终态轮 detail 仍是 string，memo 命中率不变。
放弃方案：① 父级 TurnRow 持 interval 整体重算 metaDetail——每秒整轮重渲染，违反渲染经济铁律（FR-06 惯例，TurnStatusBar 注释明载 tick 不外溢），放弃；② 只改数据层（running → replyAt=null）——该位置整体消失，不满足「进行中显示实时走秒历时」的用户裁决，放弃；③ RoundDivider 开专用 liveElapsed prop——为单场景在共享组件上扩接口面，比向后兼容的类型放宽侵入更大，放弃。

## 文件变更清单

| 操作 | 路径 | 说明 |
| --- | --- | --- |
| 改 | frontend/src/components/daemon/turn-timeline.tsx | metaDetail 三分支 + TurnLiveElapsedText 走秒组件 |
| 改 | frontend/src/components/chat/round-divider.tsx | detail prop 类型 string→ReactNode |
| 改 | frontend/src/components/daemon/session-panel/page-helpers.tsx | 活跃 run replyAt 不回退 started_at |
| 改 | frontend/src/components/daemon/__tests__/turn-time-display.test.tsx | 新增运行中/完成切换用例 |
| 改 | frontend/src/components/daemon/__tests__/runtime-session-helpers.test.tsx | 新增活跃 run replyAt 不伪造用例 |
