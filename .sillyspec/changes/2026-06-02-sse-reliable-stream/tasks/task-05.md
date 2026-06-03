---
author: qinyi
created_at: 2026-06-02T16:21:37
id: task-05
title: "新增 `frontend/src/lib/agent-stream.ts` — `AgentRunStreamClient` 类"
priority: P0
estimated_hours: 3
depends_on: [task-04]
blocks: [task-06, task-08]
allowed_paths:
  - frontend/src/lib/agent-stream.ts
---

# task-05: 新增 `frontend/src/lib/agent-stream.ts` — `AgentRunStreamClient` 类

## 修改文件

- `frontend/src/lib/agent-stream.ts` — 新建文件

## 实现要求

1. 创建 `AgentRunStreamClient` 类，封装 SSE 连接生命周期
2. 状态管理：`disconnected | connecting | connected | error`
3. 断线重连：最多 5 次，指数退避 1s/2s/4s/8s/16s
4. Token 刷新：重连时通过 `useSession.getState()` 获取新 token
5. 日志回填：重连前调用 `getAgentRunLogs(ws, run, lastLogId)` 获取缺失日志
6. 去重：维护 `Set<string>` 记录已处理的 log_id（UUID 字符串）
7. 回调注册：`onMessage` / `onStatusChange` / `onDone`，返回取消函数

**重要**：`log_id` 是 UUID 字符串（非 number）。`AgentRunLog.id` 在后端是 UUID。

## 接口定义

```typescript
import { getApiBaseUrl } from "./api";
import { getAgentRunLogs, type StreamLogEvent } from "./agent";
import { useSession } from "@/stores/session";

export type StreamStatus = "disconnected" | "connecting" | "connected" | "error";

export class AgentRunStreamClient {
  private workspaceId: string;
  private runId: string;
  private status: StreamStatus = "disconnected";
  private es: EventSource | null = null;
  private retryCount = 0;
  private maxRetries = 5;
  private backoffMs = [1000, 2000, 4000, 8000, 16000];
  private seenLogIds = new Set<string>();
  private lastLogId: string | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  private messageCallbacks: Array<(event: StreamLogEvent) => void> = [];
  private statusCallbacks: Array<(status: StreamStatus) => void> = [];
  private doneCallbacks: Array<() => void> = [];

  constructor(workspaceId: string, runId: string) {
    this.workspaceId = workspaceId;
    this.runId = runId;
  }

  connect(token: string): void {
    // 1. 断开旧连接
    if (this.es) { this.es.close(); this.es = null; }
    // 2. 设置状态为 connecting
    this._setStatus("connecting");
    // 3. 构建 EventSource URL
    const base = getApiBaseUrl();
    const url = new URL(`${base}/api/workspaces/${this.workspaceId}/agent/runs/${this.runId}/stream`);
    if (this.lastLogId) url.searchParams.set("after", this.lastLogId);
    url.searchParams.set("token", token);
    // 4. 创建 EventSource
    this.es = new EventSource(url.toString());
    this.es.onmessage = (e: MessageEvent<string>) => {
      try {
        const parsed: StreamLogEvent = JSON.parse(e.data);
        this._emitMessage(parsed);
        // 连接成功收到第一条消息 → connected
        if (this.status === "connecting") this._setStatus("connected");
      } catch { /* ignore parse errors */ }
    };
    this.es.addEventListener("done", () => {
      this.doneCallbacks.forEach(cb => cb());
      this.disconnect();
    });
    this.es.onerror = () => {
      this._reconnect();
    };
  }

  disconnect(): void {
    if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null; }
    if (this.es) { this.es.close(); this.es = null; }
    this.retryCount = 0;
    this._setStatus("disconnected");
  }

  onMessage(cb: (event: StreamLogEvent) => void): () => void {
    this.messageCallbacks.push(cb);
    return () => { this.messageCallbacks = this.messageCallbacks.filter(c => c !== cb); };
  }

  onStatusChange(cb: (status: StreamStatus) => void): () => void {
    this.statusCallbacks.push(cb);
    return () => { this.statusCallbacks = this.statusCallbacks.filter(c => c !== cb); };
  }

  onDone(cb: () => void): () => void {
    this.doneCallbacks.push(cb);
    return () => { this.doneCallbacks = this.doneCallbacks.filter(c => c !== cb); };
  }

  getStatus(): StreamStatus { return this.status; }

  private _setStatus(s: StreamStatus): void {
    if (this.status === s) return;
    this.status = s;
    this.statusCallbacks.forEach(cb => cb(s));
  }

  private _emitMessage(event: StreamLogEvent): void {
    if (event.log_id != null) {
      if (this.seenLogIds.has(event.log_id)) return;
      this.seenLogIds.add(event.log_id);
      this.lastLogId = event.log_id;
    }
    this.messageCallbacks.forEach(cb => cb(event));
  }

  private _reconnect(): void {
    if (this.es) { this.es.close(); this.es = null; }
    if (this.retryCount >= this.maxRetries) {
      this._setStatus("error");
      return;
    }
    const delay = this.backoffMs[this.retryCount] ?? 16000;
    this.retryCount++;
    this.reconnectTimer = setTimeout(() => {
      void this._doReconnect();
    }, delay);
  }

  private async _doReconnect(): Promise<void> {
    try {
      // 获取新 token
      const { accessToken } = useSession.getState();
      if (!accessToken) { this._reconnect(); return; }
      // 回填缺失日志
      if (this.lastLogId) {
        const logs = await getAgentRunLogs(this.workspaceId, this.runId, this.lastLogId);
        // 将 AgentRunLogEntry 转为 StreamLogEvent 格式并通过 _emitMessage 去重发送
        for (const log of logs) {
          this._emitMessage({
            channel: log.channel as StreamLogEvent["channel"],
            content: log.content_redacted ?? "",
            timestamp: log.timestamp,
            log_id: log.id,  // UUID string
          });
        }
      }
      // 用新 token 重建连接
      this.connect(accessToken);
    } catch {
      this._reconnect();
    }
  }
}
```

