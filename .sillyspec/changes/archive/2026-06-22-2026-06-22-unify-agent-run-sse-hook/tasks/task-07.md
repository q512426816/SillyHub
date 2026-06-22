---
id: task-07
title: changes/[cid]/page.tsx 两触发点（dispatch :523 + connectLogStream :599）合并为单 <AgentRunPanel>
priority: P0
estimated_hours: 4
depends_on: [task-03]
blocks: [task-08]
requirement_ids: [FR-01, FR-04]
decision_ids: [D-002@v1]
risk_ids: [R-06]
allowed_paths:
  - frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/page.tsx
created_at: 2026-06-22T11:24:44+08:00
author: qinyi
---

# task-07 changes/[cid]/page.tsx 合并为单 AgentRunPanel

依据文档：
- design.md §1（背景，changes :523/:599 两调用点重复）、§5.1（分层）、§6（文件清单：本文件 `:523`+`:599` 合并）、§10 R-06（localRunId 兜底）、§13 X-003（Grill 交叉，登记 R-06）
- requirements.md FR-01（单一 SSE 客户端，删除 streamAgentRunLogs 调用）、FR-04（changes 页 task 执行 AskUserQuestion 卡片渲染）
- plan.md W3 task-07（依赖 task-03，阻塞 task-08）、调用点搜索记录（changes/[cid]/page.tsx:41 import + :523/:599 调用）
- decisions.md D-002@v1（hook + 面板组件抽象层次）

## 修改文件

| 操作 | 文件 | 说明 |
|---|---|---|
| 修改 | `frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/page.tsx` | `:523`（dispatch 后连新 run）+ `:599`（connectLogStream）两条 SSE 路径合并为单个 `<AgentRunPanel>`；删除 4 处胶水（eventSourceRef / dispatchOwnsSseRef / loadHistoryLogs / connectLogStream）+ `:41` streamAgentRunLogs import + 手搓 `AgentLogViewer` 区块（:948-1070，用 panel 接管日志/卡片/input）；保留 dispatch/refresh 触发逻辑，用 localRunId 兜底 R-06 |

> 本任务不改动 `AgentRunPanel`（task-03 交付）、`useAgentRunStream`（task-01 交付）、`AgentLogViewer`、`agent.ts`（`streamAgentRunLogs` 删除归 task-08）、后端。

## 覆盖来源

| 需求 / 风险 | 来源章节 | 覆盖点 | 验证 |
|---|---|---|---|
| FR-01 | requirements.md §FR-01 | 删 `:41` streamAgentRunLogs import + `:523`/`:599` 两处调用 | grep `streamAgentRunLogs` 在本文件无结果 + tsc 通过 |
| FR-04 | requirements.md §FR-04 | changes 页活跃 run 的 AskUserQuestion 经 AgentRunPanel→AgentLogViewer 渲染审批卡片（原 :523/:599 两条路径无 permission 回调，现走 panel） | 手测 changes 页 task 执行中触发 AskUserQuestion → 卡片弹出（原 5min 兜底消失） |
| D-002@v1 | decisions.md §D-002 | 调用点渲染单行 `<AgentRunPanel .../>`，无 SSE/状态胶水残留 | 代码 review |
| R-06 | design.md §10 + §13 X-003 | localRunId 兜底：dispatch 成功后立即 setLocalRunId(result.last_dispatch.run_id)，panel runId={localRunId ?? activeRunId}，对照原 :515-553 立即连不丢失 | 代码 review + 手测 dispatch 后日志立即滚动 |

## 实现要求

### 1. 现状（必读，对照基准）

当前 `changes/[cid]/page.tsx` 有**两条独立 SSE 连接路径**，能力是 `AgentRunStreamClient` 的子集（无 permission 解析 → 导致 FR-04 bug）：

**路径 A — `handleDispatch` 内 `:505-553`**：dispatch 成功后用**返回值** `result.last_dispatch.run_id`（立即值）**同步**清空旧日志 + 预取历史 + 连新 SSE。关键代码：

