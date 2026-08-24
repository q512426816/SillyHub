---
id: task-05
title: '前端新增 SessionStreamEnvelope 事件解析分支'
title_zh: '前端新增 SessionStreamEnvelope 事件解析分支'
author: 'qinyi'
created_at: 2026-08-24 11:07:30
priority: P0
depends_on: ['task-01']
blocks: ['task-06', 'task-07', 'task-09']
requirement_ids: [FR-01, FR-02, FR-03]
decision_ids: [D-002@v1]
provides:
  contract: |
    SessionEventKind 新增 plan_mode_entered / bash_status / bash_chunk
    SessionStreamEnvelope 扩展对应字段
    SessionStreamHandlers 新增 onPlanModeEntered / onBashStatus / onBashChunk
    submitPlanResponse(sessionId, runId, decision, feedback?) 提交函数
    streamSession dispatch 新增事件分支
allowed_paths:
  - frontend/src/lib/daemon.ts
expects_from:
  task-01: 'PlanModeEnteredEvent / BashStatusEvent / BashChunkEvent DTO schema（backend → frontend SSE payload）'
goal: >
  在现有 streamSession 单通道分发中识别 plan_mode_entered、bash_status、bash_chunk
  三类事件，通过新增专用回调透传给上层；同时提供 submitPlanResponse 供 PlanApprovalCard 提交用户决策。
implementation:
  - 扩展 SessionEventKind 联合类型：新增 plan_mode_entered、bash_status、bash_chunk
  - 扩展 SessionStreamEnvelope 字段：summary、command、status、exit_code、elapsed_ms、channel、content、is_final 等
  - 在 SessionStreamHandlers 新增 onPlanModeEntered / onBashStatus / onBashChunk 可选回调
  - 在 streamSession dispatch 的 switch 中新增事件分支，校验 session_id / run_id 后分发
  - 新增 submitPlanResponse(sessionId, runId, decision, feedback?)，调用 POST /api/daemon/sessions/{sessionId}/plan-response
  - 不认识的事件仍走 default 分支静默忽略，保持旧前端兼容
acceptance:
  - plan_mode_entered 携带 summary 与 requested_at 正确触发 onPlanModeEntered
  - bash_status(running/completed/failed) 携带 command / exit_code / elapsed_ms 正确触发 onBashStatus
  - bash_chunk 携带 channel / content / is_final 正确触发 onBashChunk
  - submitPlanResponse 200/422/404 行为正确，revise/cancel 强制 feedback
  - 未知事件不抛错、不影响现有 log / permission 解析
verify:
  - cd frontend && pnpm exec tsc --noEmit
constraints:
  - 不修改 permission_request / permission_resolved 现有解析逻辑
  - 不复用或新建第二条 SSE 连接
  - 不认识的事件必须静默忽略
---

<!-- 骨架由 sillyspec taskcard 生成（LF 行尾 + frontmatter 已闭合 + 硬校验 9 字段齐全）。
     用 Edit tool 填充上方占位符（allowed_paths/goal/implementation/acceptance/verify/constraints 等），
     勿用 Write 整文件重写——会引入 CRLF 行尾/漏闭合 ---/漏字段回归。
     可选字段按需插进上方 frontmatter（规则见 taskcard-rules）：
     provides:      仅当本 task 给其他 task 提供接口/DTO/响应时填
     expects_from:  仅当本 task 消费其他 task 的契约时填
     related_tests: 仅当本 task 改动导致既有测试断言失效时填（测试路径须同时进 allowed_paths） -->
