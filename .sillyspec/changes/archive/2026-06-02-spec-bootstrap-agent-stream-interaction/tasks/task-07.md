---
id: task-07
title: Workspace 详情页接入 bootstrap SSE 和内联输入
priority: P0
estimated_hours: 5
depends_on: [task-06]
blocks: [task-09]
allowed_paths:
  - frontend/src/app/(dashboard)/workspaces/[id]/page.tsx
  - frontend/src/lib/spec-workspaces.ts
  - frontend/src/lib/agent.ts
author: qinyi
created_at: 2026-06-02T10:08:47
---

# task-07: Workspace 详情页接入 bootstrap SSE 和内联输入

## 修改文件

| 操作 | 文件路径 | 说明 |
|---|---|---|
| 修改 | `frontend/src/app/(dashboard)/workspaces/[id]/page.tsx` | Bootstrap 后立即连接 SSE 流、展示实时日志、处理 pending_input 事件、提供内联用户输入入口、展示终态结果。替换旧同步 bootstrap 结果 UI。 |
| 修改 | `frontend/src/lib/spec-workspaces.ts` | 仅当 task-06 未完成时补齐 `BootstrapResult` 类型更新；如果 task-06 已完成则不改动此文件。 |

## 实现要求

1. **替换旧 bootstrap 同步 UI**：移除当前 `bootstrapResult` 状态中对 `command`、`agent_exit_code`、`stdout`、`stderr`、`validation_passed` 的渲染代码。这些字段在 task-06 中已从 `BootstrapResult` 类型中移除。
2. **新增 bootstrap run 追踪状态**：点击 Bootstrap 后，将响应中的 `agent_run_id` 存入 `activeBootstrapRunId: string | null` 状态，作为 SSE 连接和日志展示的锚点。
3. **立即连接 SSE 流**：Bootstrap API 返回后，调用已有的 `streamAgentRunLogs(workspaceId, runId, onMessage, onDone, onError)` 建立 SSE 连接。`onMessage` 回调将 `StreamLogEvent` 追加到本地日志数组 `bootstrapLogs`。
4. **日志去重**：SSE 回放历史日志可能和首次 `getAgentRunLogs` 返回的条目重复。去重逻辑为：`run_id + timestamp + channel + content` 四元组相同则跳过。参考 Agent 控制台 `agent/page.tsx` 中已有的去重模式。
5. **实时日志面板**：在 Spec Workspace 卡片中，当 `activeBootstrapRunId` 非 null 时，显示一个日志面板区域，展示 `bootstrapLogs` 数组中的日志条目。面板样式复用 Agent 控制台的日志行模式（时间戳 + channel tag + 内容）。
6. **pending_input 事件处理**：当 SSE 推送的 `StreamLogEvent.channel === "pending_input"` 时，在日志面板下方显示一个内联输入区域（文本框 + 提交按钮），提示用户"Agent 请求指导"。
7. **用户输入提交**：用户填写输入后，调用 `submitAgentRunInput(workspaceId, runId, { content })`（由 task-06 新增的 API）。提交成功后将输入内容作为 `user_input` channel 日志追加到 `bootstrapLogs`，并隐藏输入区域。提交时禁用按钮防止重复提交。
8. **SSE 终态处理**：`onDone` 回调触发时，说明后端发送了 `done` 事件（run 终态）。此时关闭 SSE、刷新 SpecWorkspace 状态（调用 `load()` 重新获取 `sync_status` 等信息），并保留日志面板供用户查看历史。
9. **SSE 错误处理**：`onError` 回调将错误信息写入 `pageError`，不断开已接收的日志。关闭 SSE。
10. **Abort bootstrap 按钮**：当 SSE 连接活跃时（run 状态为 pending/running），Bootstrap 按钮文字改为 "Bootstrap 运行中..." 并禁用。在日志面板标题栏增加一个"关闭"按钮，允许用户关闭日志面板和 SSE 连接。
11. **清理逻辑**：组件卸载时（`useEffect` cleanup）关闭 EventSource，避免内存泄漏。用户手动关闭日志面板或触发新 bootstrap 时也关闭旧的 EventSource。