```tsx
// :505-553（当前）
if (result.has_active_run && result.last_dispatch?.run_id) {
  dispatchOwnsSseRef.current = true;            // 标记 dispatch 独占 SSE，阻止 connectLogStream 抢占
  if (eventSourceRef.current) {
    eventSourceRef.current.close();
    eventSourceRef.current = null;
  }
  const newRunId = result.last_dispatch.run_id;  // ← 立即值，不等 refresh
  setAgentLogs([]);
  setLogStreaming(true);
  getAgentRunLogs(workspaceId, newRunId).then(setAgentLogs).catch(() => {});
  const es = streamAgentRunLogs(workspaceId, newRunId, onMessage, onDone, onError);
  eventSourceRef.current = es;
}
```

**路径 B — `connectLogStream` `:588-628`**：由 useEffect（:631-650）在 logsExpanded 切换时触发，用**派生值** `activeRunId`（= `agentStatus?.last_dispatch?.run_id`，来自异步 refresh）。关键代码：

```tsx
// :578-579
const activeRunId = agentStatus?.last_dispatch?.run_id ?? null;
const isRunActive = agentStatus?.has_active_run ?? false;
// :588-628
const connectLogStream = useCallback(() => {
  if (!activeRunId || !workspaceId || eventSourceRef.current) return;
  if (!isRunActive) { loadHistoryLogs(); return; }   // ← 非活跃只拉历史（D-001 现有语义）
  setLogStreaming(true);
  loadHistoryLogs();
  const es = streamAgentRunLogs(workspaceId, activeRunId, onMessage, onDone, onError);
  eventSourceRef.current = es;
}, [activeRunId, workspaceId, isRunActive, loadHistoryLogs]);
```

**两路径冲突防护**：`dispatchOwnsSseRef`（:282）—— dispatch 成功后置 true，阻止 useEffect（:632）触发 connectLogStream 抢占；onDone/onError 时复位为 false 并触发 refreshAgentStatus。这是一个 hack，因为两个 streamAgentRunLogs 实例都改同一个 eventSourceRef。

**渲染处 `:948-1070`**：手搓的"智能体执行日志"卡片（折叠/展开按钮 + 状态点 + 手搓 `agentLogs.map(...)` 渲染），无 permission 卡片、无 pending_input 控件。

### 2. R-06 核心方案：localRunId 兜底

**问题**（design §10 R-06 / §13 X-003）：合并后只有单个 panel 实例，panel 的 `runId` prop 决定连哪条 run。若 `runId` 仅用派生值 `activeRunId`（:578，来自 `agentStatus`，需 refresh 才更新），会出现"dispatch 已返回但 refresh 未完成"的窗口 —— panel 在此窗口内 runId 还是旧值（dispatch 前的 last_dispatch，或 null），原 :515-553 立即连新 run 的语义丢失，首屏日志不滚、permission 事件接不上。

**解决**：新增 `localRunId` state，dispatch 成功后**立即** setLocalRunId(result.last_dispatch.run_id)，与派生 activeRunId 取**优先级合并**：

```tsx
// 新增 state（替换原 eventSourceRef/dispatchOwnsSseRef/loadHistoryLogs/connectLogStream 胶水）
const [localRunId, setLocalRunId] = useState<string | null>(null);

// 派生：localRunId 优先（dispatch 立即值），回落到 refresh 后的 activeRunId
const activeRunId = agentStatus?.last_dispatch?.run_id ?? null;
const panelRunId = localRunId ?? activeRunId;
const isRunActive = agentStatus?.has_active_run ?? false;
const panelIsActive = localRunId !== null ? true : isRunActive;
```

**为什么 `panelIsActive = localRunId !== null ? true : isRunActive`**：
- dispatch 成功 setLocalRunId 后，无论 refresh 是否回来，此 run 必然是刚派发的活跃 run（has_active_run=true 刚刚触发 dispatch 分支）→ 强制 isActive=true 让 panel 立即连 SSE。
- localRunId=null 时（首次加载页面、刷新后）回退到 `isRunActive`（D-001 语义：非活跃 run 仅 prefetch 历史）。

