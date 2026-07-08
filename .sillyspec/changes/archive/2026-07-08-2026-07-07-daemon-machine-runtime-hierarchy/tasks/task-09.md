---
id: task-09
title: 重构 runtimes/page.tsx 为两级手风琴（覆盖 FR-4,7）
author: WhaleFall
created_at: 2026-07-07 16:30:00
priority: P0
depends_on: [task-06, task-07, task-08]
blocks: [task-10]
requirement_ids: [FR-4, FR-7]
decision_ids: [D-005, D-006, D-007]
allowed_paths:
  - frontend/src/app/(dashboard)/runtimes/page.tsx
provides: {}
expects_from:
  task-06:
    - contract: useDaemonMachines
      needs: [items, total, sessions, isLoading, refetch]
  task-07:
    - contract: RuntimeCard
      needs: [runtime, usage, onToggleEnabled]
  task-08:
    - contract: MachineCard
      needs: [machine, expanded, onToggleExpand, usageByRuntime]
---

goal: > 把 /runtimes 页改为 Machine→Runtime 两级手风琴——机器级 SummaryCard/分页/筛选/时间窗 + MachineCard 列表 + 展开态记忆 + ?session 恢复改编，完全替换平铺视图（D-005）。

implementation:
  - useDaemonMachines(listParams) 替代 useDaemonRuntimes；queryKey 改 daemonMachines.list。
  - SummaryCard 改机器级统计：按 machine.status 统计 机器总数 / 在线 / 维护中 / 禁用 / 离线，meta 显提供方数 + 最近心跳。
  - 筛选条：搜索 hostname/display_alias/provider + 状态 + 提供方 + 人员（admin）+ 时间窗切换 + 刷新，保留 updateFilter 改筛重置到第一页。
  - 机器级分页器 PAGE_SIZE=20（D-007），listParams 透传 limit/offset。
  - expandedMachineIds: Set<string> 记忆展开态，切页/刷新不丢。
  - 渲染 MachineCard 列表（透传 machine/sessions/usageByRuntime/usageWindow/latestVersion/runtime 级回调 isPlatformAdmin）。
  - 用量仍 getRuntimesUsage + usageByRuntime（reloadUsage 机制不变），机器头聚合费用 = sum(该 machine.runtimes 的 usage.summary.total_cost_usd)（D-004）。
  - stats 改按 machine 聚合（providers 从 runtimes.flatMap 收集，latestHeartbeat 取 instance.last_heartbeat_at）。
  - ?session 恢复：matched 从 machines.flatMap(m=>m.runtimes) 查找 → 命中则展开所属 machine（expandedMachineIds.add）→ 开 RuntimeSessionDialog；urlRestoreDoneRef 守卫语义不变。
  - 4 个 Modal 保留（RuntimeSessionDialog / 别名 / 可写目录 / 目录浏览器）+ RuntimeSessionDialog runtimes 改传 machines.flatMap(m=>m.runtimes)。
  - 别名 handler 改调 updateDaemonMachine(instance_id)：aliasEditing 类型改 DaemonMachineRead，patchItems 改 patch machines cache（嵌套 runtimes 保留）。
  - 升级 handler 改调 triggerMachineSelfUpdate(instance_id)，invalidateQueries daemonMachines.all。
  - runtime 级 handler（toggle/delete/allowed-roots/session/browse-native）复用既有端点，patchItems 改在 machines cache 内嵌套定位 runtime 更新。

## 验收标准
  - 机器级 SummaryCard 统计正确（总数/在线/维护中/禁用/离线）。
  - 机器级分页/筛选/时间窗切换正常工作。
  - 展开态切页/刷新保留（expandedMachineIds 记忆）。
  - ?session= 自动展开所属 machine + 开弹窗；ended/failed/不存在 降级清 param。
  - 别名 Modal 走 updateDaemonMachine；升级走 triggerMachineSelfUpdate。
  - 视觉 1:1 对齐 prototype-machine-runtime.html（D-006）。
  - 完全替换无平铺切换（D-005）。
  - cd frontend && pnpm exec tsc --noEmit 通过。

verify:
  - cd frontend && pnpm exec tsc --noEmit
  - cd frontend && pnpm test

constraints:
  - 保留 4 个 Modal + RuntimeSessionDialog 单例语义 + key 重 mount 逻辑。
  - runtime 级 handler（toggle/delete/allowed-roots/session/browse-native）复用既有 runtime 端点，契约不变。
  - 不破坏 ?session= 恢复语义（urlRestoreDoneRef 一次性守卫 + isActiveSession 判定）。
  - handler 改调机器级端点 only：别名 → updateDaemonMachine；升级 → triggerMachineSelfUpdate；其余维持 runtime 级。
  - 不内联用量到 /machines（D-004）；15s 轮询只刷列表不重拉用量。
