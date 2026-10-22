---
author: flow-machine-draft
created_at: 2026-10-21T02:49:06.356Z
---
# 设计记录（Design Record）— 2026-10-21-task-wakeup-restore

## 做法概述

本变更怎么解决问题？改哪里、为什么选这个方案（一两段）。

答：从 f889832d1^ 原样恢复 2026-10-13-task-wakeup-remove 删除的 daemon 侧唤醒链（scheduleTaskWakeup 2s debounce 合并 + handleTaskNotificationEvent 尾部触发块 + onTaskWakeupInject dep + cli.ts 接线 + lifecycle.ts 终态清理 + _taskWakeupPending 状态面），backend 侧零改动（inject 端点/task_wakeup 门控/queue_when_busy 排队/hubClient.injectSessionPrompt 四件均已核实存活）。唯一新造点：60s 静默阈值从硬编码常量改为 env getter `taskWakeupQuietThresholdMs()`（SILLYHUB_TASK_WAKEUP_QUIET_MS，缺省 60000，0=关闭阀，负数/非法回落缺省，逐次读取便于测试覆写）——沿 daemon 既有 SILLYHUB_INJECT_WAIT_SESSION_MS 同款模式（daemon.ts:1386 先例），替代原案中的 local.yaml 载体：阈值守卫的是 daemon 进程行为噪音，属部署级而非工作区级偏好，env 载体与本仓既有 feature-flag 面一致且零文件格式决策。

选生产者侧恢复而非让引擎自续跑：claude SDK 流式驱动下轮只能由 daemon 推消息开轮（sdk.d.ts streamInput 契约），引擎无头模式不自带唤醒（49d893ab 导出实证通知到达后引擎零动作）；平台侧唤醒必须过 backend inject 建正式 run（2026-09-15 权限锁死事故实证跨轮后台工作越过治理面的代价）。pi 影子任务走 kind=agent_task_status 另一条分发（events.ts:408→handleAgentTaskStatusEvent），唤醒仅在 task_notification 处理器（events.ts:426→handleTaskNotificationEvent），路由结构上排除「pi 轮结束→注入」反馈环。

## 接口契约

动了哪些函数/端点/命令/文件格式？对外可见的签名或行为变化是什么（含「无」的说明）？

答：
- `SessionManagerDeps`（src/interactive/types.ts）：新增可选 `onTaskWakeupInject?: (sessionId: string, prompt: string) => void | Promise<void>`——未注入时唤醒静默跳过，既有测试 mock 零影响（additive-optional，沿 onSessionEvent 先例）。
- `SessionManagerCore`（src/interactive/session-manager/types.ts）：新增 `_taskWakeupPending: Map<string, { timer: NodeJS.Timeout; lines: string[] }>` 只读字段 + `_scheduleTaskWakeup(sessionId, info)` 方法声明；`SessionManager`（session-manager.ts）补同名字段实现。
- `handleTaskNotificationEvent`（session-manager/background-tasks.ts）：completed/failed 终态在别名补发之后追加唤醒判定（时长阈值门槛 + scheduleTaskWakeup）；stopped/非法终态路径不变。
- 新增导出 `taskWakeupQuietThresholdMs(): number`（src/daemon.ts，SILLYHUB_TASK_WAKEUP_QUIET_MS getter）；background-tasks.ts import 该 getter（若与 daemon.ts 成环则 getter 落 config.ts，import 方向以 tsc 为准）。
- cli.ts：deps 接线 `onTaskWakeupInject: (sessionId, prompt) => client.injectSessionPrompt(sessionId, prompt, 'task_wakeup')`（f889832d1^ 原样）。
- backend / hub-client：零改动（消费端存活复用）。
- 前端（FR-06，执行期用户追加——dsh「收到任务消息」同款形态，废止 2026-10-13-session-taskwakeup-hide 的整体隐藏口径）：session-log-assembler.ts TurnSegment 新增 kind:"task_wakeup"（{id,text,ts}，装配器不主动构造）；turn-segment-views.tsx 新增 TaskWakeupNoticeView（折叠行：✈ +「收到任务消息」+ 任务数 + ▶，展开显全文）并接 SegmentView 分发 case；runtime-session-helpers.tsx 回放开轮槽分支收集 task_wakeup 段置于段序列首部；session-panel-page.tsx live upsert 回调同口径插段（幂等守卫 segments 无 task_wakeup）；turn-timeline.tsx isConversationSegment 放行 + 对话分支特判渲染；turn-status-bar.tsx / turn-timeline.tsx 两个 segmentTs 穷尽 switch 编译补点（task_wakeup 取捕获 ts，无行为变化）；segmentsToLegacy 无 case 自动跳过（兼容投影不进 output/processItems）。

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）

1. 乱序/迟到到达：输入或事件乱序时，本设计的假设还成立吗？

答：成立。唤醒是终态消费尾部的独立分支，恢复后 emit/落行/注销/别名补发顺序与现行完全一致；迟到终态（注册表已无条目）沿现行三无 WARN 路径，仅在其后进入 fail-open 唤醒判定（durationMs=undefined 放行）——孤儿终态唤醒由 backend inject 侧兜底（会话不存在时注入失败仅日志），无状态残留；_taskWakeupPending 随 lifecycle 终态清理，无悬挂 timer。

