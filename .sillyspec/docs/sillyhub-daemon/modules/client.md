---
schema_version: 1
doc_type: module-card
module_id: client
author: qinyi
created_at: 2026-08-18 01:45:00
---

# 平台 REST 瘦客户端（client）

## 定位
daemon ↔ SillyHub backend 的 REST 瘦客户端（hub-client.ts）。Node 20 原生 fetch（零 HTTP 库依赖），每次请求独立调用（无连接池）、不缓存 lease 状态、不内置重试（失败即抛，重试归 ResilienceService）。WebSocket 通信不在此类（归 ws-client）。daemon 几乎所有模块对 backend 的 HTTP 面都经它。

## 契约摘要
- `HubClient(serverUrl, authOrToken?)`：serverUrl 去尾斜杠；authOrToken 为旧式裸 token 字符串或 `{ token?, apiKey? }`。`close()` 为 no-op（仅 API 兼容）。
- 鉴权 `_headers()`：apiKey 优先（X-API-Key，长期凭证）> token（Authorization: Bearer，浏览器短期 JWT）；都缺不带鉴权头。
- `HubHttpError(status, bodyText, url, method)`：非 2xx 时抛出；网络错误/超时**不包装**，透传 fetch 原始 TypeError/DOMException（调用方需区分超时 vs 业务错误）。
- 方法面（按业务域）：
  - runtime 生命周期：`register`（daemon_local_id + 机器字段 + providers + version/build_id，内部自动填 DAEMON_VERSION/BUILD_ID/started_at）、`heartbeat`、`markOffline`。
  - lease 生命周期：`claimLease` / `startLease` / `leaseHeartbeat` / `submitMessages`（message 顶层可带 dedup_key 幂等）/ `completeLease` / `getPendingLeases`（唯一 GET，WS 断线兜底）。
  - interactive：`notifyRunResult`（可带 ModelError）/ `notifySessionEnd` / `notifySessionReady` / `recoverSession` / `confirmReconnected` / `markRecoveryFailed`（后三者靠实例内 sessionId→runtimeId 映射补 runtime_id）。
  - spec 同步：`syncStatus` / `getSpecBundle`（tar 二进制，单独 fetch + arrayBuffer）/ `postSpecSync`（二进制上传）/ `postSpecSyncIncremental`（FileOp[] 增量，返回 SpecIncrementalSyncResult：conflict=true 时 HTTP 仍 200，由 daemon 侧提示人工拍板）。
  - change write：`getPendingChangeWrites` / `claimChangeWrite` / `completeChangeWrite` / `reportChangeWriteProgress`。
  - 团队 MCP：`dispatchWorker` / `getWorkerResult` / `listWorkers` / `convergeMission` / `reportProgress`。
  - 其他：`getExecutionContext`（按 run 拉执行上下文）。
- 模块级导出：`fetchMcpWhitelist(serverUrl, token)`（拉平台 MCP 白名单，失败返 null 不抛）、`extractCause(err)`（压平 undici cause 链）、`parseJsonFromResponse`（BOM-safe JSON 解析）。

## 关键逻辑
```text
_request(method, path, body?, timeoutMs?):
  resp = fetch(`${baseUrl}${REST_PREFIX}${path}`, { method,
          headers: _headers(), body: JSON.stringify(body),
          signal: AbortSignal.timeout(timeoutMs ?? 30_000) })
  !resp.ok → 读全文抛 HubHttpError；ok → parseJsonFromResponse
  # trust_env=False 等价：Node fetch 默认不读 HTTP_PROXY，无需配置
# getSpecBundle/postSpecSync/postSpecSyncIncremental 单独放宽 timeoutMs = 300_000
```

## 注意事项
- body 字段全部 snake_case 对齐 backend Pydantic（runtime_id / claim_token / agent_run_id 等），改字段名直接 422。
- 超时双轨：默认 30s（对齐 Python httpx）；spec 同步上传三方法 300s（全量 tar apply 实测 69s+，30s 必 AbortSignal 假失败——服务端实际成功而 daemon 标 failed）。
- 二进制方法（getSpecBundle 收 / postSpecSync 发）不走 `_request`（它 JSON.stringify body），各自单独 fetch。
- `FileOp.content` 为 base64；`mtime`（ms）可携带宿主真实修改时间，backend 落 source_mtime。
- getExecutionContext 按服务端归属校验，跨 user 访问 403。
- recoverSession 系列的 runtime_id 补齐依赖 daemon 活着期间的内存映射（重启即重建），confirm/markFailed 调用后映射条目删除（一次性）。

## 人工备注

<!-- MANUAL_NOTES_START -->
- ql-20260816-002：`postSpecSync`（tar 上传）与 `postSpecSyncIncremental`（增量 ops 含 base64 内容）超时独立放宽到 300s——新增 `SPEC_SYNC_TIMEOUT_MS=300_000` 常量；`_request` 加可选 `timeoutMs` 参数（默认仍 `DEFAULT_TIMEOUT_MS=30s`，对齐 Python）。根因：全量 tar apply 实测 69~93s > 30s，30s 必 AbortSignal 假失败（服务端实际 200 成功）。
<!-- MANUAL_NOTES_END -->
