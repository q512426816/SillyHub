---
id: task-03
title: 新增 AgentRunPanel 组件
priority: P0
estimated_hours: 3
depends_on: [task-01]
blocks: [task-04, task-05, task-06, task-07]
requirement_ids: [FR-03, FR-05]
decision_ids: [D-002@v1, D-003@v1]
allowed_paths:
  - frontend/src/components/agent-run-panel.tsx
created_at: 2026-06-22T11:24:44+08:00
author: qinyi
---

# task-03 新增 AgentRunPanel 组件

依据文档：
- design.md §5.1（分层）、§7.2（AgentRunPanel props）、§7.3（生命周期契约）、§13 X-002/X-004（input 适配 / loading 来源）
- requirements.md FR-03（面板组件）、FR-05（pending_input 纳入 + UI 统一）
- plan.md W2 task-03

## 修改文件

| 操作 | 文件 | 说明 |
|---|---|---|
| 新增 | `frontend/src/components/agent-run-panel.tsx` | AgentRunPanel 组件（client component），内部调 `useAgentRunStream` + 注入 `<AgentLogViewer>` |

> 本任务不改动 `agent-log-viewer.tsx`（design §3 非目标：AgentLogViewer 已支持 permissionRequests，只喂数据）。

## 覆盖来源

| 需求/决策 | 覆盖点 | 验证 |
|---|---|---|
| FR-03 | 渲染 `<AgentRunPanel>` 内部调 hook + 注入 AgentLogViewer | 组件存在 + props 签名匹配 design §7.2；调用点零 SSE 胶水 |
| FR-05 | input 适配 `AgentRunInputStream` → `AgentLogInputControls`，三处 pending_input UI 收敛为同一契约 | 字段映射代码 + 命名对齐（values→inputValues 等） |
| D-002@v1 | 抽象层次 = hook + 面板组件（panel 负责适配 + 透传，不引入第二套状态机） | 组件实现，props 显式列 + ...rest 兜底 |
| D-003@v1 | `onPermissionResolved` 仅调 `dismissPerm(requestId)` 本地移除，**不调** `respondSessionPermission`（卡片自调） | panel 内 handler 只 dismiss，不引 `respondSessionPermission` |

## 实现要求

### 1. 文件头部

```tsx
"use client";

import * as React from "react";
import { AgentLogViewer } from "@/components/agent-log-viewer";
import type { AgentLogInputControls } from "@/components/agent-log/types";
import { useAgentRunStream } from "@/lib/use-agent-run-stream";
import type { AgentRunInputStream } from "@/lib/use-agent-run-stream";
```

> `AgentRunInputStream` 由 task-01 在 `use-agent-run-stream.ts` export（design §7.1）。`AgentLogInputControls` 从 `components/agent-log/types.ts` 取（agent-log-viewer.tsx:26 复用同一类型）。

### 2. input 适配器（X-002 字段映射）

panel 负责把 hook 返回的 `AgentRunInputStream` 字段映射到 `AgentLogViewer` 期望的 `AgentLogInputControls` 契约。字段映射表：

| hook 字段（AgentRunInputStream） | viewer 字段（AgentLogInputControls） | 说明 |
|---|---|---|
| `values` | `inputValues` | Record<string, string> |
| `submitting` | `submittingInputs` | Record<string, boolean> |
| `errors` | `inputErrors` | Record<string, string> |
| `replied` | `repliedInputs` | Set<string> |
| `set` | `onChange` | (logId, value) => void |
| `submit` | `onSubmit` | (logId) => void / Promise<void> |

**伪代码**（实现采用 `React.useMemo`，依赖列表 `[input]`）：

```tsx
const adaptInputControls = (input: AgentRunInputStream): AgentLogInputControls => ({
  inputValues: input.values,
  submittingInputs: input.submitting,
  inputErrors: input.errors,
  repliedInputs: input.replied,
  onChange: (logId, value) => input.set(logId, value),
  onSubmit: (logId) => { void input.submit(logId); },
});
```

注意：
- `AgentLogInputControls.onSubmit` 类型是 `(_logId: string) => void`（types.ts:31，非 Promise）；hook 的 `input.submit` 返回 `Promise<void>`，适配时用 `void` 吞掉返回值，避免类型不匹配。
- `AgentLogViewer` 内 `inputControls.onSubmit(log.id)` 在 onKeyDown(Enter) 与 button onClick 两处调用（agent-log-viewer.tsx:314,322），适配后不引入额外闭包开销（`onChange`/`onSubmit` 经 `useMemo` 稳定引用）。

