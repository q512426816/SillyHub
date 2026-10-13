---
author: flow-machine-draft
created_at: 2026-10-13T03:00:28.585Z
---
# 设计记录（Design Record）— 2026-10-13-subagent-stub-reconcile

## 做法概述

本变更怎么解决问题？改哪里、为什么选这个方案（一两段）。

根因（浏览器实测 + 真实数据复现实证）：历史日志分页窗口（400 行）截断使子代理派发 tool_call 行落在窗口外 → 装配器为子代理消息创建 stub 兜底段（名字回落 subagentType=「general-purpose」）→ stub 无任务元数据槽 → 头部 status 恒 running、durationText 恒「运行中」（turn-segment-views.tsx:795 的占位）。前两个变更（冒名行收口、task_id 兜底路由）修的是数据与路由环节，本变更修渲染环节：**以服务端任务快照为权威，在渲染层按 tool_use_id 对账**。选渲染层对账而非装配层补元数据，是因为快照（GET /sessions/{id}/tasks，AgentSessionTaskRead 已含 tool_use_id，后端零改动、零 gen:types）天然覆盖所有窗口截断形态，且 stub 无元数据槽的装配器契约不需要动。

改动面（纯前端三处 + 接线）：① `use-session-tasks.ts` 视图行补 `toolUseId`（快照映射 + 事件合并透传）+ 导出 `buildSubagentTaskLookup` 纯函数与 `SubagentTaskSnapshotInfo` 类型；② `turn-segment-views.tsx` `subagentHeaderOf` 增第三参 `reconciled`（可选，{taskName,status,elapsedMs}），stub 与「无元数据且 running」的 tool 段命中时按快照展示名称/徽标/时长，并导出 `SubagentTaskLookupContext`；③ `subagent-detail-panel.tsx` 右栏面板同源接入；④ `session-panel-page.tsx` 页面级建一份 `useSessionTasks` 实例（复用既有 refreshSignal），useMemo 构建 Map 后以 **Context Provider** 下发（同时覆盖时间线与右栏面板/抽屉三处槽位）。

实现偏离说明（相对初稿）：容器头对账的下发用 **Context** 而非 TurnTimelineProps 逐层透传——SegmentView 递归链（TurnRow→SegmentView→SubagentBlockView）层级深且 memo 化，prop 钻取要动 4 层组件签名；Context 值经 useMemo 稳定引用，memo 收益不受损，且 DetailPanel/Drawer（portal 的 React 树仍继承 context）天然覆盖。TurnTimelineProps 零改动。

## 接口契约

动了哪些函数/端点/命令/文件格式？对外可见的签名或行为变化是什么（含「无」的说明）？

- `subagentHeaderOf(segment, now, reconciled?)`：第三参可选 `SubagentReconciledTask`（turn-segment-views.tsx 导出：{taskName,status,elapsedMs}）；不传行为完全不变（既有调用零改动）。返回类型不变。
- 新增导出 `SubagentTaskLookupContext`（turn-segment-views.tsx，React Context，值 `Map<string, SubagentReconciledTask> | null`）。
- `AgentSessionTaskView`（use-session-tasks.ts 导出）新增可选 `toolUseId?: string | null`；新增导出 `SubagentTaskSnapshotInfo` 与纯函数 `buildSubagentTaskLookup(rows)`（与 `SubagentReconciledTask` 结构兼容，session-panel-page 构建的 Map 直接作 context value）。
- 新增导出纯函数 `buildSubagentTaskLookup(rows: AgentSessionTaskView[]): Map<string, SubagentTaskSnapshotInfo>`（落位 use-session-tasks.ts，turn-segment-views 定义 SubagentTaskSnapshotInfo 类型并导出，避免跨组件循环依赖——helper 消费该类型用结构化类型）。
- 无 HTTP API / DB / OpenAPI 变化；`pnpm gen:types` 不需要跑（AgentSessionTaskRead.tool_use_id 前端类型已存在）。

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）

