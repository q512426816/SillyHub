---
id: task-08
title: "Agent 控制台接入 pending input 和用户指导输入"
priority: P1
estimated_hours: 4
depends_on:
  - task-06
blocks:
  - task-09
  - task-10
allowed_paths:
  - frontend/src/app/(dashboard)/workspaces/[id]/agent/page.tsx
author: qinyi
created_at: 2026-06-02T12:00:00
---

# task-08: Agent 控制台接入 pending input 和用户指导输入

## 修改文件

| 操作 | 文件路径 | 说明 |
|---|---|---|
| 修改 | `frontend/src/app/(dashboard)/workspaces/[id]/agent/page.tsx` | 在活跃 run 的 Tool Call Stream 面板中识别 `pending_input` 日志并渲染交互输入面板；识别 `user_input` 日志并展示已提交指导；调用 `submitAgentRunInput()` 提交用户输入。 |

## 实现要求

1. 在活跃 run 的日志流（Tool Call Stream 面板）中，当检测到 `channel === "pending_input"` 的 `AgentRunLogEntry` 时，在该条日志下方渲染一个用户指导输入面板：
   - 一个单行 `<Input>` 用于输入指导文本
   - 一个"提交指导" `<Button>`
   - 提交按钮在输入为空或正在提交时 disabled
   - 提交调用 task-06 提供的 `submitAgentRunInput(workspaceId, runId, { content })` API
2. 当检测到 `channel === "user_input"` 的日志时，在该条日志下方展示已提交的用户指导内容（只读，使用蓝色背景高亮区分）。
3. 一个 pending_input 条目在被用户提交指导后，视觉上应标记为"已回复"（显示绿色 Badge "已回复"），但不隐藏或删除原始 pending_input 日志。
4. 在活跃 run 卡片的 tool summary 栏中，新增"待指导"计数，统计当前活跃日志中 `pending_input` channel 的条目数（未被回复的数量）。
5. 提交成功后通过 SSE 或 reload 获取新的 `user_input` 日志，自动滚动到底部。提交失败时显示内联错误提示，不清空输入框。
6. 对于已完成 run 的展开日志面板（expandedLogs），也识别 `pending_input` 和 `user_input` channel，用不同的视觉样式展示（pending_input 用琥珀色边框，user_input 用蓝色边框），但不提供输入框交互。
7. `levelTag()` 辅助函数扩展，为 `pending_input` 和 `user_input` 返回合适的标签和颜色。

## 接口定义

### 依赖的 API 类型（由 task-06 提供，本任务直接 import）

```typescript
import {
  submitAgentRunInput,
  type AgentRunInputRequest,
  type AgentRunInputResponse,
  type AgentRunLogChannel,
} from "@/lib/agent";
```

- `submitAgentRunInput(workspaceId: string, runId: string, input: AgentRunInputRequest): Promise<AgentRunInputResponse>`
- `AgentRunInputRequest = { content: string }`
- `AgentRunInputResponse = { run_id: string; accepted: boolean }`

### 新增组件内部状态

```typescript
// 指导输入状态：key 为 pending_input 日志条目的 id
const [inputValues, setInputValues] = useState<Record<string, string>>({});
// 提交中状态：key 为 pending_input 日志条目的 id
const [submittingInputs, setSubmittingInputs] = useState<Record<string, boolean>>({});
// 提交错误状态
const [inputErrors, setInputErrors] = useState<Record<string, string>>({});
// 已回复的 pending_input 条目 id 集合
const [repliedInputs, setRepliedInputs] = useState<Set<string>>(new Set());
```

### 新增辅助函数

