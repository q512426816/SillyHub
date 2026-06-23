---
schema_version: 1
doc_type: module-card
module_id: adapter-json-rpc
source_commit: ba87eec
author: qinyi
created_at: 2026-06-24T01:10:50
---
# adapter-json-rpc

## 定位
JSON-RPC 2.0 over stdio 纯解析 adapter（`src/adapters/json-rpc.ts`）。覆盖 codex / hermes / kimi / kiro 四 provider（共享同一套 method 名）。双向通信：daemon 发 request（initialize/thread/start/turn/start），子进程回 response + 主动推 notification / server request。方案B 拆分：本类只做解析，子进程执行下沉到 task-runner。与 Python 版差异：Python parse_output 只处理 notification，Node 版统一处理 response/server-request/notification 三类。

## 契约摘要
- `JsonRpcProvider = 'codex'|'hermes'|'kimi'|'kiro'`。
- `PendingServerRequest`（id/method/params/responseTemplate）——server request 待应答条目，TaskRunner 取出写 stdin。
- `JsonRpcAdapter implements ProtocolAdapter`：
  - `provider`、`buildArgs()`（codex 返回 `['app-server','--listen','stdio://']`，其余 []）。
  - `buildHandshake({cwd,prompt,model})` ——codex 握手序列 3 条 JSON（initialize id=1 / notifications/initialized / thread/start id=2）。
  - `buildTurnStart({threadId,prompt,model})` ——turn/start id=3。
  - `parse(line): AgentEvent[] | null` ——三分支解析。

## 关键逻辑
```
parse 分支（严格对照 Python _handle_line）:
  hasId && !hasMethod → parseResponse（daemon 之前 request 的回复）
  hasId &&  hasMethod → parseServerRequest（子进程发起，需应答）
 !hasId &&  hasMethod → parseNotification（单向通知）
  坏 JSON / 非 object / id=null → null
parseServerRequest: 查 APPROVAL_RESPONSES[method]（5 个 approval method 自动 accept）；
  命中 → 存 pendingMap + 产 text 事件（metadata.rpc_method）；
  未命中 → 产 text 事件 kind='unhandled_server_request'
parseNotification: item/started → 累积 agent message（80 字符或 120ms flush）；
  item/completed → tool_result / agent message flush；turn/completed → complete + usage
buildHandshake: clientInfo.{name:'sillyhub-daemon', version: DAEMON_VERSION}
buildTurnStart: params.input=[{type:'text',text:prompt}]（codex 0.131 要求 input 非 instructions）
```

## 注意事项
- **codex 握手必须按序发** initialize → notifications/initialized → thread/start；turn/start 依赖 thread/start response 的 threadId，由 TaskRunner 收到 id=2 response 后单独调用 buildTurnStart。
- 字段名严格按 codex schema：`clientInfo`（非 client）、`threadId`（camelCase 非 thread_id）、`input`（非 instructions，codex 0.131 实测，否则 -32600）。
- server request 的「待应答 id」记实例字段 pendingMap，TaskRunner 轮询取出写 stdin（Node 方案B：I/O 全在 TaskRunner）。
- 5 个 approval method（execCommandApproval/applyPatchApproval 等）自动 accept 模板，method 名逐字来自 Python 禁止改动。
- IR 收敛：turn/started 不用 status 类型，收敛为 text + metadata.status='running'（task-02 IR 5 元组全局一致）。
- provider 差异仅在 spawn 层（codex 多 app-server 子命令），parse 层四 provider 无分支，预留 mapMethodName 钩子（当前 identity）。
- agent message 有 flush 缓冲（80 字符 / 120ms），避免 delta 过碎。

## 人工备注
<!-- MANUAL_NOTES_START -->
<!-- MANUAL_NOTES_END -->
