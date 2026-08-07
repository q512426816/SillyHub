---
id: task-08
title: "reloadWithProvider controlled restart preserving conversation context resume"
title_zh: "reloadWithProvider 受控重启保留对话上下文 resume"
author: WhaleFall
created_at: "2026-08-06 16:40:41"
priority: P0
depends_on: [task-07]
blocks: []
requirement_ids: [FR-05]
decision_ids: [D-002@v1]
allowed_paths:
  - sillyhub-daemon/src/interactive/session-manager.ts
goal: >
  session-manager 新增 reloadWithProvider(sessionId, providerConfig 或 null) 方法, close 旧子进程(SDK kill 链) 加 buildSpawnEnv 新 env
  (null 时回退本机凭证) 加 driver.start 传 resume=state.agentSessionId 重载完整对话历史 加 替换 state.query/env 加 重启 _runConsume
  加 清 pendingSwitch, reload 失败保留旧 query 不崩溃(D-002@v1 等 turn 边界 reload 落地)。
implementation:
  - 参考现有 restoreAndReconnect(约第 2288 行)的 driver.start 传 resume 加 _runConsume 重启骨架, reload 复用同一套 resume 链路, 进入时先把旧 query 与旧 env 快照到本地变量供失败回滚。
  - handle.close 走 _terminateSession 同源 SDK kill 链(close?. 加 stdin EOF 加 SIGTERM 加 SIGKILL)优雅终止旧 claude 子进程, 但仅终止子进程不调 onSessionEnd 不改终态 status。
  - buildSpawnEnv 构造新 env, provider_config 为 null 时第 0 层整体跳过且不隔离 CLAUDE_CONFIG_DIR 回退本机凭证(spawn-env.ts 第 158-164 行已支持)。
  - 复用 _buildDriverOptions 构造 driverOpts, 透传 resume=state.agentSessionId 加 新 env 加 原 opts(canUseTool 加 cwd 加 model 加 allowedTools 加 mcpServers 加 permissionMode)。
  - driver.start 返回新句柄后按 provider 写 state.query(claude)或 state.driverHandle(codex)并替换 state.env, void 重启 _runConsume 协程加清 pendingSwitch 加 _scheduleFlush。
  - reload 期间用户发消息 inject 复用现有 _pendingInjectCount 排队语义 push 进新 InputQueue 由 SDK 下一 turn 消费不丢消息(待细化点① 收口, 不引入新锁)。
  - reload 失败(spawn 失败 加 jsonl 缺失 加 cwd 不一致)catch 回滚保留旧 query/env 加上报 _lastError 不崩溃, 不清 pendingSwitch 留待重试或人工介入。
acceptance:
  - reload 后 state.query 指向使用新供应商凭证的新 claude 子进程, env 已替换为新 env。
  - 对话历史完整保留, resume=state.agentSessionId 让 SDK 从对应 jsonl 重新加载(非 daemon 内存态)。
  - provider_config 为 null 时回退本机凭证且不隔离 CLAUDE_CONFIG_DIR(D-004 停止场景对称覆盖)。
  - reload 失败时保留旧 query 会话不崩溃(R-01) 加 reload 期间 inject 走排队语义不丢消息 加 reload 成功后清 pendingSwitch。
verify:
  - cd sillyhub-daemon 加 pnpm test 全绿(含新增 reloadWithProvider 五场景单测: 成功 加 resume 保留历史 加 null 回退本机 加 失败保留旧 query 加 inject 并发排队)。
constraints:
  - 仅改 session-manager.ts, pendingSwitch 字段加 markPendingSwitch 加 _onResult 触发链路由 task-07 owns(不动 types.ts)。
  - resume 用 state.agentSessionId 不丢历史, jsonl 由 SDK 自动持久化非 daemon 内存态。
  - 失败降级不崩溃保留旧 query 会话(R-01), reload 与 inject 并发复用现有 _pendingInjectCount 排队机制不引入新锁, handle.close 走 SDK kill 链不裸调 process.kill 与 _terminateSession 同源, 不改 lease 生命周期不重新 claim, provider_switch 不持久化。
  - 日志经 redactProviderConfig/redactEnv 守卫, api_key 明文经 WS 下发后 daemon 用完即弃不入 submitMessages/磁盘。
expects_from:
  task-07:
    - contract: pendingSwitch state 加 markPendingSwitch 与 _onResult 触发链路
      needs: [SessionState.pendingSwitch 可选字段(由 task-07 在 types.ts 改, 取值为 ProviderConfig 或 null), markPendingSwitch 空闲态立即调 reloadWithProvider 或 running 态标记等 _onResult 边界再触发]
---