## 接口定义

### 新增状态变量

```typescript
// 替换旧的 bootstrapResult
const [activeBootstrapRunId, setActiveBootstrapRunId] = useState<string | null>(null);
const [bootstrapLogs, setBootstrapLogs] = useState<AgentRunLogEntry[]>([]);
const [bootstrapStatus, setBootstrapStatus] = useState<AgentRunStatus | null>(null);
const [bootstrapError, setBootstrapError] = useState<string | null>(null);
const [pendingInputPrompt, setPendingInputPrompt] = useState<string | null>(null);
const [userInputText, setUserInputText] = useState("");
const [submittingInput, setSubmittingInput] = useState(false);
```

### SSE 连接控制

```typescript
const bootstrapEsRef = useRef<EventSource | null>(null);

function closeBootstrapStream() {
  bootstrapEsRef.current?.close();
  bootstrapEsRef.current = null;
}

// 在 useEffect cleanup 中调用 closeBootstrapStream()
```

### handleBootstrap 控制流伪代码

```
handleBootstrap():
  1. setBootstrapping(true)
  2. setPageError(null)
  3. closeBootstrapStream()           // 关闭旧连接
  4. setActiveBootstrapRunId(null)
  5. setBootstrapLogs([])
  6. setBootstrapStatus(null)
  7. setPendingInputPrompt(null)
  8. try:
       result = await bootstrapSpecWorkspace(workspaceId)
       setActiveBootstrapRunId(result.agent_run_id)
       setBootstrapStatus(result.status)
       // 立即建立 SSE
       es = streamAgentRunLogs(
         workspaceId,
         result.agent_run_id,
         onMessage(event):
           去重检查
           追加到 bootstrapLogs
           if event.channel === "pending_input":
             setPendingInputPrompt(event.content)
         ,
         onDone():
           setBootstrapStatus("completed")  // 或根据最后已知状态
           closeBootstrapStream()
           void load()                       // 刷新 SpecWorkspace 状态
         ,
         onError(err):
           setBootstrapError(err.message)
           closeBootstrapStream()
       )
       bootstrapEsRef.current = es
     catch (err):
       setPageError(err instanceof ApiError ? err.message : "初始化失败")
     finally:
       setBootstrapping(false)
```

### handleSubmitInput 控制流伪代码

```
handleSubmitInput():
  1. if !activeBootstrapRunId or !userInputText.trim(): return
  2. setSubmittingInput(true)
  3. try:
       await submitAgentRunInput(workspaceId, activeBootstrapRunId, {
         content: userInputText.trim()
       })
       // 追加 user_input 日志到面板
       setBootstrapLogs(prev => [...prev, {
         id: crypto.randomUUID(),
         run_id: activeBootstrapRunId,
         timestamp: new Date().toISOString(),
         channel: "user_input",
         content_redacted: userInputText.trim(),
       }])
       setUserInputText("")
       setPendingInputPrompt(null)     // 隐藏输入区域
     catch (err):
       setPageError(err instanceof ApiError ? err.message : "提交输入失败")
     finally:
       setSubmittingInput(false)
```

### 日志面板渲染结构

