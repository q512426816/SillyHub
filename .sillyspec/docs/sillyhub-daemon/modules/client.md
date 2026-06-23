---
schema_version: 1
doc_type: module-card
module_id: client
source_commit: ba87eec
author: qinyi
created_at: 2026-06-24T01:10:13
---
# client

## 定位
daemon ↔ SillyHub backend 的 REST HTTP 客户端（`hub-client.ts`）。基于 Node 20 原生 fetch（零 HTTP 库依赖），覆盖 runtime 生命周期（register/heartbeat/markOffline）、lease 生命周期（claim/start/leaseHeartbeat/submitMessages/complete）、WS 断线兜底（getPendingLeases）、spec 同步（getSpecBundle/postSpecSync）、session 恢复（recoverSession/confirmReconnected/markRecoveryFailed）、执行上下文拉取（getExecutionContext）。WebSocket 不在此类（归 ws-client）。1:1 迁移自 Python `client.py`。

## 契约摘要
- `HubClient(serverUrl, authOrToken?)`：构造器去尾斜杠、存鉴权信息。
- `HubClientAuth`：`{ type: 'bearer'|'api-key', token }` 或裸 token 字符串。
- `HubHttpError`：包装非 2xx 响应（status + body）。
- runtime：`register(params)`、`heartbeat(runtimeId)`、`markOffline(runtimeId)`。
- lease：`claimLease`、`startLease(leaseId, claimToken)`、`leaseHeartbeat`、`submitMessages`、`completeLease`、`getPendingLeases(runtimeId)`（唯一 GET）。
- session：`notifyRunResult`、`notifySessionEnd`、`recoverSession`、`confirmReconnected`、`markRecoveryFailed`。
- 其他：`syncStatus`、`getExecutionContext(agentRunId)`、`getSpecBundle(wsId): Buffer`、`postSpecSync`。
- `close()`：no-op（fetch 无连接池，仅 API 兼容）。

## 关键逻辑
```
// 所有请求统一前缀 REST_PREFIX、统一 30s 超时、统一鉴权头
headers = this._authHeaders()              // Bearer 或 X-API-Key，或无
resp = await fetch(`${base}${REST_PREFIX}/...`, {
  method, headers, body: JSON.stringify(payload),
  signal: AbortSignal.timeout(30_000),
})
if (!resp.ok) throw new HubHttpError(resp.status, body)
return resp.json()
// trust_env=False 等价：Node fetch 默认不读 HTTP_PROXY
```

## 注意事项
- body 字段全部 snake_case（runtime_id/claim_token/agent_run_id）对齐 backend Pydantic，改字段名会直接 422。
- 30s 超时来自 Python httpx，改超时需评估长任务接口（getSpecBundle 可能较大）。
- `getSpecBundle` 返回 Buffer（tar 包），不走 JSON 解析路径。
- `getExecutionContext` 按 server 端 `_user_owns_run` 做归属校验，跨 user 访问 → 403。
- close() 无实际作用但保留（cli/daemon 调用链期望显式释放），勿删。
- fetch 默认不读系统代理，与 Python `trust_env=False` 天然等价，无需额外配置。

## 人工备注
<!-- MANUAL_NOTES_START -->
<!-- MANUAL_NOTES_END -->
