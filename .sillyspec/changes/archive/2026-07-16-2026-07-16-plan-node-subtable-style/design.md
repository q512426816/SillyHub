---
author: WhaleFall
created_at: 2026-07-16T09:30:00
scale: small
---

# 设计文档（Design）— 计划节点模板子表样式优化

> 变更 `2026-07-16-plan-node-subtable-style` · 方案 A（子表限宽独立滚动 + 明细列宽压缩）
> 原型 `prototype-plan-node-subtable.html`

## 1. 背景

`/ppm/plan-nodes`（计划节点模板）页是三层嵌套结构：模板（PlanNode）→ 模板明细（PlanNodeDetail）+ 执行模块（PlanNodeModule），通过 AntD Table 的 expand 展开行呈现。

当前问题（用户反馈「子表样式不美观，宽度太宽，导致母表 X 轴滚动很长」）：

- **母表**（`PlanNodesPage` 主 Table）设 `scroll={{ x: "max-content", y: "calc(100vh - 430px)" }}`。
- 展开行 `PlanNodeChildren` 内含两个子表：
  - **明细子表**：`PpmSubTable` editable 行内编辑模式，`DETAIL_COLUMNS` 7 列 width 合计约 920px（详细阶段120 + 任务主题120 + 任务描述180 + 要求160 + 角色100 + 成果120 + 总体阶段120）+ 操作列 80px ≈ **1000px**；其内部 `EditableSubTable` 硬编码 `scroll={{ x: "max-content" }}`（`ppm-sub-table.tsx:423`）。
  - **模块子表**：AntD `Table`，`scroll={{ x: "max-content" }}`。

**根因**：AntD Table 的 `scroll.x: "max-content"` 表示「表格宽度按内容自然展开」。当子表嵌套在母表的展开行里时，子表的「内容自然宽度」（明细 1000px）会**参与母表的内容宽度测量**——母表为容纳展开行内的子表，把自身横向滚动区撑到 1000px+（双重传导）。结果：
1. 母表底部出现一条极长的横向滚动条（1000px 视口被撑到 ~1500px）；
2. 子表本身反而**不滚动**（宽度被母表整体接管）；
3. 明细列宽偏大，视觉空旷不紧凑。

`PpmSubTable` 是泛型通用组件，被 3 处复用：`plan-nodes`（editable 模式）、`milestone-details`（展开行模式）、`ppm-project-plan-detail`（展开行模式）。本问题仅出现在 plan-nodes 的特定嵌套结构。

## 2. 设计目标

1. 明细子表、模块子表**各自有独立的 X 轴滚动条**，滚动行为与母表隔离，不再撑长母表。
2. 明细子表 7 列列宽**整体压缩**，紧凑美观。
3. 改动**仅限 plan-nodes 页本地**，不动 `PpmSubTable` 通用组件，对其他 2 个使用方**零回归**。

## 3. 非目标

- ❌ 不改 `PpmSubTable` 通用组件（避免影响 `milestone-details`、`ppm-project-plan-detail`）。
- ❌ 不改母表列结构 / 母表 scroll 配置。
- ❌ 不改后端接口、数据模型、DB。
- ❌ 不引入子表竖向滚动 / 最大高度（本次仅解决横向溢出）。
- ❌ 不顺手优化其他 ppm 页面（即便它们结构相似）。

## 4. 拆分判断

单页面纯前端样式优化，不满足「3+ 模块 / 3+ 角色 / 跨页面状态流转」拆分条件，非批量模式（非「模板 × 数据」）。单变更即可，无需 MASTER.md。

## 5. 总体方案（方案 A）

**核心思路**：给明细、模块两个子表各套一层「绝对限宽 + 横向滚动」容器，切断子表内容宽度向母表的传导；同时压缩明细列宽。

### 5.1 滚动隔离容器

在 `PlanNodeChildren` 内，`DetailsSubTable` 与 `ModulesSubTable` 的表格根节点外层，各包一层：

```tsx
<div style={{ maxWidth: "calc(100vw - 340px)", overflowX: "auto" }}>
  {/* 原 PpmSubTable / Table */}
</div>
```

- 容器用**绝对宽度** `calc(100vw - 340px)`（视口宽 − 左侧导航 256px − 页面 padding / 展开行缩进约 84px），而非百分比 `max-w-full`。
- **为何不用百分比**：百分比 `max-width: 100%` 在母表 `max-content` 下存在循环依赖——子表 100% 宽依赖父（展开行 td）宽，而父宽又依赖母表内容宽（含子表），无法切断传导。绝对值（基于 vw）直接锚定视口，打破循环。
- 容器 `overflowX: "auto"`：子表内容超出容器宽度时，在**容器底部出现独立横向滚动条**，不再把宽度传给母表。母表横向滚动条恢复为母表自身列宽决定的正常长度。

### 5.2 明细列宽压缩

`DETAIL_COLUMNS` 7 列 width 调整（任务描述仍是最宽列，保留 textarea 多行展开）：

| 列 | 现状 | 方案A | 说明 |
|---|---|---|---|
| 详细阶段 | 120 | 90 | 短文本 |
| 任务主题 | 120 | 100 | 中等文本 |
| 任务描述（textarea） | 180 | 140 | 仍最宽，autoSize 多行 |
| 要求与注意事项 | 160 | 120 | 收紧 |
| 角色名称 | 100 | 80 | 短文本 |
| 成果 | 120 | 90 | 收紧 |
| 总体阶段 | 120 | 90 | 短文本 |
| 操作（PpmSubTable 自加 fixed right） | 80 | 80 | 不变 |
| **合计** | **1000** | **790** | 压缩 21% |

