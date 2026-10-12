---
author: flow-machine-draft
created_at: 2026-10-12T00:42:29.656Z
---
# 设计记录（Design Record）— 2026-10-12-pi-oldhost-fallback-pin

## 做法概述

本变更怎么解决问题？改哪里、为什么选这个方案（一两段）。

24h 审查 P2-2 原判「旧版 pi 宿主 mission_worker 产出无人上报」经复核**降级**：daemon.ts:4236 的 +90s 延迟兜底探测（ql-20260911-028）对一切 mission_worker 成功轮生效、`_fallbackWorkerDone` 无 provider 门——旧版 pi 宿主（pi-rpc-driver 运行时探测 major<1 跳过 MCP 注入、会话无 worker_done 工具）实际经该探测在 90s 后收敛，与「claude 分身未调工具」同一安全网形态，90s 延迟属设计内代价而非产出丢失。残余风险是覆盖面无测试钉住、注释未披露（未来重构若给延迟探测加 provider 门或改立即门语义，旧版 pi 收敛面会静默回归）。修法：测试面补 pi 载体钉子（对齐既有 claude 延迟兜底用例的 harness 与断言形态）+ daemon.ts 立即代报门注释与测试头注补披露；生产逻辑零改动。

## 接口契约

动了哪些函数/端点/命令/文件格式？对外可见的签名或行为变化是什么（含「无」的说明）？

- 无：生产代码仅注释行增改（daemon.ts 立即代报门三重门控注释补一句披露）；测试文件新增 1 用例 + 头注同步。无 schema/端点变化，`pnpm gen:types` 不需跑。

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）

1. 乱序/迟到到达：输入或事件乱序时，本设计的假设还成立吗？

   不受影响：钉子只覆盖既有 onTurnResult → setTimeout(90s) → 探测的既有时序（fake 计时器确定性推进）；pi 空白 result 因 override 晚到由既有会话级全文缓存兜住（注释已述），不在本变更面。

2. 并发写：两个执行体同时操作同一数据/文件会发生什么？

   不适用：测试单会话单轮，无并发写；生产路径的防双写（立即门 mcp=true 不放行 + 探测 artifacts 非空跳过）语义零改动且被既有用例钉住。

3. 切换/生命周期：会话、请求或变更中途切换/中断时状态是否安全？

   不适用：测试用 fake 计时器 + afterEach 恢复真实计时器与 mock，daemon 实例 afterEach stop，无跨用例状态泄漏。

4. 作用域：跨工作区/跨仓/多实例时数据会不会串台？

   不适用：workerDone/getMissionStatus 调用均携 sessionId（session-scoped），断言逐字核对载体 sessionId，无串台面。

## 风险与死路

本方案最大的风险是什么？试过但放弃的方案及放弃理由？

- 风险：披露注释与实现漂移（规则 18 万恶之源）——缓解：披露文本与钉子用例同变更落盘，用例红即披露失真，可被常规回归捕获。
- 放弃方案 A：立即代报门改为读运行时注入结果（driver 上报「MCP 未注入」信号）——可省旧版 pi 宿主 90s 延迟，但需 driver→daemon 新增状态通道，复杂度与收益不成比例（mission 本为长耗时流程），且延迟探测已是 claude 未自报形态的既定安全网，双通道徒增双写回归面。
- 放弃方案 B：caps 表按宿主版本参数化——静态表承载运行时事实会破坏「caps 描述机制支持」的既有语义（FR-06 两层门控分工），且 daemon 启动时无法预知所有会话宿主版本。

## 文件变更清单

| 操作 | 路径 | 说明 |
| --- | --- | --- |
| 改 | sillyhub-daemon/src/daemon.ts | 立即代报门注释补旧版 pi 宿主收敛披露（仅注释） |
| 改 | sillyhub-daemon/tests/daemon-mission-worker-artifact.test.ts | 新增 pi 旧版宿主延迟兜底钉子 + 头注同步 |
