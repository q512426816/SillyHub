---
author: flow-machine-draft
created_at: 2026-10-21T03:38:36.353Z
---
# 设计记录（Design Record）— 2026-10-21-daemon-sync-hardening

## 做法概述

本变更怎么解决问题？改哪里、为什么选这个方案（一两段）。

背景：2026-10-21 腾讯云会话实测 daemon 宿主冻结约 5 分钟——`_wsLoop` 每秒轮询、假活阈值 120s，理论上 11:02:56 即应回收，实际 11:07:23 才发生，且 daemon 日志 6 分钟零输出，事件循环整体停摆却无任何本端观测面；同日另有两类长期噪音：某登记根每分钟 `sillyspec progress show` exit 2 刷屏（CLI uninit 门对跨仓子目录必拒）、`/mnt/e` drvfs 慢盘 30s 超时；再叠加 runbook（docs/sillyspec/finished/spec-push-conflict-recovery-runbook.md）钉死的历史根因——daemon 自动同步与 CLI `sillyspec platform sync` 双写者致 SpecPushConflict 反复。用户拍板：平台侧加固、单写者优先 CLI。

方案按四个独立小步落地，全部收敛在 sillyhub-daemon 包内：

1. **FR-01 关闭开关**：守在 `postSpecSync` 包装器（daemon 侧 interactive `syncSpecTreeIfNeeded` 与 task-runner 批量两条推送路径的唯一汇聚点）入口。机器级 env `SILLYHUB_DAEMON_SPEC_SYNC_OFF` + 工作区级 flag 文件 `~/.sillyhub/daemon/spec-sync-off/{wsId}.flag`（置于 daemonStateDir 下 specs/ 旁，pull 整树交换不触及，永不丢）。命中即返回 null——调用方既有 null 分支（mock 容错）天然 no-op，零调用方改动；pending_push 不动（关闭非传输失败）；knowledge hits 上行独立于 manifest，照常执行。
2. **FR-02 超时 env 化**：constructor 回退链 `deps.statusTimeoutMs ?? parseStatusTimeoutMsEnv(env) ?? 30_000`，deps 优先保住既有测试注入面。
3. **FR-03 退避 + FR-04 crossrepo 跳过**：都在 `collectStatusOnce`/`_collectOneTarget` 内。退避用「per-target 连败计数 + 全局轮次取模」纯函数判定（避免多定时器生命周期复杂度）；crossrepo 用 `existsSync(<cwd>/.git/sillyspec-crossrepo.json)` 前置守卫 + 一次性 info 指路（标记格式读自 sillyspec CLI local-register.js 实锤：`{workspace, key, registeredAt}`）。
4. **FR-05 超时补口 + FR-06 lag 监控**：hub-client 全量 fetch 已带 AbortSignal.timeout（DEFAULT 30s / SPEC_SYNC 300s / BUNDLE 120s），唯一缺口 fetchMcpWhitelist 补 DEFAULT；新增 `event-loop-watch.ts` 以 `perf_hooks.monitorEventLoopDelay` 采样，作为第六循环挂 `_fire` 统一 abort 生命周期——宿主冻结类事故自此有 warn 证据点。

## 接口契约

动了哪些函数/端点/命令/文件格式？对外可见的签名或行为变化是什么（含「无」的说明）？

- `sillyhub-daemon/src/spec-sync.ts`：新增导出 `parseSpecSyncOffEnv(v)`、`specSyncOffFlagPath(wsId)`、`isDaemonSpecSyncOff(wsId)`；`postSpecSync` 行为变化——开关命中时跳过推送返回 null（此前 null 仅 mock 客户端出现），签名不变。
- `sillyhub-daemon/src/sillyspec-manager.ts`：新增导出 `parseStatusTimeoutMsEnv(v)`、`shouldSkipStatusCollect(fails, round)`、常量 `STATUS_COLLECT_BACKOFF_GRACE_FAILS=3`、`STATUS_COLLECT_BACKOFF_EVERY_N=10`；constructor 超时回退链新增 env 层；`collectStatusOnce` 新增退避跳过与连败记账，`_collectOneTarget` 新增 crossrepo 前置守卫（对 deps 注入面零变化）。
- `sillyhub-daemon/src/hub-client.ts`：`fetchMcpWhitelist` 实参补 `signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS)`，签名与返回不变。
- `sillyhub-daemon/src/event-loop-watch.ts`（新增）：导出 `summarizeLagHistogram(histo, thresholdMs, windowMs)`（纯函数）、`runEventLoopWatch(signal, deps)`（循环体，log/intervalMs/warnThresholdMs/histogramFactory/sleep 可注入）。
- `sillyhub-daemon/src/daemon.ts`：`_startInternal` 循环启动区追加第六循环 `this._fire((signal) => runEventLoopWatch(signal, { log: ... }))`，别无改动。
- 运维面（新增 env / 文件，向后兼容：不设即零行为变化）：`SILLYHUB_DAEMON_SPEC_SYNC_OFF`、`SILLYHUB_DAEMON_STATUS_TIMEOUT_MS`、flag 目录 `~/.sillyhub/daemon/spec-sync-off/`。

