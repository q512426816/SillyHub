---
id: task-06
title: agent/page.tsx 活跃 run 迁移到 <AgentRunPanel>；历史展开保持直接 AgentLogViewer
priority: P0
estimated_hours: 3
depends_on: [task-03]
blocks: [task-08]
requirement_ids: [FR-01, FR-04]
decision_ids: [D-002@v1]
allowed_paths:
  - frontend/src/app/(dashboard)/workspaces/[id]/agent/page.tsx
created_at: 2026-06-22T11:24:44+08:00
author: qinyi
---

# task-06 agent/page.tsx 活跃 run 迁移到 <AgentRunPanel>

依据文档：
- design.md §3（非目标：历史展开保持直接 AgentLogViewer + 下载按钮）、§5.1（分层：调用点 → `<AgentRunPanel>`）、§6（文件清单 agent/page.tsx）、§7.2（AgentRunPanel props 契约）、§10 R-04（删 streamAgentRunLogs 前 grep）
- requirements.md FR-01（单一 SSE 客户端，删 streamAgentRunLogs）、FR-04（AskUserQuestion 卡片在 /agent 渲染）
- plan.md W3 task-06（活跃 run 改 AgentRunPanel；历史展开保持直接 AgentLogViewer）、§调用点搜索记录（agent/page.tsx:33 import + :397 调用 → task-06 清理/迁移）、全局验收标准第 1 条（/agent 页 scan run AskUserQuestion → 卡片弹出）
- tasks/task-03.md §接口定义（AgentRunPanelProps 13 个 prop）、§实现要求 4（onClose 自动追加关闭按钮）、§边界处理 1/5（runId=null / onClose 注入）

## 修改文件

| 操作 | 文件 | 说明 |
|---|---|---|
| 修改 | `frontend/src/app/(dashboard)/workspaces/[id]/agent/page.tsx` | 活跃 run 区（:652-704）改用 `<AgentRunPanel isActive>`；删 `streamAgentRunLogs` import（:33）+ 调用（:397-416）+ `activeLogs`/`logsLoading`/`inputValues`/`submittingInputs`/`inputErrors`/`repliedInputs` 状态 + `handleSubmitInput`；保留历史展开 :824-887（直接 `<AgentLogViewer>`，不套 panel） |

> 本任务不动 `agent-run-panel.tsx`（task-03 负责）、`agent.ts`（task-08 负责 streamAgentRunLogs 删除）、`agent-log-viewer.tsx`（design §3 非目标）。

## 覆盖来源

| 需求/决策 | 覆盖点 | 验证 |
|---|---|---|
| FR-01 | 删本文件的 `streamAgentRunLogs` import（:33）+ 调用（:397），活跃 run 日志流改由 `<AgentRunPanel>` → `useAgentRunStream` → `AgentRunStreamClient` 承担 | grep `streamAgentRunLogs` 在本文件无结果（task-08 删除前的中间态：import 已清，仅 agent.ts 仍保留定义） |
| FR-04 | 活跃 run 通过 panel 的 `perms` 注入 `AgentLogViewer.permissionRequests`，AskUserQuestion 触发 permission_request 时渲染审批卡片（原 5min 兜底超时消失） | 手动验收：/agent 页 scan run 触发 AskUserQuestion → 卡片弹出 |
| D-002@v1 | 抽象层次 = hook + 面板：调用点收敛为一行 `<AgentRunPanel>`，删除 SSE 生命周期 + 状态管理胶水 | 代码 review：活跃 run 区无 `streamAgentRunLogs`/`EventSource`/`onMessage`/`input*` 状态 |

## 实现要求

### 1. import 调整

删除：
- `streamAgentRunLogs`（从 `@/lib/agent` import，:33）
- `submitAgentRunInput`（:34，活跃 run 改由 panel 内 hook 处理 input submit）
- `safeUUID`（:4，原 streamAgentRunLogs onMessage 用，现 panel 接管）
- `asString`（:27，同上）

新增：
- `AgentRunPanel`（从 `@/components/agent-run-panel`）

保留：
- `AgentLogViewer`（历史展开 :850-883 仍直接使用）、`isPendingReplied`/`parseToolCallContent`/`parseScanCheckOutput`/`ToolCallEntry`（`extractRunSummary` :99-116 依赖 expandedLogs，仍保留）
- `getAgentRunLogs`（`handleExpandLogs` :422-442 拉历史展开日志）
- `killAgentRun`/`listAgentRuns`/`formatRunProviderLabel`/`AgentRun`/`AgentRunLogEntry`（类型 + 列表）

