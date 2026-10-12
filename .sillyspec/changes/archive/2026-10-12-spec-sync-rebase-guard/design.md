---
author: flow-machine-draft
created_at: 2026-10-12T00:36:25.792Z
---
# 设计记录（Design Record）— 2026-10-12-spec-sync-rebase-guard

## 做法概述

本变更怎么解决问题？改哪里、为什么选这个方案（一两段）。

c4ff833b0 在 `postSpecSyncImpl` 的 conflict 分支里只给「重试推送」套了传输失败守卫（catch 后转抛 `SpecPushConflict`），但同分支内 `rebaseManifestVersions` 之后、重试推送之前还有 `computeIncrementalOps`（内部 `readFile` 无保护——Windows 杀软短暂锁文件 EBUSY/EPERM、或活跃会话在 walk 与 read 之间删文件即抛）与 `onProgress` 回调两处裸奔点：它们抛出的异常穿透到外层 `catch`（`SpecPushConflict` instanceof 之外的分支），走 `packSpecDir` + `postSpecSync` tar 全量覆盖推送——首推已知冲突面下静默覆盖服务端，正是 c4ff833b0 自述要堵的 NFR-02 违背在非传输路径上的残留。修法：把守卫从「重试推送一圈」扩大到「conflict 后整段 re-base 区」——外层 try 包住 rebase/重算/onProgress/重推全部语句，catch 内 `SpecPushConflict` 原样透传、其余异常统一转 `SpecPushConflict`（附 server_versions 快照），成功路径与「重试仍 conflict」判定移到守卫外保持原语义。

## 接口契约

动了哪些函数/端点/命令/文件格式？对外可见的签名或行为变化是什么（含「无」的说明）？

- 仅改 `sillyhub-daemon/src/spec-sync.ts` 的 `postSpecSyncImpl` conflict 分支内部异常映射；`postSpecSync` 对外签名、`SpecPushConflict` 形态、返回值结构零变化。行为变化一处：conflict 后 re-base 段的非传输异常从「落 tar 全量回退」收紧为「上抛 `SpecPushConflict` 人工裁决」——原行为是缺陷路径，无消费方依赖。
- 无 schema/端点/迁移变化，`pnpm gen:types` 不需跑。

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）

1. 乱序/迟到到达：输入或事件乱序时，本设计的假设还成立吗？

   首推响应与重试响应是同一 await 链上的顺序调用，无并发响应交错面；`server_versions` 快照在首推响应中一次性携带，守卫转抛时复用该快照（与 c4ff833b0 重试传输失败路径同源），不存在读到更新版本集的乱序窗口。

2. 并发写：两个执行体同时操作同一数据/文件会发生什么？

   重算期间文件被并发改动（其他进程/杀软）正是本守卫的目标场景——原来会落 tar 全量覆盖（把并发改动连同冲突一起静默盖掉），现在转人工裁决；守卫不改变任何磁盘写入时序（`writeLocalManifest` 仍在成功路径唯一写入点，失败路径不落盘 re-base 的语义保持）。

3. 切换/生命周期：会话、请求或变更中途切换/中断时状态是否安全？

   `cached` 是调用局部对象，re-base 对它的 version 改写只在内存；转 `SpecPushConflict` 后不写本地清单缓存、不写 pending_push（与既有重试传输失败路径一致——人工拍板语义），下次推送以磁盘缓存原状重新 diff，状态安全。

4. 作用域：跨工作区/跨仓/多实例时数据会不会串台？

   守卫是单次推送调用内的控制流，作用域仅限当前 `wsId` 的 conflict 处理；`SpecPushConflict` 携带的 `server_versions` 来自本 wsId 的响应，无跨工作区数据面。

## 风险与死路

本方案最大的风险是什么？试过但放弃的方案及放弃理由？

- 最大风险：守卫扩大后，re-base 段内原本「tar 回退能自愈」的异常现在全部上抛人工裁决——但首推已 conflict 的前提下 tar 回退不是自愈而是静默覆盖（NFR-02 明文禁止），所谓自愈面本不存在，上抛是唯一正确语义；真实代价仅为冲突人工处理频次的口径更严。
- 放弃方案 A：仅给 `computeIncrementalOps` 单独套 try/catch（失败时跳过重试、维持首推 conflict 抛出）——粒度更细但留不住 onProgress 回调与未来新增语句的裸奔面，守卫区间再次漂移；整段包裹与「conflict 后不自动覆盖」不变量一一同构。
- 放弃方案 B：重算失败时降级为直接抛首推的 conflict（复用既有 `if (result.conflict) throw`）——与方案 A 同缺陷，且多一条隐式控制流路径；统一转 `SpecPushConflict` 单出口更可测。

## 文件变更清单

| 操作 | 路径 | 说明 |
| --- | --- | --- |
| 改 | sillyhub-daemon/src/spec-sync.ts | conflict 后 re-base 段整段守卫：非 SpecPushConflict 异常统一转抛 |
| 改 | sillyhub-daemon/tests/spec-sync-incremental.test.ts | 新增 node:fs/promises 部分替身 + 重算 IO 异常用例 |
