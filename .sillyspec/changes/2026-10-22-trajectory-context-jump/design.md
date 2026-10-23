---
author: flow-machine-draft
created_at: 2026-10-23T16:30:40.307Z
---
# 设计记录（Design Record）— 2026-10-22-trajectory-context-jump

## 做法概述

本变更怎么解决问题？改哪里、为什么选这个方案（一两段）。

三处小改，全部落在上次轨迹重做的组件面内：① `from-turn-views.ts` 在派生轮行时遍历 `turn.processItems`，把 `kind === "system_event"` 的项追加为 `kind=system` 行（`meta.contextEvent=true` 标记来源，锚点取项 ts、缺失用轮首——与段缺锚点同语义），补齐 dsh 对照中缺失的「上下文」类信息；② `trajectory-ledger.tsx` 给选中行加 `scrollIntoView({block:"nearest"})` effect（带 jsdom typeof 守卫），选中变化的四个入口（点行、点时间线条块、键盘 ↑↓、轮次跳转）统一获得滚入视野行为；③ `session-panel-page.tsx` 的 `handleJumpToTurn` 增加轨迹分支——`viewMode === "trajectory"` 时不再查 `data-turn-key` 轮块（轨迹分支无轮块），改发出受控跳转信号 `trajectoryJump={turnKey, nonce}`，经 `TurnTimeline` 透传给 `TrajectoryPane`，按 run key 匹配轮、选中该轮首个可见行（滚动由 ② 承担）。

## 接口契约

动了哪些函数/端点/命令/文件格式？对外可见的签名或行为变化是什么（含「无」的说明）？

- `trajectoryFromTurnViews`：签名不变；产物 rows 新增 system_event 派生行（kind=system + meta.contextEvent）。
- `TurnTimeline` 新增可选 prop `trajectoryJump?: { turnKey: string; nonce: number } | null`（不传零回归）；`TrajectoryView`/`TrajectoryTimeline` 对外 props 不变。
- `handleJumpToTurn`（session-panel-page 内部函数）：轨迹视图走信号分支，对话/进度视图原路径不动。
- 无后端 API / OpenAPI / DTO 变更。

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）

1. 乱序/迟到到达：输入或事件乱序时，本设计的假设还成立吗？

成立。system_event 行进轮后按 startedAt 排序（既有机制）；processItems 迟到追加时行 id 用 `${runId}:ctx:${text 哈希或序号}` 保持稳定，重复渲染幂等。

2. 并发写：两个执行体同时操作同一数据/文件会发生什么？

无并发写面：派生是纯函数，UI 状态单组件持有。

3. 切换/生命周期：会话、请求或变更中途切换/中断时状态是否安全？

安全。跳转信号带 nonce（每次点击自增），TrajectoryPane 用 effect 消费后不残留；会话切换时信号 state 随组件重挂载复位。

4. 作用域：跨工作区/跨仓/多实例时数据会不会串台？

不会。跳转信号是会话面板实例内 state，run key 匹配限定当前 turns。

## 风险与死路

本方案最大的风险是什么？试过但放弃的方案及放弃理由？

风险：`scrollIntoView` effect 在流式更新（新行追加）时可能把用户正在阅读的位置拉走——限定为「selectedRowId 变化时」触发（非滚动容器内容变化），与旧实现同口径。放弃的方案：让 TurnCatalog 直接操作轨迹 DOM（跨组件 querySelector）——耦合 DOM 结构且绕过选中状态机；放弃 imperative ref 暴露滚动方法——受控信号 + 选中 effect 已够用，少一条命令式通道。

## 文件变更清单

| 操作 | 路径 | 说明 |
| --- | --- | --- |
| 修改 | frontend/src/components/daemon/trajectory/from-turn-views.ts | processItems 的 system_event → kind=system 行（meta.contextEvent，ts/轮首锚点） |
| 修改 | frontend/src/components/daemon/trajectory/trajectory-view-model.ts | contextEvent 行标签「上下文」；搜索字段纳入其文本 |
| 修改 | frontend/src/components/daemon/trajectory/trajectory-ledger.tsx | 选中行 scrollIntoView effect（typeof 守卫） |
| 修改 | frontend/src/components/daemon/turn-timeline.tsx | TurnTimeline 新增 trajectoryJump prop 透传给 TrajectoryPane；Pane 内按 run key 选中轮首行 |
| 修改 | frontend/src/components/daemon/session-panel/session-panel-page.tsx | handleJumpToTurn 轨迹分支：发 trajectoryJump 信号 |
| 修改 | frontend/src/components/daemon/trajectory/__tests__/from-turn-views.test.ts | system_event 派生用例 |
| 修改 | frontend/src/components/daemon/trajectory/__tests__/trajectory-redesign.test.tsx | 跳转信号 + 滚入视野用例（stub scrollIntoView） |
| 修改 | frontend/src/components/daemon/__tests__/turn-timeline-trajectory-view.test.tsx | 透传与零回归用例 |
