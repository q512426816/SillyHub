---
id: task-05
title: 根 page.tsx Bootstrap run 迁移到 <AgentRunPanel>
priority: P0
estimated_hours: 3
depends_on: [task-03]
blocks: [task-08]
requirement_ids: [FR-01]
decision_ids: [D-002@v1]
allowed_paths:
  - frontend/src/app/(dashboard)/workspaces/[id]/page.tsx
created_at: 2026-06-22T11:24:44+08:00
author: qinyi
---

# task-05 根 page.tsx Bootstrap run 迁移到 `<AgentRunPanel>`

依据文档：
- design.md §5.1（分层：4 调用点 → `<AgentRunPanel>` → `useAgentRunStream` → `AgentRunStreamClient`）、§6（文件变更清单：根 `page.tsx` Bootstrap run 改用 `<AgentRunPanel>`；删 `connectBootstrapStream`/`bootstrapLogs`/`bootstrapPerms`/`bsInput*`）、§7.2（AgentRunPanel props 契约）、§9（brownfield 兼容策略：未使用 AgentRunPanel 的页面行为不变）
- requirements.md FR-01（单一 SSE 客户端：调用点不再直接使用 SSE 客户端，统一经 hook → AgentRunStreamClient）
- plan.md W3 task-05（依赖 task-03，阻塞 task-08；根 page.tsx 迁移）
- task-03 蓝图（AgentRunPanel props 契约，§接口定义：workspaceId/runId/isActive + title/emptyText?/summary?/actions?/compact?/variant?/maxHeightClass?/isLive? + onDone?/onClose?；`onDone` 透传 hook；`onClose` 自动追加关闭按钮到 actions）

## 修改文件

| 操作 | 文件 | 说明 |
|---|---|---|
| 修改 | `frontend/src/app/(dashboard)/workspaces/[id]/page.tsx` | 把 Bootstrap/scan run 的 SSE 连接 + 状态管理整体替换为一行 `<AgentRunPanel>`；删除 connectBootstrapStream/streamClientRef/bootstrapLogs/bootstrapPerms/bsInput*/bootstrapStreamStatus 等胶水；保留 activeBootstrapRunId/lastBsRun/bootstrapStatus/bootstrapError + 简化 closeBootstrapPanel；load() 恢复 in-progress run 时仅设状态、不再 connectBootstrapStream |

> 本任务不新增/不修改任何其他文件。`AgentRunPanel`（task-03）与 `useAgentRunStream`（task-01）已完成，本任务只消费。

## 覆盖来源

| 需求/决策 | 覆盖点 | 验证 |
|---|---|---|
| FR-01 | 根 page.tsx 不再直接 `new AgentRunStreamClient`/`streamClientRef.current`，Bootstrap run 经 `<AgentRunPanel>` → `useAgentRunStream` → `AgentRunStreamClient` 统一链路 | grep `connectBootstrapStream` / `streamClientRef` / `AgentRunStreamClient` / `bootstrapLogs` / `bootstrapPerms` 在本文件无结果 |
| D-002@v1 | 抽象层次 = hook + 面板组件；调用点收敛为一行 JSX，零 SSE 胶水 | 代码 review：Bootstrap 区只剩 `<AgentRunPanel .../>` + 状态来源（activeBootstrapRunId/bootstrapStatus/bootstrapError） |
| （间接）FR-02/FR-06/FR-07 | 通过 AgentRunPanel → useAgentRunStream 间接覆盖 hook 封装/isActive 语义/dialog 恢复 | task-01/02 已交付，本任务验证集成 |

## 实现要求

### 1. import 调整

**新增**：
```tsx
import { AgentRunPanel } from "@/components/agent-run-panel";
import { useCallback } from "react";  // 若已有 React import 则用 React.useCallback
```

**删除**（以下 import 在本文件不再使用，清掉）：
- `AgentLogViewer`（来自 `@/components/agent-log-viewer`）— Bootstrap 区不再直接渲染 viewer
- `AgentRunStreamClient, type StreamStatus`（来自 `@/lib/agent-stream`）— 不再 new client
- `fetchPendingDialogs, type SessionPermissionRequest`（来自 `@/lib/daemon`）— dialog 恢复移入 hook
- `submitAgentRunInput`（来自 `@/lib/agent`）— input 提交移入 hook
- `AgentRunLogEntry`（来自 `@/lib/agent`）— 不再维护本地 logs 数组
- `safeUUID`（来自 `@/lib/api`）— 不再生成占位 log id
- `asString`（来自 `@/lib/utils`）— 不再本地拼 log content
- `useRef`（若 React import 列表中只有它未用，可从 `react` import 中删；若 `useState`/`useEffect`/`useCallback` 仍用则保留）