### 3. onPermissionResolved handler（D-003 本地移除）

`AgentLogViewer` 的 `onPermissionResolved?: (requestId: string, decision: "allow" | "deny") => void`（agent-log-viewer.tsx:387）。卡片（PermissionApprovalCard / AskUserDialogCard）**已自调** `respondSessionPermission`，成功后回调本 prop。panel 只做本地移除：

```tsx
const handlePermissionResolved = React.useCallback(
  (requestId: string, _decision: "allow" | "deny") => {
    dismissPerm(requestId);  // D-003：hook 暴露的本地移除，不调 API
  },
  [dismissPerm],
);
```

- `_decision` 参数接收但不使用（卡片已决策完毕，本地移除与决策方向无关）。
- 不 import `respondSessionPermission`（避免 panel 二次封装，保持 D-003 卡片自洽）。

### 4. AgentLogViewer 注入

panel 渲染 `<AgentLogViewer>`，prop 注入清单：

| AgentLogViewer prop | 来源 | 备注 |
|---|---|---|
| `title` | props.title | 显式列 |
| `runId` | props.runId ?? "" | runId=null 时降级为字符串（避免 viewer `runId: string` 报错；viewer 仅用于头部展示前 8 字符，空串安全） |
| `logs` | `logs`（hook 返回） | `AgentRunLogEntry[] \| null` |
| `loading` | `loading`（hook 返回，X-004） | 注入 |
| `emptyText` | props.emptyText ?? "暂无日志" | 兜底默认 |
| `maxHeightClass` | props.maxHeightClass | 可选透传（viewer 有默认值 `max-h-[720px]`） |
| `compact` | props.compact | 可选 |
| `variant` | props.variant | 可选 |
| `isLive` | props.isLive | 可选 |
| `summary` | props.summary | 可选 ReactNode |
| `actions` | 组合 props.actions + onClose 按钮 | 见下方 §边界处理 onClose 注入 |
| `inputControls` | `useMemo(() => adaptInputControls(input), [input])` | X-002 适配 |
| `permissionRequests` | `perms`（hook 返回） | 空数组时 viewer 自然不渲染卡片（hasPermissionCards=false） |
| `onPermissionResolved` | `handlePermissionResolved` | D-003 本地移除 |

**显式列 + ...rest 兜底（D-002，R-03）**：design §7.2 明确"显式列关键 prop + ...rest 兜底"，但 AgentLogViewer 当前是无 rest 的完整 props 列表（agent-log-viewer.tsx:350-388），实际无需 rest。本任务保守处理：**先全显式列**（所有 viewer 接受的定制 prop 都在 panel props 显式声明），不引入 `...rest` 透传（YAGNI，避免类型宽松）。如果 execute 阶段 viewer 新增定制 prop 再加 rest。

### 5. runId=null 短路（X-001 衍生）

`runId=null` 时 hook 已 guard（useEffect 不连 SSE，返回空状态）；panel 仍正常渲染 `<AgentLogViewer logs={null} loading={false}>`，展示 emptyText。panel 自身不额外短路（避免双重渲染逻辑）。调用点（task-05/06/07）负责决定是否挂载 panel。

## 接口定义（AgentRunPanelProps 完整 TS）

```tsx
// frontend/src/components/agent-run-panel.tsx

export interface AgentRunPanelProps {
  /** 工作区 ID（hook + API 请求路径用） */
  workspaceId: string;
  /** agent run ID；null 表示未选定 run（hook 不连 SSE，展示 emptyText） */
  runId: string | null;
  /** run 状态 pending/running → 连 SSE；否则仅 prefetch 历史（D-001） */
  isActive: boolean;

  // —— AgentLogViewer 定制（显式列，D-002）——
  /** 日志面板标题（透传 viewer.title，必填） */
  title: string;
  /** 空态文案，默认 "暂无日志" */
  emptyText?: string;
  /** 头部右侧摘要节点（透传 viewer.summary） */
  summary?: React.ReactNode;
  /**
   * 头部右侧操作节点（透传 viewer.actions）。
   * 若同时传 onClose，panel 自动追加一个"关闭"按钮到 actions 末尾。
   */
  actions?: React.ReactNode;
  /** 紧凑模式（透传 viewer.compact） */
  compact?: boolean;
  /** 面板/嵌入样式（透传 viewer.variant），默认 "panel" */
  variant?: "panel" | "embedded";
  /** 日志区最大高度 class（透传 viewer.maxHeightClass） */
  maxHeightClass?: string;
  /** LIVE 徽标（透传 viewer.isLive），活跃 run 建议传 true */
  isLive?: boolean;

  // —— 生命周期回调 ——
  /** run 结束（done 事件）通知父组件（透传 hook onDone） */
  onDone?: (status: string) => void;
  /** 关闭面板回调；传入后 panel 自动在 actions 区追加关闭按钮 */
  onClose?: () => void;
}

export function AgentRunPanel({
  workspaceId,
  runId,
  isActive,
  title,
  emptyText,
  summary,
  actions,
  compact,
  variant,
  maxHeightClass,
  isLive,
  onDone,
  onClose,
}: AgentRunPanelProps): JSX.Element;
```