```
{activeBootstrapRunId && (
  <div className="mx-4 mt-3 rounded border bg-muted/40">
    {/* 面板标题栏 */}
    <div className="flex items-center justify-between border-b px-3 py-1.5">
      <div className="flex items-center gap-2">
        <code className="text-[11px] font-mono">
          Bootstrap Run: {activeBootstrapRunId.slice(0, 8)}...
        </code>
        <Badge variant={statusToVariant(bootstrapStatus)}>
          {bootstrapStatus ?? "connecting"}
        </Badge>
      </div>
      <Button size="sm" variant="ghost" onClick={closeBootstrapPanel}>
        关闭
      </Button>
    </div>

    {/* 日志区域 */}
    <div className="max-h-[300px] overflow-auto">
      {bootstrapLogs.length === 0 ? (
        <p className="px-3 py-6 text-center text-xs text-muted-foreground">
          等待日志输出...
        </p>
      ) : (
        <div className="divide-y">
          {bootstrapLogs.map(log => (
            <div key={log.id} className="flex items-start gap-2 px-3 py-1.5">
              <span className="shrink-0 font-mono text-[11px] text-muted-foreground">
                {new Date(log.timestamp).toLocaleTimeString()}
              </span>
              <span className={`shrink-0 font-mono text-[11px] font-medium ${channelTagCls(log.channel)}`}>
                [{channelLabel(log.channel)}]
              </span>
              <span className="flex-1 break-all text-[11px]">
                {renderLogContent(log)}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>

    {/* 用户输入区域 (仅当 pendingInputPrompt 非 null 时显示) */}
    {pendingInputPrompt && (
      <div className="border-t px-3 py-2">
        <p className="text-xs text-amber-700 font-medium mb-1">
          Agent 请求指导: {pendingInputPrompt}
        </p>
        <div className="flex gap-2">
          <input
            type="text"
            className="flex-1 rounded border bg-background px-2 py-1 text-xs"
            placeholder="输入指导..."
            value={userInputText}
            onChange={e => setUserInputText(e.target.value)}
            onKeyDown={e => {
              if (e.key === "Enter" && !submittingInput) handleSubmitInput();
            }}
          />
          <Button
            size="sm"
            disabled={!userInputText.trim() || submittingInput}
            onClick={handleSubmitInput}
          >
            {submittingInput ? "提交中..." : "提交"}
          </Button>
        </div>
      </div>
    )}

    {/* 错误提示 */}
    {bootstrapError && (
      <div className="border-t px-3 py-2 text-xs text-destructive">
        {bootstrapError}
      </div>
    )}
  </div>
)}
```

### 辅助函数

```typescript
function channelLabel(channel: string): string {
  switch (channel) {
    case "stdout": return "INFO";
    case "stderr": return "WARN";
    case "tool_call": return "TOOL";
    case "pending_input": return "INPUT";
    case "user_input": return "USER";
    default: return channel.toUpperCase();
  }
}

function channelTagCls(channel: string): string {
  switch (channel) {
    case "stderr": return "text-amber-600";
    case "tool_call": return "text-blue-600";
    case "pending_input": return "text-amber-700";
    case "user_input": return "text-emerald-700";
    default: return "text-muted-foreground";
  }
}

function statusToVariant(status: AgentRunStatus | null): "success" | "warning" | "destructive" | "outline" {
  switch (status) {
    case "completed": return "success";
    case "running": return "warning";
    case "failed":
    case "killed": return "destructive";
    default: return "outline";
  }
}
```

### 导入更新

```typescript
import {
  streamAgentRunLogs,
  submitAgentRunInput,
  type AgentRunLogEntry,
  type AgentRunStatus,
  type StreamLogEvent,
} from "@/lib/agent";

import {
  bootstrapSpecWorkspace,
  getSpecWorkspace,
  importSpecWorkspace,
  syncSpecWorkspace,
  type BootstrapResult,
  type SpecWorkspace,
} from "@/lib/spec-workspaces";
```

## 边界处理

