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
