---
id: task-04
title: 'daemon 在 session-manager turn 事件流中识别 plan/Bash/后台任务'
title_zh: 'daemon 在 session-manager turn 事件流中识别 plan/Bash/后台任务'
author: 'qinyi'
created_at: 2026-08-24 11:07:30
priority: P0
depends_on: ['task-03']
blocks: ['task-11']
requirement_ids: [FR-01, FR-02, FR-03]
decision_ids: [D-002@v1]
allowed_paths:
  - sillyhub-daemon/src/interactive/session-manager.ts
  - sillyhub-daemon/src/interactive/types.ts
  - sillyhub-daemon/src/cli.ts
expects_from:
  task-03: HubClient.notifyPlanModeEntered / notifyBashStatus / notifyBashChunk / notifyAgentTaskStatus
provides:
  contract: |
    SessionManager turn 事件流中自动触发 plan/bash/agent_task 事件上报
    运行中 Bash 命令内存索引：toolUseId -> {command, startTime}
goal: >
  在 SessionManager 的 turn 事件流（_onMessage / _onResult）中识别 plan 模式进入、Bash 命令生命周期与后台 Agent 任务事件，调用 task-03 新增的 HubClient 方法实时上报 backend，让前端会话面板获得反馈。
implementation:
  - spike-01 已确认 hook 点（symbol-impact.md）：_onMessage（session-manager.ts:3446）assistant tool_use blocks 遍历（3459-3476）+ user 消息通用转发分支（3582-3585）前拦截 tool_result
  - 在 SessionManagerDeps（types.ts:364）新增 optional onSessionEvent 回调字段（additive-optional，既有构造点零影响），保持测试可 mock
  - 在 cli.ts:640 SessionManager 构造处新增 onSessionEvent 闭包接线（同 onTurnResult/onTurnMessage 模式，client=HubClient 在作用域内，调用 task-03 notify 方法）
  - 在 _onMessage 中识别 assistant message 的 tool_use block：name 为 EnterPlanMode / ExitPlanMode（plan 相关）时提取 objective/tasks/design_snippet，调用 notifyPlanModeEntered（EnterPlanMode 的 summary 可为空骨架，计划内容随 ExitPlanMode input.plan 到达）
  - Bash tool_use 开始时调用 notifyBashStatus(sessionId, runId, command, 'running')，并用 Map 记录 toolUseId -> {command, startTime}
  - user 消息 tool_result（tool_use_id 匹配）到达时调用 notifyBashChunk(is_final=true，Claude SDK 不流式推 stdout，chunk 在结果到达时一次性发出)；最终态调用 notifyBashStatus('completed'|'failed', is_error 派生 exit_code, elapsed_ms) 并清理 Map
  - 识别 Task tool_use / 子代理相关 message，调用 notifyAgentTaskStatus 上报后台任务状态
  - session end/fail 时清理运行中命令表与待上报状态
  - 所有上报 fire-and-forget，异常吞掉不阻塞 turn 主流程与现有 onTurnMessage 转发
acceptance:
  - 模拟 plan 模式触发后 backend 收到 plan_mode_entered 事件，payload 含 summary
  - Bash 命令全生命周期产生 bash_status(running)、bash_chunk、bash_status(completed/failed)
  - 多 Bash 命令按 toolUseId 隔离，不串命令
  - 后台 Agent 任务状态变化产生 agent_task_status 事件
  - 不认识的消息类型原有 onTurnMessage 转发行为不变
verify:
  - cd sillyhub-daemon && pnpm exec tsc --noEmit
  - cd sillyhub-daemon && pnpm exec vitest run tests/session-plan-bash-events.test.ts
constraints:
  - 依赖 spike-01 确认的 hook 点；若 spike 结论推翻需回退重设计
  - 不上报 plan/bash/agent_task 以外的工具事件
  - 运行中命令表仅存内存，session end/fail/interrupt 时清理
  - 不修改现有消息转发与 turn 收尾主流程
---

<!-- 骨架由 sillyspec taskcard 生成（LF 行尾 + frontmatter 已闭合 + 硬校验 9 字段齐全）。
     用 Edit tool 填充上方占位符（allowed_paths/goal/implementation/acceptance/verify/constraints 等），
     勿用 Write 整文件重写——会引入 CRLF 行尾/漏闭合 ---/漏字段回归。
     可选字段按需插进上方 frontmatter（规则见 taskcard-rules）：
     provides:      仅当本 task 给其他 task 提供接口/DTO/响应时填
     expects_from:  仅当本 task 消费其他 task 的契约时填
     related_tests: 仅当本 task 改动导致既有测试断言失效时填（测试路径须同时进 allowed_paths） -->
