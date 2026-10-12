---
author: flow-machine-draft
created_at: 2026-10-12T23:37:51.941Z
---
# 设计记录（Design Record）— 2026-10-13-spawn-flush-e2e-test

## 做法概述

本变更怎么解决问题？改哪里、为什么选这个方案（一两段）。

答：2026-10-13-review-risk-fixes 独立评审 PASS 但留 P3：spawnAndStream 收尾冲刷（break 出 readline 后 flushAll → forwardSubmitMessages → await pendingForwards）只有组合件单测，收尾序列本身无执行级守护。本变更新增 `tests/task-runner/spawn-flush-e2e.test.ts` 直调 `spawnAndStream(runner, params)` 全函数——沿用 tests/task-runner.test.ts 先例 `vi.mock('node:child_process')` + `tests/helpers/fake-child.ts` 的 FakeChild 驱动真实 readline/decodeStream/收尾序列，fake runner 的 `_eventToMessages` 委托真实 `eventToSubmitMessages(ev, coalescer)`、`client.submitMessages` 捕获转发批次。纯测试新增，零 src 改动。

三条路径各一用例：取消（AbortSignal.abort → onAbort 置 cancelled + kill → FakeChild exit → exitCloser 关 readline → break）、超时（ctx.timeoutSeconds=0.05 武装毫秒级看门狗 → timedOut + kill → exit → break）、正常关闭（_endStdout push null + exit 0）。断言统一：abort/关闭前 delta 已缓冲零直发；收尾后残留冲刷为单行（拼接内容 + timestamp）恰经 client.submitMessages 转发一批；status 分别为 cancelled/timeout/completed。

## 接口契约

动了哪些函数/端点/命令/文件格式？对外可见的签名或行为变化是什么（含「无」的说明）？

答：无——纯测试新增（一个新测试文件），src / 对外 API / DB / 协议零变化。测试内部使用既有导出：`spawnAndStream`、`SpawnStreamParams`（spawn-stream.ts）、`eventToSubmitMessages`（event-wire.ts）、`createFakeChild`（tests/helpers/fake-child.ts）、`LeaseCtx`/`AgentEvent` 类型。

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）

1. 乱序/迟到到达：输入或事件乱序时，本设计的假设还成立吗？

   答：成立（测试视角）。用例按确定性时序驱动：推行后固定 tick 等待（25ms，微任务/pipe/readline 链足够消化）再触发 abort/exit；FakeChild 的 stdout 是真实 Readable，readline 消费顺序与推送顺序一致，无乱序面。看门狗用例的 0.05s 远小于等待窗（150ms+），触发时序确定。

2. 并发写：两个执行体同时操作同一数据/文件会发生什么？

   答：不涉及。每用例独立 FakeChild / AbortController / submits 捕获数组 / spawnAndStream 调用（coalescer 是函数内 attempt 级局部变量），用例间零共享状态；vitest 默认同文件串行。

3. 切换/生命周期：会话、请求或变更中途切换/中断时状态是否安全？

   答：安全。取消路径的 killTimer（2s SIGKILL 升级）与超时路径的同款定时器都在 spawnAndStream 收尾 cleanup 段 clearTimeout；用例断言完成后无悬挂定时器拖住进程（await p 即函数完全返回）。abort 在 delta 已缓冲后触发（tick 隔离），exitCloser 关闭 readline 让 for-await 必然跳出，无死等。

4. 作用域：跨工作区/跨仓/多实例时数据会不会串台？

   答：不涉及。测试无磁盘/网络共享面（fake client 全内存）；spawnAndStream 内 createTerminalObserver 的 fire-and-forget 日志目录副作用与既有 task-runner.test.ts spawn 用例先例一致（写 daemon 配置目录 runs/<leaseId>，leaseId 唯一化），不跨用例断言、不清理外部状态。

## 风险与死路

本方案最大的风险是什么？试过但放弃的方案及放弃理由？

答：最大风险：时序脆弱——若固定 tick 不足以让 readline 消费推送行（慢 CI），「零直发」断言可能偶发红。对冲：tick 取 25ms（既有测试同量级）且断言面宽松（只断言批次数与内容，不依赖帧级时序）；看门狗用例等待窗 3 倍于触发时间。次风险：`vi.mock('node:child_process')` 文件级替换影响同文件后续 import——同 tests/task-runner.test.ts 先例，本文件独立无其它 spawn 依赖。

试过但放弃的方案：① 经 `runner.runLease` 全链驱动（含 lease claim/心跳编排，时序面大、断言噪声多，且 runLease 已有专属测试，放弃）；② 给 spawnAndStream 加依赖注入 seam 以便绕过 spawn（为测改产线签名，违背「纯测试新增」边界，放弃）。

## 文件变更清单

| 操作 | 路径 | 说明 |
| 新增 | sillyhub-daemon/tests/task-runner/spawn-flush-e2e.test.ts | 取消/超时/正常收尾三路径执行级残留冲刷断言（FR-01~04） |