1. 乱序/迟到到达：输入或事件乱序时，本设计的假设还成立吗？

对账数据源是快照拉取（updated_at desc，终态优先 pick 在构建时一次性裁决），无流式乱序问题。SSE 实时路径不喂对账 Map——实时中的子代理其派发行必在窗口内（当轮日志），由既有 NOTIFICATION 行 parent 路由收敛（2026-10-13-agent-task-stuck-running FR-02 已修）；对账只兜「派发行出窗」的历史形态，两路正交。

2. 并发写：两个执行体同时操作同一数据/文件会发生什么？

Map 在 useMemo 内构建（渲染期纯计算，只读快照数组）；快照更新走 React setState 整体替换，无原地写。页面级 useSessionTasks 实例与 TaskExecutionPanel 内部实例各自独立 fetch，互不共享可变态，最坏情况是同刻两个相同 GET（幂等读）。

3. 切换/生命周期：会话、请求或变更中途切换/中断时状态是否安全？

页面级实例复用 useSessionTasks 既有防串台守卫（session_id 过滤 + epoch 丢弃迟到响应 + 换会话清空），切会话时 Map 随 tasks 重算（useMemo 依赖 tasks），旧会话的行不会泄漏到新会话的容器头。refreshSignal（SSE 重连）驱动重拉，与 TaskExecutionPanel 同信号同频。

4. 作用域：跨工作区/跨仓/多实例时数据会不会串台？

对账键是 tool_use_id（SDK call id 全局唯一）且 Map 只由当前 sessionId 的快照行构建；API 归属闸门（404 on cross-user/soft-delete）不变。stub 段 id 与快照 tool_use_id 的匹配限定在同会话渲染树内，无跨会话/跨工作区通路。

## 风险与死路

本方案最大的风险是什么？试过但放弃的方案及放弃理由？

最大风险：对账把「真在跑」的 stub 误标终态——数据源是服务端权威行（清扫只会标 stopped 不会标 completed），误标面收敛为「快照行本身错误」，与任务清单页签同源同信，可接受。次风险：TurnRow memo 对新 prop 的比较——Map 以 useMemo 稳定引用，仅快照变化时重建，不破坏流式期间的 memo 收益。

试过但放弃的方案：① 装配器给 stub 补元数据槽并路由 [TASK_*] 行——窗口外行根本不在装配输入里，治不了根因，且动 stub 类型契约波及面大；② 时间线按 run 全量补拉日志（窗口截断的根治）——改分页架构，性能取舍（ql-20260916-013 有意为之）推翻成本高，收益仅此一处展示，不做；③ stub 徽章改中性文案「已结束(见任务清单)」——不解决名字问题且是降级不是修复；④ 后端给快照行补「是否关联时间线」之类新端点——现有 tool_use_id 关联键已够，零后端改动是本方案的显式优点。

## 文件变更清单

| 操作 | 路径 | 说明 |
| --- | --- | --- |
| 修改 | frontend/src/hooks/use-session-tasks.ts | 视图行补 toolUseId + buildSubagentTaskLookup 纯函数 + SubagentTaskSnapshotInfo 类型 |
| 修改 | frontend/src/components/daemon/turn-segment-views.tsx | subagentHeaderOf 第三参对账 + SubagentReconciledTask/SubagentTaskLookupContext 导出 + 头部渲染消费 |
| 修改 | frontend/src/components/daemon/subagent-detail-panel.tsx | 右栏详情面板同源接入对账 |
| 修改 | frontend/src/components/daemon/session-panel/session-panel-page.tsx | 页面级 useSessionTasks 实例 + useMemo 构建 Map + Context Provider 三处包裹 |
| 新增 | frontend/src/components/daemon/__tests__/subagent-task-reconcile.test.ts | 对账索引/stub 收敛/名称/优先级回归 |