**localRunId 与 activeRunId 同步**：refreshAgentStatus 完成后 `activeRunId` 会追上 `localRunId`（同值）；为避免 localRunId 永远卡住（导致 isRunActive=false 时仍误连 SSE），在 `refreshAgentStatus` 完成后**清空 localRunId**（让派生值接管）：

```tsx
const refreshAgentStatus = useCallback(async () => {
  setLoadingAgentStatus(true);
  try {
    const as = await getAgentStatus(workspaceId, changeId);
    setAgentStatus(as);
    setLocalRunId(null);  // refresh 完成，让 activeRunId 接管（两者此时同值）
  } catch { /* silent */ } finally {
    setLoadingAgentStatus(false);
  }
}, [workspaceId, changeId]);
```

**注意**：onDone（run 结束）也调 refreshAgentStatus → 此时 activeRunId 指向已完成 run、isRunActive=false，panel 自动降级为"仅 prefetch 历史"（D-001）。localRunId 清空后 panel runId 仍是 activeRunId（同一已完成 run），panel 内 hook 在 isActive=false 时仅重取历史，不重复连 SSE —— 行为对齐原 `:590-594`（非活跃只 loadHistoryLogs）。

### 3. handleDispatch 简化

删除 `:505-553` 内全部手动 SSE 胶水，只保留：调 API + setLocalRunId + refresh + UI 反馈：

```tsx
const handleDispatch = async () => {
  setDispatching(true);
  setPageError(null);
  try {
    const result = await triggerDispatch(workspaceId, changeId, stageProvider, stageModel);
    setAgentStatus(result);
    setLogsExpanded(true);
    if (result.has_active_run && result.last_dispatch?.run_id) {
      setSuccessMsg("🤖 智能体 已触发执行");
      setTimeout(() => setSuccessMsg(null), 3000);
      // R-06：立即 setLocalRunId → panel runId 立即指向新 run → 立即连 SSE（保持原 :515-553 语义）
      setLocalRunId(result.last_dispatch.run_id);
    }
    // 异步 refresh（不阻塞 UI），完成后 localRunId 清空、activeRunId 接管
    void refreshAgentStatus();
  } catch (err) {
    setPageError(err instanceof ApiError ? err.message : "触发智能体失败");
  } finally {
    setDispatching(false);
  }
};
```

**对照原语义逐项核对**：
| 原 :505-553 行为 | 新实现等价点 |
|---|---|
| `dispatchOwnsSseRef.current = true`（阻止 connectLogStream 抢占） | 不再需要 —— 只有一个 panel 实例，setLocalRunId 直接驱动 panel，无抢占问题 |
| `eventSourceRef.current.close()`（清旧 SSE） | panel 内 hook useEffect cleanup 自动 disconnect 旧 run（runId 变化触发，R-01 应对） |
| `const newRunId = result.last_dispatch.run_id`（立即值） | `setLocalRunId(result.last_dispatch.run_id)` → panelRunId 立即取新值 |
| `setAgentLogs([])`（清空旧日志） | panel 内 hook 在 runId 变化时 useEffect 重新初始化 logs=[]（task-01 实现） |
| `getAgentRunLogs(workspaceId, newRunId).then(setAgentLogs)`（预取历史） | panel 内 hook `AgentRunStreamClient.connect` 内已做 getAgentRunLogs 预取（design §7.3） |
| `streamAgentRunLogs(...)`（连 SSE） | panel runId 变化 + isActive=true → hook 连 SSE（AgentRunStreamClient，超集） |
| onDone 回调（setLogStreaming(false) + refreshAgentStatus） | panel `onDone={() => void refreshAgentStatus()}`（见 §5 useCallback） |
| onError 回调（setLogStreaming(false)） | hook 内部 error 状态（task-01），panel loading/error 注入 viewer |

### 4. 删除胶水（一次性删除清单）

