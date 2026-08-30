---
author: qinyi
created_at: 2026-08-27 09:44:00
change: 2026-08-27-background-subagent-progress
---

# 符号影响面（Symbol Impact）· 后台异步子代理进度可视化

> 生成于 execute「加载上下文」步；调用点经 rg/grep 实测（2026-08-27，HEAD=3892571b）。

- task-01: 无签名级变更（临时 debug 打点 + design.md 回填，不改任何函数签名）。
- task-02: 接口字段新增（可选）——`NotifyAgentTaskStatusBody`（hub-client.ts:141）与 `SessionEventForBackend.agent_task_status` 分支（types.ts:104）扩展字段。调用点：`notifyAgentTaskStatus`（hub-client.ts:1018 定义）仅 cli.ts:718 case 消费 → 两文件均在 task-02 allowed_paths 内。可选字段不破坏既有构造点。
- task-03: 无对外签名级变更——`SessionState` 新增私有状态 + `_onMessage` 内部分支 + 私有方法；emit 走既有 `_emitSessionEvent`，载荷类型变更由 task-02 覆盖（session-manager.ts 在 task-03 范围内）。
- task-04: 无签名级变更（仅新增测试文件）。
- task-05: DTO 字段新增（可选）——`AgentTaskStatusEvent`（schema.py:968）。调用点：router.py `notify_agent_task_status`（:1555，在范围内）、run_sync/service.py publish 载荷构造（在范围内）、既有测试 test_session_plan_bash_events.py（已列入 task-08 allowed_paths）。`async_` + alias 不影响既有构造。
- task-06: 无签名级变更——submit_messages 内部 run_id 归位逻辑 + 进程级 LRU；对外行为（落库行内容）不变，仅 run_id 归因。
- task-07: DTO 约束 + 新异常路径——inject 请求模型 prompt 加 min_length；`inject_session`（session/service.py:2177）新增 raise SessionEmptyPrompt。调用点：router.py inject 端点（同模块，行为透传 422）、`inject_session_as_service` 包装（同文件 :2292）。前端发送方由 task-14 防御，无其它后端调用点。
- task-08: 无签名级变更（仅测试文件）。
- task-09: 生成物更新（api-types.ts/openapi.json），无手写签名。
- task-10: 接口字段新增（可选）——frontend `AgentTaskStatusEvent`（daemon.ts:1022）与 `onAgentTaskStatus` 回调载荷扩展。调用点：仅 session-panel.tsx handler（:1160）消费 → 在 task-12 allowed_paths 内（Wave 5 晚于本任务，编译期可选字段不破坏）。
- task-11: 类型字段新增（可选）——`TurnSegment` tool 分支加 taskStatus/taskElapsedMs/taskAsync/taskSummary/taskToolName 元数据。调用点（TurnSegment 消费方）：session-log-assembler.ts（本任务范围）、turn-status-bar.tsx / turn-segment-views.tsx / session-panel.tsx（task-13/12 范围）、**范围外**：file-message-card.tsx、runtime-session-helpers.tsx、turn-timeline.tsx、tool-args-detail.tsx——可选字段零代码改动（不改原因：仅消费既有字段），不阻断。
- task-12: 组件 props 扩展——`AgentTaskCardProps` 新增可选 props（elapsed/summary 等）；调用点仅 session-panel.tsx ActivityCatalog 两处挂载（:2478/:4122，在 task-12/14 范围内）。
- task-13: 无签名级变更（展示组件内部消费 task-11 元数据 + task-10 回调）。
- task-14: 无签名级变更（disabled 条件追加）。
- task-15: 无签名级变更（仅测试文件）。

结论：全部签名级变更的影响调用点均落在对应 task 的 allowed_paths 内（或可选字段零改动范围外消费方）；无阻断项。
