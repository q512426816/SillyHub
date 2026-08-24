---
id: task-02
title: '后端新增 plan-response REST 端点与 WebSocket 通知 daemon'
title_zh: '后端新增 plan-response REST 端点与 WebSocket 通知 daemon'
author: 'qinyi'
created_at: 2026-08-24 11:07:30
priority: P0
depends_on: ['task-01']
blocks: ['task-06']
requirement_ids: [FR-02]
decision_ids: [D-001@v1, D-002@v1]
allowed_paths:
  - backend/app/modules/daemon/router.py
  - backend/app/modules/daemon/session/service.py
  - backend/app/modules/daemon/protocol.py
expects_from:
  task-01: 'PlanResponseDecision / PlanResponseRequest DTO，以及 SessionEventEnvelope / PlanModeEnteredEvent 字段（session_id/run_id correlation）'
provides:
  contract: |
    POST /api/daemon/sessions/{session_id}/plan-response
    WebSocket daemon:plan_response {session_id, run_id, decision, feedback}
goal: >
  新增 POST /api/daemon/sessions/{session_id}/plan-response 端点，接收用户对 plan 的 confirm/revise/cancel 决策，写入会话状态并通过现有 WebSocket Hub 通知 daemon，Agent 收到后才继续执行。
implementation:
  - 在 session/service.py 新增 handle_plan_response 方法：校验 run 状态、写 plan 决策、WS 通知 daemon
  - 在 router.py 新增 /sessions/{session_id}/plan-response 端点，委托 service 处理
  - 通过 ws_hub.send_session_control 发送 daemon:plan_response 消息
  - DTO 复用 task-01 已定义的 PlanResponseDecision / PlanResponseRequest
  - 在 router.py 新增 4 个 daemon ingestion 端点（POST /sessions/{session_id}/plan-mode-entered、/bash-status、/bash-chunk、/agent-task-status），body 用 task-01 DTO 校验，经 task-01 的 publish_session_event helper 发布到 agent_session:{id}（design.md 接口定义 §daemon → 后端 HTTP 上报；bash-chunk 节流在 helper 内）
acceptance:
  - 端点 200 成功、404 会话不存在、422 决策/feedback 非法
  - 用户选择 revise/cancel 时 feedback 必填
  - daemon 收到 WebSocket plan_response 消息后 Agent 继续/修订/终止
verify:
  - cd backend && uv run pytest app/modules/daemon/tests/test_session_plan_bash_events.py -q --no-cov -k plan_response
constraints:
  - 复用现有 WebSocket Hub，不新建独立通道
  - 不持久化 plan 决策到新表，状态写现有 AgentSession/lease metadata
---

<!-- 骨架由 sillyspec taskcard 生成（LF 行尾 + frontmatter 已闭合 + 硬校验 9 字段齐全）。
     用 Edit tool 填充上方占位符（allowed_paths/goal/implementation/acceptance/verify/constraints 等），
     勿用 Write 整文件重写——会引入 CRLF 行尾/漏闭合 ---/漏字段回归。
     可选字段按需插进上方 frontmatter（规则见 taskcard-rules）：
     provides:      仅当本 task 给其他 task 提供接口/DTO/响应时填
     expects_from:  仅当本 task 消费其他 task 的契约时填
     related_tests: 仅当本 task 改动导致既有测试断言失效时填（测试路径须同时进 allowed_paths） -->