| 行号 | 内容 | 删除原因 |
|---|---|---|
| :41 | `streamAgentRunLogs` import（保留 `getAgentRunLogs` / `AgentRunLogEntry` / `StreamLogEvent` 如仍被用 —— 实际 panel 接管后 `getAgentRunLogs`/`StreamLogEvent` 不再直接用，`AgentRunLogEntry` 如仅用于已删的 agentLogs 也删；execute 阶段 tsc 报 unused 引导精确清理） | FR-01 |
| :270-282 | `agentLogs` state、`logsExpanded`/`logStreaming` 状态（logsExpanded 保留，仍控制面板折叠）、`logEndRef`、`eventSourceRef`、`dispatchOwnsSseRef` | panel 接管日志/状态 |
| :281 | `eventSourceRef = useRef<EventSource \| null>(null)` | 无手搓 SSE |
| :282 | `dispatchOwnsSseRef = useRef(false)` | 单 panel 无抢占 |
| :581-586 | `loadHistoryLogs` useCallback | panel 内 hook 预取历史 |
| :588-628 | `connectLogStream` useCallback | 单 panel 接管 |
| :631-650 | useEffect（监听 logsExpanded/activeRunId/connectLogStream 触发 connectLogStream） | 单 panel 的生命周期由 panel 自管 |
| :653-655 | useEffect（logEndRef.scrollIntoView，agentLogs 变化时自动滚动） | AgentLogViewer 内部自管滚动（若 viewer 无此能力则 panel 层补充，task-03 负责） |
| :948-1070 | 手搓的"智能体执行日志" `<section>`（折叠按钮 + 状态点 + agentLogs.map 渲染 + tool_call 解析） | 用 `<AgentRunPanel>` 替代；tool_call 渲染由 AgentLogViewer 内部完成 |

> `parseToolCallContent`（:185-208）、`ToolCallEntry` 类型（:176-184）：仅服务于已删的手搓渲染区，若 grep 确认无其他引用则一并删除；execute 阶段 tsc unused 报错会引导。

### 5. 新增：onDone useCallback + panel 渲染

```tsx
// onDone 用 useCallback（依赖项：refreshAgentStatus）
const handleRunDone = useCallback(
  (_status: string) => {
    void refreshAgentStatus();
  },
  [refreshAgentStatus],
);
```

渲染处替换原 :948-1070（位置：`<SillySpecStepProgress>` 下方，保留原 `{activeRunId && (...)}` 条件，但条件改为 `panelRunId && logsExpanded`，或无条件渲染由 panel 内部处理 runId=null 空态 —— 选择前者保持"展开才加载"的现有交互）：

```tsx
{/* ── Agent 执行日志（AgentRunPanel 接管 SSE + 审批 + input）────── */}
{logsExpanded && panelRunId && (
  <AgentRunPanel
    workspaceId={workspaceId}
    runId={panelRunId}
    isActive={panelIsActive}
    title="智能体执行日志"
    isLive={panelIsActive}
    summary={
      <span className="text-[11px] text-muted-foreground">
        {agentStatus?.last_dispatch?.status ? ` · ${agentStatus.last_dispatch.status}` : ""}
      </span>
    }
    onDone={handleRunDone}
  />
)}
```

**折叠/展开控制保留**：原 :949-983 的折叠按钮 `<section>` 头（"智能体执行日志" + 状态点 + ▾/▸）保留为外层壳，仅删除内部日志渲染区（:984-1068）。或简化为：折叠按钮独立一行 + 展开时挂载 panel。execute 时按代码整洁度取舍，两种均可，关键是 logsExpanded 控制是否挂载 panel（避免无 run 时也连）。

**状态点简化**：原 :963-974 的 logStreaming/failed/completed 三色状态点可由 panel/hook 返回的 `status`/`streaming` 驱动，或直接用 `agentStatus?.last_dispatch?.status` 渲染（已是当前实现）。若 panel 提供更精细状态可迁移到 summary slot；本任务保守：保留 `agentStatus.last_dispatch.status` 驱动的状态点，避免过度改造。

## 接口契约（消费 task-03 AgentRunPanel props）

严格对齐 task-03 `AgentRunPanelProps`（13 个 prop）：

