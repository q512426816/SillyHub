---
id: task-07
title: "Frontend列表页更新 — 新阶段Badge颜色+筛选"
priority: P1
estimated_hours: 1
depends_on:
  - task-05
blocks:
  - task-08
allowed_paths:
  - frontend/src/app/(dashboard)/workspaces/[id]/changes/page.tsx
---

# Task-07: Frontend列表页更新 — 新阶段Badge颜色+筛选

## 背景

当前列表页 `page.tsx` 使用旧的 6 阶段体系（`created`, `propose`, `plan`, `execute`, `verify`, `archived`），需替换为设计文档中定义的新 10 阶段工作流状态机。本任务聚焦于列表页展示层更新：将阶段常量、颜色映射、标签文案、筛选下拉框全部对齐新的 10 阶段体系，使列表页能正确显示每个 change 所处的精确阶段。

本任务仅修改列表页 `page.tsx`，不涉及详情页工作流 UI（task-06）和 StageBadge 独立组件的抽取。

## 修改文件

| 文件 | 操作 | 说明 |
|------|------|------|
| `frontend/src/app/(dashboard)/workspaces/[id]/changes/page.tsx` | 修改 | 替换 STAGE_VARIANT / STAGE_LABEL / STAGE_OPTIONS 常量，更新 Badge 渲染逻辑 |

## 实现要求

### 1. 替换 `STAGE_VARIANT` 常量

将现有的 6 阶段 `STAGE_VARIANT` 替换为新的 10 阶段 `WORKFLOW_STAGE_VARIANT`：

```typescript
// ── 旧代码（删除） ──────────────────────────────────────────────
// const STAGE_VARIANT: Record<string, "outline" | "default" | "warning" | "destructive" | "success"> = {
//   created: "outline",
//   propose: "default",
//   plan: "warning",
//   execute: "destructive",
//   verify: "success",
//   archived: "outline",
// };

// ── 新代码 ──────────────────────────────────────────────────────
const WORKFLOW_STAGE_VARIANT: Record<
  string,
  "outline" | "default" | "warning" | "destructive" | "success"
> = {
  draft: "outline",                   // 灰色
  clarifying: "default",              // 蓝色
  design_review: "warning",           // 紫色（Badge variant 中无紫色，使用 warning）
  ready_for_dev: "success",           // 绿色
  in_dev: "default",                  // 黄色（Badge variant 中无黄色，使用 default + 自定义 class）
  technical_verification: "warning",  // 橙色（使用 warning 代表暖色调）
  business_review: "default",         // 蓝色
  rework_required: "destructive",     // 红色
  accepted: "success",                // 绿色
  archived: "outline",                // 灰色
};
```

> **颜色映射设计说明**：Badge 组件仅支持 `outline | default | warning | destructive | success` 五种 variant，无法精确对应所有 10 种颜色。方案如下：
> - **灰色**（draft, archived）→ `outline`
> - **蓝色**（clarifying, business_review）→ `default`
> - **绿色**（ready_for_dev, accepted）→ `success`
> - **红色**（rework_required）→ `destructive`
> - **紫色/橙色**（design_review, technical_verification）→ `warning`——此 variant 在 Badge 中通常渲染为琥珀/橙色，两者视觉有差异但可通过 class override 细调，不在本任务 scope 内

### 2. 替换 `STAGE_LABEL` 常量

将旧标签替换为新的中文标签映射：

```typescript
// ── 旧代码（删除） ──────────────────────────────────────────────
// const STAGE_LABEL: Record<string, string> = { ... };

// ── 新代码 ──────────────────────────────────────────────────────
const WORKFLOW_STAGE_LABEL: Record<string, string> = {
  draft: "草稿",
  clarifying: "需求澄清",
  design_review: "设计评审",
  ready_for_dev: "待开发",
  in_dev: "开发中",
  technical_verification: "技术验证",
  business_review: "业务验收",
  rework_required: "需返工",
  accepted: "已通过",
  archived: "已归档",
};
```

### 3. 替换 `STAGE_OPTIONS` 筛选下拉选项

将筛选下拉框的选项更新为 10 阶段：