> `useSession`（stores/session）原用于 `connectBootstrapStream` 取 `accessToken`；迁移后 token 由 hook 内部获取（design §7.2 "token 来源：hook 内部 useSession.getState().accessToken"）。检查 `useSession` 是否还被本文件其他逻辑用 —— 若仅 Bootstrap 用，则一并删除 import。

### 2. 删除清单（状态 + 函数 + 渲染）

**删除以下 state**（:128-149）：
- `bootstrapLogs` / `setBootstrapLogs`
- `bsInputValues` / `setBsInputValues`
- `bsSubmittingInputs` / `setBsSubmittingInputs`
- `bsRepliedInputs` / `setBsRepliedInputs`
- `bsInputErrors` / `setBsInputErrors`
- `bootstrapStreamStatus` / `setBootstrapStreamStatus`
- `bootstrapPerms` / `setBootstrapPerms`
- `streamClientRef`（useRef）

**删除以下函数/helper**：
- `closeBootstrapStream`（:260-263）
- `connectBootstrapStream`（:284-342，整段删）
- `handleBsSubmitInput`（:393-426，整段删）

**删除渲染中的本地 SSE 状态重置逻辑**：
- `handleBootstrap`（:346-370）内对 `bsInputValues`/`bsSubmittingInputs`/`bsRepliedInputs`/`bsInputErrors`/`bootstrapPerms`/`bootstrapLogs` 的 set 调用全部删除；只保留 `setActiveBootstrapRunId(null)` + `setBootstrapStatus(null)` + `setBootstrapError(null)` 重置（其余状态由新 run 的 panel 实例自行初始化）。`closeBootstrapStream()` 调用删除。新增 run 的 `connectBootstrapStream(result.agent_run_id)` 调用删除（panel 按 runId/isActive 自动连）。
- `closeBootstrapPanel`（:265-277）内对已删 state 的 set 全部删除，仅保留 setActiveBootstrapRunId(null) + setBootstrapStatus(null) + setBootstrapError(null)。

**删除 useEffect cleanup 中的 streamClientRef disconnect**（:248-256）：
- `return () => { streamClientRef.current?.disconnect(); streamClientRef.current = null; };` 改为无 cleanup 或仅依赖 React 默认卸载（panel 卸载时 hook 内部 useEffect cleanup 会 disconnect，design §7.1 已保证）。

**删除 load() 内的 SSE 恢复 + dialog 恢复逻辑**（:206-234）：
- 删除 `connectBootstrapStream(activeRun.id)` 调用
- 删除 `fetchPendingDialogs(activeRun.session_id)` 调用块（dialog 恢复移入 hook，FR-07）
- 删除 `!streamClientRef.current &&` 条件（不再需要 ref 去重）
- 保留：`setActiveBootstrapRunId(activeRun.id)` + `setBootstrapStatus(activeRun.status)`（panel 按 runId + isActive={status pending/running} 自动连）
- `setBootstrapLogs([])` 删除（无此 state；panel 内部 logs 由 hook 管理）

### 3. 替换为 `<AgentRunPanel>` 的 JSX

把 :673-710 的 Bootstrap SSE log panel（含 `<AgentLogViewer ...>` + `bootstrapError` 展示）整体替换为：

```tsx
{activeBootstrapRunId && (
  <div className="mb-3">
    <AgentRunPanel
      workspaceId={workspaceId}
      runId={activeBootstrapRunId}
      isActive={bootstrapStatus === "running" || bootstrapStatus === "pending"}
      title="初始化运行"
      emptyText="等待日志输出..."
      isLive={bootstrapStatus === "running" || bootstrapStatus === "pending"}
      summary={
        <Badge variant={statusToVariant(bootstrapStatus)}>
          {bootstrapStatus ?? "等待中"}
        </Badge>
      }
      onClose={closeBootstrapPanel}
      onDone={handleBootstrapRunDone}
    />
    {bootstrapError && (
      <p className="mt-2 text-xs text-destructive">{bootstrapError}</p>
    )}
  </div>
)}
```