2. 并发写：两个执行体同时操作同一数据/文件会发生什么？

答：_taskWakeupPending 为同会话键控的单 timer debounce（Node 单线程事件循环内串行消费 handleTaskNotificationEvent，无跨执行体并发写）；同一会话多任务终态并发到达时按到达序 push 进同一 lines 数组，2s 后一次性合并注入——与旧链六周生产行为一致。

3. 切换/生命周期：会话、请求或变更中途切换/中断时状态是否安全？

答：安全。会话 terminate 时 lifecycle 先清 _clearBackgroundTasks 再清 pending wakeup（恢复原顺序），注入回调异步失败仅 console.error 不复排队；daemon 关闭路径沿 stop() → terminateSession 已覆盖；interrupt 不清注册表（现行口径），其终态照常可触发唤醒——后台任务与当轮 turn 解耦是既有设计，不在本变更收窄。

4. 作用域：跨工作区/跨仓/多实例时数据会不会串台？

答：不会。_taskWakeupPending 以 sessionId 键控于 SessionManager 实例内，daemon 进程单实例，无跨工作区串台面；注入经 backend inject（服务凭证 + origin='task_wakeup' 门控）落正确会话，归属由 backend 校验。

## 风险与死路

本方案最大的风险是什么？试过但放弃的方案及放弃理由？

答：最大风险是产品语义回退复发——本次恢复与 10-13 删除是同一取舍的正反对翻，为防「短任务噪音」复发，阈值门槛 + 0 关闭阀 + stopped 不唤醒三重降噪全部保留；若未来 claude 引擎在流式模式原生自续跑，会出现双轮，届时设 SILLYHUB_TASK_WAKEUP_QUIET_MS=0 一键关闭（[TASK_NOTIFICATION]/注入行可观测，当天可发现）。次要风险：未知帧降级桶（codex/cursor 未知事件映射 subtype='task_notification'）理论上可携带 task_id 进入唤醒判定——旧链六周共存无误触发记录（降级桶帧通常无 task_id，strOf 早退），恢复时保持原样不加新防线，避免为理论面扩表。死路：①「daemon 私推引擎流绕过 backend」——已否决，幽灵轮无审计无权限路由（$46 事故先例）；②「前端折叠系统行升级」——原裁定本变更不做，执行期用户改判（dsh「收到任务消息」形态实证后明确要求可见留痕），已并入 FR-06；③「local.yaml 阈值载体」——放弃改 env，理由见做法概述。

## 文件变更清单

| 操作 | 路径 | 说明 |
|---|---|---|
| 改 | sillyhub-daemon/src/interactive/session-manager/background-tasks.ts | 恢复触发块 + scheduleTaskWakeup；阈值改 getter 读取 |
| 改 | sillyhub-daemon/src/interactive/session-manager/types.ts | 恢复 _taskWakeupPending 字段与 _scheduleTaskWakeup 接口声明 |
| 改 | sillyhub-daemon/src/interactive/session-manager.ts | 实现 _taskWakeupPending map 字段 |
| 改 | sillyhub-daemon/src/interactive/session-manager/lifecycle.ts | 恢复终态取消 pending wakeup debounce |
| 改 | sillyhub-daemon/src/interactive/types.ts | 恢复 onTaskWakeupInject 可选 dep |
| 改 | sillyhub-daemon/src/cli.ts | 恢复 onTaskWakeupInject → injectSessionPrompt('task_wakeup') 接线 |
| 改 | sillyhub-daemon/src/daemon.ts | 新增 taskWakeupQuietThresholdMs() env getter |
| 改 | sillyhub-daemon/tests/interactive/task-lifecycle.test.ts | 翻回唤醒断言 + 新增阈值 0 关闭/fail-open/影子任务零注入用例 |
| 改 | sillyhub-daemon/tests/interactive/session-manager-lifecycle-turn-anchor-eviction.test.ts | 伪造 mgr 补 _taskWakeupPending 字段（接口新增后 fixture 跟进） |
| 改 | frontend/src/components/daemon/session-log-assembler.ts | TurnSegment 新增 kind:"task_wakeup" |
| 改 | frontend/src/components/daemon/turn-segment-views.tsx | TaskWakeupNoticeView 组件 + SegmentView 分发 case |
| 改 | frontend/src/components/daemon/runtime-session-helpers.tsx | 回放开轮槽收集 task_wakeup 段置段序列首部 |
| 改 | frontend/src/components/daemon/session-panel/session-panel-page.tsx | live upsert 同口径插 task_wakeup 段（幂等） |
| 改 | frontend/src/components/daemon/turn-timeline.tsx | isConversationSegment 放行 + 对话特判 + segmentTsOf 补点 |
| 改 | frontend/src/components/daemon/turn-status-bar.tsx | segmentTs 穷尽 switch 补点 |
| 改 | frontend/src/components/daemon/__tests__/runtime-session-helpers.test.tsx | 唤醒段回放装配用例 |
| 改 | frontend/src/components/daemon/__tests__/turn-segment-views.test.tsx | TaskWakeupNoticeView 渲染用例 |
| 改 | sillyspec/docs/multi-agent-platform/modules/sillyhub-daemon.md | 模块文档 wakeup 条目同步 |
