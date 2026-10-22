---
author: flow-machine-draft
created_at: 2026-10-22T01:21:47.536Z
---
# 设计记录（Design Record）— 2026-10-22-fix-trajectory-row-select

## 做法概述

本变更怎么解决问题？改哪里、为什么选这个方案（一两段）。

在 `turn-timeline.tsx` 的 `TrajectoryPane` 内部增加一个受控 `selectedRowId`（`useState<string | null>(null)`），把它和 `setSelectedRowId` 作为 `selectedRowId` / `onSelectRow` 传给 `TrajectoryView`。这正是 dev 预览页 `trajectory-proto-view.tsx:40,104-107` 的既有做法，产品页接入时漏了这一步。

不改 `TrajectoryView` / `TrajectoryTimeline` 本身——它们的选中、检查器、键盘处理和条点击逻辑都已完整并有单测覆盖；本次只补「谁来持有状态」的接线。状态放在 `TrajectoryPane` 而不是提升到 `TurnTimeline`：切回「时间线」时面板卸载、选中自然丢弃，符合「呈现方式切换即重置」的直觉，也不给父组件增加无关状态。

## 接口契约

动了哪些函数/端点/命令/文件格式？对外可见的签名或行为变化是什么（含「无」的说明）？

无对外接口变化：不新增/修改 API、不改 `TrajectoryView` / `TrajectoryTimeline` / `trajectoryFromTurnViews` 的签名。行为变化仅是会话页轨迹面板接入受控选中（点击、键盘、条点击恢复生效），与 dev 预览页一致。`TrajectoryPane` 保持组件私有（未导出），无签名契约影响。

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）

1. 乱序/迟到到达：输入或事件乱序时，本设计的假设还成立吗？

成立。选中只持有 `rowId` 字符串；会话轮视图更新导致轨迹重算后，若选中的 `rowId` 已不存在，`TrajectoryView` 的 `rows.find` 返回 `null`，检查器回落空提示、无行高亮，不崩溃也不指向错误行。不做主动清理（多一次渲染且无用户可见收益），下一次点击即覆盖旧 id。

2. 并发写：两个执行体同时操作同一数据/文件会发生什么？

无并发写面：选中态是单个客户端组件实例内的 React state，不落盘、不发请求、不写后端。

3. 切换/生命周期：会话、请求或变更中途切换/中断时状态是否安全？

安全。切回「时间线」或离开「进度」视图时 `TrajectoryPane` 卸载，选中态随组件销毁丢弃；再切回「轨迹」默认无选中。会话切换由会话面板重挂载处理，不同会话不共享选中。

4. 作用域：跨工作区/跨仓/多实例时数据会不会串台？

不会。状态闭包在单个 `TurnTimeline` 实例内，`rows` 由当前会话已加载的轮视图派生；不读 staging、不跨请求共享。

## 风险与死路

本方案最大的风险是什么？试过但放弃的方案及放弃理由？

风险很低：改动一处在渲染接线，行为对齐已有 dev 页。唯一可感知的代价是选中时 `TrajectoryView` 重算 `selectedRow` 与检查器（账本行已用 `content-visibility: auto`，与 dev 页同一实现、实测可接受）。放弃的方案：把选中状态提升到 `TurnTimeline` 顶层——需要在「时间线 / 轨迹」切换时手动重置，反而多一处状态与遗漏；放弃改 `TrajectoryView` 加内部默认 state——会让 dev 页的受控用法与产品页分叉，偏离既有单一实现。

## 文件变更清单

| 操作 | 路径 | 说明 |
| --- | --- | --- |
| 修改 | frontend/src/components/daemon/turn-timeline.tsx | `TrajectoryPane` 增加受控 `selectedRowId` 状态并传给 `TrajectoryView` |
| 修改 | frontend/src/components/daemon/__tests__/turn-timeline-trajectory-view.test.tsx | 新增账本行点击、时间轴条目点击、键盘切换 3 个用例 |