1. **BootstrapResult 类型迁移**：task-06 将 `BootstrapResult` 改为 `{ agent_run_id, stream_url, status, spec_root, message }`。本任务所有引用 `BootstrapResult` 的代码必须只使用新字段。如果 task-06 尚未执行（旧类型仍存在），则本任务必须自行更新 `spec-workspaces.ts` 中的 `BootstrapResult` 类型，与 task-06 的接口定义保持一致。
2. **SSE 连接晚于日志产生**：`streamAgentRunLogs()` 的 SSE 首包会回放后端已持久化日志。去重逻辑（`timestamp + channel + content`）必须处理回放日志与手动加载历史日志的重复，不能丢失任何日志条目。
3. **空 bootstrapLogs**：SSE 建立后可能延迟几百毫秒才收到首包。面板初始显示"等待日志输出..."，不要显示"无日志"。
4. **pendingInputPrompt 为空字符串**：`pending_input` 事件的 `content` 可能为空字符串。此时仍显示输入区域，但提示文字改为通用"Agent 请求指导"（不带冒号后的空内容）。
5. **重复点击 Bootstrap**：`handleBootstrap` 开头调用 `closeBootstrapStream()` 关闭旧 SSE，重置所有 bootstrap 状态，确保不会累积多个 EventSource 或混合旧 run 的日志。
6. **组件卸载清理**：`useEffect` 返回的 cleanup 函数必须调用 `closeBootstrapStream()`，防止 EventSource 泄漏。不在 cleanup 中修改 state（React 已经卸载）。
7. **submitAgentRunInput 网络失败**：提交失败时将错误写入 `pageError`，不清空用户已输入的文本，不隐藏输入区域，用户可以重试。
8. **Bootstrap API 返回失败**：如果 `bootstrapSpecWorkspace()` 本身返回非 200，`catch` 块设置 `pageError`，不进入 SSE 连接流程，`activeBootstrapRunId` 保持 null。
9. **onDone 后不自动清空日志**：run 终态（completed/failed/killed）后，日志面板保持显示，用户可以查看完整历史。只有用户点击"关闭"或触发新 bootstrap 时才清空。
10. **旧 bootstrapResult 引用清理**：移除所有对 `BootstrapResult` 旧字段（`command`、`stdout`、`stderr`、`agent_exit_code`、`validation_passed`、`errors`、`warnings`、`sync_status`）的渲染代码，确保 TypeScript 编译通过。
11. **SpecWorkspace 刷新时机**：`onDone` 回调中调用 `load()` 刷新页面数据（包括 `sync_status`），但不依赖刷新结果来决定日志面板的显示状态。
12. **用户输入 trim**：`handleSubmitInput` 中 `userInputText.trim()` 作为实际提交内容，空字符串不触发提交（按钮 disabled）。不在 API wrapper 层 trim（task-06 约定），由 UI 层控制。

## 非目标

- 不修改 `frontend/src/app/(dashboard)/workspaces/[id]/agent/page.tsx`（Agent 控制台的 pending input UI 由 task-08 负责）。
- 不新增 React Component 文件；所有 UI 直接写在 `page.tsx` 中，与当前页面风格一致。
- 不引入 React Query、Zustand 新 store 或其他状态管理库。
- 不实现 Agent 进程级 stdin 直连、暂停/恢复或完整交互式 session。
- 不实现 bootstrap run 的 kill/stop 操作（当前页面只展示日志和提交输入）。
- 不修改后端 endpoint、SSE 行为或 AgentRunLog 持久化逻辑。
- 不修改 `frontend/src/lib/agent.ts` 中 `streamAgentRunLogs` 的 URL 结构或 token 认证方式。
- 不更新 `.sillyspec/docs/` 文档；文档同步由 task-09 统一处理。
- 不添加 bootstrap run 历史列表（多次 bootstrap 的历史查看不在此范围）。
- 不处理 `tool_call` channel 中的 approval 审批交互；本任务只展示日志文本。

## 参考

- `.sillyspec/changes/2026-06-02-spec-bootstrap-agent-stream-interaction/design.md`
  - 前端交互：点击 Bootstrap -> 调 `/spec-bootstrap` -> 保存 run id -> 连 SSE -> 展示日志/pending_input -> 提交指导。
  - 决策 4：用户确认/指导先落在 AgentRunLog/SSE，不实现完整暂停恢复。
- `.sillyspec/changes/2026-06-02-spec-bootstrap-agent-stream-interaction/plan.md`
  - task-07 依赖 task-06（前端 API 类型和用户输入 API），阻塞 task-09（文档同步）。
