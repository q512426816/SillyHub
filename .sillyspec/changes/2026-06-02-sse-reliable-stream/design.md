---
author: qinyi
created_at: 2026-06-02T16:00:00
---

# Design

## 架构决策

### 决策 1: 前端引入 AgentRunStreamClient 封装层

新建 `AgentRunStreamClient` 类替代当前散落在 `page.tsx` 中的 EventSource 管理逻辑。该类封装连接生命周期、断线重连、token 刷新、去重和状态通知，对外提供 `connect()` / `disconnect()` / `onMessage()` / `onStatusChange()` / `onDone()` 接口。

参考 happy 项目 `apiSocket.ts` 的状态管理模式：
- 三态：`disconnected` / `connecting` / `connected`
- `onStatusChange` 回调通知 UI
- 内部自动处理 token 刷新和重连

### 决策 2: 断线重连策略 — HTTP backfill + EventSource 重建

EventSource 不支持动态更新 query param（token 会过期），因此断线重连流程：

1. `onerror` 触发 → 关闭旧 EventSource
2. 调用 refresh token API 获取新 token
3. `GET /api/workspaces/{ws}/agent/runs/{id}/logs?after={lastLogId}` 回填断线期间缺失日志
4. 用新 token 重建 EventSource URL 并连接
5. 通过 `after` 参数让 SSE 跳过已回填的日志

最大重试 5 次，指数退避（1s, 2s, 4s, 8s, 16s），超过后标记 `error` 状态。

### 决策 3: 后端 SSE 支持 `after` 参数实现续传

在 `GET /stream` 端点增加可选 `after` 查询参数（AgentRunLog.id，UUID 字符串）。当指定时：
- DB replay 阶段只返回该 log 之后（按 timestamp + id 排序）的日志
- Redis Pub/Sub 阶段正常订阅（无变化）

无需数据库迁移，复用 AgentRunLog.id（UUID）+ timestamp 排序。

### 决策 4: 去重改用 log_id Set

当前去重使用 `timestamp+channel+content` 拼接，不可靠（同一秒多条相同内容日志会误判）。改为：
- 后端 SSE 事件携带 `log_id`（AgentRunLog.id，UUID 字符串）
- 前端维护 `Set<string>` 去重
- 回填和 SSE 的交集事件通过 log_id 自动去重

### 决策 5: 保留 SSE 协议，架构预留 Socket.IO 插槽

短期继续使用 SSE + HTTP input，不做协议切换。`AgentRunStreamClient` 的接口设计对齐 Socket.IO 的 `connect/disconnect/on/off` 模式，未来替换为 Socket.IO transport 时上层代码无需改动。

## 文件变更

### 新增文件
| 文件 | 说明 |
|------|------|
| `frontend/src/lib/agent-stream.ts` | `AgentRunStreamClient` 类 |

### 修改文件
| 文件 | 变更 |
|------|------|
| `backend/app/modules/agent/service.py` | `_serialize_log_event` 增加 `log_id`；`get_run_logs` 增加 `after` 过滤；`stream_run_logs` 透传 `after` |
| `backend/app/modules/agent/router.py` | `/stream` 端点接收 `after` 查询参数 |
| `frontend/src/lib/agent.ts` | `StreamLogEvent` 增加 `log_id` 字段；`getAgentRunLogs` 支持 `after` 参数 |
| `frontend/src/app/(dashboard)/workspaces/[id]/page.tsx` | 替换手动 EventSource 为 `AgentRunStreamClient` |
| `.sillyspec/docs/backend/modules/agent.md` | 记录 `after` 参数、`log_id` 字段、设计决策 |
| `.sillyspec/docs/frontend/scan/INTEGRATIONS.md` | 记录 `AgentRunStreamClient` 集成、SSE 重连机制 |

## API 设计

### GET `/api/workspaces/{workspace_id}/agent/runs/{run_id}/stream?after={log_id}`

新增可选查询参数 `after`：
- 类型：UUID 字符串（AgentRunLog.id）
- 默认：不传（返回所有日志）
- 语义：只返回该 log_id 之后（按 timestamp + id 排序）的日志

响应行为不变（SSE text/event-stream），DB replay 阶段跳过该 log 及之前的记录。

### GET `/api/workspaces/{workspace_id}/agent/runs/{run_id}/logs?after={log_id}`

`logs` 端点已有，确认支持 `after` 参数或新增支持。用于断线回填。

## SSE 事件格式变更

当前格式：
```
data: {"channel": "stdout", "content": "...", "timestamp": "..."}
```

新增 `log_id` 字段：
```
data: {"channel": "stdout", "content": "...", "timestamp": "...", "log_id": "a1b2c3d4-..."}
```

## AgentRunStreamClient 接口

```typescript
type StreamStatus = "disconnected" | "connecting" | "connected" | "error";

class AgentRunStreamClient {
  connect(token: string): void;
  disconnect(): void;
  onMessage(cb: (event: StreamLogEvent) => void): () => void;
  onStatusChange(cb: (status: StreamStatus) => void): () => void;
  onDone(cb: () => void): () => void;
  getStatus(): StreamStatus;
}
```

## 重连流程

```
onerror
  → disconnect()
  → if retries < 5
    → status = "connecting"
    → wait backoff(retryCount)
    → refreshToken()
    → GET /logs?after=lastLogId → backfill
    → connect(newToken)
  → else
    → status = "error"
```

## 兼容策略

- 后端 `after` 参数可选，不传时行为不变。
- SSE 事件增加 `log_id` 字段，前端旧代码忽略即可（向后兼容）。
- `AgentRunStreamClient` 作为新类引入，不影响现有 `streamAgentRunLogs()` 函数，逐步替换。
- 不改 Redis Pub/Sub channel 和消息格式。

## 风险登记

| 风险 | 影响 | 缓解 |
|---|---|---|
| AgentRunLog.id 不连续或有大跳跃 | after 过滤可能漏日志 | 使用 >= 而非 ==，按 id 排序 |
| Token 刷新失败 | 重连中断 | 计入重试次数，超限后 error 状态 |
| 断线期间日志量极大 | 回填响应大 | logs 端点已有分页，可限制回填条数 |
| 多标签页同时连接 | Redis 广播到多个 subscriber | 每个 subscriber 独立，互不影响 |

## 自审

- 是否保持 SSE 协议：是。
- 是否预留 Socket.IO 插槽：是，接口对齐 Socket.IO 模式。
- 是否需要数据库迁移：否。
- 是否解决断线重连：是，token 刷新 + backfill + after 参数。
- 是否解决去重不可靠：是，改用 log_id Set。
- 是否避免过度设计：是，~5 文件变更，无新依赖。
