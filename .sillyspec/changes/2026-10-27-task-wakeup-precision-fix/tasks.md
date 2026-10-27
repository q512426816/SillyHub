---
author: flow-machine-draft
created_at: 2026-10-27T00:39:56.644Z
---
# 任务注册表（Tasks）— 2026-10-27-task-wakeup-precision-fix

- [x] task-01: daemon 判定与显示同源——background-tasks.ts 唤醒分支把门槛判定算出的 durationMs 回传 scheduleTaskWakeup（elapsedMs: durationMs ?? elapsedMs）；新增/更新 vitest 用例「elapsed_ms 缺失显示注册表兜底时长」并跑绿（npx vitest run tests/interactive/task-lifecycle.test.ts）
- [x] task-02: daemon 前后台标记链——events.ts registerAgentToolUseMeta 读 input.run_in_background 存 isBackground 并把 Bash 纳入登记；BackgroundTaskInfo 加 isBackground?；懒注册从 meta 带入、registerAsyncReceiptTask 恒 true；handleTaskNotificationEvent 三态判定（true→阈值门槛/false→免唤醒/undefined→旧兜底+WARN）；新增用例「前台 Bash 免唤醒且终态信号不变」「后台标记 true 照常注入」「三无孤儿兜底放行打 WARN」并跑绿
- [x] task-03: daemon 结构化日志——唤醒判定四出口（放行/前台跳过/兜底放行/阈值0关闭）各打结构化日志（task_id/task_name/status/durationMs/duration_source/background+来源）；console spy 用例断言字段并跑绿
- [ ] task-04: 文案同步——daemon prompt 头部改「以下 N 个后台任务已全部结束（本批次均已终止）：」；backend helpers.py _TASK_WAKEUP_HEADER_COUNT_RE 改兼容形 后台(?:子代理)?任务、重写模板同步；更新 daemon 文案断言用例 + backend test_session_queue.py 合并用例并分别跑绿（pytest 仅跑 -k task_wakeup 相关）
- [ ] task-05: frontend fixture 同步——相关测试中旧文案字符串「后台子代理任务」同步为新文案（识别锚前缀不动、零源码改动），跑 frontend 相关测试文件绿（仅 task_wakeup/message-queue-bar/turn-segment-views 相关）
- [ ] task-06: 显式 pathspec 提交全部交付文件（含 tasks.md 勾选，消息带 task-01..task-05），核对 git log HEAD 移动
