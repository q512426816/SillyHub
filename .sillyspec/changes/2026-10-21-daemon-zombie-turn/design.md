---
author: flow-machine-draft
created_at: 2026-10-21T07:19:34.302Z
---
# 设计记录（Design Record）— 2026-10-21-daemon-zombie-turn

## 做法概述

本变更怎么解决问题？改哪里、为什么选这个方案（一两段）。

根因（生产会话 49d893ab 实证）：用户打断 → SDK 进入 abort 收尾窗口 → backend 在 0.6s 后自动注入（后台任务通知唤醒链）→ daemon `inject()` 正常 push 进 SDK 输入流、置 status='running' + currentRunId 并 ack 控制指令 → 但 SDK 在 abort 收尾中把该输入吞掉（无新轮、无事件、无 result）→ daemon 永停 running、backend run 永停 pending（无 started_at）。用户后续打断在 daemon 侧走 `q.interrupt()`（live query 无轮可断）返回 true 空转，10 次 acked 全部无效；最终靠 daemon 掉线被 offline sweep 收敛。四层修复各挡一段：

1. **FR-01 daemon 轮启动看门狗**（近端，90s 级收敛）：session-manager 在 inject 首轮启动路径（`!wasRunningBeforeInject`）布防 per-session 看门狗；任意轮事件（onMessage/onResult）撤防；到点仍零事件且 status=running & currentRunId 未变 → 重置会话态（active + 清 currentRunId）+ 经新增可选回调 `deps.onTurnStartTimeout` 由 daemon 桥接 `notifyRunResult(status='turn_start_timeout', is_error=true, result_summary=中文原因)` → backend `close_interactive_run` 既有路径收敛 run failed（`interactive_failed`）+ SSE 终态事件 → 前端显示失败与原因。选「拒绝+回报」而非自动重推：重推在「轮其实已启动但事件慢」的假阳性下会双执行同一条消息，失败重发由用户触发更安全。
2. **FR-02 interrupt no-op 回传**（秒级，打断即收敛）：backend `_send_interrupt_control` payload 补 run_id；daemon SESSION_INTERRUPT handler 消费 `interrupt()` 布尔结果，false 且会话在 store（能判定「无轮」而非「等会话」）且 payload 带 run_id → `notifyRunResult(status='error_during_execution')` → backend failed+`interactive_interrupted` → 前端按既有映射显示「已中止」。复用 `_reportInjectDropped` 同款 notifyRunResult 手法，零新端点。
3. **FR-03 backend pending run 启动超时清扫**（兜底，300s 级）：sweep.py 新增 `pending_run_start_sweep_once` 挂进既有 `session_reconnect_sweeper` 轮（60s 周期），收敛「pending + 无 started_at + 超龄 N（Settings `daemon_pending_run_start_timeout_sec`，默认 300）+ runtime 在线」的 run 为 failed+`interactive_turn_not_started`+可读原因，commit 后复刻 close_run_steps 终态 SSE 发布。runtime 离线的归既有 offline sweep，pending_approval（审批等待）不扫。
4. **FR-04 前端 15s 超时回退**（UX 兜底）：handleInterrupt 布防 15s 定时器（ref 管理），到点该轮仍 interrupting → 回退 running + 提示；终态到达/卸载清定时器。

## 接口契约

动了哪些函数/端点/命令/文件格式？对外可见的签名或行为变化是什么（含「无」的说明）？

