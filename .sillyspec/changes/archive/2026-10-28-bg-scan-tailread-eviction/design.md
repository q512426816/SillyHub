---
author: flow-machine-draft
created_at: 2026-10-27T23:44:45.002Z
---
# 设计记录（Design Record）— 2026-10-28-bg-scan-tailread-eviction

## 做法概述

本变更怎么解决问题？改哪里、为什么选这个方案（一两段）。

两处缺陷同在 daemon.ts `_bgTaskFinalLoop`（cdcb97fdb 引入）：读侧把 `readFile` 全量读入再 `subarray` 取尾，内存峰值与日志全大小成正比；清理侧只删空内层 Map 而 Map 一旦有条目永不为空，实际是空操作。方案：抽两个可单测的纯函数到新模块 `sillyhub-daemon/src/bg-task-scan.ts`——`readFileTailBytes(logPath, tailBytes)` 用 `open()` + 按偏移 `read()` 只读尾窗（对齐 liveness/tailer.ts:137-143 既有实践，句柄 try/finally 关闭；文件小于窗口整读；失败抛错由扫描环既有 catch→continue 兜住），`evictUnseenSnapshotPaths(snapshots, seenPaths)` 按本轮可见集删除集合外键并返回淘汰计数。扫描环改为调用两函数：读侧一行替换；清理侧把无效的 `size > 200` 块替换为每轮构建 `seenPaths` Set、循环后调用淘汰。抽函数而非原地改是为了让「区间读边界」与「淘汰语义」可被 vitest 直测（循环本体依赖 Daemon 实例与发现链，直测成本高）。

## 接口契约

动了哪些函数/端点/命令/文件格式？对外可见的签名或行为变化是什么（含「无」的说明）？

无对外契约变化：RPC 面（sillyspec_hits_flush 等）、上报事件、日志事件名均不动。新增内部模块 bg-task-scan.ts 导出 `readFileTailBytes` / `evictUnseenSnapshotPaths` 两个函数（daemon 内部使用，非公共 API）；daemon.ts `_bgTaskFinalLoop` 私有方法内部实现替换，签名不变。

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）

1. 乱序/迟到到达：输入或事件乱序时，本设计的假设还成立吗？

日志在 stat 与 read 之间增长/轮转：read 时按句柄自身读取，文件轮转（rename/重建）最坏读到旧内容或 ENOENT 抛错→continue 下轮再看，与现状语义一致；快照淘汰不依赖事件顺序，只按本轮可见集——迟到终态若其路径已不在 targets，本就不会再被扫描，淘汰不改变该事实。

2. 并发写：两个执行体同时操作同一数据/文件会发生什么？

被读日志由 CLI 进程追加写，读侧只读已落盘字节，区间读不比 readFile 全量读更多暴露竞态；_bgTaskSnapshots 仅本扫描环单执行体访问（60s 串行循环），淘汰无并发面。

3. 切换/生命周期：会话、请求或变更中途切换/中断时状态是否安全？

句柄在 finally 关闭，异常路径不泄漏 fd；abortSignal 中断时 abortableSleep 抛出退出循环，快照残留随进程生命周期（与现状一致），会话终态后路径从 targets 消失即被淘汰。

4. 作用域：跨工作区/跨仓/多实例时数据会不会串台？

快照键是绝对 logPath，天然不串台；可见集来自同一发现链，同源判定；区间读是无状态纯函数。

## 风险与死路

本方案最大的风险是什么？试过但放弃的方案及放弃理由？

最大风险：淘汰可见集若因发现链瞬时抖动漏掉在产路径，会误删其幂等基线导致终态重报——backend 侧已声明重复上报无害（同值信号），且 discoverLivenessWatchTargets(rescan:false) 完全由内存 spawn 记录推导、无 fs 抖动面，风险可控。试过放弃的方案：①内层 Map 加条目级 TTL/LRU——放弃，会话存活期内条目本就该保留（幂等基线），TTL 反而制造重报；②保留 size>200 阈值门——放弃，每轮 O(n) 核对在 60s 节奏下成本可忽略，阈值门只是把正确性修复重新变成条件触发。

## 文件变更清单

| 操作 | 路径 | 说明 |
| --- | --- | --- |
| A | sillyhub-daemon/src/bg-task-scan.ts | 新模块：readFileTailBytes 区间读 + evictUnseenSnapshotPaths 淘汰 |
| M | sillyhub-daemon/src/daemon.ts | _bgTaskFinalLoop 读侧换区间读、清理侧换可见集淘汰 |
| A | sillyhub-daemon/tests/bg-task-scan.test.ts | 两函数各三形态用例 |
