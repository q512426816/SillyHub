---
author: flow-machine-draft
created_at: 2026-10-13T15:01:33.214Z
---
# 设计记录（Design Record）— 2026-10-13-sillyspec-version-probe-fast-retry

## 做法概述

本变更怎么解决问题？改哪里、为什么选这个方案（一两段）。

问题根因：注册期 `probeLocal()`（shell 跑 `sillyspec --version`，30s 超时）瞬态失败（冷启动慢/超时杀树）后 `_version=null`，而唯一的周期性重探入口是第四循环 `_sillyspecLoop`（默认 3600s 且先睡后查）——失败后最长 1 小时内无人重探，心跳第 5 参因「version=null 键不出现=backend 保留 NULL」持续缺席，机器卡长期误显「sillyspec 未安装」。

方案：在 `SillySpecManager` 内加**限频重探入口** `retryProbeLocalIfUnknown()`（version 未知且距上次尝试 ≥`versionRetryMs`，默认 120s，才真正执行一次 `probeLocal()`），daemon `_sendHeartbeatOnce` 每拍在组装 sillyspec 快照**前**以 void fire-and-forget 触发（duck-type 守卫）。自愈时延 = 120s 窗口 + 至多一个心跳间隔（默认 15s），不再依赖 1 小时循环；成功后下一拍心跳即带 version，backend 列收敛、徽标消失。选 manager 内限频而非 daemon 侧计数：限频状态（lastAttemptAt）与探测行为同源单一，daemon 侧零状态、测试可独立注入假钟。

## 接口契约

动了哪些函数/端点/命令/文件格式？对外可见的签名或行为变化是什么（含「无」的说明）？

- `SillySpecManager.retryProbeLocalIfUnknown(): Promise<void>`（新增公共方法）：version 非 null 纯 no-op；version null 且距上次 `probeLocal` 尝试 <120s 跳过；否则执行一次 `probeLocal()`（内部统一记 `_versionLastAttemptAt`）。全路径自收敛不抛（异常仅 `sillyspec_version_retry_error` warn）。
- `SillySpecManagerDeps.versionRetryMs?: number`（新增可选依赖，默认常量 `SILLYSPEC_VERSION_RETRY_MS=120_000`；测试注入调小）。
- `probeLocal()` 行为不变，仅新增副作用：入口处记录尝试时刻（所有调用路径——注册期/手动升级/第四循环/重探——统一记账，重探限频天然以最近一次尝试为基准）。
- daemon `_sendHeartbeatOnce`：新增一行触发点，位于 `getSnapshot()` 组装前；心跳报文协议（第 5 参键存在性语义）、backend、前端**零变化**。
- 对外协议/DB/DTO/前端：无变化。

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）

4. 作用域：跨工作区/跨仓/多实例时数据会不会串台？

3. 切换/生命周期：会话、请求或变更中途切换/中断时状态是否安全？

2. 并发写：两个执行体同时操作同一数据/文件会发生什么？

1. 乱序/迟到到达：输入或事件乱序时，本设计的假设还成立吗？

1. 乱序/迟到到达：重探入口由心跳循环串行调用（15s 一拍），不存在乱序输入；探测结果迟到（void 未 await 完成）只影响下一拍快照，本拍心跳照发——语义为「最终一致」，可接受。注册期探测与首拍重探可能时间上接近，但 lastAttemptAt 记账保证窗口内不会重复探测。
2. 并发写：`retryProbeLocalIfUnknown`（心跳线程）与手动升级 `requestManualUpgrade`（WS 指令线程）可能并发调 `probeLocal`——两者均只写 `_version`（string 原子赋值）与 `_versionLastAttemptAt`（number 原子赋值），Node 单线程下无交错撕裂；重复探测代价=一次幂等只读命令，无害。限频窗口判定（读 now-写 lastAttemptAt）非原子但调用方仅心跳循环一处串行，无竞态放大面。
3. 切换/生命周期：进程重启后 `_version`/`_versionLastAttemptAt` 归零重来（内存态，与 `_update` 状态机同取舍）——注册期重新探测一次即恢复，无持久化需求。stop/abort 期间心跳循环退出，重探随之停止，无悬挂定时器（本设计不引入 setTimeout，复用心跳节奏）。
4. 作用域：全部状态在单 daemon 进程内的 SillySpecManager 实例上，per-server 配置隔离（一个 server 一个 Daemon 一个 manager），无跨工作区/跨仓共享面，不存在串台。

## 风险与死路

本方案最大的风险是什么？试过但放弃的方案及放弃理由？

最大风险：version 确实不存在（真未安装）的机器上，每 120s 白跑一次 `sillyspec --version`（最坏 30s 超时等待）。代价评估：单次只读命令 + 失败即返回，120s 一次的频率与第四循环（1h）相比可忽略；且第四循环的 `checkAndUpgrade` 在未安装场景本会触发安装路径，重探成功反而是其前置数据修复——不做退避（对数/上限封顶）是为保持实现最小，若实测有噪音再加指数退避。

试过放弃的方案：①「注册期失败后前 N 分钟密集重试（定时器阵列）」——需要引入 setTimeout 生命周期管理（stop 清理、重启残留），与 manager 现有「零自有定时器除 deferred 复查外」的形态冲突，复杂度不成比例；②「心跳对 version 未知态每拍探测（不限频）」——15s 一拍 × 30s 超时最坏叠加连发 spawn，且真未安装机器上永久每拍探测，噪音不可接受；③「backend/前端区分『探测失败』与『未安装』（新列 sillyspec_version_probe_failed）」——三端协议+DB 迁移，超出 thin 范围，且本变更（2 分钟自愈）已把假「未安装」的存活期压到用户基本无感，不引入该区分的收益已不成立。

## 文件变更清单

| 操作 | 路径 | 说明 |
| --- | --- | --- |
| 修改 | sillyhub-daemon/src/sillyspec-manager.ts | 常量 SILLYSPEC_VERSION_RETRY_MS、deps.versionRetryMs、_versionLastAttemptAt 记账、retryProbeLocalIfUnknown() |
| 修改 | sillyhub-daemon/src/daemon.ts | _sendHeartbeatOnce 组装快照前 duck-type 守卫 + void 触发重探 |
| 修改 | sillyhub-daemon/tests/sillyspec-manager.test.ts | 新 describe：限频重探五分支（makeHarness 增 versionRetryMs 注入） |
| 修改 | sillyhub-daemon/tests/daemon-heartbeat-sillyspec.test.ts | FakeManager 增可编程 retryProbeLocalIfUnknown；心跳触达与旧形态不崩两用例 |
