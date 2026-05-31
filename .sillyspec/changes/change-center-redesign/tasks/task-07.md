---
id: task-07
title: 前端变更列表改造 — 阶段 Badge + 新建按钮
priority: P1
estimated_hours: 1
depends_on:
  - task-05
blocks:
  - task-09
allowed_paths:
  - frontend/src/app/(dashboard)/workspaces/[id]/page.tsx
  - frontend/src/components/ui/badge.tsx
---

# task-07: 前端变更列表改造

## 目标

在变更列表页面中，为每行变更增加阶段 Badge（颜色编码），在右上角增加"新建变更"按钮，使列表能直观展示变更所处阶段，并提供快速创建变更的入口。

## 操作步骤

### Step 1 — 定位变更列表渲染位置

文件：`frontend/src/app/(dashboard)/workspaces/[id]/page.tsx`

该文件是工作空间详情页，其中包含变更列表的展示区域。找到渲染变更列表的部分（通常是一个遍历 `changes` 数组的 map）。

> 如果变更列表在单独的 tab 或组件中，则修改对应文件。

### Step 2 — 增加阶段 Badge 组件

在变更列表的每一行中，在 `status` Badge 旁边或之后，增加 `current_stage` Badge：

```tsx
const STAGE_COLORS: Record<string, "default" | "outline" | "success" | "warning" | "destructive"> = {
  created: "outline",       // 灰色
  propose: "default",       // 蓝色
  plan: "warning",          // 黄色
  execute: "destructive",   // 橙色 (用 destructive 近似)
  verify: "success",        // 绿色
  archived: "outline",      // 紫色 (或 secondary)
};

const STAGE_LABELS: Record<string, string> = {
  created: "已创建",
  propose: "提案",
  plan: "规划",
  execute: "执行",
  verify: "验证",
  archived: "归档",
};
```

在变更行中添加：

```tsx
{change.current_stage && (
  <Badge variant={STAGE_COLORS[change.current_stage] ?? "outline"}>
    {STAGE_LABELS[change.current_stage] ?? change.current_stage}
  </Badge>
)}
```

### Step 3 — 增加"新建变更"按钮

在变更列表区域的标题栏右侧增加"新建变更"按钮：

```tsx
<Link
  href={`/workspaces/${workspaceId}/changes/create`}
  className="inline-flex h-7 items-center rounded bg-primary px-3 text-xs font-medium text-primary-foreground hover:bg-primary/90"
>
  + 新建变更
</Link>
```

按钮位置应在变更列表 header 行中（如 "变更 (N)" 标题的右侧）。

### Step 4 — 可选：阶段筛选下拉

如果列表有筛选功能，增加阶段筛选：

```tsx
<select
  value={stageFilter}
  onChange={(e) => setStageFilter(e.target.value)}
  className="rounded border bg-background px-2 py-1 text-xs"
>
  <option value="">全部阶段</option>
  <option value="created">已创建</option>
  <option value="propose">提案</option>
  <option value="plan">规划</option>
  <option value="execute">执行</option>
  <option value="verify">验证</option>
  <option value="archived">归档</option>
</select>
```

使用前端过滤：`changes.filter(c => !stageFilter || c.current_stage === stageFilter)`。

### Step 5 — 验证构建

```bash
cd /Users/qinyi/SillyHub/frontend
npm run build 2>&1 | tail -20
```

## 完成标准

- [ ] 变更列表每行显示 `current_stage` Badge，颜色按设计规范编码
- [ ] 右上角有"新建变更"按钮，链接到 `/workspaces/{id}/changes/create`
- [ ] 无 `current_stage` 的变更行不显示阶段 Badge（向后兼容）
- [ ] `npm run build` 无错误

## 文件清单

| 文件 | 操作 |
|------|------|
| `frontend/src/app/(dashboard)/workspaces/[id]/page.tsx` | 修改 — 增加 Stage Badge + 新建按钮 |
