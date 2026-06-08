---
id: task-01
title: 修复 Agent 控制台活跃运行日志溢出
priority: P0
estimated_hours: 0.2
depends_on: []
blocks: [task-04]
allowed_paths:
  - frontend/src/app/(dashboard)/workspaces/[id]/agent/page.tsx
author: unknown
created_at: 2026-06-05 07:48:46
---

# task-01: 修复 Agent 控制台活跃运行日志溢出

## 修改文件（必填）

- `frontend/src/app/(dashboard)/workspaces/[id]/agent/page.tsx`
  - **第 566 行**：日志内容 `<span>` 元素的 `className` 属性

## 实现要求

在第 566 行，将日志内容 span 的 `className` 添加 `overflow-x-auto` 类名。

### 修改前（第 566 行当前值）

```tsx
<span className="min-w-0 flex-1 whitespace-pre font-mono text-[11px]">
```

### 修改后（第 566 行目标值）

```tsx
<span className="min-w-0 flex-1 overflow-x-auto whitespace-pre font-mono text-[11px]">
```

### 原理说明

- 该 span 是一个 flex 子元素，已有 `min-w-0`（允许收缩）和 `flex-1`（占据剩余空间）
- 缺少 `overflow-x-auto`，导致当日志文本超长时，内容会撑大 flex 容器，进而撑大外层 `max-h-[300px] overflow-auto` 的 div，最终导致页面出现 X 轴滚动条
- 添加 `overflow-x-auto` 后，超长内容将在该 span 内部产生水平滚动，而不是向外溢出
- `overflow-x-auto` 放在 `min-w-0` 和 `flex-1` 之后、`whitespace-pre` 之前，保持语义分组（布局类 → 溢出类 → 文本类）

### 上下文结构（供理解，不需修改其他行）

```
<section> (第 507 行，外层卡片容器)
  <div> (第 539 行，max-h-[300px] overflow-auto，日志滚动容器)
    <div className="divide-y"> (第 552 行)
      {activeLogs.map(...)} → 每条日志:
        <div key={log.id}> (第 556 行)
          <div className="flex items-start gap-2 px-3 py-1.5"> (第 557 行，flex 行)
            <span> 时间戳 (shrink-0)          ← 第 558 行
            <span> [标签] (shrink-0)           ← 第 561 行
            <span> 日志内容 (min-w-0 flex-1)   ← 第 566 行 【本次修改】
            <Badge> 工具状态 (shrink-0)        ← 第 573 行（可选）
          </div>
        </div>
```

## 接口定义

本次为纯 CSS 类名修改，无接口变更。

### className 变更

| 属性 | 修改前 | 修改后 |
|---|---|---|
| 第 566 行 span 的 className | `min-w-0 flex-1 whitespace-pre font-mono text-[11px]` | `min-w-0 flex-1 overflow-x-auto whitespace-pre font-mono text-[11px]` |

## 边界处理

1. **null/空值行为**：当 `log.content_redacted` 为空字符串或 `undefined` 时，span 内容为空，`overflow-x-auto` 不会产生任何可见影响（无滚动条、无布局偏移）
2. **短文本行为**：当日志内容宽度小于 span 可用宽度时，`overflow-x-auto` 不显示滚动条（`auto` 的语义：仅在需要时显示）
3. **超长单行文本**：`whitespace-pre` 保留原始空白和换行，单行超长文本会触发 `overflow-x-auto` 显示水平滚动条，span 内部可滚动查看完整内容
4. **多行文本（含换行符）**：`whitespace-pre` 保留换行，内容自然换行显示，每行若仍超宽则可水平滚动；外层容器的 `max-h-[300px] overflow-auto` 负责垂直滚动，不会与 span 的水平滚动冲突
5. **极端宽文本（数千字符无换行）**：`min-w-0` 确保可收缩至 flex 分配宽度，`overflow-x-auto` 确保内容在 span 内滚动，不会撑大任何父容器
6. **无 activeRunId 时**：整个 section 不渲染（第 506 行 `{activeRunId && ...}`），修改无影响

## 非目标

- 不修改外层容器（第 539 行）的 `overflow-auto` 类名
- 不修改时间戳 span（第 558 行）或标签 span（第 561 行）的任何样式
- 不修改 `pending_input` 交互面板（第 583-628 行）或 `user_input` 高亮区（第 630-636 行）
- 不提取共享日志行组件
- 不修改已完成运行日志区域（那属于 task-02）
- 不修改变更详情页日志查看器（那属于 task-03）

## 参考

- Tailwind CSS `overflow-x-auto` 文档：https://tailwindcss.com/docs/overflow
- Flexbox `min-width: 0` 技巧：解决 flex 子元素 `min-width: auto` 导致无法收缩的问题
- design.md 决策 1：混合方案 — 容器保持 `overflow-auto`，内容 flex 子元素添加 `min-w-0` + `overflow-x-auto`

## TDD 步骤

本次为纯 CSS 类名修改（添加一个 Tailwind 工具类），不涉及逻辑变更，无单元测试覆盖价值。验证方式为浏览器视觉验证（由 task-04 执行）。

1. 确认修改前：日志内容超宽时页面出现 X 轴滚动条（通过 task-04 验证记录）
2. 执行代码修改：在第 566 行 className 中添加 `overflow-x-auto`
3. 确认修改后：日志内容超宽时日志块内出现水平滚动条，页面无 X 轴滚动条
4. 回归确认：短日志、空日志、多行日志显示正常，channel 着色和标签不受影响

## 验收标准

| # | 验证步骤 | 通过标准 |
|---|---|---|
| AC-01 | 检查第 566 行 span 的 className 包含 `overflow-x-auto` | className 值为 `min-w-0 flex-1 overflow-x-auto whitespace-pre font-mono text-[11px]` |
| AC-02 | 在浏览器中打开 Agent 控制台，选择一个有活跃运行日志的 workspace | 日志区域正常显示，无布局异常 |
| AC-03 | 触发产生超长日志内容的 Agent 运行（或通过 DevTools 修改 DOM 模拟超长文本） | 日志内容 span 内部出现水平滚动条，可左右滚动查看完整内容 |
| AC-04 | 确认超宽日志存在时页面整体无 X 轴滚动条 | `<html>` 或 `<body>` 不出现水平滚动条 |
| AC-05 | 短日志内容显示时确认无多余滚动条 | `overflow-x-auto` 在内容不超宽时不显示滚动条 |
| AC-06 | 运行 `npx tsc --noEmit`（或项目 TypeScript 检查命令）确认编译无错误 | 无 TypeScript 类型错误 |
