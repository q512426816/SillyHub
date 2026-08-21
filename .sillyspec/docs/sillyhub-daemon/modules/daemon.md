---
schema_version: 1
doc_type: module-card
module_id: daemon
author: qinyi
created_at: 2026-08-18 01:45:00
---

# 守护进程主类（daemon）

## 定位

守护进程主类，编排核心（约 4000 行）。只做组装不实现子能力（探测/HTTP/WS/子进程/
git 都在前置模块）。生命周期：preflight → 探测 agent → runtime lock 单实例 →
per-daemon 注册 → 崩溃会话恢复 → skills 同步 → 三循环（heartbeat / lease 轮询 /
WS）→ WS RPC handler + 消息路由 → lease 状态机（claim → start → execute →
complete）按 kind 分流 batch / interactive / init / change-write。

## 契约摘要

- `Daemon(options: DaemonOptions)` + `start()` / `stop()`；DaemonOptions 可注入
  mock detector / wsClientFactory / taskRunner / sessionManager / persistence /
  recoveryClient / lockManager（测试口）。
- 导出纯函数与端口：`translateSpecRoot(prompt, specRootMap)`（spec_root_map
  "from:to" 容器路径→宿主路径翻译，按**首个** ':' 分割容忍盘符冒号）；
  `RecoveryCoordinator` / `SessionRecoverStatus`（重启恢复鸭子类型端口）；
  `LEASE_POLL_SKIP_MS = 90_000`（轮询门控常量）。
- 依赖契约全为鸭子类型子集（DetectorLike / ClientLike / TaskRunnerLike /
  WsClientLike / RuntimeLockLike / InteractiveCredentialManager），避免硬耦合。
- interactive 桥接回调：`onTurnMessage`（→ submitMessages 流式上报）、
  `onTurnResult`（→ notifyRunResult，含 usage/cost/duration + ModelError）、
  `onSessionEnd`（→ notifySessionEnd + spec 回灌）。

## 关键逻辑

```
start():
  runPreflight(失败不阻断) → detectAgents → 逐 provider acquireLock(失败回滚+抛)
  → _registerDaemon(单次 POST /register) → _recoverSessionsOnBoot → syncSkills
  → _fire 三循环 + sessionManager.start() + 信号 handler
_pollLoop(): WS isConnected 且 lastMessageAt < 90s → 跳过该轮 HTTP 轮询（假活/断连恢复 30s 兜底）
_runLeaseStateMachine(): claimLease → 归一化 execPayload(snake→camel，嵌套/平铺两形态)
  → startLease → 按 kind/mode 分流 → completeLease
  batch → taskRunner.runLease；interactive → _startInteractiveSession；
  init lease → task-runner 内 runSillyspecInit 链路
_executeChangeWrite(): claim → taskRunner.runChangeWrite(轻量分支，不启 agent) → complete
  → kind=spec-sync 时整树回灌 postSpecSync（严格不走 lease 状态机）
_handleWsMessage(): TASK_AVAILABLE / HEARTBEAT_ACK(同步 allowed_roots+PolicyCache) /
  LEASE_CANCEL(taskRunner.cancel 杀子进程) / SESSION_INJECT|INTERRUPT|END|RESUME /
  PERMISSION_RESPONSE / PROVIDER_CONFIG_CHANGED / SELF_UPDATE / CLEANUP(缓存清理,
  交互会话运行中或已有清理在跑时跳过) / session_switch_config
RPC handler 注册: list_dir / host_fs.* / get_spec_bundle
```

## 注意事项

- **execPayload 归一化是历史事故多发点**：backend claim 返回 snake_case，必须逐字段
  camel 化；遗漏曾致 agent_run_id 空串 422（ql-20260616-006）、transport 漏传致
  interactive spec 从不同步（ql-20260627）、mode/platform_config 漏传致 init lease
  落入无 prompt spawn（ql-20260711）。给 lease payload 加字段时同步补这里。
- runtime lock 强制单实例（同 host+user+provider 一 daemon）：任一 provider 锁被
  活跃进程持有 → releaseAll + 抛错阻止三循环启动；防双开共享 runtime_id 致
  ownership 双通过 + WS 重连风暴。
- 并发控制：`_inflightLeases` 去重 + `max_concurrent_tasks` 上限（超限丢轮等下次）；
  change-write 有独立的 `_inflightChangeWrites` 去重。
- interactive 会话 spec 同步：session 开始按 spec_strategy 三分支
  （platform-managed / repo-mirrored / repo-native）经 pullSpecBundle 初始化；
  结束经 syncSpecTreeIfNeeded 回灌（specSyncCtx ctx-guarded，仅 scan/stage 会话有，
  quick-chat/shared no-op）。
- 借用（borrow）沙箱：backend placement 下发 `metadata.cwd = "borrow-sandbox:<slug>"`
  marker，daemon 检测前缀 → 提取 slug → 创建独立沙箱目录作 cwd（marker 不进真实
  路径），并登记按 lease 隔离的只读 policy。
- usage/cost 上报走 ResilienceService（notifyRunResult + mergeAdapterUsage）非
  submitMessages 直传；FileOutbox 防 WS 断线丢消息。
- SILLYSPEC_TEMP_ROOTS 常量放行 /dev/null（含 Windows C:/dev/null 形态）+ tmpdir，
  供 sillyspec 写临时文件过 PolicyCache 白名单；写死不接受外部输入。
- 模块级常量 `daemon:session_switch_config`（会话内切档案/供应商）暂收口在本文件，
  protocol.ts MSG 表未收录——升级 protocol 时注意回收。

## 人工备注

<!-- MANUAL_NOTES_START -->

<!-- MANUAL_NOTES_END -->
