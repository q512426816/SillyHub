---
author: flow-machine-draft
created_at: 2026-10-21T02:49:06.356Z
---
# 任务注册表（Tasks）— 2026-10-21-task-wakeup-restore

- [x] task-01: 空闲会话任务完成且时长≥阈值 → scheduleTaskWakeup 触发 onTaskWakeupInject（2s debounce 合并多任务、汇总 prompt 模板还原）
- [x] task-02: 忙轮/短任务/stopped 不注入：忙轮走 backend queue_when_busy 语义由注入文案自带（daemon 侧仅验证 onTaskWakeupInject 调用面）；时长<阈值不注入，elapsed_ms/startedAt 双缺失 fail-open 放行
- [x] task-03: 阈值从 daemon 配置读取，缺省 60000，配置 0 时 completed/failed 一律不注入
- [x] task-04: pi 会话轮次聚合（kind=agent_task_status 路由）不触发注入（回归断言防死循环）
- [x] task-05: daemon task-lifecycle 整组绿 + pnpm typecheck 零错
- [x] task-06: 前端唤醒轮留痕（FR-06，执行期用户追加）——task_wakeup 段类型 + TaskWakeupNoticeView 折叠行 + 回放/live 双路径插段 + 对话视图放行，前端 tsc 零错 + 目标套件绿