- `.sillyspec/changes/2026-06-02-spec-bootstrap-agent-stream-interaction/tasks/task-06.md`
  - `BootstrapResult` 新类型：`{ agent_run_id, stream_url, status, spec_root, message }`。
  - `submitAgentRunInput(workspaceId, runId, { content })` API wrapper。
  - `AgentRunLogChannel` 包含 `pending_input` 和 `user_input`。
  - `StreamLogEvent.channel` 已扩展为 `AgentRunLogChannel`。
- `frontend/src/app/(dashboard)/workspaces/[id]/agent/page.tsx`
  - SSE 连接模式：`streamAgentRunLogs()` + `useRef<EventSource>` + cleanup close。
  - 日志去重：`run_id + timestamp + channel + content` 四元组。
  - 日志行渲染：`levelTag()` channel 标签 + 时间戳 + 内容。
  - `renderConversationLog()` 解析 `[TOOL_USE]`/`[THINKING]`/`[ASSISTANT]` 前缀。
- `frontend/src/lib/agent.ts`
  - `streamAgentRunLogs()`、`submitAgentRunInput()`、类型导出。
- `frontend/src/lib/spec-workspaces.ts`
  - `bootstrapSpecWorkspace()` 返回新 `BootstrapResult`。
- `.sillyspec/docs/frontend/scan/CONVENTIONS.md`
  - API 模块通过 `apiFetch<T>()` 发起请求。
  - SSE 使用 `EventSource` + `?token=` query 认证。
  - 页面组件使用 `useState + useEffect` 模式，不使用 React Query。
  - 样式：Tailwind 原子类，卡片 `rounded-md border bg-card`。
  - 字号：`text-xs` (12px)、`text-[11px]`、`text-sm` (14px)。
- `.sillyspec/docs/frontend/scan/INTEGRATIONS.md`
  - SSE 认证：`url.searchParams.set("token", accessToken)`。
  - 前端按 `run_id + timestamp + channel + content` 去重避免历史与回放重复。

## TDD 步骤

1. **确认 task-06 状态**：检查 `BootstrapResult` 类型是否已更新。如果 task-06 未执行，先更新 `spec-workspaces.ts` 中的类型定义（参考 task-06 接口定义），确保编译通过。
2. **TypeScript 编译检查**：修改 `page.tsx` 前，运行 `cd frontend && pnpm typecheck 2>&1 | grep 'page.tsx'` 确认旧 bootstrap 字段的编译错误位置（如 task-06 已完成则会报错）。
3. **移除旧 bootstrap UI**：删除 `bootstrapResult` 状态变量及其在 JSX 中的渲染块（显示 command/exit code/stdout/stderr 的 `div`）。
4. **新增状态和导入**：添加 `activeBootstrapRunId`、`bootstrapLogs`、`bootstrapStatus`、`bootstrapError`、`pendingInputPrompt`、`userInputText`、`submittingInput` 状态。添加 `bootstrapEsRef`。更新导入。
5. **实现 handleBootstrap**：替换旧 handleBootstrap，改为调用 API -> 保存 run id -> 连接 SSE -> 追加日志。
6. **实现 handleSubmitInput**：新增用户指导提交处理函数。
7. **实现 closeBootstrapPanel**：关闭 SSE、清空 bootstrap 追踪状态。
8. **添加 useEffect cleanup**：组件卸载时关闭 EventSource。
9. **实现日志面板 JSX**：在 Spec Workspace 卡片中，替换旧 bootstrap 结果展示区域，渲染新的日志面板和用户输入区域。
10. **实现辅助函数**：`channelLabel`、`channelTagCls`、`statusToVariant`。
11. **运行 typecheck**：
    ```bash
    cd frontend && pnpm typecheck
    ```
12. **运行 lint**：
    ```bash
    cd frontend && pnpm lint
    ```
