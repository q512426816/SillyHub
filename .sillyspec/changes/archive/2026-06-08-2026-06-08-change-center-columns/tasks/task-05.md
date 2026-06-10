---
author: WhaleFall
created_at: 2026-06-08T11:10:17
---
---
id: task-05
title: 前端状态列改用 human_gate 展示、阶段列 null 兜底、类型列颜色映射
priority: P0
estimated_hours: 1.5
depends_on: [task-04]
blocks: []
allowed_paths:
  - frontend/src/app/(dashboard)/workspaces/[id]/changes/page.tsx
---

# task-05: 前端状态列改用 human_gate 展示、阶段列 null 兜底、类型列颜色映射

## 目标文件

唯一修改文件：`frontend/src/app/(dashboard)/workspaces/[id]/changes/page.tsx`

## 前置知识

- `ChangeSummary` 类型定义在 `frontend/src/lib/changes.ts`（第 3-16 行），已包含 `human_gate: string | null` 和 `current_stage: string | null`
- Badge 组件定义在 `frontend/src/components/ui/badge.tsx`，支持 5 种 variant：`default`、`success`、`warning`、`destructive`、`outline`
- 现有常量 `STATUS_COLORS`（第 26-32 行）、`STAGE_VARIANT`（第 34-46 行）、`STAGE_LABEL`（第 48-60 行）保持不动（或删除 STATUS_COLORS，视下面说明）

## 改动 1：新增常量

### 1.1 删除旧 STATUS_COLORS（第 26-32 行）

整段删除 `STATUS_COLORS` 常量，它不再被使用。

### 1.2 新增 GATE_LABELS 常量（放在原 STATUS_COLORS 位置）

```typescript
const GATE_LABELS: Record<string, { label: string; color: "warning" | "destructive" }> = {
  need_proposal_review: { label: "待提案审核", color: "warning" },
  need_plan_review: { label: "待计划审核", color: "warning" },
  need_human_test: { label: "待人工测试", color: "warning" },
  need_archive_confirm: { label: "待归档确认", color: "warning" },
  blocked: { label: "阻塞中", color: "destructive" },
};
```

说明：
- 所有 `need_*` 类型用 `warning` variant（amber 配色），表示"等待人工操作"
- `blocked` 用 `destructive` variant（red 配色），表示"异常/阻塞"
- 此常量覆盖 design.md 2.1 节定义的所有 5 个 gate 值
- 注意：`need_requirement_input` gate 也存在于系统中（见变更详情页 GATE_PANELS），但 design.md 未要求在列表状态列展示它，因此不加入 GATE_LABELS。如果 future 需要展示，追加即可。

### 1.3 新增 TYPE_COLORS 常量（放在 GATE_LABELS 后面）

```typescript
const TYPE_COLORS: Record<string, "default" | "warning" | "success"> = {
  feature: "default",
  quick: "warning",
  prototype: "success",
};
```

说明：
- `feature` 用 `default` variant（blue 配色），表示标准功能变更
- `quick` 用 `warning` variant（amber 配色），表示快速修改
- `prototype` 用 `success` variant（emerald 配色），表示原型
- design.md 2.3 节要求 feature=blue, quick=yellow, prototype=purple。Badge 组件没有 blue/purple variant，使用最接近的：default(blue tint), warning(amber), success(emerald)。如需精确 purple，需要给 Badge 组件新增 variant，但 design.md 也说了"不修改前端表格列结构"，且当前 Badge 只有 5 种颜色，这已经是最合理的映射。

## 改动 2：状态列渲染逻辑（第 270-274 行）

### 现有代码

```tsx
<td>
  <Badge variant={STATUS_COLORS[c.status] ?? "outline"}>
    {c.status}
  </Badge>
</td>
```

### 替换为

```tsx
<td>
  {(() => {
    const gate = GATE_LABELS[c.human_gate ?? ""];
    if (gate) {
      return <Badge variant={gate.color}>{gate.label}</Badge>;
    }
    if (c.current_stage === "accepted") {
      return <Badge variant="success">已完成</Badge>;
    }
    if (c.current_stage && c.current_stage !== "draft") {
      return <Badge variant="success">进行中</Badge>;
    }
    return <Badge variant="outline">空闲</Badge>;
  })()}
</td>
```

### 渲染逻辑说明（按优先级）

| 优先级 | 条件 | 展示 | Badge variant |
|---|---|---|---|
| 1 | `human_gate` 不为 null/空/"none" 且在 GATE_LABELS 中有映射 | GATE_LABELS 对应的 label | GATE_LABELS 对应的 color |
| 2 | `current_stage === "accepted"` | "已完成" | success |
| 3 | `current_stage` 存在且不是 "draft" | "进行中" | success |
| 4 | 其他（null/undefined/"draft"） | "空闲" | outline |

### 关于 gate 值不在 GATE_LABELS 中的情况

如果 `human_gate` 有值但不在 GATE_LABELS 中（例如 `need_requirement_input`），上面的逻辑会把 gate 解析为 undefined，然后走优先级 2-4 的阶段判断。这是合理的——未映射的 gate 按普通状态展示。

## 改动 3：阶段列 null 兜底（第 275-281 行）

### 现有代码

