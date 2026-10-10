---
author: flow-machine-draft
created_at: 2026-10-10T07:45:13.004Z
---
# 任务注册表（Tasks）— 2026-10-10-task-wakeup-quiet-threshold

- [x] task-01: daemon 测试先行——task-lifecycle.test.ts 唤醒 describe 内新增 4 条用例（短任务 elapsed_ms 2s 不唤醒/长任务 61s 唤醒/elapsed 缺失走 startedAt 兜底/双缺失保持唤醒），同步把既有合并用例 durationMs 夹具 20/21s 上调 61/62s（00:20→01:01）；跑该文件确认新用例红、旧用例仅夹具变化
- [x] task-02: daemon 实现——background-tasks.ts 加 TASK_WAKEUP_MIN_DURATION_MS=60_000，handleTaskNotificationEvent completed/failed 分支在 scheduleTaskWakeup 前判时长（elapsed_ms 优先→info.startedAt 兜底→双缺失放行），跑 task-lifecycle.test.ts 全绿
- [x] task-03: backend 测试先行——test_session_queue.py 新增 3 条用例（1 通知+4 用户后第 5 条用户消息不拒/5 条用户队满后通知入队不抛 QueueFull/纯 5 条用户后第 6 条照旧拒），先跑确认红
- [x] task-04: backend 实现——queue.py 满员计数剔除 [后台任务通知] 前缀 pending 条目 + 通知类注入豁免 DaemonSessionQueueFull，跑 test_session_queue.py 全绿
- [x] task-05: 同步模块文档 daemon.md 唤醒门槛行为段 + 全部交付文件显式 pathspec 提交（每任务一格、消息带 task-NN）
