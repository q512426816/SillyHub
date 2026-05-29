---
author: qinyi
created_at: 2026-05-28 13:25:00
---

# Design

## 架构决策

### ADR-01: SSE 而非 WebSocket

日志推送是纯单向场景（服务端→客户端），SSE 协议简单，浏览器原生 `EventSource` 支持，不需要额外库。WebSocket 的双向能力在本场景下是 YAGNI。

### ADR-02: Redis Pub/Sub 而非 Redis Streams

Running 阶段丢少量消息可接受——结束后 DB 有完整记录。Pub/Sub 零配置、零维护，适合单实例部署。多实例部署时可升级为 Redis Streams，但当前规模不需要。

### ADR-03: 逐行读取替代 communicate()

`asyncio.create_subprocess_exec` 的 stdout 设为 pipe，用 `readline()` 循环逐行读取。每行解析 stream-json event 后通过 Redis Pub/Sub 发布，同时累积到完整 output buffer。

## 数据流

```
Claude CLI (subprocess)
  → stdout pipe (readline loop)
    → parse stream-json event
      → format conversation log line
        → Redis PUBLISH agent_run:{run_id}
          → SSE endpoint (SUBSCRIBE)
            → EventSource (frontend)
        → accumulate to output buffer (retained for DB write)
```

## 文件变更清单

### 后端修改

- `backend/app/modules/agent/adapters/claude_code.py` — `_exec_stream` 改逐行读取 + Redis 发布
- `backend/app/modules/agent/router.py` — 新增 `GET /{run_id}/stream` SSE 端点
- `backend/app/modules/agent/service.py` — 新增 `stream_run_logs` 方法（Redis subscribe + SSE 生成器）

### 前端修改

- `frontend/src/lib/agent.ts` — 新增 `streamAgentRunLogs` EventSource 消费函数
- `frontend/src/app/(dashboard)/workspaces/[id]/agent/page.tsx` — running 时用 SSE 替代轮询

## API 设计

### 新增端点

- `GET /api/workspaces/{workspace_id}/agent/runs/{run_id}/stream`
  - Auth: 同现有 `/logs` 端点
  - Response: `text/event-stream`
  - 事件格式：
    - `data: {"channel":"stdout","content":"...","timestamp":"..."}` — 日志行
    - `event: done\ndata: {}` — 运行结束
    - `: keepalive` — 每 30 秒心跳注释

### 现有端点不变

- `GET /api/workspaces/{workspace_id}/agent/runs/{run_id}/logs` — DB 日志查询，行为不变

## Redis 使用

- Channel 命名：`agent_run:{run_id}`
- 消息格式：`{"channel": "stdout"|"stderr", "content": "...", "timestamp": "..."}`
- 无需持久化，无消费者组
- 进程结束后自然无人发布

## 风险登记

| 风险 | 影响 | 缓解 |
|---|---|---|
| Pub/Sub 消息丢失（客户端未订阅时） | 实时流缺几行 | 可接受，结束后 DB 有完整记录 |
| SSE 长连接占用资源 | 高并发时连接数压力大 | 单实例部署规模小，且 Agent run 通常只有 1-2 个并发 |
| Redis 连接池耗尽 | 影响其他 Redis 使用 | 设置 subscribe 超时，连接数上限 |
| stdout 行缓冲延迟 | 实时性降低 | 子进程设置行缓冲模式 |

## 自审

- 没有引入新的数据模型或迁移。
- 没有改变现有 DB 日志写入逻辑。
- SSE 端点复用了现有认证和权限。
- 前端 running/completed 分支清晰，completed 行为完全不变。
- Redis Pub/Sub 是最简方案，未来可升级。