- `SessionManagerDeps` 新增可选回调 `onTurnStartTimeout?(sessionId, runId)`（additive-optional，同 onTaskWakeupInject 先例；未注入时看门狗仍重置本地态、只不上报，测试 mock 零影响）。daemon.start 注入生产实现（桥 hubClient.notifyRunResult）。
- session-manager 新增内部 API：`_armTurnStartWatchdog(sessionId, runId)` / `_disarmTurnStartWatchdog(sessionId)`（模块函数挂 core，Map<sessionId, {timer, runId}> 常驻 session-manager.ts，`_turnStartWatchdogs`）。inject（turn-control.ts）arm；onMessage/onResult（events.ts）、terminateSession（lifecycle.ts）、stop 撤防。
- SESSION_INTERRUPT payload 新增可选字段 `run_id`（backend `_send_interrupt_control` 组装；daemon 侧 snake/camel 双读）。旧 daemon 忽略新字段零影响；旧 backend 不带 run_id 时 daemon 无法定位 run，维持现状（只 ack）。
- backend Settings 新增 `daemon_pending_run_start_timeout_sec: int = 300`；sweep.py 新增公开函数 `pending_run_start_sweep_once(session) -> int`。
- AgentRun.error_code 新值 `interactive_turn_not_started`（仅 FR-03 清扫路径落；前端按未知 failed 码走「失败」展示，output_redacted 原因透出）。
- 前端 session-panel-page.tsx handleInterrupt 内部行为增强（15s timer + 状态回退 + 提示），对外 API 无变化。
- 环境变量：daemon `SILLYHUB_TURN_START_WATCHDOG_MS`（默认 90000，≤0 视为默认值）。

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）

1. 乱序/迟到到达：输入或事件乱序时，本设计的假设还成立吗？

   成立，按子项拆解：① 看门狗到点后 SDK 事件迟到（假阳性：轮其实启动了只是慢）→ 会话态已重置 active、currentRunId 已清：迟到事件被 onMessage 的 currentRunId 守卫丢弃、迟到 result 走 onResult 的 runId=undefined 分支不上报——状态一致，代价是该轮 token 白烧（90s 零事件窗口 + 默认值可调，风险接受，见风险节）。② interrupt no-op 回报与真实 result 竞态（用户打断恰逢轮自然结束、result 在飞）→ close_interactive_run 对已终态 run 幂等 no-op（close_run_steps.py:99 既有守卫），后到者被忽略，最坏表现是终态被记为 interrupted 而非 completed（用户刚点了打断，语义可接受）。③ 清扫与 daemon 迟到启动竞态：run 被扫收敛后 daemon 才启动该轮 → 事件走 submitMessages 对 failed run 的既有容错（backend 幂等守卫），轮在 daemon 侧跑完但结果上报被终态守卫忽略——300s 窗口 + runtime 在线 + inject 必经 daemon ack 才算送达，正常链路 created→started ~2s，误扫需同时满足「ack 送达 + 300s 零事件」，概率极低。

2. 并发写：两个执行体同时操作同一数据/文件会发生什么？

   看门狗 Map/timer 全在 daemon 单线程事件循环内，无锁需求；backend 清扫 UPDATE 带全条件重挂（status='pending' AND started_at IS NULL AND created_at < 阈值），与 run_sync 的 FOR UPDATE 终态写入天然幂等（被并发改态的行条件不命中跳过）；interrupt no-op 回报走既有 notifyRunResult HTTP（claim_token 校验 + 幂等）。

3. 切换/生命周期：会话、请求或变更中途切换/中断时状态是否安全？

   安全：会话 end/fail（terminateSession）撤防看门狗；daemon stop() 清全部看门狗 timer（unref 不阻塞退出）；reload（provider/config 切换）由 onResult 边界触发，届时看门狗已撤防或由新轮事件撤防；前端 15s timer 在组件卸载与轮终态时清除，无泄漏。

4. 作用域：跨工作区/跨仓/多实例时数据会不会串台？

   不会：看门狗 per-session（Map 键 sessionId），多会话互不串台；清扫按 run 所属会话的 runtime 在线判定，多 daemon 实例各自心跳独立判定；跨仓（backend/daemon/frontend 三端）契约仅为「payload 可选字段 + 可选回调 + 新 error_code 字符串」，旧版混布时各自降级（旧 daemon 忽略 run_id、旧 backend 不发 run_id → FR-02 静默退化为现状；新 error_code 对旧前端显示为普通失败）。

## 风险与死路

本方案最大的风险是什么？试过但放弃的方案及放弃理由？

