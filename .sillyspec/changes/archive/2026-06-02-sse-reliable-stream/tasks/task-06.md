---
author: qinyi
created_at: 2026-06-02T16:21:37
id: task-06
title: 前端 Workspace 详情页替换为 `AgentRunStreamClient`
priority: P0
estimated_hours: 1.5
depends_on: [task-05]
blocks: [task-10]
allowed_paths:
  - frontend/src/app/(dashboard)/workspaces/[id]/page.tsx
---

# 前端 Workspace 详情页替换为 `AgentRunStreamClient`

## 修改文件

| 文件 | 操作 | 说明 |
|---|---|---|
| `frontend/src/app/(dashboard)/workspaces/[id]/page.tsx` | 修改 | 替换手动 EventSource 管理，接入 `AgentRunStreamClient` |

## 实现要求

### 1. 导入替换

移除旧的 `streamAgentRunLogs` 导入，新增 `AgentRunStreamClient` 和 `StreamStatus`：

```typescript
// 移除
import { streamAgentRunLogs, ... } from "@/lib/agent";

// 新增
import { AgentRunStreamClient, type StreamStatus } from "@/lib/agent-stream";
```

保留以下导入不变：
- `submitAgentRunInput` — 用户输入提交仍走 HTTP
- `AgentRunLogEntry` / `AgentRunStatus` / `StreamLogEvent` — 类型仍需要

### 2. Ref 替换

将 `bootstrapEsRef` 替换为 `streamClientRef`：

```typescript
// 旧
const bootstrapEsRef = useRef<EventSource | null>(null);

// 新
const streamClientRef = useRef<AgentRunStreamClient | null>(null);
```

### 3. 新增 bootstrapStreamStatus state

```typescript
const [bootstrapStreamStatus, setBootstrapStreamStatus] = useState<StreamStatus>("disconnected");
```

### 4. handleBootstrap 重写

用 `new AgentRunStreamClient()` + 回调注册 + `connect(token)` 替换 `streamAgentRunLogs()`：

```typescript
async function handleBootstrap() {
  setBootstrapping(true);
  setPageError(null);
  closeBootstrapStream();
  setActiveBootstrapRunId(null);
  setBootstrapLogs([]);
  setBootstrapStatus(null);
  setBootstrapError(null);
  setPendingInputPrompt(null);

  try {
    const result = await bootstrapSpecWorkspace(workspaceId);
    setActiveBootstrapRunId(result.agent_run_id);
    setBootstrapStatus(result.status);

    const seenLogIds = new Set<number>();
    const client = new AgentRunStreamClient(workspaceId, result.agent_run_id);

    client.onStatusChange((status: StreamStatus) => {
      setBootstrapStreamStatus(status);
    });

    client.onMessage((event: StreamLogEvent) => {
      // 用 log_id 去重
      if (event.log_id != null) {
        if (seenLogIds.has(event.log_id)) return;
        seenLogIds.add(event.log_id);
      }
      setBootstrapLogs((prev) => [
        ...prev,
        {
          id: event.log_id != null ? String(event.log_id) : crypto.randomUUID(),
          run_id: result.agent_run_id,
          timestamp: event.timestamp,
          channel: event.channel,
          content_redacted: event.content,
        },
      ]);
      if (event.channel === "pending_input") {
        setPendingInputPrompt(event.content || "");
      }
    });

    client.onDone(() => {
      setBootstrapStatus("completed");
      closeBootstrapStream();
      void load();
    });

    // 从 session store 获取 token
    const { accessToken } = useSession.getState();
    client.connect(accessToken);
    streamClientRef.current = client;
  } catch (err) {
    setPageError(err instanceof ApiError ? err.message : "初始化失败");
  } finally {
    setBootstrapping(false);
  }
}
```

### 5. closeBootstrapStream 重写

```typescript
function closeBootstrapStream() {
  streamClientRef.current?.disconnect();
  streamClientRef.current = null;
  setBootstrapStreamStatus("disconnected");
}
```

### 6. 组件卸载清理

```typescript
useEffect(() => {
  void load();
  return () => {
    streamClientRef.current?.disconnect();
    streamClientRef.current = null;
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [workspaceId]);
```

### 7. Badge 显示 bootstrapStreamStatus

在 bootstrap panel 的 title bar 中，将 Badge 的显示从 `bootstrapStatus ?? "connecting"` 改为同时展示连接状态：

```tsx
<Badge variant={statusToVariant(bootstrapStatus)}>
  {bootstrapStatus ?? "connecting"}
</Badge>
{/* 连接状态指示器 */}
<Badge
  variant={
    bootstrapStreamStatus === "connected" ? "success"
    : bootstrapStreamStatus === "error" ? "destructive"
    : "outline"
  }
>
  {bootstrapStreamStatus}
</Badge>
```

### 8. AgentRunLogEntry 增加 log_id 字段

在 `frontend/src/lib/agent.ts` 中为 `AgentRunLogEntry` 增加可选字段：

```typescript
export interface AgentRunLogEntry {
  id: string;
  run_id: string;
  timestamp: string;
  channel: AgentRunLogChannel;
  content_redacted: string;
  log_id?: number;  // 用于去重
}
```

**注意**: 此字段声明实际在 task-04 中完成（StreamLogEvent 增加 log_id），但此处需确认 `AgentRunLogEntry` 也拥有该字段以便在 setBootstrapLogs 中使用。

## 接口定义

### AgentRunStreamClient 构造函数