```tsx
<td>
  {c.current_stage && (
    <Badge variant={STAGE_VARIANT[c.current_stage] ?? "outline"}>
      {STAGE_LABEL[c.current_stage] ?? c.current_stage}
    </Badge>
  )}
</td>
```

### 替换为

```tsx
<td>
  <Badge variant={STAGE_VARIANT[c.current_stage ?? "draft"] ?? "outline"}>
    {STAGE_LABEL[c.current_stage ?? "draft"] ?? c.current_stage ?? "draft"}
  </Badge>
</td>
```

### 说明

- `c.current_stage ?? "draft"`：null/undefined 时默认 "draft"
- STAGE_VARIANT 和 STAGE_LABEL 中已有 `draft` 的映射（"outline" / "草稿"），因此 null 时会显示灰色 "草稿" Badge
- 不再需要外层条件判断，始终渲染 Badge（消除视觉空洞）

## 改动 4：类型列颜色映射（第 269 行）

### 现有代码

```tsx
<td className="text-xs">{c.change_type ?? "—"}</td>
```

### 替换为

```tsx
<td>
  {c.change_type ? (
    <Badge variant={TYPE_COLORS[c.change_type] ?? "outline"}>
      {c.change_type}
    </Badge>
  ) : (
    <span className="text-xs text-muted-foreground">—</span>
  )}
</td>
```

### 说明

- `change_type` 有值时渲染带颜色的 Badge
- `change_type` 为 null/空时保持 "—" 文本
- TYPE_COLORS 中无映射的类型 fallback 到 `outline` variant

## 边界处理清单

| # | 边界场景 | 预期行为 | 对应代码逻辑 |
|---|---|---|---|
| E1 | `human_gate` 为 null | 走阶段判断优先级 2-4 | `GATE_LABELS[null ?? ""]` 得到 undefined |
| E2 | `human_gate` 为空字符串 `""` | 同 null 处理 | `GATE_LABELS[""]` 得到 undefined |
| E3 | `human_gate` 为 `"none"` | 同 null 处理（none 视为无 gate） | `GATE_LABELS["none"]` 得到 undefined |
| E4 | `human_gate` 为未知值（如 `"need_requirement_input"`） | 不走 gate 展示，走阶段判断 | GATE_LABELS 无映射，gate 为 undefined |
| E5 | `current_stage` 为 null | 阶段列显示 "草稿" Badge，状态列显示 "空闲" Badge | `?? "draft"` / 走优先级 4 |
| E6 | `current_stage` 为 undefined | 同 null | `?? "draft"` |
| E7 | `change_type` 为 null | 类型列显示 "—" 文本 | 条件判断 `c.change_type ? ... : ...` |
| E8 | `change_type` 为未知值（如 "hotfix"） | 显示 Badge，variant 为 outline | `TYPE_COLORS["hotfix"] ?? "outline"` |

## 验收标准

| # | 验收项 | 验收方法 | 通过条件 |
|---|---|---|---|
| A1 | human_gate 有值时状态列显示待办 Badge | 找一条 `human_gate = "need_proposal_review"` 的变更 | 状态列显示橙色 "待提案审核" Badge |
| A2 | human_gate 为 "none"/null 时状态列显示阶段状态 | 找一条 `human_gate = null` 且 `current_stage = "execute"` 的变更 | 状态列显示绿色 "进行中" Badge |
| A3 | human_gate 为 null 且 current_stage = "accepted" 时显示已完成 | 找一条已验收变更 | 状态列显示绿色 "已完成" Badge |
| A4 | human_gate 为 null 且 current_stage = null/draft 时显示空闲 | 找一条草稿变更 | 状态列显示灰色 "空闲" Badge |
| A5 | human_gate = "blocked" 时状态列显示阻塞 | 构造 blocked 状态变更 | 状态列显示红色 "阻塞中" Badge |
| A6 | 阶段列 current_stage = null 时显示草稿 | 找一条 `current_stage = null` 的变更 | 阶段列显示灰色 "草稿" Badge，非空白 |
| A7 | 阶段列 current_stage 有值时正常显示 | 找任意正常变更 | 阶段列显示对应中文 Badge |
| A8 | 类型列 change_type 有值时显示 Badge | reparse 后找一条有 change_type 的变更 | 类型列显示带颜色的 Badge（feature=default, quick=warning, prototype=success） |
| A9 | 类型列 change_type 为 null 时显示 "—" | 找一条未 reparse 的变更 | 类型列显示 "—" |
| A10 | 编译通过 | 运行 `pnpm --filter frontend build` | 无 TypeScript 错误 |
| A11 | 已归档变更也正确展示 | 切换到已归档 tab | 所有列展示正常，无报错 |

## 不修改的内容

- `STAGE_VARIANT` 常量（第 34-46 行）：保持不动
- `STAGE_LABEL` 常量（第 48-60 行）：保持不动
- `STAGE_OPTIONS` 常量（第 62-75 行）：保持不动
- `ChangeSummary` 类型定义（`frontend/src/lib/changes.ts`）：保持不动，`human_gate` 字段已存在
- Badge 组件（`frontend/src/components/ui/badge.tsx`）：保持不动
- 表格列结构（7 列布局）：保持不动
- 其他列（变更 Key、标题、影响组件、更新时间）：保持不动