| prop | 传值 | 来源 |
|---|---|---|
| `workspaceId` | `workspaceId`（params.id） | 现有 |
| `runId` | `panelRunId`（localRunId ?? activeRunId） | R-06 §2 |
| `isActive` | `panelIsActive`（localRunId !== null ? true : isRunActive） | R-06 §2 |
| `title` | `"智能体执行日志"` | 原 :962 |
| `emptyText` | 不传（用 panel 默认 "暂无日志"） | task-03 默认 |
| `summary` | `{agentStatus?.last_dispatch?.status ? ...}` | 原 :975-978 |
| `actions` | 不传（无定制 actions；onClose 也不传，面板由 logsExpanded 控制挂载） | — |
| `compact` | 不传 | — |
| `variant` | 不传（默认 "panel"） | — |
| `maxHeightClass` | 可选传 `"max-h-80"`（对齐原 :985 `max-h-80 overflow-auto`） | 原 :985 |
| `isLive` | `panelIsActive`（活跃 run 显示 LIVE 徽标） | 新增 |
| `onDone` | `handleRunDone`（useCallback） | §5 |
| `onClose` | 不传（折叠由外层 logsExpanded 控制） | — |

## 边界处理

| # | 场景 | 处理 | 依据 |
|---|---|---|---|
| 1 | **R-06 dispatch 立即连不丢失** | `setLocalRunId(result.last_dispatch.run_id)` 在 dispatch 成功后立即调用 → `panelRunId = localRunId ?? activeRunId` 立即取新值 → panel 内 hook useEffect（runId 变化）触发重连，不等 refreshAgentStatus。对照原 :515-553 `const newRunId = result.last_dispatch.run_id` + 立即 streamAgentRunLogs 的同步语义保持一致。 | design §10 R-06 / §13 X-003 |
| 2 | **R-06 activeRunId 异步追平** | `refreshAgentStatus` 在 dispatch 后异步触发（`void refreshAgentStatus()`），完成时 setAgentStatus 更新 → activeRunId 追上 localRunId（同值）→ 同时 `setLocalRunId(null)` 清空让派生值接管。此窗口内 panelRunId 始终 = localRunId（即新 run_id），无空窗。 | design §10 R-06 |
| 3 | **R-06 localRunId 永久卡住风险** | 若不清空 localRunId，当该 run 完成后 isRunActive=false 但 panelIsActive 仍 true → panel 误连已完成 run 的 SSE（无事件，空连）。解决：refreshAgentStatus 完成后 `setLocalRunId(null)`；onDone 也触发 refresh → 自动清空 → panelIsActive 回退到 isRunActive（false）→ panel 降级为仅 prefetch 历史（D-001）。 | design §10 R-06 / D-001 |
| 4 | **dispatch 立即连 vs panel 的 isActive 语义对齐** | `panelIsActive = localRunId !== null ? true : isRunActive`：localRunId 非 null 表示刚 dispatch（run 必然活跃）→ 强制 true 让 panel 连 SSE；localRunId=null 后回退 isRunActive（页面刷新/首次加载场景，按 D-001 决定连/不连）。 | D-001 / R-06 |
| 5 | **isRunActive=false（页面加载已有完成 run）只拉历史** | localRunId 初始 null → panelIsActive = isRunActive = false → panel runId=activeRunId（已完成 run）→ hook 仅 prefetch 历史（D-001），不连 SSE、不注册 permission/input 回调。对齐原 :590-594（!isRunActive → loadHistoryLogs + return）。 | D-001 / FR-06 |
| 6 | **onDone 用 useCallback 稳定引用** | `handleRunDone = useCallback((_status) => void refreshAgentStatus(), [refreshAgentStatus])`；refreshAgentStatus 本身也是 useCallback（依赖 workspaceId/changeId）。避免 panel 因 onDone 引用变化触发不必要的 hook 重渲染/重连。 | React 最佳实践 / R-01 |
| 7 | **logsExpanded=false 时不挂载 panel** | 条件渲染 `{logsExpanded && panelRunId && <AgentRunPanel .../>}`：折叠时不挂载 panel → hook 不连 SSE（省连接）。原 :631-650 useEffect 也是 logsExpanded 驱动，语义一致。展开时 panel 挂载 → hook 自动连。 | 原 :631-650 语义 |
| 8 | **无 activeRunId 且无 localRunId**（首次加载、无任何 dispatch） | panelRunId=null → 不渲染 panel（条件 `panelRunId &&`）→ 原 :949 `{activeRunId && (...)}` 等价。页面不展示日志区。 | 原 :949 语义 |
| 9 | **handleDispatch 失败** | catch 设置 pageError，不 setLocalRunId（保留旧值）→ panel 仍连旧 run（若有）。对齐原 :555-559 catch 仅 setPageError。 | 原 :555-559 |
| 10 | **triggerDispatch 返回 has_active_run=false**（dispatch 被 dedup 跳过） | 不进入 `if (result.has_active_run && ...)` 分支 → 不 setLocalRunId → panelRunId 仍 = activeRunId（现有 run）→ panel 继续连现有 run。对齐原 :354-359 "已在运行中，跳过重复派发" 语义（successMsg 提示 + 不重连）。 | 原 :354-359 / changes.ts DispatchResponse |
| 11 | **删除 streamAgentRunLogs import 后残留类型 import** | `AgentRunLogEntry`/`StreamLogEvent` 若仅服务于已删的 agentLogs state 和 onMessage 回调，一并删除；若 `AgentRunLogEntry` 在别处仍用（grep 确认）则保留。execute 时 tsc unused 报错兜底。 | FR-01 / R-04 |

