---
author: flow-machine-draft
created_at: 2026-10-13T03:30:35.880Z
---
# 设计记录（Design Record）— 2026-10-13-turn-live-visibility

## 做法概述

本变更怎么解决问题？改哪里、为什么选这个方案（一两段）。

三个独立小面共治「运行中看不到真实状态」：①等待可见性——TaskOutput 阻塞等待后台任务时（本次故障静默十分钟的直接形态），时间线工具行由「raw JSON 兜底显示」升级为人话等待行：任务名经任务快照（agent_session_task，SSE agent_task_status + /sessions/{id}/tasks 快照合一的 use-session-tasks 数据源）按 args.task_id 对账，行尾已等时长每秒跳动（组件局部 tick，复用 SubagentBlockView FR-06 局部走秒先例——纯组件不读全局时钟、仅该形态 running 时启动）。②终态收敛——[TASK_*] 终态 stdout 行丢失时唯一权威是服务端任务表，本变更把快照终态对账进渲染层（既有 SubagentTaskLookupContext 值从单 Map<tool_use_id> 扩为双索引 {byToolUseId, byTaskId}），收敛规则单向（仅段元数据 running→快照终态提权，终态即终不回退），同时覆盖子代理块头徽标（subagentHeaderOf）与轮状态栏运行中计数（deriveTurnActivity/collectSubagents 增可选 lookup 参数）；任务面板卡片在轮完成对账点（schedulePostTurnReconcile）顺带递增任务快照 refreshSignal 重拉。③token 数字刷新——根因在 daemon 估算推送 20-token 门限与「真 usage 到达后估算整段拦截」双重点：改双门限（≥20 token 或距上次 ≥500ms，零增量不推）+ 真 usage 后 call 进行中估算继续（message_delta 覆盖语义不动，emit 基线同步）。

选渲染层对账而非段数据层（reducer 写回 segment.taskStatus）：不动 turn-state 归并面与装配器状态机，与进行中 change 2026-10-13-subagent-stub-reconcile 的 lookup 模式同构叠加；选 daemon 双门限而非前端假插值：不伪造数字，低速兜底时时间门限给出上界 ~2 条/s/call（与既有 THINKING_FLUSH 500ms 级先例同量级）；高速生成仍由 20-token 门限主导，推送频率与改前持平。

## 接口契约

动了哪些函数/端点/命令/文件格式？对外可见的签名或行为变化是什么（含「无」的说明）？

- turn-segment-views.tsx：`SubagentTaskLookupContext` 值类型 `Map<string, SubagentReconciledTask> | null` → `SubagentTaskLookup | null`（新接口 `{ byToolUseId: Map<string, SubagentReconciledTask>; byTaskId: Map<string, SubagentReconciledTask> }`；`SubagentReconciledTask` 字段不变）；新导出 `parseTaskOutputWait(raw)`（tool 段 raw JSON 解析出 {taskId}，解析失败 null）；subagentHeaderOf 内联 terminalReconciled 单向收敛判定（running 元数据 + 快照终态 → 快照终态，不受段三态配对限制；终态元数据不回退；时长/徽标随收敛态取快照权威值），SubagentBlockView / subagent-detail-panel 的对账传递条件同步放开；ToolRowView 对 toolName="TaskOutput" 且 running 的段特判渲染（人话摘要 + 局部走秒），终态回归原渲染。
- use-session-tasks.ts：`buildSubagentTaskLookup(rows)` 返回值改双索引形态（byToolUseId 既有择优逻辑不变，byTaskId 同款择优按 taskId 建；新导出 `SubagentTaskLookupIndex` 接口）。
- turn-status-bar.tsx：`deriveTurnActivity(segments, lookup?)` / `collectSubagents(segments, out, lookup?)` 增可选参数（缺省行为与改前一致），metaDriven 分支内联同款单向收敛（tool_use_id 直查 + taskTaskId 兜底，终态收敛时 taskElapsedMs 取快照权威值）；TurnStatusBar 组件读 SubagentTaskLookupContext 传入。
- session-panel-page.tsx：轮终态（usageRefresh）与 SSE 重连恢复（tasksRefresh，state 上移）两对账信号合流为 taskReconcileSignal，同时供给时间线 lookup 实例（subagentReconcileSource.refreshSignal）与任务面板（TaskExecutionPanel tasksRefreshSignal，两处挂点）。
- sillyhub-daemon/src/adapters/stream-json.ts：类字段新增 `_lastUsageEmitAt: number`（实例化/resetAccumulator/message_start/commit 重置为 Date.now()）；text_delta 估算门限改双门限（≥20 token 或距上次 emit ≥500ms 且有增量）并删除「真 usage 后整段拦截」`_currentTurnHasRealUsage` 字段（估算只做增量累加不覆盖真值，跨 call 本就由 message_start 重置恢复）；message_start 立即 emit 与 message_delta emit 处同步 `_lastEmittedOutputTokens`/`_lastUsageEmitAt` 基线；message_delta 的 grew 四维改 changed（任一维变化含真值回落都推送校正）。usage_update 事件格式不变，仅频率提高。
- 无后端 API/DB/协议改动；无前端路由与样式系统改动（样式用既有 brand 阶语义类）。

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）

