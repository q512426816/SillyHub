---
author: flow-machine-draft
created_at: 2026-10-22T01:23:58.655Z
---
# 设计记录（Design Record）— 2026-10-22-session-trajectory-third-view

## 做法概述

本变更怎么解决问题？改哪里、为什么选这个方案（一两段）。

把视图模式从两态扩展为三态：`SessionViewMode = "conversation" | "all" | "trajectory"`。`TurnTimeline` 删除内部的 `progressLens` 状态与「时间线 / 轨迹」第二层开关，改为 `viewMode === "trajectory"` 时直接渲染轨迹面板；`TrajectoryPane` 新增受控 `selectedRowId` 状态并传给 `TrajectoryView`，修复点击无反应（与 dev 预览页 `trajectory-proto-view.tsx` 同一接法）。

视图切换控件目前由弹窗版与整页版各写一份相同 JSX（`aria-label="消息显示范围"`），本次抽成共享组件 `SessionViewTabs`，两处复用，从结构上保证三宿主一致；「进度」视图不再有任何轨迹入口。持久化函数扩展第三个合法值，旧值语义不变。

## 接口契约

动了哪些函数/端点/命令/文件格式？对外可见的签名或行为变化是什么（含「无」的说明）？

- `SessionViewMode`：`"conversation" | "all"` → `"conversation" | "all" | "trajectory"`（类型扩展，旧消费方传两值仍合法）。
- `SessionPanel` 受控 props：`viewMode?: SessionViewMode`、`onViewModeChange?: (mode: SessionViewMode) => void`（类型放宽为三态）。
- `readPersistedViewMode(sessionId): SessionViewMode`、`writePersistedViewMode(sessionId, SessionViewMode)`：支持 `"trajectory"`，localStorage key 不变。
- 新增 `SessionViewTabs`（props：`value: SessionViewMode`、`onChange(mode)`、可选 `className`），纯展示组件，无网络/存储副作用。
- `TrajectoryView` / `TrajectoryTimeline` / `trajectoryFromTurnViews` / `TrajectoryPane` 签名均不变；无后端 API、OpenAPI schema 改动。

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）

1. 乱序/迟到到达：输入或事件乱序时，本设计的假设还成立吗？

成立。轨迹数据仍由当前已加载轮视图派生，选中只持 `rowId`；轮视图更新后若该 id 消失，`rows.find` 返回 `null`，检查器回落空提示，不崩溃、不指错行。视图模式是同步 UI 状态，不参与事件排序。

2. 并发写：两个执行体同时操作同一数据/文件会发生什么？

无服务端写面。localStorage 每个会话一个 key，同一标签页内切换写覆盖为「后写生效」；多标签页并发切换互不阻塞，刷新以最后写入值为准，属可接受语义。

3. 切换/生命周期：会话、请求或变更中途切换/中断时状态是否安全？

安全。`TrajectoryPane` 在离开轨迹视图时卸载，选中态随之丢弃；会话切换时页面按 `sessionId` 重置视图状态并回读持久化值。视图切换不触发任何请求或流重建，SSE 事件照常落到轮视图，切回即可见。

4. 作用域：跨工作区/跨仓/多实例时数据会不会串台？

不会。视图模式按 `sillyhub.sessions.viewMode.<sessionId>` 隔离；轨迹数据来自当前面板的轮视图，不读 staging、不跨会话共享。

## 风险与死路

本方案最大的风险是什么？试过但放弃的方案及放弃理由？

主要风险是类型扩展后 `viewMode` 的隐式两态假设：`turn-timeline.tsx` 内多处 `viewMode === "all"` / `!== "all"` 分支需逐个确认——轨迹视图不渲染轮块，这些分支在轨迹下不可达，但需保持语义正确（`conversation` 专属逻辑不能被轨迹误命中）。靠 `tsc` + 三态渲染测试兜底，逐个分支改为显式比较。

另一风险是布局：轨迹面板含 7 列账本 + 320px 检查器，在右侧会话面板（较窄）下可能拥挤。这是既有轨迹面板的固有形态，本变更只改变入口层级、不新增布局问题；若小屏横向溢出，账本容器已有 `overflow-y-auto`，检查器在 `md` 以下隐藏，风险可控。

放弃的方案：①保留进度内的第二层开关、只在顶部再加一枚「轨迹」入口——会造成两处入口同一面板、状态重复；②让 `TrajectoryView` 内部自持选中状态——dev 预览页是受控用法，产品页自持会形成两套实现；③把轨迹做成独立路由页面——离开会话上下文后取数、SSE、返回态都需重建，成本远高于同面板切视图。

## 文件变更清单

| 操作 | 路径 | 说明 |
| --- | --- | --- |
| 修改 | frontend/src/components/daemon/turn-timeline.tsx | `SessionViewMode` 三态；删除 `progressLens` 与 `progress-lens` 开关；轨迹视图直接渲染；`TrajectoryPane` 接入受控选中 |
| 新增 | frontend/src/components/daemon/session-panel/session-view-tabs.tsx | 三态视图切换共享组件（对话 / 进度 / 轨迹） |
| 修改 | frontend/src/components/daemon/session-panel/session-panel-dialog.tsx | 改用共享组件，`viewMode` 类型三态 |
| 修改 | frontend/src/components/daemon/session-panel/session-panel-page.tsx | 改用共享组件，`viewMode` 类型三态，持久化读写三态 |
| 修改 | frontend/src/components/daemon/session-panel/turn-state.ts | `readPersistedViewMode` / `writePersistedViewMode` 支持 `"trajectory"` |
| 修改 | frontend/src/components/daemon/session-panel/index.tsx | `viewMode` / `onViewModeChange` 受控 props 类型扩展 |
| 修改 | frontend/src/components/daemon/__tests__/turn-timeline-trajectory-view.test.tsx | 按三态改写入口用例；新增轨迹选中交互与空态用例 |
| 新增 | frontend/src/components/daemon/session-panel/__tests__/session-view-tabs.test.tsx | 三态共享组件用例 |
| 新增 | frontend/src/components/daemon/session-panel/__tests__/view-mode-persist.test.ts | 持久化三态与旧值兼容用例 |
| 修改 | frontend/src/components/daemon/__tests__/session-panel-variant.test.tsx | 新增移动 variant 三态 tablist 用例（不改既有断言） |