## 文件变更清单

| 操作 | 路径 | 说明 |
|---|---|---|
| 新增 | sillyhub-daemon/src/event-loop-watch.ts | 事件循环 lag 监控循环 + 纯函数统计 |
| 修改 | sillyhub-daemon/src/daemon.ts | 接线第六循环（lag 监控） |
| 修改 | sillyhub-daemon/src/sillyspec-manager.ts | 超时 env 覆盖 + 失败退避 + crossrepo 跳过 |
| 修改 | sillyhub-daemon/src/spec-sync.ts | postSpecSync 关闭开关（env + per-ws flag） |
| 修改 | sillyhub-daemon/src/hub-client.ts | fetchMcpWhitelist 补 AbortSignal.timeout |
| 新增 | sillyhub-daemon/tests/spec-sync-off-switch.test.ts | FR-01 测试 |
| 新增 | sillyhub-daemon/tests/sillyspec-status-collect-guards.test.ts | FR-02/03/04 测试 |
| 新增 | sillyhub-daemon/tests/hub-client-fetch-timeout-surface.test.ts | FR-05 源码面断言 |
| 新增 | sillyhub-daemon/tests/event-loop-watch.test.ts | FR-06 测试 |

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）

1. 乱序/迟到到达：输入或事件乱序时，本设计的假设还成立吗？

   成立。关闭开关每次推送前现读（existsSync + env），开关翻转最晚下一拍生效，无缓存陈旧态；退避连败计数按轮次顺序在单循环内累加，某轮实采成功即清零——采集是串行 for 循环，无并发回执乱序面，失败不存在「迟到插入」。

2. 并发写：两个执行体同时操作同一数据/文件会发生什么？

   flag 文件由运维 touch/rm，daemon 只读（existsSync），竞态最多晚一拍生效、无损坏；连败 Map 与一次性提示 Set 均在 Node 单线程事件循环内读写，无锁需求；flag 目录 `daemonStateDir/spec-sync-off/` 与 `specs/{wsId}` 平级，pull 的整树交换（swapExtractedDir 只动 specs/{wsId}）不触及，开关永不丢。

3. 切换/生命周期：会话、请求或变更中途切换/中断时状态是否安全？

   安全。lag 监控循环走 `_fire` 统一 AbortController，stop 时随全部循环一并 abort，finally 里 disable 直方图；退避计数/一次性提示为内存态，进程重启回零（与 `_statusError` 既有内存态语义对齐——重启后首轮即实采，宁可多采一轮不可漏采）；env 开关重启生效、flag 文件即时生效，任一命中即关，两种粒度并存不冲突。

4. 作用域：跨工作区/跨仓/多实例时数据会不会串台？

   不会。per-ws flag 以 wsId 文件名隔离；机器级 env 语义显式为「整机全部工作区」；退避记账 key 用 workspaceId（legacy 单槽位用固定哨兵键），多目标互不串台；crossrepo 守卫按 cwd 判定只影响该目标自身，anyFailed 聚合不受污染；多 daemon 实例（SILLYHUB_DAEMON_DIR 隔离）下 daemonStateDir 随 env 重定向，flag 面天然按实例隔离。

## 风险与死路

本方案最大的风险是什么？试过但放弃的方案及放弃理由？

- **最大风险**：FR-01 开关误开且被遗忘 → 该工作区平台镜像停止前进。缓解：每次 skip 输出带恢复方法的 warn（可检索）；flag 是显式运维动作（touch），不存在静默默认开。
- **放弃方案①**：crossrepo 目标重定向采集到标记内 workspace 根——会把子仓 wsId 的摘要错标为父工作区数据（attribution 错误），且多子仓同根时槽位互相覆盖；改为跳过 + 指路日志，把登记根修正留给运维决策。
- **放弃方案②**：per-target 独立退避定时器——引入多定时器生命周期与 abort 传播复杂度，全局轮次取模一行纯函数可测可推演，降频粒度（60s×10=10 分钟）已满足去噪目标。
- **放弃方案③**：status 超时做成 config.json 落盘键——需迁移落盘格式与读取兼容层；env 与 SILLYHUB_DAEMON_DIR 既有惯例同构，deps 注入位已在，env 一层即通。
- **已知边界**：FR-01 关闭态下 daemon 的 knowledge hits 仍走 daemon 通道上行（设计如此，防 hits 断流复现），若用户连 hits 也想全关，属新需求不在本变更承诺面。
