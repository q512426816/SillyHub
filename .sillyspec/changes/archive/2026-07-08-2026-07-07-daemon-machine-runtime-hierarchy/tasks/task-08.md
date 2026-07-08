---
id: task-08
title: 新增 MachineCard 组件（覆盖 FR-4）
author: WhaleFall
created_at: 2026-07-07 16:30:00
priority: P0
depends_on: [task-05, task-07]
blocks: [task-09]
requirement_ids: [FR-4]
decision_ids: [D-002, D-003, D-006]
allowed_paths:
  - frontend/src/components/daemon/machine-card.tsx
provides:
  - contract: MachineCard
    fields: [machine, expanded, onToggleExpand, usageByRuntime, sessions, onEditAlias, onUpgrade, onRuntimeToggle, onRuntimeOpenSession, onRuntimeDelete, onRuntimeEditRoots, isPlatformAdmin]
expects_from:
  task-05:
    - contract: DaemonMachineRead
      needs: [id, hostname, display_alias, os, arch, status, last_heartbeat_at, version, build_id, owner, runtime_count, online_runtime_count, runtimes]
  task-07:
    - contract: RuntimeCard
      needs: [runtime, usage, onToggleEnabled, onOpenSession]
---

goal: > 新建 `frontend/src/components/daemon/machine-card.tsx`，导出手风琴机器卡组件 `MachineCard`，折叠头 + 展开体两级结构，视觉 1:1 对齐 `prototype-machine-runtime.html` 方案 A（D-006）。

implementation:
  - 新建 `machine-card.tsx`，导出 `MachineCard`（默认导出），props 见 provides（machine/expanded/onToggleExpand + 用量/会话注入 + runtime 级回调透传 + isPlatformAdmin）。
  - 折叠头（点击整头触发 onToggleExpand）：机器图标（Server icon，status→底色，online 绿 / offline 灰，复用 page.tsx getStatusMeta 的 iconBg 风格）+ 名称（display_alias ?? hostname）+ 别名小字（hostname，有别名时显示）+ 状态徽章（D-002：读 `machine.status`，复用 getStatusMeta，Badge 组件）。
  - 折叠头行 2（meta，slate-500 小字）：OS·arch（`machine.os · machine.arch`）· 心跳（formatRelativeTime(machine.last_heartbeat_at)）· daemon 版本 `machine.version` + `#{build_id.slice(0,7)}` + 负责人（machine.owner?.display_name）。
  - 折叠头右侧 actions（flex-shrink-0）：聚合费用胶囊（蓝，`sum( machine.runtimes[].usageByRuntime.get(r.id)?.summary.total_cost_usd )`，formatCost 风格）+ runtime 数胶囊（slate-100 底，`online_runtime_count` 绿色 + `/` + `runtime_count` + " runtime"）+ 别名按钮（btn-outline btn-tiny，调 onEditAlias）+ 升级 daemon 按钮（btn-outline btn-tiny，RefreshCw icon，offline 时 disabled，调 onUpgrade）+ chevron（lucide ChevronRight，expanded 时 rotate-90）。
  - 展开体（border-t bg-muted/30 px py）：机器 runtimes 非空 → `RuntimeCard`（import task-07，不内联实现）网格 `grid xl:grid-cols-2 gap-3`，逐 runtime 透传 usage=usageByRuntime.get(r.id)、sessionStats、isPlatformAdmin、onRuntime* 回调。
  - 0-runtime 机器（runtimes=[]）→ 空态（D-003）：slate 图标 + 「该机器暂无运行时」文案，复用 page.tsx EmptyState 视觉语言。

## 验收标准
  - 折叠/展开交互正常（点击头切 expanded，chevron 旋转 90°）；展开态由 page 持有记忆（本组件受控）。
  - 聚合费用胶囊值 = 该机器所有 runtime 在 usageByRuntime 中 total_cost_usd 之和；无用量数据时 $0.00。
  - runtime 数胶囊正确显示 `online_runtime_count / runtime_count`。
  - machine.status === "offline" 时升级按钮 disabled（title 提示「离线，无法升级」）。
  - 0-runtime 机器展开显示空态（D-003）。
  - 视觉 1:1 对齐原型方案 A 机器卡（D-006）：图标底色、胶囊配色（蓝费用/slate runtime 数）、chevron 方向、row1/row2 排版一致。
  - `cd frontend && pnpm exec tsc --noEmit` 通过（props 类型与 task-05/task-07 契约吻合，无 any）。

verify:
  - `cd frontend && pnpm exec tsc --noEmit`
  - `cd frontend && pnpm test`（task-10 补 machine-card.test.tsx；本任务先保证不破坏现有测试）

constraints:
  - 严格对齐 `prototype-machine-runtime.html` 方案 A 机器卡视觉（D-006），不自由发挥配色/布局。
  - 不内联 RuntimeCard 实现，必须 `import { RuntimeCard } from "./runtime-card"`（依赖 task-07）。
  - 不在组件内拉用量——`usageByRuntime` 由 page 注入（D-004，用量走 `/runtimes/usage` 前端按 runtime_id 求和）。
  - 不修改 page.tsx（集成在 task-09）；本任务仅产出 machine-card.tsx 单文件。
  - 跨平台：纯展示组件，无 OS 特定逻辑（CLAUDE.md 规则 12）。
