---
id: task-02
title: add-one-shot-sessionid-override-to-workerdone
title_zh: 'hub-client workerDone 增加一次性 sessionId 覆盖参数'
author: 'qinyi'
created_at: 2026-09-10 21:30:00
priority: P0
depends_on: []
blocks: ['task-03', 'task-09']
requirement_ids: [FR-01]
decision_ids: [D-001@v1]
allowed_paths:
  - sillyhub-daemon/src/hub-client.ts
  - sillyhub-daemon/tests/hub-client-worker-done-session.test.ts
target_files:
  - sillyhub-daemon/src/hub-client.ts
  - NEW:sillyhub-daemon/tests/hub-client-worker-done-session.test.ts
provides:
  - contract: HubClient.workerDone opts.sessionId
    fields: [sessionId]
goal: >
  workerDone 增第 4 参 opts.sessionId，一次性覆盖实例级 X-Session-Id 头，供 daemon 主客户端（无会话头）代报分身 worker_done（design §5.1 / FR-01）。
implementation:
  - workerDone（sillyhub-daemon/src/hub-client.ts:2136-2155）签名加第 4 参 opts?: { sessionId?: string }
  - _request 第 4 参改为合并头——先展开 _sessionIdHeaders()（:650），opts.sessionId 存在时再以 X_SESSION_ID_HEADER（:569）键覆盖同名头
  - JSDoc 补 2026-09-10-review-dispatch-platform-fixes 注记（daemon 代报用一次性分身会话头，可覆盖实例级 auth.sessionId）
  - 新增 tests/hub-client-worker-done-session.test.ts 覆盖传 sessionId 带头、未传 opts 零变化、与实例级 sessionId 并存时前者胜
acceptance:
  - workerDone(undefined, undefined, {summary}, {sessionId:'s1'}) 发出的请求带 X-Session-Id 头且值为 s1
  - 未传 opts 时请求头与改前逐字一致（实例级 auth.sessionId 行为零变化）
  - opts.sessionId 覆盖实例级 _sessionIdHeaders 同名头
verify:
  - cd sillyhub-daemon && pnpm exec vitest run tests/hub-client-worker-done-session.test.ts && pnpm typecheck
constraints:
  - 未传 opts 时行为与现状逐字一致（空展开零差）
  - 不新建 HubClient 实例，不改 _sessionIdHeaders 本体与其它 MCP 端点
  - 头名走既有 X_SESSION_ID_HEADER 单一来源
---