## 边界处理

- `log_id` 为 null 的事件不做去重，直接发送
- Token 刷新失败计入重试次数
- 回填请求失败计入重试次数
- `disconnect()` 后不触发重连（retryCount 重置，reconnectTimer 清除）
- 组件卸载时必须调用 `disconnect()` 防止内存泄漏
- 多次 `connect()` 先断开旧连接
- 回填日志和 SSE 新日志可能重叠，通过 `seenLogIds` Set 去重
- `lastLogId` 为 null 时不传 `after` 参数（首次连接）

## 非目标

- 不修改现有 `streamAgentRunLogs` 函数
- 不实现多标签页同步
- 不实现 Socket.IO transport
- 不处理 EventSource 跨域（已有 Next.js 代理）
- 不修改 page.tsx（task-06 负责）

## 参考

- happy 项目 `packages/happy-app/sources/sync/apiSocket.ts` 的状态管理模式
- `streamAgentRunLogs` 在 `agent.ts:78`
- 前端测试框架为 Vitest（非 Jest）

## TDD 步骤

1. 写测试：mock EventSource，验证状态转换 disconnected→connecting→connected
2. 确认失败
3. 实现 AgentRunStreamClient
4. 确认通过
5. 补充重连/去重测试

## 验收标准

| # | 验证步骤 | 通过标准 |
|---|---|---|
| AC-01 | connect(token) | status 变为 connecting → connected（收到首条消息后） |
| AC-02 | onmessage 收到事件 | _emitMessage 去重并回调 |
| AC-03 | onerror 触发 | 自动重连（retryCount < 5） |
| AC-04 | 连续 5 次重连失败 | status 变为 error |
| AC-05 | disconnect() | ES 关闭，status = disconnected，不重连 |
| AC-06 | 回填日志 | GET /logs?after=lastLogId 后去重发送 |
| AC-07 | 重复 log_id 事件 | 被忽略，不触发 onMessage |
| AC-08 | onDone 事件 | 回调触发，ES 关闭 |
