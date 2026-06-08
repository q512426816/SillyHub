---
id: task-03
title: 修复变更详情页日志查看器溢出
priority: P0
estimated_hours: 0.2
depends_on: []
blocks: [task-04]
allowed_paths:
  - frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/page.tsx
author: unknown
created_at: 2026-06-05 07:48:46
---

# task-03: 修复变更详情页日志查看器溢出

## 修改文件（必填）

| 文件 | 行号 | 修改类型 | 说明 |
|---|---|---|---|
| `frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/page.tsx` | 878 | CSS 类名修改 | 内容 span 添加 `overflow-x-auto` |

## 实现要求

### 精确修改点

**文件**：`frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/page.tsx`
**行号**：878

**修改前**（当前代码）：
```tsx
<span className="min-w-0 flex-1 whitespace-pre font-mono text-foreground">
```

**修改后**：
```tsx
<span className="min-w-0 flex-1 overflow-x-auto whitespace-pre font-mono text-foreground">
```

**操作**：在 `flex-1` 后面、`whitespace-pre` 前面，插入 `overflow-x-auto` 类名。

### 为什么这样改

1. 第 878 行的 `<span>` 是日志内容的显示元素，位于 flex 行（第 851 行 `<div className="flex gap-2 py-0.5">`）内。
2. 该 span 已有 `min-w-0 flex-1`，允许 flex 子元素收缩，但当日志内容（如长 JSON、长 URL）超出容器宽度时，缺少水平溢出处理。
3. 添加 `overflow-x-auto` 后，超出内容会在 span 内部产生水平滚动条，而不是撑开父容器导致页面级水平滚动。
4. `overflow-x-auto` 仅在内容超出时才显示滚动条，不超出时无视觉变化。

### 不需要修改的其他部分

- 第 846 行外层容器 `<div className="max-h-80 overflow-auto ...">` 已有 `overflow-auto`，不需要改动。
- 第 851 行日志行 `<div className="flex gap-2 py-0.5">` 不需要改动。
- 第 852-853 行时间戳 span 和第 855-877 行 channel 标签 span 均有 `shrink-0`，不受影响。

## 接口定义

本次为纯 CSS 类名修改，无接口变更。

**className 值变更**：

| 属性 | 修改前 | 修改后 |
|---|---|---|
| 第 878 行 span 的 className | `"min-w-0 flex-1 whitespace-pre font-mono text-foreground"` | `"min-w-0 flex-1 overflow-x-auto whitespace-pre font-mono text-foreground"` |

## 边界处理

1. **null/空日志内容**：`log.content_redacted` 为 `undefined`、`null`、`""` 时，span 内容为空，`overflow-x-auto` 不会产生滚动条，行为与修改前一致。
2. **短日志内容**：内容宽度小于容器宽度时，`overflow-x-auto` 不显示滚动条，视觉效果与修改前完全相同。
3. **超长单行内容**：内容宽度超出容器时，span 内出现水平滚动条，用户可在 span 内左右滚动查看完整内容，页面本身不出现 X 轴滚动条。
4. **多行日志（含换行符）**：`whitespace-pre` 保留换行符，每行分别参与宽度计算。`overflow-x-auto` 只在最宽行超出时才出现滚动条，垂直滚动仍由外层容器处理。
5. **channel 标签和时间戳不受影响**：它们有 `shrink-0` 类名，不会被压缩。日志内容 span 的 `min-w-0 flex-1` 保证标签和时间戳宽度固定后，内容区域占据剩余空间。
6. **日志数量极多时的性能**：`overflow-x-auto` 不引入额外渲染开销，浏览器按需渲染滚动条。

## 非目标

- 不重构日志查看器组件结构（不提取共享组件）
- 不修改日志数据的获取或处理逻辑
- 不修改其他两个日志区域（agent/page.tsx 的活跃/已完成区域，由 task-01、task-02 处理）
- 不添加复制、搜索等日志交互功能
- 不修改 `whitespace-pre` 为 `whitespace-pre-wrap`（保留不换行行为，这是日志显示的预期行为）

## 参考

- 同项目中 `agent/page.tsx:566` 的活跃运行日志内容 span 使用了相同的 `min-w-0 flex-1` 模式，task-01 也会为该行添加 `overflow-x-auto`。
- Tailwind CSS `overflow-x-auto` 文档：当内容超出时显示水平滚动条，不超出时不显示。

## TDD 步骤

由于本项目无前端组件测试基础设施（无 React Testing Library、无组件级 vitest 配置），且本次修改为纯 CSS 类名变更，采用以下验证策略：

1. **确认修改正确**：检查第 878 行 className 从 `min-w-0 flex-1 whitespace-pre font-mono text-foreground` 变为 `min-w-0 flex-1 overflow-x-auto whitespace-pre font-mono text-foreground`。
2. **TypeScript 编译检查**：运行 `npx tsc --noEmit`（或项目 lint 命令）确认无编译错误。
3. **浏览器视觉验证**（由 task-04 统一执行）：
   - 导航到变更详情页，展开日志区域
   - 确认含超长内容的日志行在块内水平滚动
   - 确认短内容日志行无滚动条
   - 确认页面无 X 轴滚动条

## 验收标准

| # | 验证步骤 | 通过标准 |
|---|---|---|
| AC-01 | 读取 `page.tsx` 第 878 行 | span 的 className 包含 `overflow-x-auto` |
| AC-02 | 读取 `page.tsx` 第 878 行 | span 的 className 仍包含 `min-w-0`、`flex-1`、`whitespace-pre`、`font-mono`、`text-foreground`，无遗漏 |
| AC-03 | 在变更详情页展开日志，查看含长 URL/JSON 的日志行 | 超长内容在日志行内水平滚动，不撑开页面 |
| AC-04 | 在变更详情页展开日志，查看短日志行 | 短内容无滚动条，视觉效果与修改前一致 |
| AC-05 | 检查页面整体 | 页面无 X 轴滚动条（无论日志内容长短） |
| AC-06 | 检查 channel 标签和时间戳列 | 标签和时间戳宽度固定，未被压缩 |
| AC-07 | 检查日志流式更新场景 | 日志流式到达时，水平滚动行为正常，自动滚动到最新日志不受影响 |
| AC-08 | 运行 TypeScript 编译检查 | 无类型错误 |
