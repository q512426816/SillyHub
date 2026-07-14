---
id: task-01
title: "`PpmResourceTable` 的 `PpmFieldOption` 新增可选 `statusKind` 字段 + select 列渲染分支"
title_zh: PpmFieldOption 扩展 statusKind 与 select 渲染分支
author: WhaleFall
created_at: 2026-07-14 11:00:55
priority: P0
depends_on: []
blocks: [task-05]
requirement_ids: [FR-01, FR-02]
decision_ids: [D-003@v1, D-004@v1]
allowed_paths:
  - frontend/src/components/ppm-resource-table.tsx
provides:
  - contract: PpmFieldOption
    fields: [statusKind]
goal: >
  给 PpmFieldOption 加可选 statusKind 字段，select 列按 statusKind→StatusBadge、color="default"→灰Tag、color→Tag、否则纯文本 分支渲染，统一 ppm 状态/类型视觉。
implementation:
  - 在 ppm-resource-table.tsx 顶部引入 StatusKind 类型与 StatusBadge 组件（来自 @/components/ui/status-badge）。
  - 在 PpmFieldOption 接口新增可选 statusKind 字段（类型 StatusKind），与现有 color 并列；补注释说明优先级 statusKind > color。
  - 改造 columns 中 select 字段渲染分支：命中选项后按 statusKind→StatusBadge、color==="default"→无色 Tag、有 color→带色 Tag、否则纯文本 四档判定。
  - 保持未命中/空值的现有兜底（"—"占位或原值文本）不变。
  - 确认 customers/stakeholders 现有调用未传 statusKind/color=default 时渲染与现状一致。
acceptance:
  - PpmFieldOption 含可选 statusKind 字段，tsc 无类型错误。
  - select 列命中选项且 statusKind 存在时渲染为 StatusBadge（带圆点 pill）。
  - select 列命中选项且 color==="default" 时渲染为默认灰 Tag（无 color 属性）。
  - select 列命中选项且 color 为其他值时渲染为带该 color 的 Tag。
  - select 列命中选项且无 statusKind 无 color 时渲染为纯文本，行为同改造前。
  - 未传 statusKind/color 的现有调用（customers/stakeholders）渲染不回归。
verify:
  - cd frontend && pnpm exec tsc --noEmit
constraints:
  - 纯样式，不改业务/API/数据流/字段定义。
  - statusKind/color 为新增可选字段，不传时渲染逻辑同现状（向后兼容 customers/stakeholders）。
  - 不引入新 npm 依赖（StatusBadge 已存在），不改 antd Table/Form/Select 本体。
  - 渲染分支优先级固定为 statusKind > color=default > color > 纯文本。
---