> `actions` 不显式传：task-03 蓝图 §边界处理 #5 约定，传 `onClose` 后 panel 自动在 actions 区追加"关闭"按钮，等价于原 `<Button onClick={closeBootstrapPanel}>关闭</Button>`。如需保留原视觉（ghost 样式），task-03 已定 button variant="ghost"。

### 4. 新增 `handleBootstrapRunDone` 回调（useCallback 包裹）

`onDone` 是 hook useEffect deps（task-01 提醒：onDone 引用变化会触发 SSE 重连），**必须 useCallback 包裹**避免每次渲染重新建函数导致 panel 重连：

```tsx
const handleBootstrapRunDone = useCallback((status: string) => {
  setBootstrapStatus(status as AgentRunStatus);
  void load();
}, [workspaceId]);  // load 闭包了 workspaceId；若 load 用 useCallback 包装更好（见边界处理 #3）
```

> 原 `connectBootstrapStream` 内 `client.onDone` 做了 `setBootstrapStatus(data.status)` + `client.disconnect()` + `void load()`。迁移后：
> - `setBootstrapStatus(status)` → onDone 回调内完成
> - `client.disconnect()` → panel/hook 内部 useEffect 收到 done 后自动停止（isActive 变 false，cleanup disconnect，design §7.1 / R-01）
> - `void load()` → onDone 回调内完成（刷新 lastBsRun/lastBsRun 等聚合状态）

### 5. 保留项（清单）

以下 state / 函数 / 渲染**保持原样**，不删除：

- `activeBootstrapRunId` / `setActiveBootstrapRunId`（panel runId 来源）
- `bootstrapStatus` / `setBootstrapStatus`（panel isActive/isLive 来源；onDone 更新）
- `bootstrapError` / `setBootstrapError`（panel 外部错误展示；hook 内部 error 由 panel 自身处理，本 error 只承载 bootstrapSpecWorkspace 调用等父级错误）
- `lastBsRun` / `setLastBsRun` + 历史 run 展示（:640-671，**非目标**）
- `bootstrapping` / `generatingProjects` / 其他与 Bootstrap 无关的 state
- `closeBootstrapPanel`（简化版，见边界处理 #4）
- `handleBootstrap`（简化版，见实现要求 §2）
- `load()`（简化版：保留 in-progress run 检测 + 设状态，删 connectBootstrapStream/fetchPendingDialogs）
- `bsRunStatus` / `BS_STATUS_LABEL` / `statusToVariant` / `fmtDuration` / `formatTs`（渲染 helper，仍被历史 run 区使用）
- 其他 section（基本信息 / 默认智能体 / 概览卡片 / Spec Workspace 详情 / 快速导航）完全不动

## 边界处理

