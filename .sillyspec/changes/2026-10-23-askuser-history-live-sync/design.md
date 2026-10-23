---
author: flow-machine-draft
created_at: 2026-10-23T02:21:05.382Z
---
# 设计记录（Design Record）— 2026-10-23-askuser-history-live-sync

## 做法概述

本变更怎么解决问题？改哪里、为什么选这个方案（一两段）。

根因：dialogHistory（驱动对话/进度内容流 AskUser 穿插渲染的数据源）只在 sessionId 变化的 effect 里 REST 拉一次，SSE 两个 permission 事件（onPermissionRequest ~1674 / onPermissionResolved ~1687）都只维护 pendingRequests——待答卡原先渲染在时间线内容流内，提问实时可见掩盖了历史不实时；2026-10-22-askuser-dock-inputbar 把卡迁到输入框位置后，内容流对提问/回答完全无实时回显（刷新页面才显示）。

方案：在 page-helpers 新增共享函数 `refetchDialogHistory(sessionId, setDialogHistory, seqRef)`（带序号防护的重拉动作函数；评审 P3 收敛：原稿契约名 createDialogHistoryRefetch 系笔误，实态为直接执行型函数），两挂载点（session-panel-page / session-panel-dialog）在 onPermissionRequest 与 onPermissionResolved 回调里各调用一次重拉——提问到达时后端 dialogs 已落库 pending 项（fetchPendingDialogs 同源可证），resolved 时答案已写库（backend 落库后推事件），重拉即得权威数据。前端不手工把 SSE 事件转 SessionDialogRead（resolved 事件不含 answers，伪造会与后端不一致）；事件频率为问答级（人答），重拉开销可忽略。

## 接口契约

动了哪些函数/端点/命令/文件格式？对外可见的签名或行为变化是什么（含「无」的说明）？

新增导出：page-helpers.tsx `createDialogHistoryRefetch(sessionId, setDialogHistory, seqRef)`——纯前端 helper，无后端/协议/SSE 事件格式变化；消费方仅 session-panel-page 与 session-panel-dialog 两处 SSE 回调内调用（组件对外 props 零变化）。

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）

1. 乱序/迟到到达：输入或事件乱序时，本设计的假设还成立吗？

成立：单事件触发的单次重拉无乱序面；相邻事件（request→resolved 秒级内）触发两次重拉并发时，递增 seq 守卫只接受最新一次响应（旧响应丢弃），最终收敛到后端权威状态。事件重复到达（resync 回放）幂等——重拉结果幂等，setDialogHistory 覆盖式写入。

2. 并发写：两个执行体同时操作同一数据/文件会发生什么？

纯前端组件 state：setDialogHistory 是 React 单线程 reducer 式更新，无跨执行体写面；重拉 fetch 是只读 GET，无服务端写。

3. 切换/生命周期：会话、请求或变更中途切换/中断时状态是否安全？

安全：重拉闭包绑定建立流时的 sessionId（与既有 SSE 回调同闭包），会话切换后旧流的回调不再触发（streamRef 生命周期既有管理）；sessionId 变化的 effect 重拉（既有 2856 路径）会用新会话数据整体覆盖，旧会话迟到响应被闭包隔离（fetch 的是旧 sessionId 的数据但 set 目标同 state——由 seq 守卫 + 新会话 effect 全量覆盖兜底，最坏一次旧数据闪现后被新会话拉取覆盖，非持久污染）。

4. 作用域：跨工作区/跨仓/多实例时数据会不会串台？

不会：fetchSessionDialogHistory 按 sessionId 取数，闭包绑定本会话；page/dialog 两挂载点各自实例各自 state，无共享写面。

## 风险与死路

本方案最大的风险是什么？试过但放弃的方案及放弃理由？

最大风险：resolved 事件到达时后端答案落库与事件推送的时序竞态——若推送先于落库（理论窗口），重拉拿到的仍是 pending 态，记录短暂停留未更新，直到下一次事件/刷新兜底。评估可接受：backend 的 resolved 语义是"请求已收口"（落库后广播），实际窗口极小；且问答级频率下无重试风暴风险。

放弃的方案：a) 前端把 SSE 事件手工转 SessionDialogRead 增量 append/merge——resolved 事件不含 answers（SessionPermissionResolved 无答案字段），必须伪造或再查单条，且 id/created_at 等 REST 字段 SSE 缺失，拼装体与刷新后权威数据不一致（闪变）；b) 后端在 resolved 事件里加 answers 字段——动 SSE 契约+后端，改动面大且只解决 resolved 一半（request 到达仍需转换），违背"前端回显权威数据"原则；c) 轮询 dialogHistory——问答级频率用轮询浪费且延迟不可控。均弃。

## 文件变更清单

| 操作 | 路径 | 说明 |
| --- | --- | --- |
| 修改 | frontend/src/components/daemon/session-panel/page-helpers.tsx | 新增 refetchDialogHistory 共享 helper（seq 防乱序 + 静默降级） |
| 修改 | frontend/src/components/daemon/session-panel/session-panel-page.tsx | onPermissionRequest/onPermissionResolved 回调接重拉（seqRef 实例） |
| 修改 | frontend/src/components/daemon/session-panel/session-panel-dialog.tsx | 同款接线（与 page 同构） |
| 修改 | frontend/src/components/daemon/__tests__/session-panel-dialog.test.tsx | 新增 2 用例：request 到达重拉回显 / resolved 到达再拉更新 |
| 新增 | frontend/src/components/daemon/session-panel/__tests__/refetch-dialog-history.test.ts | 乱序防护/正常路径/失败降级单测（评审 P3 收敛：清单补列） |
