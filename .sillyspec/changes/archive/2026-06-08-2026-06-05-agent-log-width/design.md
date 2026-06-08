---
author: unknown
created_at: 2026-06-05 06:54:41
---

# Design: Agent 控制台日志回显宽度修复

## 架构决策

### 决策 1：容器级 overflow 收紧 vs 内容级宽度约束

**选择**：混合方案 — 容器保持 `overflow-auto`，内容 flex 子元素添加 `min-w-0` + `overflow-x-auto`

**理由**：
- 容器已有 `overflow-auto`（含 x+y 方向），但 flex 子元素的 `min-width: auto` 默认值阻止了收缩
- 添加 `min-w-0` 允许 flex 子元素收缩到比内容更窄
- 添加 `overflow-x-auto` 让超出部分在块内滚动
- 这是最小改动、最低风险的修复方式

### 决策 2：不提取共享组件

**理由**：
- 本次变更目标是修复 CSS 溢出问题，不是重构组件结构
- 3 处日志显示的渲染逻辑（channel 着色、标签、交互）有差异，强行提取会增加复杂度
- 遵循 YAGNI 原则

## 文件变更清单

### 文件 1：`frontend/src/app/(dashboard)/workspaces/[id]/agent/page.tsx`

**位置 A：活跃运行日志区域（~506-643 行）**
- 日志内容行：flex 布局中显示日志文本的子元素
- 修改：添加 `min-w-0` 类名，确保 flex 子元素可收缩
- 如内容区域已有独立元素，同时添加 `overflow-x-auto`

**位置 B：已完成运行日志区域（~717-783 行）**
- `<pre>` 标签已包含 `overflow-x-auto`
- 检查外层容器是否需要 `min-w-0`
- 如外层是 flex 子元素，添加 `min-w-0`

### 文件 2：`frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/page.tsx`

**位置 C：变更详情页日志查看器（~808-888 行）**
- 日志内容行：flex 布局中的日志文本区域
- 修改：添加 `min-w-0 overflow-x-auto` 类名

## 风险登记

| 风险 | 概率 | 影响 | 缓解 |
|---|---|---|---|
| `min-w-0` 破坏现有 flex 布局 | 低 | 低 | 仅在日志内容元素上添加，不影响其他 flex 子元素 |
| `overflow-x-auto` 双滚动条 | 低 | 低 | 确保只在最内层内容元素上添加，不与容器冲突 |

## 自审

- 改动范围：纯 CSS 类名，~10 行
- 回归风险：极低，不涉及逻辑变更
- 测试策略：视觉验证（手动）+ 现有测试不受影响