## 非目标

- 不改动 `AgentRunPanel`（task-03 交付）、`useAgentRunStream`（task-01 交付）、`AgentLogViewer`、`AgentLogStreamClient`。
- 不删除 `streamAgentRunLogs` 函数本身（agent.ts:117-162，归 task-08；本任务只删本文件的 import + 调用）。
- 不改 `triggerDispatch` / `getAgentStatus` / `transitionChange` API 调用签名（只改 handleDispatch 内部胶水）。
- 不改 `handleTransition` / `handleGateAction` 内的 agent_status 刷新逻辑（它们调 refreshAgentStatus 或直接 setAgentStatus，行为不变；refreshAgentStatus 内新增的 setLocalRunId(null) 对这些路径无害 —— 它们本来就不依赖 localRunId）。
- 不改外层折叠/展开 UI 交互（logsExpanded state 保留，仅控制 panel 挂载）。
- 不接管 `handleExecute`（executeChange 路径，它不直接连 SSE，只启动 run + refresh change，与本次无关）。
- 不写本文件的专门测试（task-04 panel 集成测试覆盖 perms→卡片端到端；本任务靠手测 + tsc/lint 兜底）。

## TDD 步骤

> 本任务为调用点迁移（无新增可单测单元）。遵循 CLAUDE.md "读现有代码 → 写实现 → 跑测试 → 验收"，以 tsc/lint + 手测验证为主。

1. **读现有代码**：已读 page.tsx（:41/:270-282/:505-553/:578-650/:948-1070）、task-03 AgentRunPanel props、design R-06。
2. **写实现**：
   a. 新增 `localRunId` state + `panelRunId`/`panelIsActive` 派生。
   b. 改 `refreshAgentStatus`（useCallback + setLocalRunId(null)）。
   c. 改 `handleDispatch`（删 :505-553 胶水，换 setLocalRunId + void refresh）。
   d. 新增 `handleRunDone` useCallback。
   e. 删 import（:41 streamAgentRunLogs + 可能的 AgentRunLogEntry/StreamLogEvent）、胶水（eventSourceRef/dispatchOwnsSseRef/loadHistoryLogs/connectLogStream/相关 useEffect/手搓日志渲染区）、parseToolCallContent/ToolCallEntry（若仅本处用）。
   f. 引入 `AgentRunPanel` import + 渲染（替换 :948-1070）。
3. **跑验证**：
   - `cd frontend && pnpm typecheck`（tsc 兜底：unused import / 类型不匹配）
   - `cd frontend && pnpm lint`（eslint）
   - `cd frontend && pnpm test`（现有测试不回归；本任务无新增测试）
