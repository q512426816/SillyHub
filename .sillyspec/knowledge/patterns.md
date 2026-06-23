---
author: qinyi
created_at: 2026-06-23 02:00:00
---

# 可复用模式 (Patterns)

## Monorepo 三服务架构

```
frontend (Next.js, 浏览器)
    │  REST / SSE / WebSocket
    ▼
backend (FastAPI)  ◄──── HTTP/WS ────►  sillyhub-daemon (Node, 本地守护进程)
    │                                          │
    ▼                                          ▼
PostgreSQL + Redis                    本地 Claude 进程 (Claude Agent SDK)
```

- **backend**：中心 API 服务，持久化（PG）、消息（Redis Pub/Sub）、对外 REST/SSE/WS
- **sillyhub-daemon**：运行在用户本机，受 backend 调度管理本地 Claude 进程的生命周期（lease/heartbeat/complete），通过 HTTP/WS 与 backend 通信
- **frontend**：纯消费 backend API 的 Web 界面
- 部署：`deploy/docker-compose.yml` 编排三服务（dev 用 `docker-compose.dev.yml`）

## Backend 模块组织

backend 源码分两层（`backend/app/`）：
- `app/core/` — 基础设施：config / database / redis / security / auth / logging / telemetry / errors / audit / paths
- `app/modules/<domain>/` — 业务模块，每个模块内含 `router.py`（FastAPI APIRouter）+ service + model

FastAPI app 在 `app/main.py` 创建，所有 router 以 `prefix="/api"` 挂载（workspace / members / auth / health / qc 等）。

## 子项目间通信

- frontend → backend：REST（`/api/*`）+ SSE（流式日志）+ WebSocket
- backend → daemon：HTTP（下发任务）+ WS（lease 心跳、消息回传）
- daemon → 本地 Claude：Claude Agent SDK（spawn 子进程 + stdio）

## AgentRun + DaemonTaskLease 编排流程

交互式/任务式 agent 执行的统一编排链路：

```
backend 创建 AgentRun（持久化运行记录）
   │  + DaemonTaskLease（领租约：daemon 认领任务、心跳续约、complete 回收）
   ▼
daemon 收到 lease → claude-agent-sdk 的 SessionManager.create()/执行
   │  （interactive session 支持多轮 + persistence/recovery）
   ▼
daemon 执行输出经 adapters/ 协议解析 → WebSocket / hub-client 回传 backend
   │  backend 写 AgentRunLog（三层日志：daemon/backend/前端）
   ▼
backend 标记 AgentRun 完成 / daemon 释放 Lease
```

- backend 是编排中枢（建 run + lease、收消息、写日志），daemon 是执行体（SDK 调 Claude）。
- 改 agent 执行链路（新增 provider、改 lease 心跳、改日志回传）时沿此链路定位各环节，别只改一端。
- 与「三服务架构」互补：前者讲静态拓扑，本条讲运行时编排时序。

## daemon adapters/ 多协议抽象（stream-json / json-rpc / jsonl / ndjson / text）

`sillyhub-daemon/src/adapters/` 用统一 `ProtocolAdapter` 接口抽象 5 种 CLI 进程输出协议：`stream-json`（Claude/Codex 主用）、`json-rpc`、`jsonl`、`ndjson`、`text`（纯文本兜底）。
- 每个 provider 对应一种协议，`ProtocolAdapter` 把字节流解析成统一消息事件喂给上层。
- 新增 agent provider（如新 CLI）：在 `agent-detector.ts` 注册检测 + 在 adapters/ 复用或新增对应协议 adapter，别在调用方散写解析。
- 协议解析与上层编排（AgentRun/Lease）解耦，是 daemon 处理多 provider 输出的扩展点。
