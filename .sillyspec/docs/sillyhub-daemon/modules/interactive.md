---
schema_version: 1
doc_type: module-card
module_id: interactive
source_commit: ba87eec
author: qinyi
created_at: 2026-06-24T01:10:50
---
# interactive

## 定位
交互式会话子系统（`src/interactive/`，task-04 起 + task-07/08/10 增强）。基于 @anthropic-ai/claude-agent-sdk 的同进程多轮会话，区别于 batch lease 的一次性 TaskRunner spawn。6 个文件分工：session-manager（生命周期）、claude-sdk-driver（SDK 封装）、input-queue（输入队列）、permission-resolver（远程人审）、session-store-persistence（元数据持久化）、types（局部类型）。

## 契约摘要
- **SessionManager**（核心入口）：`create(input)`/`inject(sessionId,prompt,runId)`/`interrupt(sessionId)`/`end(sessionId)`/`fail(sessionId)`/`refreshClaimToken`/`getPendingInjectCount`/`start()`/`stop()`/`scanOnce()`/`snapshotPersistable`/`restoreAndReconnect`/`markReconnected`/`flush`。内存 Map<sessionId, SessionState>。
- **ClaudeSdkDriver**：`start(input,opts): Query`（SDK query({prompt:AsyncIterable,options})）/`consume(q,cb)`（for-await 遍历 result 边界）/`interrupt(q)`（turn 级）。`resolveClaudeExecutable(detectedPath)` 把 Windows cmd-shim wrapper 解析到底层真 .exe。
- **InputQueue**：per-session AsyncIterable<SDKUserMessage>，单订阅、close 后 push 抛 SessionQueueClosedError。
- **PermissionResolver**：canUseTool 远程人审 pending 注册表，register/resolve/abortAll，5min 兜底超时 deny，fail-closed。
- **JsonSessionPersistence**：sessions.json 元数据原子写（0600 + tmp rename），损坏 quarantine。
- 类型：SessionStatus(active/running/reconnecting/ended/failed)、SessionState、CreateSessionInput、InjectResult、SessionManagerDeps、PersistedSessionRecord、PersistedSessionFile、SESSION_FILE_VERSION=1。错误类：SessionNotFoundError/SessionAlreadyExistsError/SessionNotActiveError/UnsupportedProviderError/ClaudeExecutableNotFoundError/SessionQueueClosedError。

## 关键逻辑
```
create: 建 InputQueue + push 首 SDKUserMessage → driver.start → fire consume 协程
inject: push 追问（turn 级串行，SDK 在当前 turn result 后消费）；
  status=running 时 pendingInjectCount++ + onTurnQueued 回调（排队检测非拒绝）
interrupt: driver.interrupt（turn 级，session 仍 active）；终态由 _onResult 按 SDK result 收尾
end: InputQueue.close → query 自然结束 → status=ended → onSessionEnd（统一收口）
fail: driver onError → status=failed → onSessionEnd
空闲扫描: start()/stop() 启停定时器（FR-06/D-004@v1）；_scanIdle → _onIdleExpire → end
持久化: snapshotPersistable → JsonSessionPersistence.save（原子写）；
  restoreAndReconnect 从 sessions.json 恢复 + resume SDK jsonl
permission: canUseTool 回调 → PermissionResolver.register 生成 request_id + 发 PERMISSION_REQUEST
  → await Promise；PERMISSION_RESPONSE 到达 resolve() settle；interrupt 时 signal abort deny
```

## 注意事项
- **R-exe 关键修正（task-01 / ql-20260624-002）**：agent-detector 在 Windows 给的 claude/codex 路径常是 npm cmd-shim wrapper（claude.cmd / codex.cmd），spawn 不带 shell → CreateProcess 对 .cmd 返回 EINVAL（4ms 失败进程没起）。claude SDK driver.start 前用 resolveClaudeExecutable 转 wrapper→真 .exe；codex app-server driver.start（ql-20260624-002）复用 cmd-shim.ts 的 resolveWindowsCmdShim 解析 codex.cmd → {exe:node.exe, prependArgs:[codex.js]}，spawn(node.exe, [codex.js, ...args])，对齐 batch task-runner.ts:705-713，解析失败回退 shell:true。
- **turn 级语义**：InputQueue 只保证 push 顺序 yield，「同一 turn 不接受第二条」由 SDK 自身保证（未 result 的 push 排到下一 turn，spike S1）。
- **InputQueue 单订阅**：第二次 [Symbol.asyncIterator] 抛 SessionQueueDoubleSubscribeError；close 前已 push 的消息必须全部 yield 完才结束。
- **PermissionResolver fail-closed 铁律**：send 失败/signal aborted/5min 超时/abortAll 全部 deny，绝不本地 allow；每个 promise 只 settle 一次；listener settle 时移除防泄漏；resolver 只活在当前 turn 协程内不跨 turn。
- **持久化白名单**：仅写 PersistedSessionRecord（sessionId/leaseId/agentSessionId/cwd/provider 等），禁止写 claim token/API key/credential/prompt 内容/agent 输出/Query 句柄/InputQueue（不可序列化且敏感）。SDK 自动持久化 ~/.claude/projects/<encoded-cwd>/<sid>.jsonl，daemon 不读不写。
- claimToken 跨 turn 复用（gap-2 D-002@v3）：create 时存入 state.claimToken，供 submitMessages + notifyRunResult 复用。
- claim token / API key / credential 一律不进持久化白名单（task-10 §4.1）。

## 人工备注
<!-- MANUAL_NOTES_START -->
<!-- MANUAL_NOTES_END -->
