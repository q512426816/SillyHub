---
schema_version: 1
doc_type: module-card
module_id: client
author: qinyi
created_at: 2026-06-10T16:55:00
---

# client

## 定位
基于 httpx 的异步 HTTP 客户端，封装 daemon 与 SillyHub server 之间所有 REST API 调用。只负责 HTTP 通信，不负责 WebSocket（WebSocket 由 daemon.py 通过 websockets 库直接管理）。

## 契约摘要
- `HubClient(server_url, token?)` — 初始化，自动构建 Bearer 认证头
- `register(runtime_id?, name, provider, version, protocol, ...)` — POST `/api/daemon/register`
- `heartbeat(runtime_id)` — POST `/api/daemon/heartbeat`
- `claim_lease(lease_id, runtime_id)` — POST `/api/daemon/leases/{id}/claim`
- `start_lease(lease_id, claim_token)` — POST `/api/daemon/leases/{id}/start`
- `lease_heartbeat(lease_id, claim_token)` — POST `/api/daemon/leases/{id}/heartbeat`
- `submit_messages(lease_id, claim_token, agent_run_id, messages)` — POST `/api/daemon/leases/{id}/messages`
- `complete_lease(lease_id, claim_token, result)` — POST `/api/daemon/leases/{id}/complete`
- `close()` — 关闭底层连接池

## 关键逻辑
```
HubClient.__init__(server_url, token)
  → httpx.AsyncClient(base_url, headers=auth_headers, timeout=30, trust_env=False)
  → 所有方法: resp = await self._http.post(path, json=body) → raise_for_status → resp.json()
```

## 注意事项
- `trust_env=False` 明确禁用系统代理，daemon 直连本地 server
- timeout 硬编码 30 秒，大文件上传场景可能不够
- 所有方法在 HTTP 错误时直接 raise（httpx.HTTPStatusError），调用方需 try/except
- 修改 API 路径时需同步检查 server 端 router 定义
- 被 cli、daemon、task-runner 三个模块使用

## 人工备注

<!-- MANUAL_NOTES_START -->

<!-- MANUAL_NOTES_END -->