```typescript
/**
 * 判断一个 pending_input 日志是否已被回复。
 * 遍历该 pending_input 之后的所有 user_input 日志，
 * 如果存在时间戳晚于该 pending_input 的 user_input，则视为已回复。
 */
function isPendingReplied(
  logId: string,
  logTimestamp: string,
  allLogs: AgentRunLogEntry[],
): boolean {
  return allLogs.some(
    (l) =>
      l.channel === "user_input" &&
      l.timestamp >= logTimestamp,
  );
}

/**
 * levelTag 扩展：新增 pending_input 和 user_input 的标签和颜色
 */
function levelTag(channel: string): { label: string; cls: string } {
  switch (channel) {
    case "tool_call":
      return { label: "TOOL", cls: "text-blue-600" };
    case "stderr":
      return { label: "WARN", cls: "text-amber-600" };
    case "pending_input":
      return { label: "PENDING", cls: "text-amber-700 font-medium" };
    case "user_input":
      return { label: "INPUT", cls: "text-blue-700 font-medium" };
    default:
      return { label: "INFO", cls: "text-muted-foreground" };
  }
}
```

### 提交处理函数

```typescript
const handleSubmitInput = useCallback(
  async (pendingLogId: string, runId: string) => {
    const content = inputValues[pendingLogId]?.trim();
    if (!content) return;

    setSubmittingInputs((prev) => ({ ...prev, [pendingLogId]: true }));
    setInputErrors((prev) => {
      const next = { ...prev };
      delete next[pendingLogId];
      return next;
    });

    try {
      const result = await submitAgentRunInput(workspaceId, runId, { content });
      if (result.accepted) {
        setRepliedInputs((prev) => new Set(prev).add(pendingLogId));
        setInputValues((prev) => {
          const next = { ...prev };
          delete next[pendingLogId];
          return next;
        });
      }
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : "提交失败";
      setInputErrors((prev) => ({ ...prev, [pendingLogId]: msg }));
    } finally {
      setSubmittingInputs((prev) => ({ ...prev, [pendingLogId]: false }));
    }
  },
  [workspaceId, inputValues],
);
```

### pending_input 交互面板渲染逻辑（伪代码）

在 Tool Call Stream 的日志列表中，每条日志渲染后追加：

```
if (log.channel === "pending_input") {
  const isReplied = repliedInputs.has(log.id)
    || isPendingReplied(log.id, log.timestamp, activeLogs);

  if (isReplied) {
    render: Badge "已回复" (variant="success")
  } else {
    render:
      <div className="flex gap-2 mt-1 px-3 py-1.5 bg-amber-50 border border-amber-200 rounded">
        <Input
          placeholder="输入指导文本..."
          value={inputValues[log.id] ?? ""}
          onChange={(e) => setInputValues(prev => ({...prev, [log.id]: e.target.value}))
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void handleSubmitInput(log.id, activeRunId);
            }
          }}
          disabled={submittingInputs[log.id]}
          className="text-xs h-7"
        />
        <Button
          size="sm"
          variant="default"
          onClick={() => void handleSubmitInput(log.id, activeRunId)}
          disabled={!inputValues[log.id]?.trim() || submittingInputs[log.id]}
        >
          {submittingInputs[log.id] ? "提交中..." : "提交指导"}
        </Button>
      </div>
      {inputErrors[log.id] && (
        <p className="text-xs text-destructive mt-1 px-3">{inputErrors[log.id]}</p>
      )}
  }
}
```

### 已完成 run 的只读 pending_input / user_input 展示

在 `expandedLogs` 渲染中，`renderConversationLog` 之后增加 channel 判断：

```
if (log.channel === "pending_input") {
  // 渲染为琥珀色边框卡片，只读展示 content_redacted
  <div className="ml-2 border-l-2 border-amber-400 pl-2 text-xs text-amber-800 bg-amber-50 rounded px-2 py-1">
    [待确认] {log.content_redacted}
  </div>
}

if (log.channel === "user_input") {
  // 渲染为蓝色边框卡片，只读展示 content_redacted
  <div className="ml-2 border-l-2 border-blue-400 pl-2 text-xs text-blue-800 bg-blue-50 rounded px-2 py-1">
    [用户指导] {log.content_redacted}
  </div>
}
```

### toolSummary 扩展

在现有 `toolSummary` 的 useMemo 中增加 `pendingGuidance` 计数：