```typescript
// ── 旧代码（删除） ──────────────────────────────────────────────
// const STAGE_OPTIONS = [ ... ] as const;

// ── 新代码 ──────────────────────────────────────────────────────
const WORKFLOW_STAGE_OPTIONS = [
  { value: "", label: "全部阶段" },
  { value: "draft", label: "草稿" },
  { value: "clarifying", label: "需求澄清" },
  { value: "design_review", label: "设计评审" },
  { value: "ready_for_dev", label: "待开发" },
  { value: "in_dev", label: "开发中" },
  { value: "technical_verification", label: "技术验证" },
  { value: "business_review", label: "业务验收" },
  { value: "rework_required", label: "需返工" },
  { value: "accepted", label: "已通过" },
  { value: "archived", label: "已归档" },
] as const;
```

### 4. 更新筛选下拉框 JSX

在 `<select>` 元素中，将 `STAGE_OPTIONS` 引用替换为 `WORKFLOW_STAGE_OPTIONS`：

```diff
- {STAGE_OPTIONS.map((opt) => (
+ {WORKFLOW_STAGE_OPTIONS.map((opt) => (
```

### 5. 更新表格中 Badge 渲染

在表格行中的阶段列，替换引用：

```diff
- <Badge variant={STAGE_VARIANT[c.current_stage] ?? "outline"}>
-   {STAGE_LABEL[c.current_stage] ?? c.current_stage}
+ <Badge variant={WORKFLOW_STAGE_VARIANT[c.current_stage] ?? "outline"}>
+   {WORKFLOW_STAGE_LABEL[c.current_stage] ?? c.current_stage}
 </Badge>
```

### 6. 更新底部"变更生命周期"展示

将底部静态展示从旧 6 步替换为新 10 阶段流程：

```diff
- {[
-   "需求输入",
-   "Change 创建",
-   "Task 拆分",
-   "执行",
-   "验证",
-   "归档",
- ].map((step, i) => (
+ {[
+   "草稿",
+   "需求澄清",
+   "设计评审",
+   "待开发",
+   "开发中",
+   "技术验证",
+   "业务验收",
+   "已通过",
+   "已归档",
+ ].map((step, i) => (
    <div key={step} className="flex items-center">
      <div className="whitespace-nowrap rounded-md border border-border bg-muted/40 px-3 py-1.5 text-[11px] font-medium text-foreground">
        {step}
      </div>
-     {i < 5 && (
+     {i < 8 && (
        <span className="mx-2 text-muted-foreground">&rarr;</span>
      )}
    </div>
  ))}
```

### 7. 保留不变的代码

以下代码**不做修改**：
- `STATUS_COLORS` 常量及 `status` 列的 Badge 渲染（`status` 字段为旧字段，设计文档 §7.3 过渡期双写，保留兼容）
- `TABS` 常量（`active` / `archive` 分类不变）
- `ChangeSummary` 类型（由 task-05 定义，`current_stage` 字段名不变）
- `listChanges` / `reparseChanges` 等 API 调用逻辑
- 搜索、排序、分页等现有交互逻辑
- 表格列结构（Key、标题、类型、状态、阶段、影响组件、更新时间 7 列保持不变）

## 接口定义

### 常量接口

| 常量名 | 类型 | 值域 | 说明 |
|--------|------|------|------|
| `WORKFLOW_STAGE_VARIANT` | `Record<string, BadgeVariant>` | 10 个 key，值域 `"outline" \| "default" \| "warning" \| "destructive" \| "success"` | 阶段→Badge variant 映射 |
| `WORKFLOW_STAGE_LABEL` | `Record<string, string>` | 10 个 key→中文标签 | 阶段→显示文本映射 |
| `WORKFLOW_STAGE_OPTIONS` | `readonly [{ value: string, label: string }, ...]` | 11 项（含空值"全部阶段"） | 筛选下拉选项 |

### 阶段值域（与后端 StageEnum 对齐）

| 阶段值 | 中文标签 | Badge Variant | 视觉颜色 |
|--------|---------|---------------|---------|
| `draft` | 草稿 | `outline` | 灰色 |
| `clarifying` | 需求澄清 | `default` | 蓝色 |
| `design_review` | 设计评审 | `warning` | 橙/琥珀色 |
| `ready_for_dev` | 待开发 | `success` | 绿色 |
| `in_dev` | 开发中 | `default` | 蓝色 |
| `technical_verification` | 技术验证 | `warning` | 橙/琥珀色 |
| `business_review` | 业务验收 | `default` | 蓝色 |
| `rework_required` | 需返工 | `destructive` | 红色 |
| `accepted` | 已通过 | `success` | 绿色 |
| `archived` | 已归档 | `outline` | 灰色 |

## 边界处理

