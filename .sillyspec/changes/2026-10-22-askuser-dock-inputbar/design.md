---
author: flow-machine-draft
created_at: 2026-10-23T01:22:36.798Z
---
# 设计记录（Design Record）— 2026-10-22-askuser-dock-inputbar

## 做法概述

本变更怎么解决问题？改哪里、为什么选这个方案（一两段）。

上轮（2026-10-22-askuser-card-inline）把 pending AskUser 卡改内嵌内容流顶部，但位置在日志顶部仍不易见。本变更新建组件 `PendingDialogDock`（frontend/src/components/daemon/pending-dialog-dock.tsx），把 TurnTimeline 内的 pending 卡整套（卡列渲染 + 最小化 state + 右下角胶囊 + pill 定位还原 effect）整体迁出，渲染到真会话底部输入框位置：session-panel-page（~5765 SessionInputBar 处）与 session-panel-dialog（~2204 SessionInputBar 处）两挂载点以同一互斥条件渲染——`pendingRequests.length > 0 && sessionStatus 非 ended/failed` 时渲染 dock、否则渲染 SessionInputBar。dock 容器对齐输入栏视觉（shrink-0 bg-card px-5 pb-4 pt-1），内部卡列区 max-h-[45vh] overflow-y-auto overscroll-contain；pill 定位 effect 去除「滚动容器滚顶」（卡区不在滚动区），保留「无条件还原 + ring 闪烁 1.2s 自清」。TurnTimeline 删除 pending 卡容器块、minimized state 块、胶囊块、focus effect 与 pendingRequests/onDialogResolved/focusDialogRequest 三个 props。

选此方案原因：用户原话明确「问答选择替换底部的用户输入框（遮挡），选择完成后底部输入框恢复显示，占比高度固定最大高度超出显示上下滚动条」——互斥替换即用户裁决；整套逻辑迁移（而非 page 层重写）保住最小化/胶囊/pill 还原既有交互零重写，改动集中在「搬家 + 接线」。

## 接口契约

动了哪些函数/端点/命令/文件格式？对外可见的签名或行为变化是什么（含「无」的说明）？

- 新导出：`PendingDialogDock`（frontend/src/components/daemon/pending-dialog-dock.tsx），props：`{ pendingRequests: SessionPermissionRequest[]; sessionStatus: string | undefined; onResolved: (requestId: string) => void; focusRequest?: { requestId: string; nonce: number } | null }`（focusRequest 缺省 null 零行为——dialog 挂载点不传）。
- 收窄：TurnTimeline 删除 props `pendingRequests`、`onDialogResolved`、`focusDialogRequest`（仅剩这两个消费方 session-panel-page/session-panel-dialog 同步删传参；其余 props 零变化）。
- 无后端/协议/数据结构变化；无 SSE/REST 变化；群聊面板（group-chat-panel）的 AskUserDialogCard 用法零变化。

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）

1. 乱序/迟到到达：输入或事件乱序时，本设计的假设还成立吗？

成立：pending 卡渲染位置固定于输入框位置（与到达顺序无关）；prune effect（pendingRequests 变化时清最小化集合残留）原样迁移；REST 恢复（dialogs 拉取）与 SSE 实时到达最终都收敛到同一 pendingRequests state，单一数据源驱动互斥条件。

2. 并发写：两个执行体同时操作同一数据/文件会发生什么？

纯前端展示态：minimizedIds 是 dock 内部 React state（与原 TurnTimeline 内部同语义），无共享写面；pendingRequests 由 page/dialog 各自的 state 管理，无跨实例写。

3. 切换/生命周期：会话、请求或变更中途切换/中断时状态是否安全？

安全：最小化集合与卡内已填内容是组件内存态，会话切换时 dock 随挂载点卸载而清空——与原 TurnTimeline 会话内存态语义一致（既有行为，非本次引入的丢失）；提交回答后 pendingRequests 过滤由既有 handleDialogResolved / permission_resolved 路径承担，dock 卸载即恢复输入框，无中间态卡死；SessionInputBar 重挂载只重置内部局部 UI 态（光标等），输入值/附件/mentions 受控 state 在父级不丢。

4. 作用域：跨工作区/跨仓/多实例时数据会不会串台？

不会：dock 是会话面板局部组件，page/dialog 两挂载点各自实例化、各绑定本会话的 pendingRequests；胶囊 fixed 定位渲染于本面板视口内（与原 TurnTimeline 渲染同源）；群聊面板独立渲染不受影响。

## 风险与死路

本方案最大的风险是什么？试过但放弃的方案及放弃理由？

最大风险：pending 期间输入框不可用——用户想「先不答、先输入别的内容」没有入口。缓解：卡头最小化按钮保留，最小化后右下角胶囊可还原；pill 定位还原保留；且 pending permission 语义上本就阻塞 agent 轮次（先答后问语义），输入框被替换与队列语义一致。此边界为用户显式裁决（「替换底部的用户输入框（遮挡）」）。

次风险：SessionInputBar 重挂载丢内部局部态（光标/展开的菜单）——受控值全在父级，丢的只是瞬时 UI 态，可接受。放弃的方案：a) absolute 定位把卡覆盖在输入栏上（输入框仍挂载）——「遮挡」会露出输入栏残边、且输入栏仍可聚焦与「答题优先」语义矛盾，弃；b) 全部最小化时恢复输入框（需最小化状态上抛或受控化）——状态同步面增大、交互分叉（输入框出现/消失多一层条件），且「pending 期间不该发新消息」语义下价值低，弃；c) 保留 TurnTimeline 内渲染不动、仅用 CSS 把卡定位到输入区——跨组件定位（卡在滚动容器内、目标在容器外）需 hack（fixed/portal），脆弱，弃。

## 文件变更清单

| 操作 | 路径 | 说明 |
| --- | --- | --- |
| 新增 | frontend/src/components/daemon/pending-dialog-dock.tsx | 问答卡 dock 组件：卡列（max-h-[45vh] 内滚）+ 最小化 state + 胶囊 + focusRequest 还原闪烁 effect（自 turn-timeline 迁移） |
| 修改 | frontend/src/components/daemon/turn-timeline.tsx | 删 pending 卡容器/minimized state/胶囊/focus effect 与 pendingRequests、onDialogResolved、focusDialogRequest 三 props 及相关 import |
| 修改 | frontend/src/components/daemon/session-panel/session-panel-page.tsx | 真会话输入区互斥渲染 dock（focusRequest 接线 focusDialogRequest state）；TurnTimeline 调用点删三传参 |
| 修改 | frontend/src/components/daemon/session-panel/session-panel-dialog.tsx | 真会话输入区互斥渲染 dock（不传 focusRequest）；TurnTimeline 调用点删两传参 |
| 新增 | frontend/src/components/daemon/__tests__/pending-dialog-dock.test.tsx | dock 测试（自 turn-timeline-dialog-minimize.test.tsx 迁移改写 + 新增 max-h/focus 用例） |
| 删除 | frontend/src/components/daemon/__tests__/turn-timeline-dialog-minimize.test.tsx | 用例已迁移至 pending-dialog-dock.test.tsx（文件随组件迁移删除） |
