---
id: task-04
title: daemon notifyRunResult payload 增 error + daemon.ts 映射 + session-manager 收尾
title_zh: daemon 运行结果回传携带模型错误
author: qinyi
created_at: 2026-07-29 10:34:02
priority: P0
depends_on: [task-03]
blocks: [task-11]
requirement_ids: [FR-01, FR-02]
decision_ids: [D-005@v1]
allowed_paths:
  - sillyhub-daemon/src/hub-client.ts
  - sillyhub-daemon/src/daemon.ts
  - sillyhub-daemon/src/interactive/session-manager.ts
  - sillyhub-daemon/src/api-types.ts
provides:
  - contract: NotifyRunResultError
    fields: [error]
expects_from:
  task-03:
    - contract: StreamJsonModelError
      needs: [type, code, message, retryable, hint, raw]
goal: >
  notifyRunResult payload 携带 ModelError，daemon.ts payload 映射带 error，session-manager turn 收尾传递，贯通 daemon 到 backend 错误链路。
implementation:
  - hub-client.ts:530+ notifyRunResult payload 增可选 error 字段（ModelError）
  - daemon.ts:1354-1397 payload 映射带 error（从 stream-json 缓存取）
  - session-manager.ts turn 收尾携带 error（result is_error 时）
  - api-types.ts 同步 notifyRunResult 请求类型增 error（daemon 类型定义）
acceptance:
  - notifyRunResult payload 含 error 字段（is_error 时）
  - daemon.ts payload 映射正确传递 error
  - session-manager turn 收尾携带 error
verify:
  - cd sillyhub-daemon && pnpm typecheck
  - cd sillyhub-daemon && pnpm test
constraints:
  - error 字段可选（is_error=false 不传，成功路径不回归）
  - 不改后端契约（后端接收留 task-06）
  - api-types.ts 为 daemon 自身类型定义，非 frontend gen:types 产物
---
