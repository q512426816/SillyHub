---
id: task-04
title: 'daemon resume 接线（payload 归一化→CreateSessionInput.resume→SessionManager.create）（depends_on: task-03）'
title_zh: 'daemon resume 接线（payload 归一化→CreateSessionInput.resume→SessionManager.create）（depends_on: task-03）'
author: 'qinyi'
created_at: 2026-08-29 21:15:48
priority: P0
depends_on: [task-03]
blocks: []
requirement_ids: [FR-03]
decision_ids: [D-001@v1]
allowed_paths:
  - sillyhub-daemon/src/daemon.ts
  - sillyhub-daemon/src/interactive/types.ts
  - sillyhub-daemon/tests/daemon-resume-input.test.ts
goal: daemon 消费 claim payload 的 resume_session_id——execPayload.resumeSessionId 归一化（daemon.ts:6120-6123 既有）经 CreateSessionInput 新增 resume 可选字段，在 _startInteractiveSession 的 create 调用（daemon.ts:5784-5837）下发；不含 resume 时行为零变化保旧 backend 兼容。
implementation:
  - types.ts CreateSessionInput（:352）加 resume 可选字段（string；注释注明来自 execPayload.resumeSessionId 透传，undefined 全链无键零回归）
  - daemon.ts _startInteractiveSession 的 sessionManager.create 调用（:5784-5837）加 resume——传 execPayload.resumeSessionId（归一化 :6120-6123 已存在不新建第二套）
  - 遵循 daemon 仓 ESM .js 后缀导入惯例
  - 新增 tests/daemon-resume-input.test.ts——mock SessionManager 断言 create 收到 resume 归一化值；payload 无该键时 resume 为 undefined 的旧 backend 兼容用例
acceptance:
  - claim payload 带 resume_session_id 时 create 入参含 resume=归一化值（spy 断言）
  - 不含时 resume 为 undefined 行为与现状一致（旧 backend 兼容用例）
  - pnpm typecheck 通过（CreateSessionInput 扩字段不破坏既有调用点）
verify:
  - cd sillyhub-daemon && pnpm exec vitest run tests/daemon-resume-input.test.ts && pnpm typecheck
provides:
  - contract: resume_input
    fields: [CreateSessionInput_resume]
constraints:
  - 不动 session-manager.ts——create 内 spec 转发 resume 进 driverOpts（session-manager.ts:1429-1438 现缺该转发）与损伤降级归 task-05
  - 不改 batch stream-json 路径与既有 execPayload 归一化区，不新建第二套 resumeSessionId 归一化
expects_from:
  task-03:
    - contract: InteractiveResumeClaim
      needs: [resume_session_id]
---