```typescript
const pendingGuidance = activeLogs
  ? activeLogs.filter(
      (l) =>
        l.channel === "pending_input" &&
        !isPendingReplied(l.id, l.timestamp, activeLogs) &&
        !repliedInputs.has(l.id),
    ).length
  : 0;

const toolSummary = useMemo(() => {
  const success = activeToolCalls.filter((t) => t.success && t.status === "allowed").length;
  const failed = activeToolCalls.filter((t) => !t.success).length;
  const pending = activeToolCalls.filter((t) => t.status === "pending").length;
  return { success, failed, pending, pendingGuidance };
}, [activeToolCalls, activeLogs, repliedInputs]);
```

在 Tool Call Stream 面板的 header 中展示：

```tsx
{toolSummary.pendingGuidance > 0 && (
  <Badge variant="warning">{toolSummary.pendingGuidance} 待指导</Badge>
)}
```

## 边界处理

1. **空输入提交**：提交按钮在 `inputValues[log.id]?.trim()` 为空时 disabled，后端也会校验。前端不 trim 后提交，保持用户原始输入。
2. **重复提交**：`submittingInputs[log.id]` 为 true 时 disabled 按钮和输入框，防止重复请求。
3. **SSE 新日志中的 pending_input**：通过 `streamAgentRunLogs` 的 `onMessage` 回调自动追加到 `activeLogs`，输入面板随日志列表自动渲染，无需额外轮询。
4. **已完成 run 不展示输入框**：已完成 run 的展开日志面板（expandedLogs）只展示只读标记，不渲染 Input 和 Button。
5. **repliedInputs 与 SSE 的竞争**：用户提交成功后立即将 pendingLogId 加入 `repliedInputs`，不等 SSE 推送 `user_input` 日志。SSE 推送的 `user_input` 日志会作为普通日志渲染蓝色边框卡片，与 `repliedInputs` 标记互补而非冲突。
6. **多个 pending_input 条目**：每个 pending_input 条目维护独立的 `inputValues[logId]` 和 `submittingInputs[logId]` 状态，互不干扰。
7. **submitAgentRunInput 失败**：捕获异常后在内联显示错误信息（`inputErrors[logId]`），不清空输入框，用户可修改后重试。
8. **activeLogs 为 null 或空**：`pendingGuidance` 计算使用 `activeLogs ? ... : 0` 防御空值。
9. **旧 channel 类型兼容**：`levelTag()` 对 `stdout/stderr/tool_call` 保持原有返回值，新增 case 不影响已有逻辑。
10. **页面离开时清理**：SSE 连接由现有 `useEffect` cleanup 中的 `es.close()` 管理；`inputValues`/`submittingInputs` 等状态随组件卸载自动清理，无需额外操作。

## 非目标

- 不修改 `frontend/src/lib/agent.ts` 或 `frontend/src/lib/spec-workspaces.ts`（API 类型由 task-06 负责）。
- 不修改 `frontend/src/app/(dashboard)/workspaces/[id]/page.tsx`（Workspace 详情页的 bootstrap SSE 和内联输入由 task-07 负责）。
- 不修改后端 endpoint、权限校验或 Redis publish 行为。
- 不实现完整暂停/恢复协议或 stdin 直连。
- 不修改 `levelTag` 对已有 `stdout/stderr/tool_call` channel 的行为。
- 不新增独立组件文件；所有变更在 `agent/page.tsx` 内完成。
- 不更新 `.sillyspec/docs/` 文档（文档同步由 task-09 处理）。

## 参考

