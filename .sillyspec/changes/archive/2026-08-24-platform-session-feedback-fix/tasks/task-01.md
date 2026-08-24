---
id: task-01
title: '后端新增 plan/bash/agent_task SSE 事件 DTO 与 Redis 发布逻辑'
title_zh: '后端新增 plan/bash/agent_task SSE 事件 DTO 与 Redis 发布逻辑'
author: 'qinyi'
created_at: 2026-08-24 11:07:30
priority: P0
depends_on: []
blocks: ['task-02', 'task-03', 'task-05']
requirement_ids: [FR-01, FR-02, FR-03]
decision_ids: [D-002@v1]
allowed_paths:
  - backend/app/modules/daemon/schema.py
  - backend/app/modules/daemon/run_sync/service.py
provides:
  contract: |
    SessionEventEnvelope {event, session_id, run_id, timestamp}
    PlanModeEnteredEvent {summary {objective, tasks[], design_snippet?}, requested_at}
    BashStatusEvent {command, status: running|completed|failed, exit_code?, elapsed_ms?}
    BashChunkEvent {command, channel: stdout|stderr, content, is_final}
    AgentTaskStatusEvent {task_id, task_name, status: running|completed|failed, progress?, message?}
    PlanResponseDecision {confirm|revise|cancel}
    PlanResponseRequest {session_id, run_id, decision, feedback?}
goal: >
  在 backend 定义 plan/bash/agent_task 三类 SSE 事件 DTO，并在 run_sync/service.py 扩展 Redis 发布逻辑，让 daemon 上报的事件能经现有 agent_session:{id} 频道推送到前端。
implementation:
  - 在 schema.py 新增 PlanModeEnteredEvent、BashStatusEvent、BashChunkEvent、AgentTaskStatusEvent、PlanSummary DTO
  - 在 schema.py 新增 PlanResponseDecision 枚举与 PlanResponseRequest DTO（供 task-02 plan-response 端点复用）
  - 扩展 publish_submitted_messages / 新增 publish_session_event 通用 helper，将上述事件发布到 agent_session:{id}
  - bash_chunk 实现 100ms 节流与 8KB 单条上限
acceptance:
  - schema.py 新增 4 个事件 DTO、1 个 summary DTO、1 个 decision 枚举与 1 个 response DTO，字段与设计文档一致
  - 调用发布 helper 后 Redis agent_session:{id} 频道收到合法 JSON 事件
  - bash_chunk 高频调用被节流，单条 content 不超过 8KB
verify:
  - cd backend && uv run pytest app/modules/daemon/tests/test_session_plan_bash_events.py -q --no-cov
constraints:
  - 不新增持久化表，事件走 Redis Pub/Sub 实时推送
  - 不改动现有 log/tokens/messages 事件发布路径
---

<!-- 骨架由 sillyspec taskcard 生成（LF 行尾 + frontmatter 已闭合 + 硬校验 9 字段齐全）。
     用 Edit tool 填充上方占位符（allowed_paths/goal/implementation/acceptance/verify/constraints 等），
     勿用 Write 整文件重写——会引入 CRLF 行尾/漏闭合 ---/漏字段回归。
     可选字段按需插进上方 frontmatter（规则见 taskcard-rules）：
     provides:      仅当本 task 给其他 task 提供接口/DTO/响应时填
     expects_from:  仅当本 task 消费其他 task 的契约时填
     related_tests: 仅当本 task 改动导致既有测试断言失效时填（测试路径须同时进 allowed_paths） -->
