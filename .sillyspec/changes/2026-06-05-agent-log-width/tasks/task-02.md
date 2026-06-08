---
id: task-02
title: 修复 Agent 控制台已完成运行日志溢出
priority: P0
estimated_hours: 0.2
depends_on: []
blocks: [task-04]
allowed_paths:
  - frontend/src/app/(dashboard)/workspaces/[id]/agent/page.tsx
---

# task-02: 修复 Agent 控制台已完成运行日志溢出

## 修改文件（必填）

- `frontend/src/app/(dashboard)/workspaces/[id]/agent/page.tsx`
  - **第 719 行**：`<td colSpan={8} className="p-0">` — 在 td 上添加 `overflow-hidden` 类名

  修改前：
  ```tsx
  <td colSpan={8} className="p-0">
  ```

  修改后：
  ```tsx
  <td colSpan={8} className="overflow-hidden p-0">
  ```

  仅此一处改动。不需要修改 `<pre>`（第 751 行），它已有 `overflow-x-auto`。不需要修改中间层 `<div className="border-t bg-muted/30">`（第 720 行）或 `<div className="max-h-[300px] overflow-auto">`（第 741 行）。

## 实现要求

1. **精确修改第 719 行**：在 `<td colSpan={8}>` 元素的 className 中添加 `overflow-hidden`。
2. **问题根因**：`<td>` 作为 `<table>` 的单元格，其宽度由表格布局算法决定，但 `colSpan={8}` 的 td 内部内容（`<pre>` 里的长日志行）会撑大 td 的实际渲染宽度，导致整个表格溢出外层容器。`<pre>` 虽然已有 `overflow-x-auto`，但如果 `<td>` 本身没有约束宽度，`<pre>` 的滚动条不会生效，因为 `<td>` 被内容撑宽了。
3. **修复原理**：在 `<td>` 上添加 `overflow-hidden`（或 `overflow-x-hidden`），让 td 严格遵守表格分配的宽度，不允许被内部 `<pre>` 内容撑宽。这样 `<pre>` 内部的 `overflow-x-auto` 才能生效，出现水平滚动条。
4. 不需要添加 Tailwind 的 `@apply` 或自定义 CSS，Tailwind 已内置 `overflow-hidden` 类。

## 接口定义

纯 CSS 类名修改，无接口变更。

| 元素 | 修改前 className | 修改后 className |
|---|---|---|
| `<td>` (第 719 行) | `"p-0"` | `"overflow-hidden p-0"` |

## 边界处理

1. **空日志 / 无日志**：`expandedLogs` 为 `null` 或空数组时显示占位文案，不涉及 `<pre>` 渲染，`overflow-hidden` 不影响占位文案显示。
2. **短日志 / 不超宽**：日志内容不超宽时，`overflow-hidden` 无可见效果（没有内容被裁剪），`<pre>` 的 `overflow-x-auto` 也不显示滚动条，行为与修改前一致。
3. **stderr / pending_input / user_input 等特殊 channel**：这些 channel 使用带样式的 `<div>`，内容一般不会超宽；即使超宽，`<td>` 的 `overflow-hidden` 会约束宽度，`<pre>` 的 `overflow-x-auto` 提供滚动。视觉效果不受影响。
4. **长 ANSI 转义序列或 URL**：日志中可能包含非常长的单行内容（如 URL、堆栈跟踪），修复后这些行在 `<pre>` 内水平滚动，不会撑宽整个页面。
5. **表格列数变更**：如果未来 `colSpan` 的值从 8 变为其他数字，`overflow-hidden` 仍然有效，不依赖 colSpan 的具体值。

## 非目标

- 不重构已完成运行日志区域的 DOM 结构。
- 不修改 `<pre>` 标签上的任何类名。
- 不修改中间层 `<div>`（`border-t bg-muted/30` 或 `max-h-[300px] overflow-auto`）的类名。
- 不处理活跃运行日志区域的溢出问题（由 task-01 负责）。
- 不处理变更详情页日志查看器的溢出问题（由 task-03 负责）。

## 参考

- [CSS overflow-hidden on table cells](https://developer.mozilla.org/en-US/docs/Web/CSS/overflow-hidden) — 阻止内容溢出其容器。
- 本文件活跃运行日志区域（~506-643 行）的修复思路类似：约束容器宽度让内部滚动生效。
- design.md 决策 1：混合方案 — 容器保持 overflow-auto，内容元素添加约束。

## TDD 步骤

1. **写测试**：无自动化测试。CSS 溢出修复的验证依赖视觉检查（参见 task-04）。如需单元测试，可编写一个渲染测试，断言 `<td>` 元素的 className 包含 `overflow-hidden`。
2. **确认失败**：手动在已完成运行日志中输入一段超长文本（如 300+ 字符的连续字符串），观察到日志区域撑宽页面、页面出现 X 轴滚动条。
3. **写代码**：在第 719 行 `<td>` 的 className 中添加 `overflow-hidden`。
4. **确认通过**：刷新页面，超长日志行在日志块内水平滚动，页面不出现 X 轴滚动条。
5. **回归**：确认短日志正常显示、channel 着色正常、展开/关闭按钮正常、加载状态正常。

## 验收标准

| # | 验证步骤 | 通过标准 |
|---|---|---|
| AC-01 | 在 Agent 控制台展开一个包含超长日志行（200+ 字符无换行）的已完成运行 | 日志块内出现水平滚动条，日志块宽度不超出表格容器 |
| AC-02 | 展开一个包含短日志（均不超宽）的已完成运行 | 日志显示与修改前完全一致，无异常 |
| AC-03 | 展开一个包含 stderr 通道日志的已完成运行 | stderr 日志红色着色正常显示，无布局异常 |
| AC-04 | 展开一个包含 pending_input / user_input 通道日志的已完成运行 | 特殊样式（黄/蓝背景、左边框）正常显示 |
| AC-05 | 整个页面不出现浏览器 X 轴滚动条（无论日志内容多长） | 页面 X 轴无滚动条 |
| AC-06 | 前端 TypeScript 编译无错误 | `npm run build` 或 `tsc --noEmit` 通过 |
