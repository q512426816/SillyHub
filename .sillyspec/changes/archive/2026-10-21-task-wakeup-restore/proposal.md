---
author: flow-machine-draft
created_at: 2026-10-21T02:49:06.356Z
---
# 提案书（Proposal）— 2026-10-21-task-wakeup-restore

## 动机

任务原话转写：恢复后台任务终态唤醒链并折叠系统行呈现
动机与背景：2026-10-13-task-wakeup-remove（f889832d1）删除终态唤醒链后，主代理派发子代理并结束回合的会话在任务完成时停摆（腾讯云会话 49d893ab 实证：任务 02:16:42 完成、通知落日志后无新轮）。backend inject 端点/task_wakeup 门控/queue_when_busy 排队/hubClient.injectSessionPrompt 均存活零改动；本变更从 f889832d1^ 恢复 daemon 侧四处（background-tasks.ts 阈值常量+触发块+scheduleTaskWakeup、types.ts _taskWakeupPending 与 onTaskWakeupInject dep、cli.ts 接线、lifecycle.ts debounce 清理），60s 安静阈值改 local.yaml 配置（wakeup.quiet_threshold_ms，缺省 60000，0=关闭）；测试翻回唤醒断言并新增跨引擎防回归（pi 影子任务零注入防死循环、忙轮排队、阈值边界）。

成功标准：
- 空闲会话任务完成且时长≥阈值 → scheduleTaskWakeup 触发 onTaskWakeupInject（2s debounce 合并多任务、汇总 prompt 模板还原）
- 忙轮/短任务/stopped 不注入：忙轮走 backend queue_when_busy 语义由注入文案自带（daemon 侧仅验证 onTaskWakeupInject 调用面）；时长<阈值不注入，elapsed_ms/startedAt 双缺失 fail-open 放行
- 阈值从 daemon 配置读取，缺省 60000，配置 0 时 completed/failed 一律不注入
- pi 会话轮次聚合（kind=agent_task_status 路由）不触发注入（回归断言防死循环）
- daemon task-lifecycle 整组绿 + pnpm typecheck 零错

## 变更范围

按成功标准机械推导，共 5 条验收面：
1. 空闲会话任务完成且时长≥阈值 → scheduleTaskWakeup 触发 onTaskWakeupInject（2s debounce 合并多任务、汇总 prompt 模板还原）
2. 忙轮/短任务/stopped 不注入：忙轮走 backend queue_when_busy 语义由注入文案自带（daemon 侧仅验证 onTaskWakeupInject 调用面）；时长<阈值不注入，elapsed_ms/startedAt 双缺失 fail-open 放行
3. 阈值从 daemon 配置读取，缺省 60000，配置 0 时 completed/failed 一律不注入
4. pi 会话轮次聚合（kind=agent_task_status 路由）不触发注入（回归断言防死循环）
5. daemon task-lifecycle 整组绿 + pnpm typecheck 零错

## 成功标准（可验证）

1. 空闲会话任务完成且时长≥阈值 → scheduleTaskWakeup 触发 onTaskWakeupInject（2s debounce 合并多任务、汇总 prompt 模板还原）
2. 忙轮/短任务/stopped 不注入：忙轮走 backend queue_when_busy 语义由注入文案自带（daemon 侧仅验证 onTaskWakeupInject 调用面）；时长<阈值不注入，elapsed_ms/startedAt 双缺失 fail-open 放行
3. 阈值从 daemon 配置读取，缺省 60000，配置 0 时 completed/failed 一律不注入
4. pi 会话轮次聚合（kind=agent_task_status 路由）不触发注入（回归断言防死循环）
5. daemon task-lifecycle 整组绿 + pnpm typecheck 零错