1. **`current_stage` 值不在映射中**：后端可能返回未知阶段值（如新增阶段但前端未同步更新）。`WORKFLOW_STAGE_VARIANT[unknown] ?? "outline"` 和 `WORKFLOW_STAGE_LABEL[unknown] ?? unknown` 的 fallback 机制确保 Badge 使用灰色渲染并显示原始字符串值，不会白屏或报错。
2. **`current_stage` 为 `null` 或 `undefined`**：现有代码中 `{c.current_stage && (...)}` 的条件渲染已处理此情况，stage 为空时不渲染 Badge。此逻辑保持不变。
3. **旧阶段值残留**：数据库中可能存在尚未迁移的旧阶段值（`created`, `propose`, `plan`, `execute`, `verify`）。由于新映射中不包含这些 key，它们会走到 fallback：`WORKFLOW_STAGE_VARIANT["propose"]` 返回 `undefined`，最终使用 `"outline"` variant + 原始值显示。虽然视觉上不够友好，但不会崩溃。完整映射由数据库迁移（task-02）解决。
4. **筛选下拉选中的旧值**：用户可能从 URL query 或浏览器记忆中带入旧 stage 值（如 `?stage=execute`），此时 `filtered` 结果为空列表，显示"没有匹配的变更"。用户可手动切回"全部阶段"重置，无需特殊代码处理。
5. **`rework_required` 阶段在 active tab 和 archive tab 中的可见性**：`rework_required` 是一个回退中间态，后端 `listChanges(location="active")` 应包含此状态。前端不额外过滤——如果后端返回了就显示。若后端错误地将其归入 archive，前端会展示在 archive tab 下，但这属于后端问题，前端不做二次分类。
6. **底部生命周期流程展示与 `rework_required`**：底部静态展示为线性主流程（9 步），不含 `rework_required` 回退分支。这是有意的简化——底部展示仅用于直观概览，完整流转图在详情页（task-06）中展示。

## 非目标

- ❌ 不抽取独立的 `StageBadge` 组件（属于设计文档中 `components/StageBadge.tsx` 的 scope，可在后续任务中完成）
- ❌ 不修改 `STATUS_COLORS` 或移除 `status` 列（过渡期双写策略，见设计文档 §7.3）
- ❌ 不新增阶段流转操作按钮（列表页仅展示，操作在详情页 task-06）
- ❌ 不实现阶段相关的拖拽排序或批量操作
- ❌ 不引入新的 UI 库或 Badge 样式变体
- ❌ 不修改后端 API 接口或数据模型

## TDD 步骤

### Red → Green 循环

| # | 测试用例 | 类型 | 预期结果 |
|---|---------|------|---------|
| 1 | `test_workflow_stage_variant_has_10_keys` — 验证 `WORKFLOW_STAGE_VARIANT` 包含全部 10 个阶段 key | 单元测试 | `Object.keys(WORKFLOW_STAGE_VARIANT).length === 10`，包含 `draft` … `archived` |
| 2 | `test_workflow_stage_variant_values_valid` — 验证所有 variant 值在合法集合 `"outline" \| "default" \| "warning" \| "destructive" \| "success"` 中 | 单元测试 | 每个 value 都在合法集合内 |
| 3 | `test_workflow_stage_label_has_10_keys` — 验证 `WORKFLOW_STAGE_LABEL` 包含全部 10 个阶段 key | 单元测试 | `Object.keys(WORKFLOW_STAGE_LABEL).length === 10` |
| 4 | `test_workflow_stage_label_all_non_empty` — 验证所有中文标签为非空字符串 | 单元测试 | 每个 label `length > 0` |
| 5 | `test_workflow_stage_options_has_11_items` — 验证筛选选项包含"全部阶段" + 10 个阶段 | 单元测试 | `length === 11`，第一项 `value === ""` |
| 6 | `test_workflow_stage_options_values_match_variant_keys` — 验证筛选选项的 value 集合与 `WORKFLOW_STAGE_VARIANT` 的 key 集合完全一致 | 单元测试 | 两个 Set 深度相等 |
| 7 | `test_old_constants_removed` — 验证旧常量 `STAGE_VARIANT`, `STAGE_LABEL`, `STAGE_OPTIONS` 不再被引用或已删除 | 回归测试 | grep 文件中无 `STAGE_VARIANT`（非 `WORKFLOW_STAGE_VARIANT`）的引用 |
| 8 | `test_render_draft_badge` — 渲染一个 `current_stage="draft"` 的 change，验证 Badge variant 为 `outline`、文本为"草稿" | 组件测试 | 快照或 DOM 断言 |
| 9 | `test_render_rework_required_badge` — 渲染 `current_stage="rework_required"`，验证 Badge variant 为 `destructive`、文本为"需返工" | 组件测试 | 快照或 DOM 断言 |
| 10 | `test_render_unknown_stage_fallback` — 渲染 `current_stage="some_new_stage"`，验证 Badge variant 为 `outline`、文本为 `"some_new_stage"` | 组件测试 | 不崩溃，显示原始值 |
| 11 | `test_render_null_stage_no_badge` — 渲染 `current_stage=null`，验证不渲染 Badge 元素 | 组件测试 | DOM 中无 Badge |
| 12 | `test_filter_by_stage_in_dev` — 设置 `stageFilter="in_dev"`，验证列表仅包含 `current_stage === "in_dev"` 的项 | 组件测试 | `filtered.length` 符合预期 |
| 13 | `test_filter_empty_shows_all` — 设置 `stageFilter=""`，验证列表包含所有项 | 组件测试 | `filtered.length === items.length` |
| 14 | `test_lifecycle_bar_has_9_steps` — 验证底部流程展示包含 9 个步骤节点 | 组件测试 | 节点数量为 9 |
| 15 | `test_page_renders_without_error` — 完整页面渲染，无 console error / uncaught exception | 冒烟测试 | 页面正常加载 |