| # | 场景 | 处理 | 依据 |
|---|---|---|---|
| 1 | `activeBootstrapRunId === null` | 不渲染 panel（`{activeBootstrapRunId && ...}` 短路）；hook 不连 SSE（panel 未挂载）；展示历史 run 区或空态引导 | 原 :628/640 逻辑保留 |
| 2 | `onDone` 必须引用稳定 | 用 `useCallback` 包裹，deps 含 `workspaceId`（load 闭包）；**禁止**每次渲染新建函数，否则 hook useEffect deps 抖动触发 SSE 重连 | task-01 提醒 + design R-01 |
| 3 | `load()` 恢复 in-progress run | 保留 `listAgentRuns` + filter `change_id == null` + 取最新一条 + 若 status∈{pending,running} 则 `setActiveBootstrapRunId` + `setBootstrapStatus`；**不再** `connectBootstrapStream`（panel 按 runId + isActive 自动连）；**不再** `fetchPendingDialogs`（hook FR-07 内部恢复）。条件简化：去掉 `!streamClientRef.current && activeBootstrapRunId !== activeRun.id` 的 ref 检查，仅保留 `activeBootstrapRunId !== activeRun.id` 避免重复 set | FR-07 / design §7.3 |
| 4 | `closeBootstrapPanel` 简化 | 仅 `setActiveBootstrapRunId(null)` + `setBootstrapStatus(null)` + `setBootstrapError(null)`；不再 disconnect stream（panel 卸载 → hook cleanup → disconnect）；不再重置已删 state（logs/perms/bsInput*/streamStatus 由 panel 卸载自然销毁） | D-002 分层 |
| 5 | `bootstrapError` 展示分工 | 父级错误（bootstrapSpecWorkspace 调用失败、handleBootstrap catch）仍走 `setBootstrapError` + 外部 `<p>` 展示；SSE 内部错误（连接失败/重连失败）由 hook 返回 error，panel 内部 AgentLogViewer 展示，不与父级 bootstrapError 混淆。原 connectBootstrapStream 内 `setBootstrapError("连接失败，请重试")` / `"会话已失效..."` 两处 SSE 错误文案**删除**（由 hook/panel 接管） | design §7.1 hook 返回 error |
| 6 | `handleBootstrap` 新 run 建立 | 删除所有已删 state 的重置；删除 `closeBootstrapStream()`；删除 `connectBootstrapStream(result.agent_run_id)`；保留 `setActiveBootstrapRunId(result.agent_run_id)` + `setBootstrapStatus(result.status)`（panel 随即按新 runId 连新 SSE） | D-002 |
| 7 | useEffect cleanup | 删除 `streamClientRef.current?.disconnect()`；保留 `void load()` 触发。panel 卸载时 hook 内部 useEffect cleanup 负责断开 SSE（design R-01 已保证） | R-01 |
| 8 | `isActive` 派生 | `isActive={bootstrapStatus === "running" || bootstrapStatus === "pending"}`；onDone 回调 `setBootstrapStatus(status)` 后，若 status∈{completed,failed,killed}，isActive 变 false → hook 切换为"仅 prefetch 历史"模式（design D-001），不再尝试连 SSE | D-001 / FR-06 |
| 9 | `isLive` 徽标 | 与 isActive 同公式；传给 panel 透传 viewer.isLive，原视觉行为不变 | 原 :682 |

## 非目标

- **不改 `lastBsRun` 历史 run 展示**（:640-671 的 `<div>` + Badge + 生成项目组件按钮）—— 历史 finished run 走一次性 listAgentRuns，非流式，design §3 非目标明确不接管。
- **不碰其他 section**：基本信息 / 默认智能体 / 概览卡片 / Spec Workspace 详情 `<dl>` / 快速导航 完全不动。
- **不改 `AgentRunPanel` 组件**（task-03 负责）。
- **不改 `useAgentRunStream` hook**（task-01 负责）。
- **不改 `AgentRunStreamClient`**（复用现有 class）。
- **不改后端/daemon**（design §3 / 全局验收：`git diff backend sillyhub-daemon` 为空）。
- **不迁移 agent/page.tsx 和 changes/[cid]/page.tsx**（task-06/07 各自独立提交，本任务只处理根 page.tsx）。
- **不删 `streamAgentRunLogs`**（task-08 在所有调用点迁移完后统一删；根 page.tsx 用的是 AgentRunStreamClient，本任务不涉及该函数）。
- **不写新测试**（本任务是调用点机械迁移，靠 tsc/lint/test 兜底；permission 卡片端到端测试在 task-04）。

## 参考

- design.md §5.1 分层、§6 文件清单、§7.2 AgentRunPanel props、§7.3 生命周期契约（done 事件 → onDone）、§9 兼容策略、§10 R-01（cleanup disconnect）、§13 X-005（token 来源由 hook 接管）
- requirements.md FR-01（单一 SSE 客户端）、FR-07（dialog 恢复移入 hook）
- plan.md W3 task-05、覆盖矩阵 D-002@v1（task-05 验收证据：调用点渲染 `<AgentRunPanel>`）
- task-03 蓝图 §接口定义（AgentRunPanelProps 13 个 prop）、§边界处理 #5（onClose 自动追加关闭按钮）、§实现要求 4（onDone 透传 hook）
- 源码 `frontend/src/app/(dashboard)/workspaces/[id]/page.tsx`：
  - state 声明 :128-149（bootstrapLogs/bootstrapPerms/bsInput*/bootstrapStreamStatus/streamClientRef）
  - load() 恢复 in-progress run :206-234
  - useEffect cleanup :248-256
  - closeBootstrapStream :260-263 / closeBootstrapPanel :265-277
  - connectBootstrapStream :284-342
  - handleBootstrap :346-370
  - handleBsSubmitInput :393-426
  - Bootstrap AgentLogViewer 渲染 :673-710

