---
author: qinyi
created_at: 2026-05-30T19:00:00
id: task-10
title: Agent Run 详情页 + SSE 日志流
priority: P0
estimated_hours: 3
depends_on: [task-08]
blocks: []
allowed_paths:
  - frontend/src/app/(dashboard)/workspaces/[id]/agent/[runId]/page.tsx
  - frontend/src/components/agent/AgentLogStream.tsx
---

# task-10: Agent Run 详情页 + SSE 日志流

## 修改文件（必填）

- **新增** `frontend/src/app/(dashboard)/workspaces/[id]/agent/[runId]/page.tsx` — Agent Run 详情页面
- **新增** `frontend/src/components/agent/AgentLogStream.tsx` — SSE 实时日志流组件

## 实现要求

### A. 详情页

展示单条 Agent Run 的完整信息，包含：

1. **基本信息区**：run_id、agent_type、status badge、创建时间、开始时间、结束时间、exit_code
2. **Diff Summary 区**：如果 `diff_summary` 非 null，展示文件变更统计（使用 `<pre>` 格式保留原格式）
3. **日志流区**：实时展示 Agent 执行日志（通过 SSE 连接后端 `/stream` 端点）
4. **Kill 按钮**：仅当 status 为 `running` 或 `pending` 时显示，点击后调用 `killAgentRun`
5. **返回链接**：面包屑导航回列表页

### B. AgentLogStream 组件

独立的 SSE 日志流组件，职责：

1. 使用 `streamAgentRunLogs` 建立 SSE 连接
2. 实时显示日志消息（自动滚动到底部）
3. 连接断开后自动尝试加载历史日志（`getAgentRunLogs`）
4. 显示连接状态指示器
5. Run 结束后（收到 `done` 事件或 status 非 running）停止连接

### 页面布局

```
┌──────────────────────────────────────────────────┐
│ ← Agent Runs                                     │
│                                                   │
│ Run Detail                          [Kill Run]   │
│ ─────────────────────────────────────────────────│
│ Status:   [running]                               │
│ Agent:    claude_code                             │
│ Started:  2 分钟前                                │
│ Run ID:   abc-def-123                             │
│                                                   │
│ ── File Changes ─────────────────────────────────│
│  3 files changed, 10 insertions(+),              │
│  2 deletions(-)                                   │
│  src/foo.py   | 8 +++++---                        │
│  src/bar.py   | 2 +-                              │
│                                                   │
│ ── Live Log ─────────────────────────────────────│
│ ┌──────────────────────────────────────────────┐ │
│ │ ● Connected                                   │ │
│ │ [12:00:01] Starting agent execution...        │ │
│ │ [12:00:02] Reading task context...            │ │
│ │ [12:00:05] Executing: edit file foo.py        │ │
│ │ [12:00:08] ✓ File modified successfully       │ │
│ │ ▼ (auto-scroll)                               │ │
│ └──────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────┘
```

### Kill 按钮行为

1. 仅 `running` / `pending` 状态显示
2. 点击后弹出确认对话框（`window.confirm`）
3. 确认后调用 `killAgentRun`
4. 成功后刷新页面数据（status 变为 killed）
5. 失败时显示错误 toast（简单的错误信息展示）

### SSE 连接策略

1. 页面加载时检查 run status
2. 如果 status 为 `pending` 或 `running`，建立 SSE 连接
3. 如果 status 为终态（completed/failed/killed），直接加载历史日志
4. SSE 收到 `done` 事件后关闭连接，刷新 run 状态
5. 连接错误时显示重连提示，3 秒后自动重试（最多 3 次）

## 接口定义（代码类任务必填）

### page.tsx Props

```typescript
interface Props {
  params: { id: string; runId: string };
}
```

### AgentLogStream Props

```typescript
interface AgentLogStreamProps {
  workspaceId: string;
  runId: string;
  isLive: boolean;  // true = SSE 连接, false = 仅历史日志
}

interface LogEntry {
  timestamp: string;
  channel: "stdout" | "stderr" | "tool_call";
  content: string;
}
```

### Kill 确认流程伪代码

```typescript
async function handleKill() {
  if (!confirm("确定要终止此 Agent Run？")) return;
  setKilling(true);
  try {
    await killAgentRun(workspaceId, runId);
    // 刷新 run 数据
    const updated = await getAgentRun(workspaceId, runId);
    setRun(updated);
  } catch (err) {
    setError(err instanceof ApiError ? err.message : "终止失败");
  } finally {
    setKilling(false);
  }
}
```

