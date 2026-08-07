# Mission SSE：订阅 worker 状态变更

第三方可以通过 SSE（Server-Sent Events）订阅某个 mission 下所有 worker run 的状态变更
（pending → running → 终态），实时跟进进度，无需反复调 `list_workers` 轮询。

## 端点

```http
GET /api/workspaces/{workspace_id}/missions/{mission_id}/events
Accept: text/event-stream
```

返回 `text/event-stream`，响应头含 `Cache-Control: no-cache, no-transform`、
`Connection: keep-alive`、`X-Accel-Buffering: no`。

> **鉴权注意**：这个端点走 `/api`，用**平台用户身份**（`require_permission_any(
> TASK_READ)`，即 JWT / X-API-Key），**不是 McpToken**。非该 workspace 成员 → 403，
> mission 不存在 → 404。也就是说它面向"有平台账号、想在网页 / 脚本里实时看进度"的
> 调用方；纯 McpToken 的第三方编排方请改用 [webhooks.md](webhooks.md) 收终态推送。

## 事件类型

EventSource 标准帧格式（`event:` 行 + `data:` 行 + 空行分隔）。

### 连接建立

连接成功后立即发一帧注释，冲刷代理缓冲：

```
: connected
```

### worker_status

每当某 worker 状态变化时发一帧。**首次连接会回放当前所有 worker 的初始状态**（让晚
接入的客户端拿到全量快照），之后只发差分。

```
event: worker_status
data: {"worker_id":"uuid","status":"running","exit_code":null,"error_code":null}
```

`data` 字段：

| 字段 | 说明 |
| --- | --- |
| worker_id | worker run id |
| status | 当前状态（`pending` / `running` / `completed` / `failed` / `killed` 等） |
| exit_code | 退出码，未结束为 `null` |
| error_code | 失败原因码，无则 `null` |

### done

当 mission 下**全部** worker 进入终态（`completed` / `failed` / `killed`）时发收尾帧并
结束流：

```
event: done
data: {"mission_id":"uuid","status":"done","workers":3}
```

### keepalive

静默超过约 25s 发一帧注释，防连接被代理 / 网关超时断开：

```
: keepalive
```

## 实现方式与重连策略（R-03）

服务端用**短轮询**（每 2s 查一次 AgentRun 表）检测状态差分发帧，不是事件总线推送。
**服务端不保存任何订阅状态**——这是刻意的简单设计（R-03）。含义：

- **断线重连 = 重新订阅**。客户端（EventSource）断开后重新发起同一个 GET 即可。
- **事件补发靠首帧全量回放**。重连后服务端会把该 mission 当前所有 worker 的最新状态
  重新发一遍（worker_status 全量快照），所以**不会丢状态**——你不用记"上次收到哪一帧"，
  重连即恢复全量。
- 因此**客户端无需维护事件游标 / offset**。标准 EventSource 的自动重连（默认带
  `Last-Event-ID`，但本端点不依赖它）即可正确工作。

## 客户端示例

### 浏览器 / Node（EventSource）

```javascript
const es = new EventSource(
  "https://<host>/api/workspaces/<wid>/missions/<mid>/events",
  { withCredentials: true } // 带平台用户会话 / 按你的鉴权方式
);

es.addEventListener("worker_status", (e) => {
  const w = JSON.parse(e.data);
  console.log(`worker ${w.worker_id} -> ${w.status}`);
});

es.addEventListener("done", (e) => {
  const d = JSON.parse(e.data);
  console.log(`mission done, ${d.workers} workers`);
  es.close(); // 收到 done 后主动关，无需再重连
});

es.onerror = () => {
  // EventSource 会自动重连；重连后服务端回放全量状态，不丢帧
};
```

### curl（调试）

```bash
curl -N \
  -H "Authorization: Bearer <平台用户 JWT>" \
  -H "Accept: text/event-stream" \
  "https://<host>/api/workspaces/<wid>/missions/<mid>/events"
```

> EventSource 浏览器 API 不支持自定义 header。若你的鉴权需要 header（如 Bearer
> token），用 fetch + ReadableStream 解析 SSE，或在受信内网 / 经反代注入凭据。需要
> 被动收终态而非实时流的场景，优先考虑 [webhooks.md](webhooks.md)（用 McpToken 体系，
> 不依赖平台用户会话）。