## TDD 步骤

> 本任务是调用点机械迁移（删胶水 + 替换 JSX），无新增可测单元；遵循 CLAUDE.md 执行顺序"读现有代码 → 改实现 → 跑测试 → 验收"，靠 tsc/lint/test 兜底。

1. **读现有代码**：已读 page.tsx（state 声明、load、connectBootstrapStream、handleBootstrap、handleBsSubmitInput、closeBootstrapPanel、Bootstrap 渲染区）、task-03 蓝图（AgentRunPanel props 契约）、task-01 蓝图（hook onDone 语义）。
2. **改实现**：按本蓝图 §实现要求 1-5 + §边界处理 表逐项修改 page.tsx。
3. **跑 typecheck**：`cd frontend && pnpm typecheck` —— 删除 import 后若仍有残留引用，tsc 报错兜底（unused var / undefined symbol）。
4. **跑 lint**：`cd frontend && pnpm lint` —— 确保无 unused import / any / 规则违规。
5. **跑 test**：`cd frontend && pnpm test` —— 现有测试全过（本任务不新增测试，但不应破坏既有快照/render 测试）。
6. **grep 确认无残留**：见验收标准 #5-#8。
7. **手动验收（建议，execute 阶段）**：启动 frontend，进入工作区首页 → 点击"初始化" → 观察 panel 渲染、日志实时滚动、done 后 status 切换、closeBootstrapPanel 关闭面板、刷新页面恢复 in-progress run。

## 验收标准

| # | 标准 | 验证方法 |
|---|---|---|
| 1 | `frontend/src/app/(dashboard)/workspaces/[id]/page.tsx` 内渲染 `<AgentRunPanel workspaceId={workspaceId} runId={activeBootstrapRunId} isActive={...} title="初始化运行" onClose={closeBootstrapPanel} onDone={handleBootstrapRunDone} ... />` | 代码 review |
| 2 | `handleBootstrapRunDone` 用 `useCallback` 包裹（deps 至少含 workspaceId） | 代码 review + grep `useCallback.*handleBootstrapRunDone` |
| 3 | `handleBootstrap` 简化：仅 setActiveBootstrapRunId + setBootstrapStatus + setBootstrapError；不再调 connectBootstrapStream/closeBootstrapStream | 代码 review |
| 4 | `load()` 恢复 in-progress run：仅 setActiveBootstrapRunId + setBootstrapStatus；不再 connectBootstrapStream / fetchPendingDialogs | 代码 review |
| 5 | `grep -n connectBootstrapStream frontend/src/app/(dashboard)/workspaces/[id]/page.tsx` 无结果 | grep |
| 6 | `grep -n streamClientRef frontend/src/app/(dashboard)/workspaces/[id]/page.tsx` 无结果 | grep |
| 7 | `grep -n "bootstrapLogs\|bootstrapPerms\|bsInputValues\|bsSubmittingInputs\|bsRepliedInputs\|bsInputErrors\|bootstrapStreamStatus" frontend/src/app/(dashboard)/workspaces/[id]/page.tsx` 无结果 | grep |
| 8 | `grep -n "AgentRunStreamClient\|StreamStatus" frontend/src/app/(dashboard)/workspaces/[id]/page.tsx` 无结果 | grep |
| 9 | `grep -n "handleBsSubmitInput" frontend/src/app/(dashboard)/workspaces/[id]/page.tsx` 无结果 | grep |
| 10 | `closeBootstrapPanel` 简化为仅 setActiveBootstrapRunId(null) + setBootstrapStatus(null) + setBootstrapError(null) | 代码 review |
| 11 | `lastBsRun` 历史 run 展示区（:640-671 原行号附近）保持原样 | 代码 review（diff 仅在 Bootstrap panel 区 + state/handler 声明区） |
| 12 | `cd frontend && pnpm typecheck` exit 0 | tsc 通过 |
| 13 | `cd frontend && pnpm lint` exit 0（无 unused import / any） | eslint 通过 |
| 14 | `cd frontend && pnpm test` exit 0（既有测试不被破坏） | vitest 通过 |
| 15 | `git diff --name-only` 仅含 `frontend/src/app/(dashboard)/workspaces/[id]/page.tsx` | diff 检查 |