### 执行顺序

```
1. 先写 test_workflow_stage_variant_* → 替换 STAGE_VARIANT 为 WORKFLOW_STAGE_VARIANT → Green
2. 再写 test_workflow_stage_label_* → 替换 STAGE_LABEL 为 WORKFLOW_STAGE_LABEL → Green
3. 再写 test_workflow_stage_options_* → 替换 STAGE_OPTIONS 为 WORKFLOW_STAGE_OPTIONS → Green
4. 再写 test_old_constants_removed → 确认旧引用全部清理 → Green
5. 写 Badge 渲染测试 (test_render_*) → 更新 JSX 中常量引用 → Green
6. 写筛选测试 (test_filter_*) → 确认筛选逻辑不变 → Green
7. 写底部展示测试 (test_lifecycle_bar_*) → 更新底部静态数据 → Green
8. 写冒烟测试 → 确认完整页面正常 → Green
9. 全量跑通确认
```

## 验收标准

| # | 标准 | 验证方法 |
|---|------|---------|
| AC-1 | `WORKFLOW_STAGE_VARIANT` 包含全部 10 个阶段 key，variant 值均为合法 Badge variant | 单元测试 + TypeScript 编译通过 |
| AC-2 | `WORKFLOW_STAGE_LABEL` 包含全部 10 个阶段 key，每个 label 为非空中文字符串 | 单元测试 |
| AC-3 | `WORKFLOW_STAGE_OPTIONS` 包含 11 项（含"全部阶段"），value 集合与 `WORKFLOW_STAGE_VARIANT` 的 key 集合完全一致 | 单元测试 |
| AC-4 | 旧常量 `STAGE_VARIANT` / `STAGE_LABEL` / `STAGE_OPTIONS` 已删除，无残留引用 | grep 搜索确认 |
| AC-5 | 表格阶段列 Badge 使用 `WORKFLOW_STAGE_VARIANT` 和 `WORKFLOW_STAGE_LABEL` 渲染，已知阶段显示正确中文标签和颜色 | 组件测试 + 手动验证 |
| AC-6 | 未知 `current_stage` 值 fallback 为灰色 Badge + 原始值文本，不崩溃 | 组件测试 |
| AC-7 | `current_stage` 为 null 时不渲染 Badge | 组件测试 |
| AC-8 | 筛选下拉框显示 11 个选项，选择某阶段后列表正确过滤 | 组件测试 + 手动验证 |
| AC-9 | 底部"变更生命周期"展示为 9 步新流程（不含 rework_required 分支） | 组件测试 |
| AC-10 | `STATUS_COLORS` 及 `status` 列保持不变，不受本次修改影响 | 代码 diff 确认 |
| AC-11 | `npx tsc --noEmit` 编译通过，无类型错误 | CI TypeScript 检查通过 |
| AC-12 | 现有 API 调用（`listChanges` / `reparseChanges`）、搜索、tab 切换功能正常 | 手动验证 + 现有测试通过 |
