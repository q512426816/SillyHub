---
schema_version: 1
doc_type: module-card
module_id: interactive
author: qinyi
created_at: 2026-08-18 01:45:00
---

# 交互式会话子系统（interactive）

## 定位

交互式会话子系统（`src/interactive/`，8 文件约 7800 行）：区别于 batch lease 的一次
性 spawn，提供同进程多轮长驻会话。分层：SessionManager（生命周期，不依赖任何
provider SDK）→ provider-neutral driver 契约（driver.ts 纯类型）→ ClaudeSdkDriver
（Claude Agent SDK）/ CodexAppServerDriver（codex app-server JSON-RPC）双实现；
辅助件 InputQueue（输入队列）、PermissionResolver（远程人审）、
JsonSessionPersistence（元数据持久化）、types.ts（局部类型，独立于 src/types.ts）。

## 契约摘要

- **SessionManager**：`create` / `inject` / `interrupt` / `end` / `fail` /
  `restoreAndReconnect`（重启恢复，按 record.stage/provider 路由）/
  `markReconnected` / `refreshClaimToken` / `setBudgetTokens` / `isOverBudget` /
  `markPendingSwitch` / `reloadWithProvider`（会话内切供应商，热重启 env）/
  `markPendingConfigSwitch` / `reloadWithConfig`（会话内切档案，承载切换轮
  prompt）/ `requestPermission` / `requestUserDialog` / `registerBorrowSandbox` /
  `snapshotPersistable` / `flush` / `start|stop|scanOnce`（空闲扫描）。
- **driver.ts 契约**：`UserTurnInput`（provider-neutral 输入单元）/
  `InteractiveDriverMessage|Result`（宽松字段，daemon 按 provider 归一化）/
  `InteractiveDriverHandle`；SDK 类型只允许出现在具体 driver 内部。
- **ClaudeSdkDriver**：SDK query 同进程多轮；`resolveClaudeExecutable` 把 Windows
  cmd-shim wrapper 解析到真 .exe（防 spawn EINVAL）；canUseTool / onUserDialog /
  mcpServers 透传 SDK options。
- **CodexAppServerDriver**：spawn `codex app-server --listen stdio://`；握手
  initialize → initialized → thread/start|resume（每条间隔 300ms）；turn 串行
  （turn/completed 后才消费下一条）；turn/interrupt；flat message 契约
  `{event_type, content, metadata, session_id=threadId}`；审批 fail-closed 拦截
  （不透传 adapter 的 accept 模板）。
- **InputQueue**：单订阅 AsyncIterable；close 后 push 抛 ClosedError；close 前
  push 的消息必须全部 yield 完。
- **PermissionResolver**：canUseTool 远程人审 pending 注册表；request_id 用
  randomUUID；`PERMISSION_FALLBACK_TIMEOUT_MS = 5min+5s` 兜底。
- **JsonSessionPersistence**：`~/.sillyhub/daemon/sessions.json` 原子写
  （tmp+rename，0600）+ 单 promise queue 串行化；损坏 quarantine、单条 schema
  非法丢弃隔离。

## 关键逻辑

```
create: 建 InputQueue + push 首消息 → 按 provider 选 driver（未注册抛
        UnsupportedProviderError）→ driver.start → fire consume 协程 → notifySessionReady
inject: status=running 时 pendingInjectCount++ + onTurnQueued（排队检测非拒绝）
turn 收尾: classifyModelError → result.modelError → daemon 桥接 notifyRunResult
写守卫: policyEngine.canWrite(runtimeId, path, provider, tool) 覆盖 Write/Edit/
  MultiEdit + Bash 经 extractShellWritePaths 提取写目标；读工具不拦；
  policyEngine 未注入时退化 allowedRootsProvider fallback（空数组放行防全 deny）
主 agent MCP: isMainAgentSession(ctx.stage==='orchestrator') → mainAgentMcpConfigProvider
  经 mergeMcpConfigs 注入 daemon 内置 MCP server；恢复时按 record.stage 重注入
reloadWithProvider: buildSpawnEnv 构造新 env + CLAUDE_CONFIG_DIR 隔离；null=停止
  供应商回退本机凭证（隔离仍保持）
空闲扫描: _scanIdle → _onIdleExpire → end（running 先 interrupt 再 end 兜底）
```

## 注意事项

- 空闲回收默认**禁用**：`DEFAULT_IDLE_TIMEOUT_SEC = 0`（scan/stage 由 backend 主动
  end_session 收口，防假性空闲误杀）；env SESSION_IDLE_TIMEOUT_SEC 显式 >0 才恢复
  旧回收行为（逃生口）。扫描周期默认 60s。
- R-exe（Windows 命中率极高的坑）：detector 给的路径常是 npm cmd-shim wrapper
  （claude.cmd / codex.cmd），spawn 不带 shell → EINVAL。claude driver 用
  resolveClaudeExecutable；codex driver 用 resolveWindowsCmdShim（失败回退
  shell:true）。
- PermissionResolver fail-closed 铁律：send 失败 / signal aborted / 5min 超时 /
  abortAll 全部 deny，绝不本地 allow；每 promise 只 settle 一次；listener settle
  时移除防泄漏。
- 持久化白名单：仅写 PersistedSessionRecord 字段；禁写 claim token / credential /
  prompt 轮次内容 / agent 输出 / Query 句柄 / InputQueue。例外：
  record.providerConfig 含 api_key（sessions-portal task-08 决策，恢复 resume 不丢
  配置；0600 与 credentials.json 同信任域）。
- SDK 自动持久化 `~/.claude/projects/<encoded-cwd>/<sid>.jsonl` 由 SDK 写，daemon
  不读不写，resume 靠 SDK 内部加载。
- codex driver 常量：KILL_GRACE_MS=2000（SIGTERM→SIGKILL 升级）、stderr 上限
  20KB、握手间隔 300ms（codex.cmd 包装层 100ms 会丢 stdin）。
- manualApproval=true 才注入 canUseTool/onUserDialog；supportedDialogKinds 缺省
  ['AskUserQuestion']——AskUserQuestion 需回传用户选择，只能走 onUserDialog
  （canUseTool 只有 allow/deny）。
- interactive/types.ts 与 src/types.ts 是两套类型（SessionState 等仅前者有），
  ProviderConfig 从 src/types.ts type-only 引入（防运行时循环依赖）。

## 人工备注

<!-- MANUAL_NOTES_START -->
- ql-20260624-007：codex turn 收敛依赖 turn/completed 经 parseTurnCompleted 产 complete event → finishTurn(currentTurnPromise)；该方法已对齐 claude result 强契约（params.turn 缺失也必收敛，见 adapter-json-rpc 模块）。新增 codex 子进程 stdout 原始行落盘：consume 内 ctx.sessionId 存在时建 WriteStream 写 ~/.sillyhub/daemon/runs/codex-interactive/<sessionId>.log（fire-and-forget 静默，不写日志不影响主流程），sessionId 经 CodexStartOptions 传入、session-manager._buildDriverOptions 一处填充（create+restore 共用）。下次 turn 卡死时看该日志确认 turn/completed 是否到达 / payload 长啥样。
<!-- MANUAL_NOTES_END -->