- `.sillyspec/changes/2026-06-02-spec-bootstrap-agent-stream-interaction/design.md` -- 决策 4：用户确认/指导先落在 AgentRunLog/SSE；前端交互：Agent 控制台部分。
- `.sillyspec/changes/2026-06-02-spec-bootstrap-agent-stream-interaction/plan.md` -- task-08 在 Wave 3，依赖 task-06。
- `frontend/src/lib/agent.ts` -- task-06 完成后的类型定义：`AgentRunLogChannel`、`AgentRunInputRequest`、`AgentRunInputResponse`、`submitAgentRunInput()`。
- `frontend/src/app/(dashboard)/workspaces/[id]/agent/page.tsx` -- 现有 Agent 控制台页面，包含 Tool Call Stream 面板、活跃 run 卡片、已完成 run 表格和展开日志面板。
- `frontend/src/components/ui/input.tsx` -- 项目 Input 组件。
- `frontend/src/components/ui/button.tsx` -- 项目 Button 组件。
- `frontend/src/components/ui/badge.tsx` -- 项目 Badge 组件。
- `.sillyspec/changes/2026-06-02-spec-bootstrap-agent-stream-interaction/tasks/task-06.md` -- 前端 API 类型和用户输入 API 的完整定义。

## TDD 步骤

1. **写测试**（本任务无独立测试文件，但可通过以下方式验证）：
   - 手动验证：在本地启动前端，模拟 SSE 推送 `pending_input` 事件，确认输入面板渲染。
   - 手动验证：输入文本后点击提交，确认 `submitAgentRunInput` 被正确调用。
   - 手动验证：确认已完成 run 的展开日志面板中 `pending_input` 和 `user_input` 以只读样式展示。
2. **确认失败**：在修改前，确认 `pending_input` 日志在控制台无特殊渲染。
3. **写代码**：按上述接口定义修改 `agent/page.tsx`。
4. **确认通过**：
   - 运行 `cd frontend && pnpm typecheck` 确认无类型错误。
   - 运行 `cd frontend && pnpm lint` 确认无 lint 错误。
   - 手动测试 SSE 场景验证交互面板。
5. **回归**：确认现有活跃 run 的 Tool Call Stream 面板和已完成 run 的展开日志面板行为不变。

## 验收标准

| # | 验证步骤 | 通过标准 |
|---|---|---|
| AC-01 | 检查 `levelTag()` 函数 | 新增 `pending_input` 返回 `{ label: "PENDING", cls: "text-amber-700 font-medium" }`，`user_input` 返回 `{ label: "INPUT", cls: "text-blue-700 font-medium" }`。 |
| AC-02 | 在活跃 run 的 Tool Call Stream 中推送 `channel: "pending_input"` 日志 | 该条日志下方渲染包含 Input 和"提交指导" Button 的交互面板。 |
| AC-03 | 在交互面板中输入文本并点击提交 | 调用 `submitAgentRunInput(workspaceId, activeRunId, { content })`，提交成功后 pending_input 条目显示绿色 Badge "已回复"，输入框消失。 |
| AC-04 | 提交时空输入 | "提交指导" Button 处于 disabled 状态，无法点击。 |
| AC-05 | 提交中状态 | Button 文本变为"提交中..."，Input 和 Button 都 disabled。 |
| AC-06 | 提交失败 | 内联显示红色错误文本，Input 保留已输入内容，用户可重试。 |
| AC-07 | 在活跃 run 日志中推送 `channel: "user_input"` 日志 | 该条日志显示蓝色边框高亮的"[用户指导]"卡片。 |
| AC-08 | 在已完成 run 的展开日志中包含 `pending_input` 日志 | 显示琥珀色边框只读卡片 "[待确认]" + content，无 Input/Button。 |
| AC-09 | 在已完成 run 的展开日志中包含 `user_input` 日志 | 显示蓝色边框只读卡片 "[用户指导]" + content。 |
| AC-10 | Tool Call Stream 面板 header | 当存在未回复的 `pending_input` 时，显示 `<Badge variant="warning">N 待指导</Badge>`。 |
| AC-11 | 运行 `cd frontend && pnpm typecheck` | 通过，无类型错误。 |
| AC-12 | 运行 `cd frontend && pnpm lint` | 通过，无新增 lint 错误。 |
| AC-13 | 检查变更范围 | 只修改 `frontend/src/app/(dashboard)/workspaces/[id]/agent/page.tsx`，未修改其他文件。 |