### AgentLogStream SSE 伪代码

```typescript
useEffect(() => {
  if (!isLive) {
    // 加载历史日志
    getAgentRunLogs(workspaceId, runId).then(setLogs);
    return;
  }

  const es = streamAgentRunLogs(
    workspaceId,
    runId,
    (event) => {
      setLogs(prev => [...prev, {
        timestamp: event.timestamp,
        channel: event.channel,
        content: event.content,
      }]);
    },
    () => {
      setConnected(false);
      onDone?.();  // 通知父组件刷新状态
    },
    (err) => {
      setError(err.message);
    },
  );

  setConnected(true);
  return () => es.close();
}, [workspaceId, runId, isLive]);
```

## 边界处理（必填）

1. **Run 不存在**：显示 404 错误页面（简单的错误文案 + 返回列表按钮）
2. **Kill 失败（409）**：显示"Run 已结束"提示，刷新状态
3. **Kill 失败（403）**：显示"无权限"提示
4. **SSE 连接失败**：显示连接错误 + 重试按钮，3 秒后自动重试
5. **diff_summary 为 null**：不显示 File Changes 区域
6. **日志为空**：显示"暂无日志"占位文案
7. **长日志性能**：日志条目超过 500 条时只显示最后 500 条（虚拟滚动 YAGNI，简单截断）
8. **Kill 按钮防重复点击**：killing 状态时禁用按钮

## 非目标（本任务不做的事）

- 不实现虚拟滚动（日志量可控，YAGNI）
- 不实现日志搜索/过滤（未来迭代）
- 不实现日志导出（未来迭代）
- 不实现自定义主题/语法高亮（日志为纯文本）
- 不修改后端 SSE 端点

## 参考

- design.md AD-4：前端 SSE 连接策略 — 使用原生 EventSource API
- 现有 SSE 实现：`frontend/src/lib/agent.ts` — `streamAgentRunLogs` 函数
- 后端 SSE 端点：`backend/app/modules/agent/router.py` — `stream_agent_run_logs`
- Badge 组件：`frontend/src/components/ui/badge.tsx`
- Button 组件：`frontend/src/components/ui/button.tsx`
- 现有页面模式：`frontend/src/app/(dashboard)/workspaces/[id]/page.tsx`

## TDD 步骤

### 步骤 1：创建 AgentLogStream 组件

```tsx
// frontend/src/components/agent/AgentLogStream.tsx
"use client";

import { useEffect, useRef, useState } from "react";
import {
  getAgentRunLogs,
  streamAgentRunLogs,
} from "@/lib/agent";
```

### 步骤 2：创建详情页面

```tsx
// frontend/src/app/(dashboard)/workspaces/[id]/agent/[runId]/page.tsx
"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { AgentLogStream } from "@/components/agent/AgentLogStream";
import { ApiError } from "@/lib/api";
import {
  getAgentRun,
  killAgentRun,
  type AgentRun,
} from "@/lib/agent";
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
| AC-01 | 详情页文件存在于正确路径 | `frontend/src/app/(dashboard)/workspaces/[id]/agent/[runId]/page.tsx` |
| AC-02 | AgentLogStream 组件存在 | `frontend/src/components/agent/AgentLogStream.tsx` |
| AC-03 | 页面加载时获取 run 数据 | `getAgentRun` 被调用 |
| AC-04 | running/pending 状态显示 Kill 按钮 | 按钮可见且可点击 |
| AC-05 | Kill 成功后状态更新 | status 变为 killed，Kill 按钮消失 |
| AC-06 | SSE 连接在 running 时建立 | `streamAgentRunLogs` 被调用，日志实时显示 |
| AC-07 | 终态 run 显示历史日志 | `getAgentRunLogs` 被调用，无 SSE 连接 |
| AC-08 | diff_summary 展示正确 | `<pre>` 格式显示，null 时不显示该区域 |
| AC-09 | Run 不存在时显示 404 | 错误文案 + 返回按钮 |
| AC-10 | 日志自动滚动到底部 | 新日志到达时自动滚动 |
| AC-11 | TypeScript 编译通过 | `npx tsc --noEmit` 无错误 |
| AC-12 | Next.js build 通过 | `npx next build` 成功 |