### 2. 状态删除

删除以下 state（活跃 run 由 panel 内部 hook 管理，design §7.1 hook 返回 logs/perms/input/loading）：

```tsx
// 删除（:245-254）
const [activeLogs, setActiveLogs] = useState<AgentRunLogEntry[] | null>(null);
const [logsLoading, setLogsLoading] = useState(false);
const [inputValues, setInputValues] = useState<Record<string, string>>({});
const [submittingInputs, setSubmittingInputs] = useState<Record<string, boolean>>({});
const [inputErrors, setInputErrors] = useState<Record<string, string>>({});
const [repliedInputs, setRepliedInputs] = useState<Set<string>>(new Set());
```

保留：
- `runs`/`error`/`activeRunId`/`expandedRunId`/`expandedLogs`/`expandedLogsLoading`
- `statusFilter`/`historyPage`（历史记录筛选 + 分页）

### 3. 活跃 run SSE useEffect 删除（:390-419）

整块删除 —— `streamAgentRunLogs` 调用 + `setActiveLogs` onMessage + done 回调全部由 panel 内 `useAgentRunStream` 接管（design §5.1 分层）。

原逻辑等价迁移到 panel：
- isActive 判定：原 `run.status === "running"`（:394-395）→ 传入 panel 的 `isActive` prop（见 §4 isActive 计算）
- done 回调：原 `() => { void reload(); window.setTimeout(() => void reload(), 1_500); }`（:412-415）→ 传入 panel 的 `onDone`（见 §5 onDone useCallback）
- logs 累加：原 onMessage 把 event push 进 activeLogs → panel hook 内部维护 logs（design §7.1）

### 4. isActive 计算

新增 useMemo，从 runs 派生 activeRunId 对应 run 是否 running（对应原 :394-395 的 `run.status === "running"` 判定）：

```tsx
const isActiveRun = useMemo(() => {
  if (!activeRunId) return false;
  const run = runs?.find((r) => r.id === activeRunId);
  return run?.status === "running" ?? false;
}, [activeRunId, runs]);
```

语义对齐 design §7.1：`isActive=true` 连 SSE（pending/running），`isActive=false` 仅 prefetch 历史（completed/failed/killed）。原页面逻辑只在 running 时连 SSE（非 running 时即使 activeRunId 有值也不连，靠 handleSelectActive 时拉的一次 getAgentRunLogs 历史展示）；迁移后 isActive=false 时 panel 走 FR-06 路径（prefetch 历史），用户仍能看到该 run 的历史日志（行为更完善，非回归）。

### 5. onDone useCallback

原 :412-415 done 回调迁移为 useCallback（design §实现要点 + 验收标准要求 onDone 用 useCallback）：

```tsx
const handleActiveRunDone = useCallback(
  (_status: string) => {
    void reload();
    window.setTimeout(() => void reload(), 1_500);
  },
  [reload],
);
```

- `_status` 参数接收但不使用（原逻辑无差别处理 done，只 reload 两次）。
- `reload` 是已存在的 useCallback（:329-338），作为依赖。

### 6. handleSubmitInput 删除（:445-475）

整块删除 —— pending_input 提交由 panel 内 `useAgentRunStream.input.submit` 调 `submitAgentRunInput`（design §7.1 input.submit / §7.3 POST .../runs/{rid}/input）。原 `handleSubmitInput` 的 `inputValues`/`submittingInputs`/`inputErrors`/`repliedInputs` 状态管理全部由 hook 接管。

### 7. handleSelectActive 简化（:352-372）

原逻辑：点"查看日志" → setActiveRunId + 拉 getAgentRunLogs 历史预填 + setLogsLoading。

迁移后简化为**仅 setActiveRunId**（panel 内部 hook 负责 prefetch 历史日志 + 连 SSE）：

```tsx
const handleSelectActive = useCallback(
  (runId: string) => {
    if (activeRunId === runId) {
      setActiveRunId(null);
      return;
    }
    setActiveRunId(runId);
  },
  [activeRunId],
);
```

- 删除 `setActiveLogs(null)`/`setLogsLoading(true)`/`getAgentRunLogs(workspaceId, runId)`/`setActiveLogs(logs)`/try-catch-finally（panel hook 接管 prefetch + loading）。
- 关闭逻辑（同 run 再点）保留：setActiveRunId(null) → panel unmount 或 isActive=false。
- workspaceId 依赖移除（不再用）。

