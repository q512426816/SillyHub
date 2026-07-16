---
author: WhaleFall
created_at: 2026-07-16T09:37:00
---

# 任务（Tasks）— 计划节点模板子表样式优化

> 变更 `2026-07-16-plan-node-subtable-style` · scale: small · 实现路径：quick
> 依据：`design.md` §5 / §6 / §7

## task-01 子表外层加限宽滚动容器

- **文件**：`frontend/src/app/(dashboard)/ppm/plan-nodes/page.tsx`
- **位置**：`PlanNodeChildren` → `DetailsSubTable` / `ModulesSubTable` 表格根节点外层
- **改动**：各包一层 `<div style={{ maxWidth: "calc(100vw - 340px)", overflowX: "auto" }}>`
- **依据**：design §5.1 / §7 / D-004
- **覆盖**：FR-001 / FR-004

## task-02 DETAIL_COLUMNS 列宽压缩

- **文件**：同上
- **改动**：`DETAIL_COLUMNS` 7 列 width → 90 / 100 / 140 / 120 / 80 / 90 / 90（操作列 PpmSubTable 自加，不变）
- **依据**：design §5.2
- **覆盖**：FR-002

## task-03 验证与部署

- `tsc --noEmit` 通过；`pnpm lint` 0 error；`vitest run`（plan-nodes / milestone-details 相关测试）通过
- rebuild frontend 部署，浏览器多分辨率实测：母表滚动条正常、子表独立滚动、列紧凑、其他页面无变化
- 实测 R-02（明细 + 模块两类子表 max-content 隔离），失效则按 design §10 退化方案（明细 `tableProps={{ scroll: { x: 790 } }}` / 模块 `scroll={{ x: <固定值> }}`）
- **覆盖**：FR-003（零回归确认）

## quick 执行（ql-20260716-003-8b3e）

- [x] ql-20260716-003-8b3e 实现子表限宽滚动容器 + 列宽压缩（design §5，对应 task-01/02/03）
- [x] ql-20260716-005-c2a7 修 R-02：明细限宽容器加 `[&_.ant-table-wrapper]:min-w-0` 让 PpmSubTable flex 内表格可压缩出独立滚动条