压缩后多数情况内容不再溢出容器；超长文本时容器内独立滚动兜底。

### 5.3 模块子表

同步套用 5.1 的滚动容器（列已较窄，主要保证展开区内视觉一致 + 滚动隔离）。

## 6. 文件变更清单

| 操作 | 文件路径 | 说明 |
|---|---|---|
| 修改 | `frontend/src/app/(dashboard)/ppm/plan-nodes/page.tsx` | ① `PlanNodeChildren` 内 `DetailsSubTable` / `ModulesSubTable` 表格根节点外层各加限宽 `overflowX:auto` 容器；② `DETAIL_COLUMNS` 7 列 width 按上表压缩 |

仅 1 个文件。后端、其他前端页面、通用组件均不动。

## 7. 接口定义

无新增接口 / 方法 / 类型。本次为纯样式调整，关键改动点：

**a. 滚动容器 wrapper（新增 JSX 结构）**

```tsx
// PlanNodeChildren → DetailsSubTable / ModulesSubTable 的表格根节点外层
<div style={{ maxWidth: "calc(100vw - 340px)", overflowX: "auto" }}>
  <PpmSubTable<DetailDraftRow> ... />   {/* 明细 */}
  {/* 或 <Table<PlanNodeModule> ... /> 模块 */}
</div>
```

**b. `DETAIL_COLUMNS` 列宽变更**（见 §5.2 表，width 数值改写）。

无 props / schema / API 变更。

## 8. 数据模型

无。纯前端样式，不动后端、DB、migration。

## 9. 兼容策略（brownfield）

- **未改 `PpmSubTable` 通用组件**：`milestone-details`、`ppm-project-plan-detail` 两处使用方行为完全不变（零回归）。
- **回退路径**：删除新增的外层 wrapper `div` + 还原 `DETAIL_COLUMNS` 列宽即完全恢复原状，无副作用。
- **不改变的 API / 表结构**：无任何后端变动。

## 10. 风险登记

| 编号 | 风险 | 等级 | 应对策略 |
|---|---|---|---|
| R-01 | `calc(100vw - 340px)` 的 340px 偏移需匹配实际布局（左侧导航 256 + 页面 padding + 展开行缩进），侧边栏折叠态 / 不同分辨率下可能偏差 | P2 | 实现阶段浏览器多分辨率实测；必要时改用固定 px 或配合 `scroll.x` 固定值兜底 |
| R-02 | 明细子表（`PpmSubTable` editable，内部硬编码 `scroll.x: "max-content"` @ `ppm-sub-table.tsx:423`）与模块子表（AntD `Table`，`scroll.x: "max-content"` @ `page.tsx:582`）**两类嵌套子表**，外层限宽容器能否让其内部独立滚动、不再向母表传导 max-content 需实测（Grill 补：模块表此前未单独提及） | P1 | 实现阶段两类子表均重点验证；明细若失效→退化通过 `tableProps={{ scroll: { x: 790 } }}` 传固定宽度（`EditableSubTable` 的 `{...tableProps}` 在 `scroll` 之后展开可覆盖默认）；模块表若失效→直接改 `scroll={{ x: <固定值> }}` |
| R-03 | 任务描述 textarea 压到 140px，长文本编辑体验略降 | P2 | textarea 自带 `autoSize={{ minRows: 1, maxRows: 3 }}` 多行展开，140px 可接受；验收确认 |

## 11. 决策追踪

当前版本决策（详见 `decisions.md`）：

- **D-001@v1**：改动范围 = 只改 plan-nodes 本地，不改 `PpmSubTable` 通用组件。→ 覆盖于 §3 非目标 / §6 文件清单。
- **D-002@v1**：优化对象 = 明细 + 模块两个子表。→ 覆盖于 §5 总体方案。
- **D-003@v1**：实现路径 = 方案 A（外层滚动容器 + 压缩列宽），淘汰方案 B（固定宽度需调试）/ C（动母表治本但面大）。→ 覆盖于 §5。
- **D-004@v1**：容器限宽用绝对值 `calc(100vw - 340px)` 而非百分比，切断 max-content 循环依赖。→ 覆盖于 §5.1 / R-01。

无未解决决策。

## 12. 自审

- ✅ **需求覆盖**：子表独立滚动（§5.1）+ 列宽压缩（§5.2）+ 仅改 plan-nodes（§3/§6），完整覆盖用户需求。
- ✅ **Grill 覆盖**：引用 D-001~D-004 全部当前版本决策。
- ✅ **约束一致性**：符合 `CONVENTIONS.md`（Next.js 14 + AntD 6，typecheck `tsc --noEmit`，test `vitest run`，lint `pnpm lint`），UI 中文。
- ✅ **真实性**：文件路径 / 组件名 / 列名 / 行号均来自真实代码（`plan-nodes/page.tsx`、`ppm-sub-table.tsx:423`、`DETAIL_COLUMNS`）。
- ✅ **YAGNI**：不含竖向滚动、组件改造、其他页面优化等非必要项。
- ✅ **验收标准**：§5 + 原型可视觉验证，具体可测。
- ✅ **非目标清晰**：§3 明确界定。
- ✅ **兼容策略**：§9 给出回退路径与零回归保证。
- ✅ **风险识别**：§10 含 R-01~R-03 及对策。
- N/A **生命周期契约表**：本变更不涉及 session / lease / agent_run / daemon / lifecycle / claim / heartbeat 等关键词，省略。