### 8. 活跃 run 区 JSX 替换（:652-704）

原 `<AgentLogViewer>` 块替换为 `<AgentRunPanel>`：

```tsx
{activeRunId && (
  <section className="min-w-0">
    <AgentRunPanel
      workspaceId={workspaceId}
      runId={activeRunId}
      isActive={isActiveRun}
      title="实时日志"
      emptyText="暂无日志输出"
      isLive
      summary={
        <>
          {toolSummary.success > 0 && (
            <StatusBadge kind="success">{toolSummary.success} 成功</StatusBadge>
          )}
          {toolSummary.failed > 0 && (
            <StatusBadge kind="error">{toolSummary.failed} 失败</StatusBadge>
          )}
          {toolSummary.pending > 0 && (
            <StatusBadge kind="warning">{toolSummary.pending} 待审批</StatusBadge>
          )}
          {toolSummary.pendingGuidance > 0 && (
            <StatusBadge kind="warning">{toolSummary.pendingGuidance} 待指导</StatusBadge>
          )}
        </>
      }
      onDone={handleActiveRunDone}
      onClose={() => setActiveRunId(null)}
    />
  </section>
)}
```

- 关闭按钮：原 `<Button>关闭</Button>`（:678-688）通过 panel `onClose` prop 实现（task-03 §实现要求 4：panel 检测 onClose 存在时自动在 actions 区追加关闭按钮）。
- `inputControls`（原 :690-701）删除 —— panel 内部 hook 管 input 并经 `AgentRunPanel` 适配为 `AgentLogInputControls`（task-03 §实现要求 2 X-002）。
- `actions` 不显式传（原 actions 只有关闭按钮，由 onClose 接管）；若 execute 阶段需追加其他 actions 再补。
- `maxHeightClass`/`compact`/`variant` 不传（用 viewer 默认，活跃区是主面板形态）。

### 9. toolSummary 处理（依赖 activeLogs）

原 `toolSummary`（:313-326）依赖 `activeLogs`/`activeToolCalls`/`repliedInputs`。panel 接管 logs 后页面不再持有 activeLogs，**两个选择**（execute 阶段决策，本蓝图登记 trade-off）：

**方案 A（推荐，简化）**：删除 toolSummary，活跃 run summary 区只保留固定 LIVE 徽标（panel `isLive` prop 已驱动 viewer 内部 LIVE 标）。理由：原 summary 的"成功/失败/待审批/待指导"计数依赖实时 logs 解析，panel 接管后页面拿不到 logs；强行从 panel 暴露 logs 回传页面违反单向数据流（panel 是黑盒）。

**方案 B（保留 summary）**：panel 暴露 `onLogsChange?(logs): void` 回调，页面侧缓存最近一次 logs 计算 toolSummary。代价：panel 暴露内部状态、破坏 D-002 黑盒分层。

**本任务采用方案 A**：summary 区简化为空（或仅保留 isLive 触发的 viewer LIVE 徽标），删除 `activeToolCalls`/`toolSummary` useMemo（:305-326）。若产品要求保留 summary 计数，execute 阶段提 change（task-03 panel 扩展 onLogsChange）或改为 panel 内部计算 summary 节点（task-03 范围）。

> 验收提示：方案 A 下 summary prop 可省略（传 undefined），panel 默认无 summary 节点，viewer 头部只显示 LIVE 徽标 + 过滤 + 全屏 + 关闭按钮。

### 10. 历史展开区保持不变（:824-887）

**design §3 非目标**：历史展开（expandedRunId/expandedLogs + 下载按钮）保持直接 `<AgentLogViewer>`，**不套 panel**。

零改动确认：
- `handleExpandLogs`（:422-442）保留：拉 `getAgentRunLogs` 历史 → setExpandedLogs。
- 历史展开 JSX（:824-887）保留：`<AgentLogViewer title="运行日志" runId={run.id} logs={expandedLogs} loading={expandedLogsLoading} emptyText="无日志输出" maxHeightClass="max-h-[480px]" compact variant="embedded" actions={下载按钮} />`。
- 下载按钮（:859-882）保留：基于 expandedLogs 生成 .log 文件。
- StatPill 统计条（:828-849）保留：基于 run.* 字段（非 logs）。

## 边界处理

