---
author: flow-machine-draft
created_at: 2026-10-13T04:04:16.999Z
---
# 设计记录（Design Record）— 2026-10-13-task-wakeup-remove

## 做法概述

本变更怎么解决问题？改哪里、为什么选这个方案（一两段）。

在生产者源头（sillyhub-daemon）整体移除唤醒链：`handleTaskNotificationEvent` 里的 completed/failed 唤醒分支（含 60s 安静阈值判定）删除，`scheduleTaskWakeup`（2s debounce 合并注入）、`onTaskWakeupInject` dep 及 cli.ts 接线（hubClient.injectSessionPrompt origin='task_wakeup'）、`_taskWakeupPending` 状态与 lifecycle 终态清理一并清零。选生产者侧而非 backend inject 端点侧：inject 端点是通用能力（服务凭证 + origin 门控），排队合并/豁免是消费端防御——留着零风险且可支持未来重启用；只删唯一生产者即可让「[后台任务通知]」从此不再产生。终态侧信道（emit/[TASK_NOTIFICATION] 落行/注销/别名收口/清锚点）全部不动，任务完成信息在时间线与任务面板仍可见；主代理在用户下一条消息到达后可用 TaskOutput 自取结果（prompt 文案既有指引，2026-10-10 安静阈值已生产验证该口径）。

## 接口契约

动了哪些函数/端点/命令/文件格式？对外可见的签名或行为变化是什么（含「无」的说明）？

- 删除：`scheduleTaskWakeup`（background-tasks.ts 导出）、`TASK_WAKEUP_MIN_DURATION_MS` 常量、SessionManager 私有方法 `_scheduleTaskWakeup`、SessionManagerCore 接口的 `_taskWakeupPending` 字段与 `_scheduleTaskWakeup` 声明、SessionManagerDeps 的 `onTaskWakeupInject` 可选回调、cli.ts 构造点接线。
- 不变：backend `/sessions/{id}/inject`（origin='task_wakeup' 门控）与排队合并/豁免机制；hubClient.injectSessionPrompt 方法本体；前端全部行为（含 2026-10-13-session-taskwakeup-hide 的历史回放隐藏）。无对外 API/协议/文件格式变化——仅 daemon 内部行为「终态自动唤醒」消失。

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）

4. 作用域：跨工作区/跨仓/多实例时数据会不会串台？

3. 切换/生命周期：会话、请求或变更中途切换/中断时状态是否安全？

2. 并发写：两个执行体同时操作同一数据/文件会发生什么？

1. 乱序/迟到到达：输入或事件乱序时，本设计的假设还成立吗？

1. 乱序/迟到到达：唤醒是终态消费尾部的独立分支，删除后终态处理的 emit/落行/注销/别名收口顺序不变；迟到终态、孤儿终态原经 fail-open 唤醒的路径现统一为不唤醒，无状态残留（_taskWakeupPending 连同 lifecycle 清理一并删除，不存在悬挂 timer 面）。
2. 并发写：被删的 _taskWakeupPending 是会话级 Map + setTimeout，唯一写者是 scheduleTaskWakeup；删除后无共享写面新增或变化，任务表/锚点清理逻辑不动。
3. 切换/生命周期：会话终态（end/fail）时原取消 pending wakeup timer 的清理块随机制删除——timer 已不存在，无泄漏面；daemon 重启窗口的孤儿终态不再有 fail-open 注入，行为收敛为静默（WARN 日志兜底已在既有代码）。
4. 作用域：改动仅 sillyhub-daemon 子项目（同一 git 仓内目录），无跨仓交付；backend/frontend 零文件改动；历史会话日志中的旧「[后台任务通知]」回放显示由前端既有隐藏逻辑覆盖，不因本变更变化。

## 风险与死路

本方案最大的风险是什么？试过但放弃的方案及放弃理由？

最大风险是产品语义回退：依赖自动唤醒续跑的多步后台工作流（主代理派发后台任务后结束本轮、等唤醒汇报）将停在空闲态，直到用户发下一条消息才继续——这是用户明确裁定的取舍（「没必要」，终态汇报轮的 token/轮次噪音 > 自动续跑便利），且与 2026-10-10 安静阈值（短任务不唤醒）同构，非全新形态。次要风险：若未来要恢复唤醒，需从 git 历史找回整链（机制代码彻底删除而非开关停用）——用户裁定没必要时彻底删优于留死开关（规则 18：注释与实现不一致是万恶之源）。

试过但放弃的方案：①backend inject 端点拒收 origin='task_wakeup'——动消费端防御面，backend 测试面大改且端点是通用能力；②加环境开关停用注入——留休眠代码与配置面，违反「彻底去掉」的用户意图；③仅前端隐藏（已完成于 2026-10-13-session-taskwakeup-hide）——汇报轮照跑照烧 token，治标不治本。

## 文件变更清单

| 操作 | 路径 | 说明 |
| --- | --- | --- |
| M | sillyhub-daemon/src/interactive/session-manager/background-tasks.ts | 删唤醒触发分支、scheduleTaskWakeup、TASK_WAKEUP_MIN_DURATION_MS；修模块头/函数头注释 |
| M | sillyhub-daemon/src/interactive/session-manager.ts | 删 scheduleTaskWakeup import、_taskWakeupPending 字段、_scheduleTaskWakeup 私有方法 |
| M | sillyhub-daemon/src/interactive/session-manager/types.ts | 删 SessionManagerCore 的 _taskWakeupPending 字段与 _scheduleTaskWakeup 声明 |
| M | sillyhub-daemon/src/interactive/session-manager/lifecycle.ts | 删会话终态 pending wakeup timer 清理块 |
| M | sillyhub-daemon/src/interactive/types.ts | 删 onTaskWakeupInject 可选 dep |
| M | sillyhub-daemon/src/cli.ts | 删 onTaskWakeupInject 接线（hubClient.injectSessionPrompt origin='task_wakeup' 调用） |
| M | sillyhub-daemon/tests/interactive/task-lifecycle.test.ts | 「task wakeup inject」describe 改写为新口径（终态一律不注入；侧信道断言保留） |
