---
author: flow-machine-draft
created_at: 2026-10-12T23:08:59.047Z
---
# 设计记录（Design Record）— 2026-10-13-review-risk-fixes

## 做法概述

本变更怎么解决问题？改哪里、为什么选这个方案（一两段）。

答：2026-10-13 风险审查（最近 24h 两提交只读分析）实证两处缺陷：① bf4c47c07 的 F2b 合并缓冲器只落了 `eventToSubmitMessages(ev, coalescer?)` 可选参，唯一生产调用点 `spawn-stream.ts handleLine`（经 `runner._eventToMessages`）未传实例——功能是死代码，提交宣称的碎片行修复未生效；② c782a9249 的 askwait 豁免无时间上限，且注释声称的「daemon 真死由离线清扫兜底」经查只存在于任务表清扫（`sweep_confirmed_dead_tasks` 不碰 AgentRun 且 daemon 离线时 fail-open），daemon 真死场景 run 永远 running、会话楔死。另有 path-utils 注释与实现不一致（anchor 声称双透传实为仅 target）与 isFlagToken 残留放行面未记档两处小项。

方案：① spawn-stream 按 attempt（spawnAndStream 单次调用）创建 `MessageCoalescer`，经 HandleLineEnv 透传给 `_eventToMessages`；attempt 收尾（含取消/超时 break 出循环后）flushAll 残留缓冲并经既有转发通道提交——转发逻辑从 handleLine 内联体提取为模块级 `forwardSubmitMessages` 单源复用，行为逐字节等价；`event-wire.ts` 新增 `coalescerFlushAllMessages`（flushAll 输出附消息级 timestamp，F2a 同口径）。② `_run_awaiting_user_input` 增加 `now` 参数与 24h 上限常量：最后 ask 信号超龄 → 返回 False 走既有判死路径；时限内行为零回归。③④ 两处纯注释对齐/记档，无行为变化。

## 接口契约

动了哪些函数/端点/命令/文件格式？对外可见的签名或行为变化是什么（含「无」的说明）？

答：
- `TaskRunnerCore._eventToMessages(ev, coalescer?)`（runner-types.ts 接口 + task-runner.ts facade 透传）：新增可选第二参；TS 结构类型下既有少参实现/测试 fake 兼容，零破坏。
- `spawn-stream.ts` 新增导出 `forwardSubmitMessages(runner, env 子集, messages)`（从 handleLine 内联转发提取，resilience envelopes/dedup_key、fire-and-forget catch、claimToken/agentRunId 守卫逻辑逐条保留）；`HandleLineEnv` 新增必填 `coalescer` 字段（仅 spawn-stream 内部构造，外部无新增实现方）。
- `event-wire.ts` 新增导出 `coalescerFlushAllMessages(coalescer)`：flushAll 输出映射为带消息级 timestamp 的 message dict。
- backend `service.py _run_awaiting_user_input(session, run_id, now)`：新增 `now` 参数（调用点传清理循环同一 now）；新增模块常量 `_ASKWAIT_EXEMPT_MAX_AGE = timedelta(hours=24)`。
- 对外 API / DB schema / 前端类型 / wire 协议：无变化。

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）

1. 乱序/迟到到达：输入或事件乱序时，本设计的假设还成立吗？

   答：成立。coalescer 按 message id 缓冲，非流式完整行到达即冲刷同 id 残留（feed 既有保底语义，冲刷行先于完整行输出）；attempt 边界 flushAll 兜底一切乱序/缺完结序列（宁碎片不丢内容）。delta 不跨 attempt——每次 spawn 新进程、SDK 消息 id 不延续，attempt 级实例生命周期与之对齐。

2. 并发写：两个执行体同时操作同一数据/文件会发生什么？

   答：coalescer 是 spawnAndStream 局部变量，单 readline 协程串行 feed，无跨执行体共享，无并发写面。backend 侧 24h 上限判定只读日志列（MAX 聚合），写路径仍是既有 `_mark_stale_run_failed` + 写前 FOR UPDATE 重读防护，不新增写面、不改变并发语义。

3. 切换/生命周期：会话、请求或变更中途切换/中断时状态是否安全？

   答：安全。取消/超时 break 出 readline 循环后仍无条件执行 flushAll——残留缓冲内容保底提交（内容不丢，至多退化为碎片行）；冲刷转发 push 进 pendingForwards，由既有 `await Promise.allSettled(pendingForwards)` 兜住，daemon 收尾不丢尾部消息（ql-20260706-010 口径）。backend 侧上限用清理循环传入的同一 now（启动时刻），不读墙钟二次取值，复扫/重启判定稳定。

4. 作用域：跨工作区/跨仓/多实例时数据会不会串台？

   答：不会。coalescer 不落盘、不跨进程、不进任何全局状态；多 attempt/多 lease 各自实例互不可见。24h 上限是后端模块级常量，对所有会话统一阈值（不按工作区分化，记档于常量注释）。

## 风险与死路

本方案最大的风险是什么？试过但放弃的方案及放弃理由？

答：最大风险：tail 冲刷行不带 session 三列（`appendSessionWireColumns` 以事件为单位注入，冲刷时刻无源事件可取）——冲刷行仍按 run_id 归属（submit 调用自带 run 维度），session 级 metadata 索引缺列的影响限于一条消息的尾部残片，接受并在 `coalescerFlushAllMessages` 注释记档。次风险：`forwardSubmitMessages` 提取若漏抄任一守卫会改变 handleLine 既有转发行为——以「逐条保留 + 定向测试回归」对冲。

试过但放弃的方案：① coalescer 挂全局单例（跨 attempt 状态泄漏、消息 id 空间不隔离，放弃）；② flushAll 输出复刻 session 三列注入（冲刷时刻无源事件，伪造成分大于收益，放弃）；③ askwait 上限改读 lease 心跳判 daemon 死活（重启瞬间心跳必陈旧，生产实证已否定该判据，维持日志列信号 + 时间上限方案）。

## 文件变更清单

| 操作 | 路径 | 说明 |
| 修改 | sillyhub-daemon/src/task-runner/spawn-stream.ts | attempt 级 coalescer 创建/透传/收尾冲刷 + forwardSubmitMessages 提取单源 |
| 修改 | sillyhub-daemon/src/task-runner/runner-types.ts | `_eventToMessages` 接口加可选 coalescer 参 |
| 修改 | sillyhub-daemon/src/task-runner.ts | facade 透传 coalescer |
| 修改 | sillyhub-daemon/src/event-wire.ts | 新增导出 `coalescerFlushAllMessages` |
| 新增 | sillyhub-daemon/tests/task-runner/spawn-stream-coalescer.test.ts | 透传/合并/收尾冲刷三组测试 |
| 修改 | backend/app/modules/agent/service.py | `_run_awaiting_user_input` 加 now 参 + `_ASKWAIT_EXEMPT_MAX_AGE` 24h 上限 |
| 修改 | backend/app/modules/agent/tests/test_cleanup_stale_runs_error_code.py | 超 24h 判死新用例 + 时限内豁免零回归断言 |
| 修改 | sillyhub-daemon/src/policy/path-utils.ts | FR-03 注释对齐（无行为变化） |
| 修改 | sillyhub-daemon/src/policy/shell-paths.ts | FR-04 残留风险记档（无行为变化） |