| # | 场景 | 处理 | 依据 |
|---|---|---|---|
| 1 | `activeRunId === null` | 不渲染 `<AgentRunPanel>`（外层 `{activeRunId && ...}` guard）；点击"查看日志"设 activeRunId → panel 挂载 → hook 连 SSE/prefetch | 原 :652 `{activeRunId && ...}` guard 保留 |
| 2 | activeRunId 有值但 run.status !== "running"（已完成/失败） | `isActiveRun=false`（§4 useMemo）→ panel 走 FR-06 路径：仅 prefetch 历史、不连 SSE；用户仍能看到该 run 历史日志（行为更完善，原逻辑此时不连 SSE 但也展示 handleSelectActive 预填的 logs，迁移后由 panel hook 统一拉历史） | D-001@v1 / FR-06 |
| 3 | 历史展开（expandedRunId）与活跃 panel 并存 | 互不影响：活跃 panel 看 running run，历史展开看 completed/failed/killed run，两者 runId 不同；panel 独立 hook 实例，历史展开仍走 `getAgentRunLogs` 一次性拉取 | design §3 非目标 |
| 4 | onDone 用 useCallback | `handleActiveRunDone` 用 `useCallback(fn, [reload])` 包裹，避免 panel 因 onDone 引用变化触发 hook 重连（hook useEffect 依赖 onDone） | design §实现要点 / R-01 |
| 5 | isActive 计算 memo | `isActiveRun` 用 `useMemo(fn, [activeRunId, runs])`，runs 变化（5s auto-reload）时重新派生；避免每次 render 重新计算 + panel isActive prop 抖动 | §4 |
| 6 | toolSummary 依赖 activeLogs | panel 接管 logs 后页面无 activeLogs；方案 A 删除 toolSummary + activeToolCalls useMemo（:305-326），summary prop 不传或传空 Fragment；方案 B 登记为后续扩展 | §9 |
| 7 | 删除的 import 残留检查 | `safeUUID`（:4）/`asString`（:27）原仅用于 streamAgentRunLogs onMessage，删除调用后必须同步删 import，否则 eslint no-unused-vars 报错 | R-04 / eslint |
| 8 | panel onClose 关闭按钮样式 | 原 :678-688 关闭按钮 `variant="ghost" className="text-zinc-500 hover:bg-zinc-900 hover:text-zinc-200"`；panel 内部关闭按钮样式由 task-03 定义（统一），本任务不透传自定义样式（接受 panel 默认） | task-03 §实现要求 4 |

## 非目标

- 不改 `agent-run-panel.tsx`（task-03 负责）。
- 不改 `agent.ts` 的 `streamAgentRunLogs` 定义（task-08 负责；本任务只删本文件的 import + 调用）。
- 不改 `agent-log-viewer.tsx`（design §3 非目标）。
- 不接管历史展开（expandedRunId + 下载按钮保持直接 `<AgentLogViewer>`，design §3 非目标）。
- 不扩展 panel 暴露 logs（方案 B 留作后续，本任务采方案 A 简化 summary）。
- 不改后端 / daemon（design §3 非目标）。
- 不写本文件单测（页面层迁移，集成验证依赖 task-04 panel 集成测试 + 手动验收 /agent AskUserQuestion）。

## 参考

- design.md §3（非目标 5 项）、§5.1 分层、§6 文件清单、§7.2 AgentRunPanel props、§10 R-04（删前 grep）
- requirements.md FR-01（删 streamAgentRunLogs）、FR-04（/agent 卡片渲染）、决策覆盖矩阵 D-002@v1
- plan.md W3 task-06、§调用点搜索记录（agent/page.tsx:33/:397）、全局验收标准第 1/3 条
- tasks/task-03.md §接口定义（AgentRunPanelProps 13 prop）、§实现要求 2（input 适配）、§实现要求 4（onClose 注入）、§边界处理 1/5
- `frontend/src/app/(dashboard)/workspaces/[id]/agent/page.tsx`（本任务源码）：
  - :4 `safeUUID` import（删）
  - :27 `asString` import（删）
  - :33 `streamAgentRunLogs` import（删）
  - :34 `submitAgentRunInput` import（删）
  - :244-254 activeRunId/activeLogs/logsLoading + input* 状态（删 activeLogs/logsLoading/input*，保留 activeRunId）
  - :305-326 activeToolCalls/toolSummary useMemo（方案 A 删，依赖 activeLogs）
  - :329-338 `reload` useCallback（保留，onDone 依赖）
  - :352-372 `handleSelectActive`（简化为仅 setActiveRunId）
  - :390-419 活跃 run SSE useEffect（整块删，panel 接管）
  - :422-442 `handleExpandLogs`（保留，历史展开）
  - :445-475 `handleSubmitInput`（整块删，panel 接管）
  - :652-704 活跃 AgentLogViewer（替换为 `<AgentRunPanel>`）
  - :706-925 历史运行表格 + 展开行（保持不变）
  - :824-887 历史展开 `<AgentLogViewer>` + 下载按钮（保持不变，design §3 非目标）

