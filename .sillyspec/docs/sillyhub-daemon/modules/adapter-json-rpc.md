---
schema_version: 1
doc_type: module-card
module_id: adapter-json-rpc
author: qinyi
created_at: 2026-08-18 01:45:00
---

# JSON-RPC 输出适配器（adapter-json-rpc）

## 定位
JSON-RPC 2.0 over stdio 的解析 adapter，覆盖 codex / hermes / kimi / kiro 四 provider（parse 层共享同一套 method 名，无分支）。协议是双向通信：daemon 发 request（initialize → thread/start → turn/start），子进程回 response、主动推 notification、并发起需应答的 server request。与 Python 版差异：Python parse_output 只处理 notification，Node 版统一处理三类入站消息（方案 B：解析职责全在 adapter，I/O 全在 TaskRunner）。

## 契约摘要
- `JsonRpcProvider = 'codex' | 'hermes' | 'kimi' | 'kiro'`。
- `JsonRpcAdapter implements ProtocolAdapter`：
  - `buildArgs()`：codex 返回 `['app-server','--listen','stdio://']`（缺此参数 codex 进交互 TUI，检测 stdin 非 terminal 即 exit 1）；其余 provider 返回 []。
  - `buildHandshake({cwd,...})`：握手 3 条 JSON-RPC——initialize(id=1，clientInfo.name='sillyhub-daemon'+DAEMON_VERSION) → notifications/initialized → thread/start(id=2，params.cwd)。
  - `buildTurnStart({threadId,prompt,model})`：turn/start(id=3，params.input=[{type:'text',text:prompt}])。
  - `parse(line)`：三分支解析（见关键逻辑）。
  - `getPendingServerRequests()` / `markResponded(id)`：TaskRunner 轮询待应答 server request、应答后清除。
  - `resetAccumulator()`：重试 attempt 间清空 delta 缓冲与去重集合。
- `PendingServerRequest`：{ id, method, params, approvalKind: 'file'|'command'|'elicitation'|null, writePaths?, toolName?, responseTemplate? }。

## 关键逻辑
```text
parse(line) 三分支（对照 Python _handle_line）：
  hasId && !hasMethod → parseResponse   # daemon 之前 request 的回复（含 thread/start reply）
  hasId &&  hasMethod → parseServerRequest  # 子进程发起，需应答
 !hasId &&  hasMethod → parseNotification  # 单向通知
 坏 JSON / 非 object / id===null → null

parseNotification 按 method 分派：
  item/started、item/completed（agentMessage/commandExecution/fileChange）
  item/agentMessage/delta（流式增量，item/completed 时按 itemId 去重防双计）
  turn/started → text+metadata.status='running'；turn/completed → 必产 complete（含 usage）

parseServerRequest 审批分类（task-17 / R-06）：
  item/fileChange/requestApproval、applyPatchApproval → approvalKind='file'
  item/commandExecution/requestApproval、execCommandApproval → 'command'
  mcpServer/elicitation/request → 'elicitation'（固定 accept 空回复）
  未知 → null（TaskRunner 回 -32601 error）
```

## 注意事项
- **codex 握手必须按序**：initialize → notifications/initialized → thread/start；turn/start 依赖 thread/start response 的 thread.id，TaskRunner 收到 id=2 response 后才调 buildTurnStart。
- 字段名严格按 codex schema：`clientInfo`（非 client）、`threadId`（camelCase）、`input`（非 instructions——codex 0.131 实测，旧字段被拒 -32600，ql-20260617-009）。
- 审批应答决策不在 adapter：file/command 类由 adapter 尽力提取 writePaths（file 走 item.path / item.change.path / diff `+++ b/path` / grantRoot 多候选，command 走 policy/shell-paths 的 extractShellWritePaths），TaskRunner 交 PolicyEngine 逐条 canWrite——全 allow 才 accept，任一 deny 或提不到路径则 fail-closed decline。
- agent message 有字符缓冲（`_agentMessageBuf` + `_streamedAgentMessageIds` 去重），turn/completed 是最后兜底 flush 点，防 codex 异常退出丢尾部。
- provider 差异仅在 spawn 层（codex 多 app-server 子命令），parse 层四 provider 无分支，预留 mapMethodName 钩子（当前 identity，须有 fixture 证据才允许加分支）。
- interactive 的 codex-app-server-driver 也构造 PendingServerRequest（不填 approvalKind，走自己的审批处理），兼容字段可选。

## 人工备注

<!-- MANUAL_NOTES_START -->
- ql-20260624-007：turn/completed 是 codex 的 claude-result 等价收尾信号（QUICKLOG-qinyi-2026-06-23:178）。parseTurnCompleted 不再因 params.turn 缺失/非 object 而 return null——降级空对象继续产出 complete event，保证 method===turn/completed 一到必收敛（对齐 claude-sdk-driver result 强契约）。否则 consume 卡在 await currentTurnPromise（codex-app-server-driver.ts:774）→ AgentRun 永不收敛 → inject 报 already has an active run。
<!-- MANUAL_NOTES_END -->
