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
per-daemon 注册 → 崩溃会话恢复 → skills 同步 → 四循环（heartbeat / lease 轮询 /
WS / sillyspec 自动升级检查）→ WS RPC handler + 消息路由 → lease 状态机（claim →
start → execute → complete）按 kind 分流 batch / interactive / init / change-write。

## 契约摘要

- `Daemon(options: DaemonOptions)` + `start()` / `stop()`；DaemonOptions 可注入
  mock detector / wsClientFactory / taskRunner / sessionManager / persistence /
  recoveryClient / lockManager / sillyspecManager（测试口，缺省构造真实
  SillySpecManager，isBusy 接 `_isBusyForUpdate` 三臂忙判定）。
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
  → _registerDaemon(单次 POST /register，注册前 manager probeLocal/probeLatest
    一次使报文即带 sillyspec 版本) → _recoverSessionsOnBoot → syncSkills
  → _fire 四循环 + sessionManager.start() + 信号 handler
_sillyspecLoop(): 第四循环（2026-08-31-machine-sillyspec-version）——间隔
  config.sillyspec_update_interval_sec(默认 3600s，0/非法=关闭即返回)，每拍
  manager.checkAndUpgrade('auto')：latest+local 探测 → 未安装/落后才升级
_pollLoop(): WS isConnected 且 lastMessageAt < 90s → 跳过该轮 HTTP 轮询（假活/断连恢复 30s 兜底）
_runLeaseStateMachine(): claimLease → 归一化 execPayload(snake→camel，嵌套/平铺两形态)
  → startLease → 按 kind/mode 分流 → completeLease
batch → taskRunner.runLease；interactive → _startInteractiveSession；
  init lease → task-runner 内 runSillyspecInit 链路
_executeChangeWrite(): claim → taskRunner.runChangeWrite(轻量分支，不启 agent) → complete
  → kind=spec-sync 时整树回灌 postSpecSync（严格不走 lease 状态机）
_sendHeartbeatOnce(): 每拍透传 sillyspec 快照（manager.getSnapshot 纯同步零
  spawn）作 heartbeat 第 5 可选参——version/latest 非 null 才带（backend 保留）、
  update 非 null 才带（无键=backend 清除），三键全无不占位（旧 4 参形态零回归）
_handleWsMessage(): TASK_AVAILABLE / HEARTBEAT_ACK(同步 allowed_roots+PolicyCache) /
  LEASE_CANCEL(taskRunner.cancel 杀子进程) / SESSION_INJECT|INTERRUPT|END|RESUME /
  PERMISSION_RESPONSE / PROVIDER_CONFIG_CHANGED / SELF_UPDATE / CLEANUP(缓存清理,
  交互会话运行中或已有清理在跑时跳过) / SILLYSPEC_UPDATE(void 调 manager.
  requestUpgrade('server_command')，fire-and-forget，状态经心跳回传) / session_switch_config
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
- ql-20260831-005：SESSION_INJECT 四条静默丢弃路径改为立即回报 run failed（实机案：生产 wp 机会话 84cf91ab——inject delivered 后被 _routeSessionControl 校验丢弃只 warn，run 挂 pending 10 分钟才被 GC 用笼统 interactive_inject_send_failed 收敛，丢弃原因永不到前端）。新增 _reportInjectDropped(raw, reason)：payload 自带 run_id/lease_id/claim_token 三件齐才上报（P2b 同款 notifyRunResult error_during_execution+result_summary，summary 落 output_redacted 经 SessionRunRead.failure_summary 透出，接 ql-20260831-004 链）；缺 run_id/claim_token 仅 warn（backend 10min GC 兜底仍在）。接入点：no_manager / session_not_found（重试后）/ lease_mismatch / missing_fields（仅 run_id 在时），INTERRUPT/END 的 not_found 是良性终态收敛维持纯 warn。
- ql-20260831-006：cwd 守卫（interactive-cwd-guard / checkWorkspaceBoundCwd，2026-08-28-fix-cross-machine-worker-dispatch task-05 引入）加 workspaceRoot 可选参数——工作区绑定会话 cwd 落在工作区根内（复用 assertWithinAllowedRoots 同一 containment 口径）时跳过机器 allowed_roots 白名单，存在性检查（错机试金石）保留。用户决策：默认工作目录在工作区内按工作区范围直接放行；实机案：wp 机会话 84cf91ab 首轮被 cwd_forbidden 拒——工作区 sgm 根 E:\sgm 不在机器白名单，主会话没起来导致后续 inject 全丢弃（与 005 同案两因）。daemon.ts 调用点传 rawRootPath（非借用路径 cwd 恒等于它）；不传参数行为零回归。
<!-- MANUAL_NOTES_END -->
