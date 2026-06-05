---
author: unknown
created_at: 2026-06-05 02:48:23
id: task-01
title: 移除 agent 页面 max-w-6xl 宽度限制
priority: P0
estimated_hours: 0.1
depends_on: []
blocks: [task-02]
allowed_paths:
  - frontend/src/app/(dashboard)/workspaces/[id]/agent/page.tsx
---

# task-01: 移除 agent 页面 max-w-6xl 宽度限制

## 修改文件（必填）

- `frontend/src/app/(dashboard)/workspaces/[id]/agent/page.tsx` — 第 380 行

## 实现要求

1. 打开 `frontend/src/app/(dashboard)/workspaces/[id]/agent/page.tsx`，定位到第 380 行
2. 找到组件 return 语句的最外层 `<div>`，当前 className 为：
   ```
   "mx-auto flex max-w-6xl flex-col gap-5 px-6 py-6"
   ```
3. 从 className 中移除 `max-w-6xl` 和 `mx-auto`，保留其余所有类名不变

## 接口定义（代码类任务必填）

这是纯 CSS 类名变更，不涉及接口变更。具体 diff 如下：

```diff
# 文件：frontend/src/app/(dashboard)/workspaces/[id]/agent/page.tsx
# 行号：第 380 行

- <div className="mx-auto flex max-w-6xl flex-col gap-5 px-6 py-6">
+ <div className="flex flex-col gap-5 px-6 py-6">
```

修改前完整类名：`mx-auto flex max-w-6xl flex-col gap-5 px-6 py-6`
修改后完整类名：`flex flex-col gap-5 px-6 py-6`

仅删除 `mx-auto` 和 `max-w-6xl`，不添加、不修改任何其他类名。

## 边界处理（必填，至少5条）

- **null/空值行为**：无，纯 CSS 类名变更，不涉及数据处理
- **兼容旧行为**：移除宽度限制后，页面内容自然填满 AppShell 主内容区，所有现有功能不受影响。flex 布局、间距、内边距均保留不变
- **异常不静默吞掉**：不适用，纯静态 className 修改
- **不修改传入参数**：不适用，不涉及函数参数
- **歧义/冲突场景**：保留 `px-6` 左右内边距确保内容不贴边；保留 `flex flex-col gap-5` 布局结构不变，页面整体垂直排列和元素间距不受影响
- **超宽屏（>2560px）**：头部信息区域可能显得稀疏，但可接受（design.md 已记录此 trade-off，后续可按需加回 max-w）
- **小屏设备**：移除 max-w-6xl 后在小屏上内容区自然收窄，响应式行为不会变差

## 非目标（本任务不做的事）

- 不修改日志渲染逻辑（renderConversationLog）
- 不修改日志高度限制（max-h-[300px]）
- 不修改活跃运行（Active Runs）区域的 grid 布局
- 不修改已完成运行（Completed Runs）区域的表格
- 不修改其他页面宽度
- 不修改 AppShell 布局或 sidebar
- 不修改 AgentRun 页面文件以外的任何文件
- 不修改后端 API 或数据模型

## 参考

- design.md 中的决策 1（移除 max-w-6xl）和决策 2（同时移除 mx-auto）
- plan.md 中 task-01 描述
- 模块文档：`.sillyspec/docs/SillyHub/modules/agent.md`（Agent 模块后端，本次不涉及后端修改）

## TDD 步骤

1. 此任务为单行 CSS 类名变更，无需编写自动化测试
2. 通过视觉验证（task-02）确认效果
3. 通过 TypeScript 编译检查确认无类型错误

## 验收标准

| # | 验证步骤 | 通过标准 |
|---|---|---|
| AC-01 | 检查 agent/page.tsx 第 380 行 className | 不包含 `max-w-6xl` 和 `mx-auto` |
| AC-02 | 检查修改后的 className | 包含 `flex`、`flex-col`、`gap-5`、`px-6`、`py-6` |
| AC-03 | TypeScript 编译 | 无编译错误 |
| AC-04 | 页面渲染 | 页面正常渲染，无白屏或布局错乱 |
| AC-05 | 页面宽度 | 内容区填满 AppShell 主内容区，不再受 1152px（6xl）最大宽度限制 |
