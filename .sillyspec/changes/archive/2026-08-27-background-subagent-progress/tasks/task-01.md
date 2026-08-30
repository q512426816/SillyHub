---
id: task-01
author: qinyi
created_at: 2026-08-27 09:36:00
priority: P0
title: spike：验证 CLI 0.3.181 运行时 task_* 发射与频率
title_zh: spike：验证 CLI 0.3.181 运行时 task_* 发射与频率
depends_on: []
blocks: [task-03]
allowed_paths:
  - sillyhub-daemon/src/interactive/session-manager.ts
  - .sillyspec/changes/2026-08-27-background-subagent-progress/design.md
provides:
  - contract: spike_conclusion
    fields: [task_started_emitted, task_progress_emitted, task_notification_emitted, progress_frequency, throttle_recommendation_ms, fallback_weight]
expects_from: []
goal: |
  消解 design R-01/R-03：实测本地 daemon + 后台 Agent 会话中 CLI 0.3.181 是否真的发出 system/task_started、task_progress、task_notification 消息及其频率，结论回填 design.md §10，输出 [TASK_PROGRESS] 节流参数与回执兜底权重决策。
implementation: |
  1. 在 session-manager.ts _onMessage 入口加临时 debug 日志（console.error 前缀 [task-spike]）：打印 msg.type/subtype 全量（仅 spike 期间，事后删除或降级为 debug 开关）。
  2. 本地起 backend（Makefile dev-up + backend-run）+ daemon（sillyhub-daemon 本地调试方式），创建一个 interactive 会话，发一条让主代理用 Agent 工具后台异步派发子代理的指令（例："用后台模式派一个子代理去数一下 backend 目录下有多少个 py 文件，别等它完成"）。
  3. 观察 daemon 控制台 [task-spike] 输出：记录 task_started/task_progress/task_notification 是否到达、task_progress 的到达频率（每工具一次/每 N 秒一次/仅终态）。
  4. 结论回填 design.md §10 验证记录两个 checkbox；若"不发"，在 design §5 P1.2 注明回执兜底升为 primary。
acceptance: |
  design.md §10 两个 checkbox 均已勾选并附实测结论（发/不发、频率）；节流参数有明确数值（默认 2000ms 或按实测调整）；spike 结论在 tasks/task-03.md 的 constraints 中被引用。
verify: |
  读 design.md §10 确认回填完整；spike 临时日志代码已移除或包在 DEBUG 开关后（不留无条件 console.error）。
constraints: |
  spike 临时代码不得改变现有消息处理行为（只加观察不加分流）；不 commit spike 产物到主干（design.md 回填除外）；Windows 本地跑（daemon 连本地 backend）。
---
