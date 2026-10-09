---
author: flow-machine-draft
created_at: 2026-10-09T20:40:00.000Z
---
# 设计记录（Design Record）— 2026-10-09-status-root-write-race

## 做法概述

本变更怎么解决问题？改哪里、为什么选这个方案（一两段）。

`sillyhub-daemon/src/daemon.ts` 的 `_noteSillySpecStatusRoot` 两处落盘调用（单槽位 `_persistSillySpecStatusRoot` + 映射槽位 `_persistSillySpecStatusRoots`）从 `void`（fire-and-forget）改为共享 `_statusRootPersistChain` 串行链（`.then(() => 写入).catch(() => {})`）——两次快速 note 的写请求按发起序排队，最后一次值必然最后落盘，消除同文件 writeFile 竞态。写方法本身零改动（best-effort try/catch 语义保留）。测试补 ×20 快速交替回归用例放大窗口。背景：daemon-ci 在 ae49ccee 实跑红（1/4530），机理为 9 月既有代码缺陷（ef5b3c76a/f9bb4eeac），此前 CI 绿属运气；非任何在途变更引入。选串行链而非写前去重/防抖：链式保序语义最小且同时治两个文件面；防抖会改观察语义（落盘延迟）。

## 接口契约

动了哪些函数/端点/命令/文件格式？对外可见的签名或行为变化是什么（含「无」的说明）？

- `daemon.ts`：新增私有字段 `_statusRootPersistChain: Promise<void>`；`_noteSillySpecStatusRoot` 内两处落盘触发方式变为链式。类外可见行为零变化（私有方法/字段）；落盘文件格式零变化。
- 测试文件 +1 用例（共 10）。
- RPC / backend / 前端：零变化。

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）

1. 乱序/迟到到达：输入或事件乱序时，本设计的假设还成立吗？

成立：note 调用本身在单线程事件循环上按到达序同步入链，链保证落盘序=入链序；迟到的 note 追加链尾仍是最后落盘者。

2. 并发写：两个执行体同时操作同一数据/文件会发生什么？

正是本变更所治：同一 daemon 进程内两次快速 note 的写被串行化；不同 daemon 进程（多实例同 stateDir）不在本面（既有形态单机单 daemon，多实例共享 stateDir 本就无文件锁，超范围）。

3. 切换/生命周期：会话、请求或变更中途切换/中断时状态是否安全？

安全：链上每个写自带 try/catch（失败仅 warn），`.catch(() => {})` 防单次失败毒化整链；进程退出时在途写丢失与原 fire-and-forget 语义一致（best-effort，恢复路径有「文件缺失/损坏静默跳过」兜底，既有用例钉住）。

4. 作用域：跨工作区/跨仓/多实例时数据会不会串台？

不会：串行链是实例内私有字段；两文件内容仍按 workspaceId 隔离（映射槽位）/单槽位语义不变。

## 风险与死路

本方案最大的风险是什么？试过但放弃的方案及放弃理由？

最大风险：回归用例对竞态的检出是概率性的（旧码本地 ×20 用例 3 跑未触发、原用例 1/3 触发、CI 触发）——窗口取决于 fs 调度；以机理代码读证 + CI 实跑红作红证，用例作放大器非唯一防线。次风险：链上积压（极端高频 claim）延迟落盘——量级为毫秒级写排队，claim 频率远达不到。试过放弃：(a) 只修测试轮询窗口——放弃，生产同款竞态（两次快速 claim 持久化旧根）仍在；(b) 写前 coalesce（同值跳过）——`_sillyspecStatusRoot === rootPath` 早退已有同值短路，跨值仍需保序，链式是完备解；(c) 防抖 500ms——放弃，改落盘时效语义且测试需假时钟。

## 文件变更清单

| 操作 | 路径 | 说明 |
| --- | --- | --- |
| 修改 | sillyhub-daemon/src/daemon.ts | _statusRootPersistChain 串行链 + 两处触发改链式 |
| 修改 | sillyhub-daemon/tests/daemon-status-root-persistence.test.ts | ×20 快速交替回归用例 |