4. **手测验收**（对照 §验收标准）：
   - changes 页手动派发 → 日志立即滚动（R-06 立即连）。
   - changes 页 task 执行中触发 AskUserQuestion → 审批卡片弹出（FR-04，原 bug 修复）。
   - 折叠/展开日志区 → 行为正常（不重连）。
   - 页面刷新（有活跃 run）→ 日志恢复 + 卡片恢复（FR-07 dialog 恢复由 hook 内 fetchPendingDialogs）。

## 验收标准

| # | 标准 | 验证方法 |
|---|---|---|
| 1 | `streamAgentRunLogs` 在本文件无 import、无调用 | `grep -n streamAgentRunLogs "frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/page.tsx"` 无结果 |
| 2 | `eventSourceRef` / `dispatchOwnsSseRef` / `loadHistoryLogs` / `connectLogStream` 全部删除，无残留 | grep 各 token 在本文件无结果 |
| 3 | 手搓 `agentLogs.map(...)` 日志渲染区（原 :984-1068）删除，替换为 `<AgentRunPanel>` | 代码 review |
| 4 | `<AgentRunPanel>` props 符合 task-03 签名（workspaceId/runId/isActive/title/isLive/summary/onDone 等） | 代码 review + tsc |
| 5 | **R-06**：`localRunId` state 存在；`panelRunId = localRunId ?? activeRunId`；`panelIsActive = localRunId !== null ? true : isRunActive`；handleDispatch 内 `setLocalRunId(result.last_dispatch.run_id)`；refreshAgentStatus 内 `setLocalRunId(null)` | 代码 review 逐项核对 |
| 6 | **R-06 dispatch 立即连语义**：手测 handleDispatch 成功后日志立即滚动（无等 refresh 的空窗） | 手测：dispatch → 观察 panel 立即出现日志流 |
| 7 | **FR-04**：changes 页 task 执行中触发 AskUserQuestion → 审批卡片弹出（原 5min 兜底消失） | 手测（需有真实 run 触发 AskUserQuestion；或信任 task-04 集成测试覆盖） |
| 8 | `onDone` 为 useCallback（handleRunDone），依赖 [refreshAgentStatus] | 代码 review |
| 9 | 折叠（logsExpanded=false）时不挂载 panel；展开时挂载 | 代码 review + 手测 |
| 10 | `cd frontend && pnpm typecheck` exit 0（无 unused import / 类型错误） | tsc |
| 11 | `cd frontend && pnpm lint` exit 0 | eslint |
| 12 | `cd frontend && pnpm test` exit 0（现有测试不回归） | vitest |
| 13 | 未修改 `agent-run-panel.tsx` / `use-agent-run-stream.ts` / `agent-log-viewer.tsx` / `agent.ts` / 后端 | `git diff --name-only` 仅含本文件 |

## 参考

- design.md §1（两调用点重复）、§5.1（分层）、§6（文件清单 changes :523+:599 合并）、§10 R-06（localRunId 兜底）、§13 X-003（Grill 登记 R-06）
- requirements.md FR-01（单一 SSE 客户端）、FR-04（changes 页 AskUserQuestion 卡片）
- plan.md W3 task-07、调用点搜索记录（changes/[cid]/page.tsx:41 import + :523/:599 调用）
- decisions.md D-002@v1（hook + 面板组件抽象层次）
- `frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/page.tsx`：:41 import、:270-282 SSE 状态、:497-560 handleDispatch（:505-553 SSE 胶水）、:562-575 handleArchive、:577-650 Agent Log Stream（activeRunId :578 / isRunActive :579 / loadHistoryLogs :581-586 / connectLogStream :588-628 / useEffect :631-650）、:948-1070 手搓日志渲染
- `frontend/src/lib/changes.ts:369-375`（DispatchResponse: has_active_run / last_dispatch.run_id）
- `frontend/src/components/agent-run-panel.tsx`（task-03 交付，AgentRunPanelProps 13 prop）
- `frontend/src/lib/use-agent-run-stream.ts`（task-01 交付，hook isActive 语义 + runId 变化重连）
