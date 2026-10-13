---
author: flow-machine-draft
created_at: 2026-10-13T21:31:25.418Z
---
# 设计记录（Design Record）— 2026-10-14-turn-anchor-cache-eviction

## 做法概述

本变更怎么解决问题？改哪里、为什么选这个方案（一两段）。

turn-anchor.ts 的模块级 prev 锚内存缓存 `_lastTreeBySession` 只在 doRecord 尾部
`.set()`、全仓无 delete 路径，会话终结也不清理（对照同文件 `_chainBySession` 链
收尾有 finally 自清理）——长驻 daemon 每会话残留一条 `sessionId→treeSha`（百字节
级），慢性增长。本变更新增导出函数 `clearTurnAnchorCache(sessionId)` 做会话级
清理，并在 `terminateSession`（lifecycle.ts）的会话级清理簇（4b
`_clearBackgroundTasks` / 5 `_destroyUsageLedger` 之间，编号 4c）接线调用，对齐
既有「session 终态清 per-session Map」惯例。JSONL 落盘记录不受影响：同会话若
（理论上）再打锚，`readLastRecord` 尾行兜底恢复 prev——与 daemon 重启续锚同一路
径，既有用例（重启续锚）已覆盖该兜底语义。

关键竞态处理：轮锚是 fire-and-forget（events.ts `void recordTurnAnchor`），
terminateSession 可能在末轮锚链在飞时执行；doRecord 尾部会回写缓存，**先清会被
在飞链回写**。因此清理函数检测到在飞链时挂到链收尾后（`.then`）再 delete，无链
则立即 delete。不引入 LRU/上限淘汰——会话终结即无新轮，终结点清理语义准确且零
配置。

## 接口契约

动了哪些函数/端点/命令/文件格式？对外可见的签名或行为变化是什么（含「无」的说明）？

- 新增导出 `clearTurnAnchorCache(sessionId: string): void`（sillyhub-daemon/src/
  interactive/turn-anchor.ts）：幂等，未存在 sessionId 无操作不抛；在飞锚链存在时
  延迟到链收尾后执行。返回 void、同步签名、永不 reject。
- `terminateSession`（session-manager/lifecycle.ts）新增第 4c 步调用上述函数；
  对外签名/行为（终态通知链、backend 通知、延迟清理）零变化。
- 不动：`recordTurnAnchor` / `toFlowDiffShape` 签名、JSONL 记录格式（TurnAnchorRecord
  字段）、`_chainBySession` 自清理逻辑。

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）

4. 作用域：跨工作区/跨仓/多实例时数据会不会串台？

3. 切换/生命周期：会话、请求或变更中途切换/中断时状态是否安全？

2. 并发写：两个执行体同时操作同一数据/文件会发生什么？

1. 乱序/迟到到达：输入或事件乱序时，本设计的假设还成立吗？

1. 乱序/迟到到达：终态后到达的迟到轮锚事件（SDK 进程已 kill，理论窗口）会在
   clear 之后新起链并回写一条缓存条目——有界（该会话此后不再有轮，最多回写一
   条），且不破坏 JSONL 数据；接受该残留，不做墓碑机制（低危场景不值得复杂度）。
2. 并发写：同会话轮锚经 `_chainBySession` per-session promise 链串行化（既有设
   计）；clear 的「链在飞→挂收尾」分支保证 delete 恒发生在该链最后一次 set 之后。
   `_lastTreeBySession` 为模块级 Map，JS 单线程事件循环下无真并发写。
3. 切换/生命周期：terminateSession 是 end/fail/cancel 硬终止链唯一收口（interrupt
   软打断不经过，session 仍 active 轮锚链继续用缓存——正确）。clear 后模块状态
   等价「该会话未打锚过但 JSONL 在」，续锚走尾行兜底，与重启场景同构。
4. 作用域：键为 sessionId（全局唯一 uuid），不跨会话/工作区串台；清理只删本
   session 条目，不触碰其他会话缓存与 JSONL 文件。

## 风险与死路

本方案最大的风险是什么？试过但放弃的方案及放弃理由？

最大风险：清理后同会话被复用（同 id 再打锚）时 prev 恢复依赖 JSONL 尾行读取，
多一次文件读——仅理论场景（终态会话不再有新轮），且与既有重启兜底同路径、已被
既有用例覆盖。试过但放弃：① LRU/条目上限淘汰——引入魔法数与淘汰策略复杂度，
会话终结点清理语义更准确；② clear 同时删 `_chainBySession`——链自身 finally 已
自清理，额外删除无收益反而在同 id 复用时破坏串行链衔接。

## 文件变更清单

| 操作 | 路径 | 说明 |
| --- | --- | --- |
| 修改 | sillyhub-daemon/src/interactive/turn-anchor.ts | 新增导出 clearTurnAnchorCache（在飞链感知的会话级缓存清理） |
| 修改 | sillyhub-daemon/src/interactive/session-manager/lifecycle.ts | terminateSession 第 4c 步接线调用 + import |
| 修改 | sillyhub-daemon/tests/interactive/turn-anchor.test.ts | 新增 3 组用例：未知 id 幂等 / 清理后续锚尾行兜底 / 在飞链竞态收尾清理 |
| 新增 | sillyhub-daemon/tests/interactive/session-manager-lifecycle-turn-anchor-eviction.test.ts | terminateSession 接线断言（vi.mock turn-anchor 模块 + 最小伪造 mgr） |
