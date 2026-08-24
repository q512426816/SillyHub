---
id: task-03
title: 'daemon 新增 plan/bash/agent_task 事件上报 HubClient 方法'
title_zh: 'daemon 新增 plan/bash/agent_task 事件上报 HubClient 方法'
author: 'qinyi'
created_at: 2026-08-24 11:07:30
priority: P0
depends_on: ['task-01']
blocks: ['task-04']
requirement_ids: [FR-01, FR-02, FR-03]
decision_ids: [D-002@v1]
allowed_paths:
  - sillyhub-daemon/src/hub-client.ts
expects_from:
  task-01: SessionEventEnvelope, PlanModeEnteredEvent, BashStatusEvent, BashChunkEvent, AgentTaskStatusEvent
provides:
  contract: |
    notifyPlanModeEntered(sessionId, runId, summary)
    notifyBashStatus(sessionId, runId, command, status, exitCode?, elapsedMs?)
    notifyBashChunk(sessionId, runId, command, channel, content, isFinal)
    notifyAgentTaskStatus(sessionId, runId, taskId, taskName, status, progress?, message?)
goal: >
  在 daemon REST 客户端 HubClient 中新增 plan/bash/agent_task 三类事件的上报方法，让 session-manager 能通过 HTTP 把事件推给 backend，backend 再经现有 agent_session:{id} 频道实时推送到前端。
implementation:
  - 在 hub-client.ts 新增请求体类型 NotifyPlanModeEnteredBody、NotifyBashStatusBody、NotifyBashChunkBody、NotifyAgentTaskStatusBody，字段 snake_case 对齐 task-01 的 Pydantic DTO
  - 新增 HubClient.notifyPlanModeEntered，POST {REST_PREFIX}/sessions/{sessionId}/plan-mode-entered
  - 新增 HubClient.notifyBashStatus，POST {REST_PREFIX}/sessions/{sessionId}/bash-status
  - 新增 HubClient.notifyBashChunk，POST {REST_PREFIX}/sessions/{sessionId}/bash-chunk
  - 新增 HubClient.notifyAgentTaskStatus，POST {REST_PREFIX}/sessions/{sessionId}/agent-task-status
  - 所有方法复用现有 _request / _headers 与 HubHttpError 语义，undefined 字段守卫写入，兼容旧后端
acceptance:
  - hub-client.ts 新增 4 个 notify 方法，TypeScript 编译通过
  - 请求体字段名、路径与 design.md / task-01 DTO 完全一致
  - 单测能 mock fetch 验证请求方法、路径、body 关键字段
verify:
  - cd sillyhub-daemon && pnpm exec tsc --noEmit
  - cd sillyhub-daemon && pnpm exec vitest run tests/session-plan-bash-events.test.ts
constraints:
  - 仅新增方法/类型，不修改现有 HubClient 其他方法签名
  - 端点路径与 body 字段以 task-01 后端 DTO 契约为准
  - 不上报 plan/bash/agent_task 以外的 SSE 事件
---

<!-- 骨架由 sillyspec taskcard 生成（LF 行尾 + frontmatter 已闭合 + 硬校验 9 字段齐全）。
     用 Edit tool 填充上方占位符（allowed_paths/goal/implementation/acceptance/verify/constraints 等），
     勿用 Write 整文件重写——会引入 CRLF 行尾/漏闭合 ---/漏字段回归。
     可选字段按需插进上方 frontmatter（规则见 taskcard-rules）：
     provides:      仅当本 task 给其他 task 提供接口/DTO/响应时填
     expects_from:  仅当本 task 消费其他 task 的契约时填
     related_tests: 仅当本 task 改动导致既有测试断言失效时填（测试路径须同时进 allowed_paths） -->
