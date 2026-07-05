---
id: task-01
title: 新建 workspace-config-card.tsx 骨架 + Props 类型签名 + 6 状态分支框架
author: qinyi
created_at: 2026-07-05 01:18:51
priority: P0
depends_on: []
blocks: [task-02, task-03, task-04, task-05, task-06, task-07, task-08]
requirement_ids: [FR-005, FR-006]
decision_ids: [D-005@V1]
allowed_paths: [frontend/src/components/workspace-config-card.tsx]
---

## Goal

> 新建 `frontend/src/components/workspace-config-card.tsx` 单组件骨架，定义 6 个 props 的类型签名并搭建 §5.3 六状态分支渲染框架，为后续 task（接入组/共享组/编辑/按钮 handlers）提供可挂载容器（D-005@V1 / FR-005 / FR-006）。

## Implementation

- 定义 `WorkspaceConfigCardProps` interface（字段按 design §7.1）：`workspace: Workspace`、`specWs: SpecWorkspace | null`、`myBinding: MemberBindingView | null`、`boundDaemon: DaemonInstanceRead | null`、`isOwner: boolean`、`onRefresh: () => void`；类型分别从 `@/lib/api-types`、`@/lib/spec-workspaces`、`@/lib/workspace-binding`、`@/lib/daemon` 导入。
- 从 `@/lib/workspace`（或现有详情页同款路径）导入 `Workspace` 类型；保持与详情页 import 路径一致，避免新增重复类型定义。
- 搭建组件主体：`export function WorkspaceConfigCard(props: WorkspaceConfigCardProps)`，内部派生 `runtimeRoot`（`specWs?.spec_root ? specWs.spec_root + "/runtime" : null`）和 `cacheRoot`（`` `~/.sillyhub/daemon/specs/${workspace.id}` ``），后续 task 复用。
- 按 §5.3 实现六状态分支骨架（仅占位渲染，具体字段渲染留给 task-02/03/04/05）：
  - `loading`（`!workspace && !specWs && !myBinding`）→ 两组骨架占位
  - `error`（暂以 `error` 变量 / props 未到异常为占位条件）→ 错误提示 + 重试按钮占位
  - 未绑定（`myBinding == null`）→ 「我的接入」组占位渲染 WorkspaceAccessGuide 首次模式入口；「工作区文档存储」组占位
  - server-local（`myBinding?.path_source === "server-local"`）→ 占位隐藏 daemon/cache 字段提示
  - 已绑定·未初始化（`myBinding && myBinding.init_synced_at == null`）→ amber 徽标占位
  - 已绑定·已初始化（`myBinding?.init_synced_at`）→ emerald 徽标占位
- 复用现有 `SectionCard` 外壳组件（与详情页一致），卡片标题「我的工作区配置」，`head-actions` 槽位预留（task-06 填操作按钮）；本任务不渲染具体字段，仅以注释/占位 `<div>` 标注后续填充位置。

## Acceptance

- 文件 `frontend/src/components/workspace-config-card.tsx` 存在，默认导出 `WorkspaceConfigCard` 函数组件，props 类型签名与 design §7.1 六字段完全一致（含可空标注 `| null`）。
- 组件接受上述 6 props 且对每个 prop 均有引用（哪怕仅占位），TS 严格模式无未使用参数告警（必要时以 `_` 前缀或 void 兼容）。
- 六状态分支按 §5.3 表判定条件互斥渲染（同一时刻只走一个分支路径骨架），且 server-local 优先于「已绑定」分支判定。
- 仅新增此单文件，不改 page.tsx / backend / daemon / 任何 API client；不引入新依赖。
- 中文 UI（卡片标题、占位文案）；派生 `runtimeRoot` / `cacheRoot` 使用 POSIX `/` 分隔（跨平台一致性，展示层统一）。

## Verify

- `cd frontend && pnpm exec tsc --noEmit`（类型零错误，含 strict null check）。
- `cd frontend && pnpm exec vitest run`（不新增测试，但既有测试不得回归；本任务无新测试，留 task-08 覆盖）。

## Constraints

- 复用现有子组件（SectionCard / WorkspaceAccessGuide 等）不重写；本任务不实现字段渲染细节，仅给骨架（YAGNI）。
- 不改 backend API、不改 schema、不新增 migration、不调用任何 API（数据全走 props）。
- 中文 UI（CLAUDE.md 规则 11、15）；路径展示用等宽 + truncate（具体字段留给 task-02/03，本任务仅占位）。
- 跨平台路径：派生 `runtimeRoot` / `cacheRoot` 统一用 POSIX `/`，不直接拼 Windows 反斜杠（实际展示层在 task-03）。
- 不引入新的生命周期事件（design §7.5），本任务零副作用纯展示骨架。
