---
author: qinyi
created_at: 2026-05-30T19:00:00
id: task-09
title: Agent Run 列表页
priority: P0
estimated_hours: 2
depends_on: [task-08]
blocks: []
allowed_paths:
  - frontend/src/app/(dashboard)/workspaces/[id]/agent/page.tsx
  - frontend/src/components/agent/AgentRunCard.tsx
---

# task-09: Agent Run 列表页

## 修改文件（必填）

- **新增** `frontend/src/app/(dashboard)/workspaces/[id]/agent/page.tsx` — Agent Run 列表页面
- **新增** `frontend/src/components/agent/AgentRunCard.tsx` — 单条 Run 卡片组件

## 实现要求

在 Workspace 仪表盘下新增 Agent Run 列表页面，展示该 Workspace 下所有 Agent Run 记录。每条 Run 以卡片形式展示，包含状态 badge、时间信息、agent 类型、操作按钮。

### 页面布局

```
┌──────────────────────────────────────────────────┐
│ ← Workspaces / {name}                            │
│ Agent Runs                          [+ New Run]  │
│ 查看此工作区下的所有 Agent 执行记录                 │
├──────────────────────────────────────────────────┤
│ ┌──────────────────────────────────────────────┐ │
│ │ Run #1           [running]  claude_code      │ │
│ │ Started 2 min ago                             │ │
│ │ Task: {task_name}                             │ │
│ │                        [View Detail →]       │ │
│ └──────────────────────────────────────────────┘ │
│ ┌──────────────────────────────────────────────┐ │
│ │ Run #2           [completed]  claude_code    │ │
│ │ Finished 5 min ago                            │ │
│ │ 3 files changed, 10 insertions, 2 deletions  │ │
│ │                        [View Detail →]       │ │
│ └──────────────────────────────────────────────┘ │
│ ┌──────────────────────────────────────────────┐ │
│ │ Run #3           [failed]  claude_code       │ │
│ │ Finished 1 hour ago                           │ │
│ │ Exit code: 1                                  │ │
│ │                        [View Detail →]       │ │
│ └──────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────┘
```

### 状态 Badge 颜色映射

| 状态 | Badge variant | 颜色 |
|---|---|---|
| `pending` | `outline` | 灰色 |
| `running` | `default` | 蓝色（primary） |
| `completed` | `success` | 绿色 |
| `failed` | `destructive` | 红色 |
| `killed` | `warning` | 琥珀色 |

### 页面行为

1. 进入页面时加载 run 列表（`listAgentRuns`）
2. 如果有 running 状态的 run，每 5 秒轮询刷新（或使用 SSE）
3. 点击卡片跳转到详情页 `/workspaces/{id}/agent/{runId}`
4. 空状态显示引导文案
5. 错误状态显示错误信息

## 接口定义（代码类任务必填）

### page.tsx Props

```typescript
interface Props {
  params: { id: string };
}
```

### AgentRunCard Props

```typescript
interface AgentRunCardProps {
  run: AgentRun;
  workspaceId: string;
}
```

### 状态映射辅助函数

```typescript
function statusVariant(status: AgentRunStatus): BadgeProps["variant"] {
  switch (status) {
    case "pending": return "outline";
    case "running": return "default";
    case "completed": return "success";
    case "failed": return "destructive";
    case "killed": return "warning";
  }
}
```

### 时间格式化

```typescript
function formatRelativeTime(dateStr: string | null): string {
  if (!dateStr) return "—";
  // 简单的相对时间显示
  const diff = Date.now() - new Date(dateStr).getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "刚刚";
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  const days = Math.floor(hours / 24);
  return `${days} 天前`;
}
```

## 边界处理（必填）

1. **空列表**：显示"还没有 Agent Run 记录"引导文案
2. **加载失败**：显示错误信息，提供重试按钮
3. **loading 状态**：显示"加载中..."占位
4. **run 数量很多**：当前不分页，前端显示全量列表（后端已有分页支持）
5. **状态轮询**：只在有 running 状态的 run 时启用轮询，全部结束后停止
6. **diff_summary 显示**：completed 状态的 run 如果有 diff_summary，显示简要变更统计

## 非目标（本任务不做的事）

- 不实现创建新 Run 的功能（未来迭代）
- 不实现分页（当前数据量小，YAGNI）
- 不实现筛选/排序（未来迭代）
- 不实现 SSE 实时推送列表更新（使用轮询即可）
- 不修改后端代码

## 参考

- 现有列表页模式：`frontend/src/app/(dashboard)/workspaces/page.tsx`
- 现有卡片组件模式：`frontend/src/components/workspace-card.tsx`
- Badge 组件：`frontend/src/components/ui/badge.tsx`
- Button 组件：`frontend/src/components/ui/button.tsx`
- API 客户端：`frontend/src/lib/agent.ts` — `listAgentRuns` 函数
- design.md AD-4：前端连接策略

## TDD 步骤

### 步骤 1：创建 AgentRunCard 组件

```tsx
// frontend/src/components/agent/AgentRunCard.tsx
"use client";

import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import type { AgentRun, AgentRunStatus } from "@/lib/agent";
```

### 步骤 2：创建列表页面

```tsx
// frontend/src/app/(dashboard)/workspaces/[id]/agent/page.tsx
"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { AgentRunCard } from "@/components/agent/AgentRunCard";
import { ApiError } from "@/lib/api";
import { listAgentRuns, type AgentRun } from "@/lib/agent";
```

### 步骤 3：确认 build 通过

```bash
cd frontend
npx next build
```

### 步骤 4：类型检查

```bash
npx tsc --noEmit
```

## 验收标准

| # | 验证步骤 | 通过标准 |
|---|---|---|
| AC-01 | 页面文件存在于正确路径 | `frontend/src/app/(dashboard)/workspaces/[id]/agent/page.tsx` 存在 |
| AC-02 | 组件文件存在于正确路径 | `frontend/src/components/agent/AgentRunCard.tsx` 存在 |
| AC-03 | 页面加载时调用 `listAgentRuns` | 网络请求正确发出 |
| AC-04 | 5 种状态 badge 颜色正确 | pending=灰, running=蓝, completed=绿, failed=红, killed=琥珀 |
| AC-05 | 点击卡片跳转正确 | 链接到 `/workspaces/{id}/agent/{runId}` |
| AC-06 | 空列表显示引导文案 | 无 run 时显示提示信息 |
| AC-07 | loading / error 状态正确 | 加载中显示占位，失败显示错误 |
| AC-08 | diff_summary 摘要显示 | completed run 卡片显示变更统计 |
| AC-09 | TypeScript 编译通过 | `npx tsc --noEmit` 无错误 |
| AC-10 | Next.js build 通过 | `npx next build` 成功 |
