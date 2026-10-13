---
author: flow-machine-draft
created_at: 2026-10-13T04:04:16.999Z
---
# 任务注册表（Tasks）— 2026-10-13-task-wakeup-remove

- [x] task-01: background-tasks.ts 删唤醒触发分支（completed/failed 唤醒 + 60s 门槛判定）与 scheduleTaskWakeup 函数、TASK_WAKEUP_MIN_DURATION_MS 常量，同步修正模块头/handleTaskNotificationEvent 注释——验证：grep 三符号 src 仅剩零星注释、pnpm typecheck（暂容忍接口面未删的报错可后置）
- [x] task-02: 清接口面与接线——session-manager.ts（import/_taskWakeupPending 字段/_scheduleTaskWakeup 方法）、session-manager/types.ts（接口声明）、interactive/types.ts（onTaskWakeupInject dep）、cli.ts（wiring）、lifecycle.ts（pending 清理块）——验证：cd sillyhub-daemon && pnpm typecheck 绿
- [x] task-03: task-lifecycle.test.ts「task wakeup inject」describe 7 用例改写为新口径——终态一律不注入（completed/failed/stopped、长/短/孤儿形态、debounce 推进）+ 终态侧信道 emit/落行/注销断言保留——验证：pnpm exec vitest run tests/interactive/task-lifecycle.test.ts 绿
- [ ] task-04: 全量回归 + 零改动面核验——cd sillyhub-daemon && pnpm test 全绿 + pnpm typecheck 绿；git diff 确认 backend/ 与 frontend/ 零文件改动