> 签名严格对齐 design §7.2（workspaceId/runId/isActive + title/emptyText?/summary?/actions?/compact?/variant?/maxHeightClass?/isLive? + onDone?/onClose?）。`onClose` 是 panel 新增的便利 prop（design §7.2 列出），不透传 viewer（viewer 无此 prop）。

## 边界处理

| # | 场景 | 处理 | 依据 |
|---|---|---|---|
| 1 | `runId === null` | 不额外短路；hook 内部 useEffect guard 不连 SSE，返回 `logs=[]`/`perms=[]`/`loading=false`；panel 正常渲染 viewer 展示 emptyText | D-001 / X-001 |
| 2 | `perms` 为空数组 | `AgentLogViewer.hasPermissionCards` 自然为 false（agent-log-viewer.tsx:406），不渲染 ASK 卡片区；panel 不需要特殊判断 | FR-04 |
| 3 | input 字段映射类型对齐 | `input.submit` 返回 `Promise<void>`，`AgentLogInputControls.onSubmit` 期望 `void` → 适配用 `void input.submit(logId)` 吞返回值；`replied` 是 `Set<string>` 直接赋值给 `repliedInputs`（同类型） | X-002 |
| 4 | `loading` 来源缺失风险 | 必须注入 hook 返回的 `loading`（X-004 已在 design §7.1 修正 hook 返回 `loading`）；不传则 viewer 默认 `loading: boolean` 必填，TS 编译报错兜底 | X-004 |
| 5 | `onClose` 注入 | panel 检测 `onClose` 存在时，在 `actions` 末尾自动追加一个 `<Button variant="ghost" onClick={onClose}>关闭</Button>`；若 `actions` 也传入，合并为 `<>{actions}<Button.../></>`；若都为空，`actions={undefined}`，viewer 头部右侧只有过滤按钮 + 全屏按钮 | design §7.2 onClose |
| 6 | `runId !== null` 但空字符串 | 视同 null —— panel 内部若 `runId === ""` 也透传给 viewer 作为 ""，仅影响头部 `<code>` 展示（空串不崩）；hook 端 task-01 负责判 `!runId` 不连 | 健壮性 |
| 7 | `onPermissionResolved` 的 decision 参数 | 卡片回调 `(requestId, decision)`，panel 忽略 `decision`（卡片已自调 API 完成决策），只 `dismissPerm(requestId)` | D-003 |
| 8 | `isActive=false`（非活跃 run） | hook 仅 prefetch 历史，不注册 permission/input 回调；panel 仍注入 perms/input（此时均为空），viewer 正常渲染历史日志 + empty 态卡片 | FR-06 / D-001 |

## 非目标

- 不改动 `AgentLogViewer`（design §3，已支持 permissionRequests，只喂数据）。
- 不改动 `PermissionApprovalCard` / `AskUserDialogCard`（卡片自调 API 保持 D-003 卡片自洽）。
- 不实现 `...rest` 透传（YAGNI，当前 viewer props 已全显式列；execute 阶段 viewer 若新增定制 prop 再评估）。
- 不接管"已完成 run 的历史展开"（agent/page.tsx expandedLogs + 下载按钮保持直接 `<AgentLogViewer>`，design §3 非目标）。
- 不调任何后端 API（`respondSessionPermission`/`submitAgentRunInput`/`fetchPendingDialogs` 均由 hook 或卡片负责）。
- 不改 `useAgentRunStream` hook 签名（task-01 负责，本任务只消费）。
- 不写集成测试（task-04 负责；本任务只交付组件实现）。

## 参考