最大风险：FR-01 看门狗假阳性（引擎慢启动 90s 零事件被误判吞没）导致该轮被误收敛 + token 白烧。缓解：90s 默认值远大于正常首事件延迟（1~2s）、env 可调、只影响单轮（会话态重置后用户重发即恢复）。已放弃方案：**自动重推被吞消息**（重推在假阳性下双执行同一条消息，且无法区分「被吞」与「慢启动」，双执行的破坏大于失败重发）；**interrupt 时同步杀 query 硬停**（terminateSession 注释明示 D-001@v2 语义：打断保持软信号、会话可续轮，硬杀会改变「打断本轮」的产品语义并误伤排队消息）。FR-03 清扫误伤面：仅 pending+无 started_at+runtime 在线+300s 四条件叠加，正常链路不可达（正常 created→started ~2s）；inject 停等窗 `_awaitSessionThenRoute` 硬顶 5min，300s 默认值若在现场出现慢启动误扫，调大 Settings 即可，无需发版。遗留已知缺口（不在本变更范围）：忙轮 steering 注入（同 run_id 复用）被 abort 窗口吞没时无 pending run 可扫、看门狗也不 arm（wasRunningBeforeInject=true 路径），表现为「轮已结束、消息无回音」，需后续单独治理。

## 文件变更清单

| 操作 | 路径 | 说明 |
|---|---|---|
| 改 | sillyhub-daemon/src/interactive/types.ts | SessionManagerDeps 增可选 onTurnStartTimeout 回调 |
| 改 | sillyhub-daemon/src/interactive/session-manager.ts | `_turnStartWatchdogs` Map + arm/disarm API + stop 清理 |
| 改 | sillyhub-daemon/src/interactive/session-manager/types.ts | SessionManagerCore 增看门狗 Map 字段与 arm/disarm 方法声明 |
| 改 | sillyhub-daemon/src/cli.ts | deps 注入 onTurnStartTimeout → daemon.onTurnStartTimeout 桥接 |
| 改 | sillyhub-daemon/tests/interactive/session-manager-lifecycle-turn-anchor-eviction.test.ts | 测试桩补 `_disarmTurnStartWatchdog` 成员（core 契约跟进） |
| 改 | sillyhub-daemon/src/interactive/session-manager/turn-control.ts | inject 首轮路径布防看门狗 |
| 改 | sillyhub-daemon/src/interactive/session-manager/events.ts | onMessage/onResult 撤防 |
| 改 | sillyhub-daemon/src/interactive/session-manager/lifecycle.ts | terminateSession 撤防 |
| 改 | sillyhub-daemon/src/daemon.ts | SESSION_INTERRUPT 消费 interrupt() 结果 + noop 回报 + onTurnStartTimeout 桥接 |
| 增 | sillyhub-daemon/tests/interactive/turn-start-watchdog.test.ts | FR-01 测试 |
| 增 | sillyhub-daemon/tests/daemon-interrupt-noop-report.test.ts | FR-02 daemon 侧测试 |
| 改 | backend/app/core/config.py | Settings 增 daemon_pending_run_start_timeout_sec |
| 改 | backend/app/modules/daemon/session/service/control.py | _send_interrupt_control payload 增 run_id |
| 改 | backend/app/modules/daemon/sweep.py | pending_run_start_sweep_once + 挂 sweeper 轮 + SSE 发布 |
| 增 | backend/app/modules/daemon/tests/test_interrupt_payload_run_id.py | FR-02 后端测试 |
| 增 | backend/app/modules/daemon/tests/test_pending_run_start_sweep.py | FR-03 测试 |
| 改 | frontend/src/components/daemon/session-panel/session-panel-page.tsx | handleInterrupt 15s 超时回退 + 提示（hook 接线） |
| 增 | frontend/src/components/daemon/session-panel/interrupt-timeout.ts | useInterruptFeedbackTimeout 定时器簿记 hook |
| 增 | frontend/src/components/daemon/session-panel/__tests__/interrupt-timeout.test.ts | FR-04 测试 |