## TDD 步骤

> 页面层迁移任务，无新增单测（组件由 task-03 实现、集成测试由 task-04 负责）。遵循 CLAUDE.md "读现有代码 → 改实现 → 跑 lint/typecheck/test → 验收"。

1. **读现有代码**：已读 agent/page.tsx 全文（943 行）、task-03 AgentRunPanel props 契约、design §7.2、agent-run-panel.tsx（task-03 交付后）。
2. **改实现**：按本蓝图 §实现要求 1-10 顺序修改 agent/page.tsx。
3. **跑 typecheck**：`cd frontend && pnpm typecheck`（删除的 import / 状态不能有残留引用，tsc 兜底）。
4. **跑 lint**：`cd frontend && pnpm lint`（no-unused-vars / no-explicit-any）。
5. **跑 test**：`cd frontend && pnpm test`（确保现有测试不回归；本任务无新增测试）。
6. **手动验收**：启动 dev server，打开 /agent 页：
   - 触发一个 scan run（让 Claude Code 执行 AskUserQuestion）→ 观察审批卡片是否弹出（FR-04）。
   - 点"查看日志"/"关闭日志"切换活跃 run → panel 挂载/卸载正常。
   - 展开历史运行 → `<AgentLogViewer>` 历史日志 + 下载按钮正常（回归验证）。
7. **验收**：对照 §验收标准 逐项检查。

## 验收标准

| # | 标准 | 验证方法 |
|---|---|---|
| 1 | `grep streamAgentRunLogs frontend/src/app/(dashboard)/workspaces/[id]/agent/page.tsx` 无结果（import :33 + 调用 :397 已删） | `grep -n streamAgentRunLogs "frontend/src/app/(dashboard)/workspaces/[id]/agent/page.tsx"` 返回空 |
| 2 | `grep submitAgentRunInputs frontend/src/app/(dashboard)/workspaces/[id]/agent/page.tsx` 无结果（handleSubmitInput + import 删） | grep 返回空 |
| 3 | 活跃 run 区渲染 `<AgentRunPanel workspaceId={workspaceId} runId={activeRunId} isActive={isActiveRun} title="实时日志" ... onDone={handleActiveRunDone} onClose={...} />` | 代码 review |
| 4 | 历史展开区（:824-887 等价）保持直接 `<AgentLogViewer>`（无 AgentRunPanel 包裹）+ 下载按钮保留 | 代码 review（design §3 非目标） |
| 5 | `activeLogs`/`logsLoading`/`inputValues`/`submittingInputs`/`inputErrors`/`repliedInputs` state 已删 | grep 这些标识符在本文件无 `useState` 声明 |
| 6 | `handleSubmitInput` 已删 | grep 返回空 |
| 7 | 活跃 run SSE useEffect（原 :390-419）已删 | 代码 review：无 `streamAgentRunLogs(` 调用块 |
| 8 | `isActiveRun` 用 useMemo 派生（`run?.status === "running"`） | 代码 review |
| 9 | `handleActiveRunDone` 用 useCallback（依赖 `[reload]`） | 代码 review |
| 10 | `handleSelectActive` 简化为仅 setActiveRunId（无 getAgentRunLogs/setLogsLoading/setActiveLogs） | 代码 review |
| 11 | /agent 页 scan run 触发 AskUserQuestion → 审批卡片弹出（不再 5min 兜底超时）（FR-04） | 手动验收：触发 scan run + AskUserQuestion，观察卡片 |
| 12 | 历史展开日志 + 下载按钮回归正常（无回归） | 手动验收：展开一条历史 run |
| 13 | `cd frontend && pnpm typecheck` exit 0 | tsc 通过 |
| 14 | `cd frontend && pnpm lint` exit 0（无 unused import / any） | eslint 通过 |
| 15 | `cd frontend && pnpm test` exit 0（现有测试不回归） | vitest 通过 |
| 16 | 仅修改 `frontend/src/app/(dashboard)/workspaces/[id]/agent/page.tsx` | `git diff --name-only` 仅含此文件 |