- design.md §5.1 分层、§7.2 AgentRunPanel props、§7.3 生命周期契约表、§13 X-002/X-004
- requirements.md FR-03、FR-05、决策覆盖矩阵 D-002@v1/D-003@v1
- plan.md W2 task-03 依赖 task-01、阻塞 task-04/05/06/07
- `frontend/src/components/agent-log-viewer.tsx:350-388`（AgentLogViewer props 契约）、`:26`（AgentLogInputControls 类型 re-export 源）、`:379`（inputControls prop）、`:385`（permissionRequests prop）、`:387`（onPermissionResolved 回调签名 `(requestId, decision)`）
- `frontend/src/components/agent-log/types.ts:25-32`（AgentLogInputControls 字段定义）
- `frontend/src/components/permission-approval-card.tsx:88-106`（卡片自调 respondSessionPermission + onResolved 回调，D-003 自洽）
- `frontend/src/lib/daemon.ts:360-390`（SessionPermissionRequest / SessionPermissionResolved 类型）、`:398`（respondSessionPermission 签名）
- `frontend/src/lib/use-agent-run-stream.ts`（task-01 新增，hook 契约见 design §7.1）

## TDD 步骤

> 本任务为组件实现（task-04 负责集成测试）。遵循 CLAUDE.md 执行顺序"读现有代码 → 写测试 → 写实现 → 跑测试 → 验收"，组件层先写最小渲染测试再补实现。

1. **读现有代码**：已读 agent-log-viewer.tsx（props 契约）、permission-approval-card.tsx（D-003 卡片自调）、types.ts（AgentLogInputControls）、daemon.ts（SessionPermissionRequest）。
2. **写最小测试**（在 `frontend/src/components/agent-run-panel.test.tsx`，task-04 会扩充，本任务先写 happy path）：
   - 渲染 `<AgentRunPanel workspaceId="ws-1" runId="run-1" isActive title="T" />` → 断言标题 "T" 出现、`AgentLogViewer` 被调用。
   - mock `useAgentRunStream` 返回 `{ logs: [], perms: [], input: {...}, loading: false, ... }` → 断言不崩。
3. **写实现**：按本蓝图 §实现要求 1-5 编写 `agent-run-panel.tsx`。
4. **跑测试**：`cd frontend && pnpm test -- agent-run-panel`（本任务最小测试）+ `pnpm typecheck`（props 签名 + input 适配类型校验）。
5. **验收**：对照 §验收标准 表格逐项检查。

> 集成测试（perms→卡片渲染、端到端 bug 覆盖）在 task-04 编写，本任务只保证组件可渲染、类型通过。

## 验收标准

| # | 标准 | 验证方法 |
|---|---|---|
| 1 | `frontend/src/components/agent-run-panel.tsx` 存在，export `AgentRunPanel` + `AgentRunPanelProps` | 文件存在 + grep `export function AgentRunPanel` / `export interface AgentRunPanelProps` |
| 2 | props 签名严格匹配 design §7.2（13 个 prop：workspaceId/runId/isActive/title/emptyText?/summary?/actions?/compact?/variant?/maxHeightClass?/isLive?/onDone?/onClose?） | `pnpm typecheck` 通过 + 人工比对 |
| 3 | 内部调 `useAgentRunStream(workspaceId, runId, { isActive, onDone })` | 代码 review |
| 4 | 注入 `<AgentLogViewer>` 全部必需 prop（title/runId/logs/loading/emptyText/inputControls/permissionRequests/onPermissionResolved + 可选定制的显式透传） | 代码 review |
| 5 | input 适配：`AgentRunInputStream` → `AgentLogInputControls` 字段映射（values→inputValues / submitting→submittingInputs / errors→inputErrors / replied→repliedInputs / set→onChange / submit→onSubmit） | 代码 review（X-002） |
| 6 | `onPermissionResolved` handler 只调 `dismissPerm(requestId)`，**不** import 或调用 `respondSessionPermission` | grep `respondSessionPermission` 在本文件无结果（D-003） |
| 7 | `onClose` 存在时自动追加关闭按钮到 actions 区 | 代码 review + 最小测试 |
| 8 | `runId=null` 正常渲染（不崩，展示 emptyText） | 最小测试 |
| 9 | `cd frontend && pnpm typecheck` exit 0 | tsc 通过 |
| 10 | `cd frontend && pnpm lint` exit 0（无 unused import / any） | eslint 通过 |
| 11 | 最小渲染测试通过（`pnpm test -- agent-run-panel`） | vitest exit 0 |
| 12 | 未修改 `agent-log-viewer.tsx` / `permission-approval-card.tsx` / `daemon.ts` | `git diff --name-only` 仅含 `agent-run-panel.tsx`（+ 最小测试文件） |