13. **手动验证**（如环境允许）：在浏览器中打开 Workspace 详情页，点击 Bootstrap，确认：
    - 日志面板出现并实时更新。
    - pending_input 事件触发输入区域显示。
    - 提交输入后输入区域消失，日志中出现 user_input。
    - run 完成后日志面板保留，SpecWorkspace 状态刷新。
    - 关闭按钮清空面板。
    - 重复点击 Bootstrap 关闭旧连接并重置。

## 验收标准

| # | 验证步骤 | 通过标准 |
|---|---|---|
| AC-01 | 检查 `page.tsx` 中 `BootstrapResult` 引用 | 不再引用旧字段 `command`、`stdout`、`stderr`、`agent_exit_code`、`validation_passed`、`errors`、`warnings`、`sync_status` |
| AC-02 | 检查 `page.tsx` 状态变量 | 存在 `activeBootstrapRunId`、`bootstrapLogs`、`bootstrapStatus`、`pendingInputPrompt`、`userInputText`、`submittingInput` |
| AC-03 | 检查 EventSource ref | 存在 `bootstrapEsRef = useRef<EventSource \| null>(null)` |
| AC-04 | 检查 `handleBootstrap` 函数 | 调用 `bootstrapSpecWorkspace()` 后用 `streamAgentRunLogs()` 建立 SSE，不使用旧同步结果渲染 |
| AC-05 | 检查 SSE `onMessage` 回调 | 对 `StreamLogEvent` 做去重后追加到 `bootstrapLogs`；对 `pending_input` channel 设置 `pendingInputPrompt` |
| AC-06 | 检查 SSE `onDone` 回调 | 关闭 SSE、调用 `load()` 刷新 SpecWorkspace 状态 |
| AC-07 | 检查 SSE `onError` 回调 | 将错误写入 `bootstrapError`，关闭 SSE |
| AC-08 | 检查 `handleSubmitInput` 函数 | 调用 `submitAgentRunInput()`，提交后追加 `user_input` 日志到面板、清空输入文本、隐藏输入区域 |
| AC-09 | 检查 `handleSubmitInput` 空值防护 | `userInputText` 为空或纯空白时不触发提交（按钮 disabled） |
| AC-10 | 检查 `handleSubmitInput` 失败处理 | 提交失败时不清空输入文本，不隐藏输入区域，错误写入 `pageError` |
| AC-11 | 检查重复点击 Bootstrap | `handleBootstrap` 开头调用 `closeBootstrapStream()` 关闭旧 EventSource，重置所有 bootstrap 状态 |
| AC-12 | 检查组件卸载 cleanup | `useEffect` 返回的 cleanup 调用 `closeBootstrapStream()`，不修改已卸载的 state |
| AC-13 | 检查日志面板渲染 | 当 `activeBootstrapRunId` 非 null 时显示日志面板；空日志时显示"等待日志输出..." |
| AC-14 | 检查 pending_input UI | `pendingInputPrompt` 非 null 时在日志面板底部显示文本输入框和提交按钮 |
| AC-15 | 检查日志行格式 | 每行包含时间戳、channel 标签（INFO/WARN/TOOL/INPUT/USER）、日志内容 |
| AC-16 | 检查 run 终态面板行为 | `onDone` 后日志面板保持显示，不清空日志；SpecWorkspace 的 `sync_status` 被刷新 |
| AC-17 | 检查 closeBootstrapPanel | 关闭 EventSource、清空 `activeBootstrapRunId` 和 `bootstrapLogs`，面板消失 |
| AC-18 | 运行 `cd frontend && pnpm typecheck` | 编译通过，无 `page.tsx` 类型错误 |
| AC-19 | 运行 `cd frontend && pnpm lint` | lint 通过，无新增 warning/error |
| AC-20 | 检查导入来源 | `streamAgentRunLogs`、`submitAgentRunInput`、`AgentRunLogEntry`、`AgentRunStatus`、`StreamLogEvent` 从 `@/lib/agent` 导入 |
| AC-21 | 检查变更范围 | 仅修改 `page.tsx`；如果 task-06 未完成，则同时更新 `spec-workspaces.ts` 的 `BootstrapResult` 类型 |
