---
author: flow-machine-draft
created_at: 2026-10-13T04:04:16.998Z
---
# 提案书（Proposal）— 2026-10-13-task-wakeup-remove

## 动机

任务原话转写：后台子代理任务终态后 daemon 自动注入「[后台任务通知]」开新轮让主代理汇报——用户裁定该自动汇报轮没必要（token 与轮次噪音），要求彻底去掉通知注入：任务终态只留 emit/[TASK_NOTIFICATION] 落行/注销等侧信道，主代理靠用户下一条消息继续（可用 TaskOutput 自取结果，2026-10-10 安静阈值已验证该口径安全）。
成功标准：
- daemon（sillyhub-daemon）任务终态 completed/failed/stopped 一律不再注入唤醒——onTaskWakeupInject 永不被调用，不再产生任何「[后台任务通知]」user_input
- 终态侧信道不受影响：agent_task_status 终态 emit、[TASK_NOTIFICATION] 落行、任务表注销（含 tool_use 别名收口）、注册表清空清后台锚点均照常
- 唤醒机制代码彻底移除：scheduleTaskWakeup/_taskWakeupPending/TASK_WAKEUP_MIN_DURATION_MS/onTaskWakeupInject dep 及 cli.ts wiring、lifecycle.ts 清理、SessionManagerCore 接口面
- backend inject 端点与排队合并/豁免机制保留不动（无生产者后为休眠代码）；前端历史会话回放的隐藏逻辑（2026-10-13-session-taskwakeup-hide）保留
- sillyhub-daemon 相关单测改写为新口径并通过 + pnpm typecheck 绿

## 变更范围

按成功标准机械推导，共 5 条验收面：
1. daemon（sillyhub-daemon）任务终态 completed/failed/stopped 一律不再注入唤醒——onTaskWakeupInject 永不被调用，不再产生任何「[后台任务通知]」user_input
2. 终态侧信道不受影响：agent_task_status 终态 emit、[TASK_NOTIFICATION] 落行、任务表注销（含 tool_use 别名收口）、注册表清空清后台锚点均照常
3. 唤醒机制代码彻底移除：scheduleTaskWakeup/_taskWakeupPending/TASK_WAKEUP_MIN_DURATION_MS/onTaskWakeupInject dep 及 cli.ts wiring、lifecycle.ts 清理、SessionManagerCore 接口面
4. backend inject 端点与排队合并/豁免机制保留不动（无生产者后为休眠代码）；前端历史会话回放的隐藏逻辑（2026-10-13-session-taskwakeup-hide）保留
5. sillyhub-daemon 相关单测改写为新口径并通过 + pnpm typecheck 绿

## 成功标准（可验证）

1. daemon（sillyhub-daemon）任务终态 completed/failed/stopped 一律不再注入唤醒——onTaskWakeupInject 永不被调用，不再产生任何「[后台任务通知]」user_input
2. 终态侧信道不受影响：agent_task_status 终态 emit、[TASK_NOTIFICATION] 落行、任务表注销（含 tool_use 别名收口）、注册表清空清后台锚点均照常
3. 唤醒机制代码彻底移除：scheduleTaskWakeup/_taskWakeupPending/TASK_WAKEUP_MIN_DURATION_MS/onTaskWakeupInject dep 及 cli.ts wiring、lifecycle.ts 清理、SessionManagerCore 接口面
4. backend inject 端点与排队合并/豁免机制保留不动（无生产者后为休眠代码）；前端历史会话回放的隐藏逻辑（2026-10-13-session-taskwakeup-hide）保留
5. sillyhub-daemon 相关单测改写为新口径并通过 + pnpm typecheck 绿