```typescript
// frontend/src/lib/agent-stream.ts（task-05 产出物）

type StreamStatus = "disconnected" | "connecting" | "connected" | "error";

interface StreamLogEvent {
  channel: AgentRunLogChannel;
  content: string;
  timestamp: string;
  log_id?: number;
}

class AgentRunStreamClient {
  constructor(workspaceId: string, runId: string);
  connect(token: string): void;
  disconnect(): void;
  onMessage(cb: (event: StreamLogEvent) => void): () => void;
  onStatusChange(cb: (status: StreamStatus) => void): () => void;
  onDone(cb: () => void): () => void;
  getStatus(): StreamStatus;
}
```

### useSession 获取 token

```typescript
import { useSession } from "@/stores/session";
// 在非 React 上下文中通过 getState() 获取
const { accessToken } = useSession.getState();
```

## 边界处理

1. **log_id 为 undefined 的兼容**：旧后端可能不返回 log_id，此时退化为不做去重（直接 append），避免丢失日志。去重条件 `if (event.log_id != null)` 确保 undefined 时不进入去重分支。

2. **connect 时 token 为空**：如果 `accessToken` 为空字符串或 undefined，`AgentRunStreamClient.connect("")` 应能处理（在 client 内部会触发 error 状态），页面不崩溃，`bootstrapStreamStatus` 显示 `"error"`，`bootstrapError` 显示相关错误信息。

3. **快速连续点击 Bootstrap**：`disabled={bootstrapping || !!activeBootstrapRunId}` 已防止重复触发，`handleBootstrap` 开头调用 `closeBootstrapStream()` 确保旧连接被清理。

4. **组件卸载时连接未完成**：useEffect cleanup 中调用 `client.disconnect()`，无论连接处于何种状态（connecting/connected）都能安全断开。

5. **重连期间页面状态**：`AgentRunStreamClient` 内部重连时状态变为 `"connecting"`，Badge 实时反映；重连成功变为 `"connected"` 并回填缺失日志；重连失败变为 `"error"`。UI 不需要额外处理重连逻辑。

6. **onDone 和 onError 与 disconnect 的交互**：`onDone` 回调中调用 `closeBootstrapStream()`（即 `disconnect()`），disconnect 需幂等，多次调用不报错。

## 非目标

- 不改动 `AgentRunStreamClient` 类本身的实现（task-05 范围）
- 不修改后端 SSE 格式或 `after` 参数（task-01/02/03 范围）
- 不改动 agent page（`/workspaces/[id]/agent/page.tsx`）中的 SSE 逻辑，仅修改 workspace detail page
- 不添加重试按钮 UI（error 状态只展示，用户可通过关闭面板再重新 Bootstrap 重试）
- 不修改 `closeBootstrapPanel` 的重置逻辑（它已正确调用 `closeBootstrapStream`）

## 参考

- design.md 决策 1（AgentRunStreamClient 封装层）、决策 4（log_id 去重）
- `frontend/src/lib/agent.ts` — 当前 `streamAgentRunLogs` 实现，作为替换目标
- `frontend/src/lib/agent-stream.ts` — task-05 产出物，提供 `AgentRunStreamClient` 类
- `frontend/src/stores/session.ts` — `useSession.getState()` 获取 accessToken

## TDD 步骤

由于本任务是 UI 集成层，主要依赖手动验证和组件渲染测试。可写的测试包括：

1. **渲染测试 — 初始状态**：组件挂载后 `bootstrapStreamStatus` 应为 `"disconnected"`，不显示 Bootstrap panel。
2. **渲染测试 — Bootstrap 触发后**：mock `bootstrapSpecWorkspace` 返回 agent_run_id，验证 Badge 显示 connecting 状态，panel 可见。
3. **渲染测试 — onMessage 回调触发**：模拟 `AgentRunStreamClient` 触发 `onMessage` 回调，验证 `bootstrapLogs` 正确追加，去重生效。
4. **渲染测试 — onDone 回调触发**：模拟 `onDone`，验证 `bootstrapStatus` 变为 `"completed"`，`bootstrapStreamStatus` 变为 `"disconnected"`。
5. **渲染测试 — 组件卸载**：验证 unmount 时 `client.disconnect()` 被调用。
6. **渲染测试 — onStatusChange 回调**：模拟状态变为 `"connected"` / `"error"`，验证 Badge variant 正确。

## 验收标准

| # | 验收项 | 预期结果 | 验证方式 |
|---|--------|----------|----------|
| 1 | `streamAgentRunLogs` 不再被导入 | 文件中无 `streamAgentRunLogs` 引用 | grep 搜索 |
| 2 | `bootstrapEsRef` 被替换为 `streamClientRef` | 类型为 `AgentRunStreamClient \| null` | 代码审查 |
| 3 | `bootstrapStreamStatus` state 存在 | 初始值为 `"disconnected"` | 代码审查 |
| 4 | handleBootstrap 使用 AgentRunStreamClient | 调用 `new AgentRunStreamClient` + `connect(token)` | 代码审查 |
| 5 | closeBootstrapStream 调用 disconnect | 替代旧的 `es.close()` | 代码审查 |
| 6 | 组件卸载时断开连接 | useEffect cleanup 调用 `disconnect()` | 代码审查 |
| 7 | Badge 显示 bootstrapStreamStatus | panel title bar 展示连接状态 Badge | 手动验证 |
| 8 | log_id 去重 | onMessage 中使用 Set 去重 | 代码审查 |
| 9 | 现有功能不受影响 | Sync / Import / User Input 均正常 | 手动验证 |
| 10 | 页面无 TypeScript 编译错误 | `npx tsc --noEmit` 通过 | CI / 本地构建 |
