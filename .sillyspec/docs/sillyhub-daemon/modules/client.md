---
schema_version: 1
doc_type: module-card
module_id: client
author: qinyi
created_at: 2026-06-10T16:55:00
---

# client

## 定位
基于原生 `fetch` 的 REST HTTP 客户端，封装 daemon 与 SillyHub server 之间所有 REST API 调用。文件名 Node 版改名为 `hub-client.ts`（模块 id `client` 保持不变）。只负责 HTTP 通信，不负责 WebSocket（WebSocket 由独立 ws-client 模块处理）。

## 契约摘要
- `HubClient(serverUrl, token?)` — 初始化，自动构建 Bearer 认证头
- `register(body: RegisterBody)` — POST `/api/daemon/register`
- `heartbeat(body: HeartbeatBody)` — POST `/api/daemon/heartbeat`
- `claimLease(leaseId, body: ClaimLeaseBody)` — POST `/api/daemon/leases/{id}/claim`
- `startLease(leaseId, body: StartLeaseBody)` — POST `/api/daemon/leases/{id}/start`
- `leaseHeartbeat(leaseId, body: LeaseHeartbeatBody)` — POST `/api/daemon/leases/{id}/heartbeat`
- `submitMessages(leaseId, body: SubmitMessagesBody)` — POST `/api/daemon/leases/{id}/messages`
- `completeLease(leaseId, body: CompleteLeaseBody)` — POST `/api/daemon/leases/{id}/complete`
- `getExecutionContext(agentRunId): Promise<ExecutionContextPayload>` — GET `/api/agent-runs/{id}/execution-context`（2026-06-14-unified-agent-execution / task-05 新增：claim 后 fetch bundle 上下文，填充 LeaseCtx 的 claudeMd/repoUrl/branch/allowedPaths/toolConfig）
- 请求体类型：`RegisterBody` / `ClaimLeaseBody` / `StartLeaseBody` / `LeaseHeartbeatBody` / `SubmitMessagesBody` / `CompleteLeaseBody` / `HeartbeatBody`
- `HubHttpError` — 非 2xx 响应抛出的错误类型（含 status / body）

## 关键逻辑
```
new HubClient(serverUrl, token)
  → 保存 baseUrl、Authorization: `Bearer ${token}`
  → 所有方法：fetch(baseUrl + path, { method: 'POST', headers, body: JSON.stringify(body) })
    → !resp.ok → throw new HubHttpError(resp.status, await resp.text())
    → return await resp.json()
```

## 注意事项
- 使用 Node ≥ 20 内置全局 `fetch`，不依赖 httpx / axios
- 不读取系统代理环境变量（daemon 直连本地 server）
- timeout 硬编码（通过 AbortController 实现），大文件上传场景可能不够
- 所有方法在 HTTP 错误时直接 throw HubHttpError，调用方需 try/catch
- 修改 API 路径时需同步检查 server 端 router 定义
- 对外 REST 端点路径与 Python 版完全相同（G-02 不变）
- 被 cli、daemon、task-runner 三个模块使用
- `getExecutionContext` 返回的 bundle 含 proposal/design 上下文，按 server 端 `_user_owns_run` 做归属校验，跨 user 访问 → 403（2026-06-14-unified-agent-execution）

## 人工备注

<!-- MANUAL_NOTES_START -->

<!-- MANUAL_NOTES_END -->
