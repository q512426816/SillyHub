---
id: task-07
title: 抽 RuntimeCard 组件（视觉不变，去 Daemon 版本行）（覆盖 FR-5）
author: WhaleFall
created_at: 2026-07-07 16:30:00
priority: P0
depends_on: []
blocks: [task-08, task-09]
requirement_ids: [FR-5]
decision_ids: [D-006]
allowed_paths:
  - frontend/src/components/daemon/runtime-card.tsx
  - frontend/src/components/daemon/runtime-card-helpers.ts
  - frontend/src/app/(dashboard)/runtimes/page.tsx
provides:
  - contract: RuntimeCard
    fields:
      - runtime: DaemonRuntimeRead
      - usage: RuntimeUsageItem | undefined
      - usageWindow: RuntimeUsageWindow
      - usageLoading: boolean | undefined
      - sessionStats: { total: number; active: number }
      - actioning: boolean
      - latestVersion: DaemonVersionInfo | undefined
      - upgrading: boolean | undefined
      - onToggleEnabled: (runtime) => Promise<void>
      - onOpenSession: (runtime) => void
      - onDelete: (runtime) => void
      - onEditAlias: (runtime) => void
      - onEditAllowedRoots: (runtime) => void
      - onUpgrade: (runtime) => void
      - isPlatformAdmin: boolean
expects_from: {}
---

## goal
> 从 `app/(dashboard)/runtimes/page.tsx` 抽出 `RuntimeCard`（L604-914）为独立组件 `components/daemon/runtime-card.tsx`，视觉零改动，仅去掉冗余的「Daemon 版本」meta 行（C-002，该信息上提机器头 task-08）。

## implementation
- 新建 `runtime-card.tsx` 导出 `RuntimeCard`（named export），Props 签名与现 page 内 RuntimeCard 完全一致（见 provides），不得改字段名/类型/可空性。
- 相关私有 helper 按「仅本组件用 → 随组件迁；跨组件共用 → 放 helpers」分流，迁入 `runtime-card-helpers.ts`：`getStatusMeta`/`StatusMeta`/`PROVIDER_TONES`/`getCapabilityChips`/`getProtocol`/`getDisplayVersion`/`formatRelativeTime`/`formatTokens`/`formatCost`/`formatCache`/`ProviderBadge`/`AgentsList`/`VersionCell`/`RuntimeMeta`/`UsageStat`（`DaemonVersionBadge` 单独保留导出，task-08 机器头复用）。
- 外部依赖保持从原来源 import 不变：`shortId`@`@/lib/utils`、`RuntimeUsageLineChart`@`@/components/charts`、`WINDOW_LABELS`、lucide 图标（`Cpu/Terminal/Power/Ban/RefreshCw/MessageSquare/Trash2`）、`cn`、`Badge/Button/Link`。
- meta 网格删除「Daemon 版本」`RuntimeMeta`（page L720-735），其余 meta（运行环境/心跳/版本/协议/可执行路径/会话）逐行保留 1:1。
- 保留用量统计区（4 数字 `UsageStat` + `RuntimeUsageLineChart` sparkline）+ 运行能力 `AgentsList` + 可写目录 allowed_roots + 操作按钮组（别名/可写目录/升级/审计日志/会话/启禁/移除）全部不变。
- `page.tsx` 删除内联 `RuntimeCard` 定义与已迁走的 helper，改为 `import { RuntimeCard } from "@/components/daemon/runtime-card"`；`DaemonVersionBadge` 仍从组件文件 re-export 供 page（task-09 别处）或机器头复用。

## 验收标准
- `RuntimeCard` 可独立 `import` 并渲染，无对 `page.tsx` 内部符号的隐式依赖（除按 props 显式传入）。
- runtime 卡视觉与现状完全一致，唯一差异为 meta 网格少了「Daemon 版本」一行（对齐 `prototype-machine-runtime.html` rt-meta 仅 版本/会话/协议）。
- `daemon_version`/`daemon_build_id` 字段在 `DaemonRuntimeRead` 上保留（向后兼容，其它消费方仍可读），仅本组件不渲染。
- `cd frontend && pnpm exec tsc --noEmit` 通过；`cd frontend && pnpm test` 通过（现有 page.test.tsx 渲染断言不破，若断言到 Daemon 版本文本则同步修正为对 runtime meta 既有项断言，非测试逻辑误改）。
- `page.tsx` 不再含 `function RuntimeCard(...)` 定义。

## verify
- `cd frontend && pnpm exec tsc --noEmit`
- `cd frontend && pnpm test`

## constraints
- 不改变现有 RuntimeCard 的任何 className / 布局 / 色调 / 文案（D-006 视觉对齐原型为验收基准）。
- 仅删除「Daemon 版本」meta 行，不得顺手删/改其它 meta 或操作按钮（C-002 严格限定）。
- `DaemonVersionBadge` 组件本身不删不重写（机器头 task-08 复用渲染 daemon 版本短码+徽标）。
- 组件兼容 Windows / Linux / macOS（无 OS 特定逻辑，CLAUDE.md 规则 12）。
- 不在本 task 内新增机器头聚合费用/runtime 数胶囊（属 task-08）；不重构 page 的两级手风琴（属 task-09）。