1. 乱序/迟到到达：快照行可能在 TaskOutput 段建成前到达（首渲染 byTaskId 未命中→回退通用文案，快照重拉后重渲染出任务名，渐进增强安全）；agent_task_status 事件与 [TASK_*] stdout 行双通道到达顺序不定——收敛判定只读快照当前值且单向（running→终态），迟到重放不产生回退；段 taskStatus 已是终态时快照任何状态不覆盖（终态即终，与既有 NOTIFICATION 覆盖语义同向）。TaskOutput 段 result 配对终态由装配器既有状态机处理，本变更不触碰。
2. 并发写：纯前端展示层——快照经 useSessionTasks setState 单线程合并，context 值 useMemo 派生；daemon 侧单适配器实例顺序消费事件流，无跨实例写面；refreshSignal 递增是幂等信号（重拉合并以服务端为准）。
3. 切换/生命周期：走秒 tick 仅组件 mounted 且等待形态 running 时启动（SubagentBlockView 同款卸载清理）；轮切换/会话切换时 useSessionTasks 按 sessionId 重建（既有链路），旧快照不泄漏到新会话；refreshSignal 重拉失败静默——既有 404/409 竞态口径 + 重连兜底链路不变。
4. 作用域：lookup 数据源按 sessionId 隔离（useSessionTasks 入参），跨会话/跨工作区不串台；daemon `_lastUsageEmitAt` 为进程内 per-adapter 实例状态，无持久化无跨实例面；双门限只提频不改变 payload 语义，旧前端收到更高频 usage_update 兼容（累加归并幂等）。

## 风险与死路

本方案最大的风险是什么？试过但放弃的方案及放弃理由？

最大风险是共享文件混提交：turn-segment-views.tsx / session-panel-page.tsx 工作区带有进行中变更（2026-10-13-subagent-stub-reconcile、2026-10-13-session-taskwakeup-hide）的未提交 hunk，本变更提交必须选择性暂存（git add -p 仅取本变更 hunk），禁止整文件 add 裹挟。次要风险：①「running→终态对账提权」与 stub-reconcile 的「元数据>对账>段三态」优先级契约交叉——本变更只放宽 running 态方向（终态快照可收敛 running 元数据），契约在 subagentHeaderOf/reconcileTaskStatusForDisplay 注释双向写明；若其收口验证发现冲突，以并集语义（终态优先）收口。②daemon 提频的后端容量——最坏 2 条/s/call 的 usage_update 走既有落库+publish 批量管线，THINKING_FLUSH（字符/时间双节流）已是同量级先例；若后端观测到压力，时间门限 500ms→1000ms 单点可调。③dialog 旧宿主无 Provider——lookup null 路径全部回退既有推导（测试守卫）。

试过但放弃的方案：①前端按 tok/s 假插值补齐刷新（无真实增量的伪造数字，放弃）；②等待提示并入 TurnStatusBar 全局横幅（丢失时间线位置语义、与工具行信息重复，放弃）；③daemon 补发 [TASK_*] 终态行协议修复残留（动 daemon 协议面且 stub-reconcile 的快照对账已在同方向覆盖，放弃）；④段数据层收敛（turn-state reducer 把快照终态写回 segment.taskStatus）——侵入归并状态机、与装配器 [TASK_*] 路由双写打架，渲染层对账已覆盖全部消费面，放弃。

## 文件变更清单

| 操作 | 路径 | 说明 |
| --- | --- | --- |
| M | frontend/src/components/daemon/turn-segment-views.tsx | context 值双索引化 + parseTaskOutputWait 导出 + ToolRowView 等待行特判 + subagentHeaderOf/terminalReconciled 收敛 + SubagentBlockView 消费适配 |
| M | frontend/src/components/daemon/turn-status-bar.tsx | deriveTurnActivity/collectSubagents 可选 lookup 参数 + TurnStatusBar 接 context + metaDriven 收敛 |
| M | frontend/src/components/daemon/subagent-detail-panel.tsx | 对账传递条件放开（FR-02 同款 terminal 收敛面） |
| M | frontend/src/hooks/use-session-tasks.ts | buildSubagentTaskLookup 返回双索引（byToolUseId 择优不变 + byTaskId 同款）+ SubagentTaskLookupIndex 导出 |
| M | frontend/src/components/daemon/session-panel/session-panel-page.tsx | 轮终态/重连恢复两对账信号合流 taskReconcileSignal，时间线 lookup 与任务面板两挂点同供 |
| M | frontend/src/components/daemon/__tests__/turn-segment-views.test.tsx | 新增等待行四场景 + parseTaskOutputWait 两场景 + deriveTurnActivity 收敛四场景用例（既有用例回归守卫） |
| M | frontend/src/components/daemon/__tests__/subagent-task-reconcile.test.ts | 双索引形态适配 + 「元数据优先不覆盖」用例按 FR-02 规格改写为单向收敛（含终态不回退保留面） |
| M | sillyhub-daemon/src/adapters/stream-json.ts | usage_update 双门限 + 真 usage 后估算续推 + emit 基线同步 + changed 覆盖校正 |
| M | sillyhub-daemon/tests/stream-json.test.ts | 旧「真 usage 后忽略 delta」用例按 FR-04 规格改写 + 新增时间门限兜底/零增量用例 |
