---
id: task-03
title: auto-report-worker-done-for-mission-worker-turns
title_zh: 'daemon onTurnResult mission_worker（caps.mcp=false）成功终态代报 worker_done（notifyRunResult 之后、fire-and-forget warn 容错）'
author: 'qinyi'
created_at: 2026-09-10 21:30:00
priority: P0
depends_on: ['task-01', 'task-02']
blocks: ['task-09']
requirement_ids: [FR-01]
decision_ids: [D-001@v1]
allowed_paths:
  - sillyhub-daemon/src/daemon.ts
  - sillyhub-daemon/tests/daemon-mission-worker-artifact.test.ts
target_files:
  - sillyhub-daemon/src/daemon.ts
  - NEW:sillyhub-daemon/tests/daemon-mission-worker-artifact.test.ts
expects_from:
  task-01:
    - contract: PiTurnResult.result
      needs: [result]
  task-02:
    - contract: HubClient.workerDone opts.sessionId
      needs: [sessionId]
goal: >
  onTurnResult 对 mission_worker 且 provider 无原生 MCP 的成功轮终态，用轮终全文 fire-and-forget 代报 worker_done，使 pi/codex/cursor 分身沉淀 kind=summary artifact（design §5.1 / FR-01）。
implementation:
  - onTurnResult（daemon.ts:3675 起）既有 await notifyRunResult 块（约:3897-3906）之后新增代报分支（Grill B-02——终态先落库、唤醒随后），门控 state.stage==='mission_worker'（types.ts:261）&& getProviderCaps(state.provider).mcp===false（providers.ts:219）&& !isError && resultMeta.result 为非空非空白 string
  - ClientLike 补可选 workerDone 声明（签名对齐 task-02 后的 hub-client），命中时 this._client.workerDone(undefined, undefined, {summary:全文}, {sessionId}) fire-and-forget——不 await 不重试，Promise.catch 只 warn worker_auto_done_failed（409/422/网络错同敛，记 session_id）
  - 新增 tests/daemon-mission-worker-artifact.test.ts 覆盖门控矩阵（stage/caps/is_error/空文本/非 string）、调用顺序在 notifyRunResult 之后、workerDone 参数、失败仅 warn、非 mission_worker 零调用
acceptance:
  - mission_worker 且 mcp:false 的成功轮全文非空时，notifyRunResult 之后恰好一次 workerDone(undefined, undefined, {summary:全文}, {sessionId})，summary=轮终全文、sessionId=分身会话
  - is_error / 全文空白 / result 非 string / 非 mission_worker / mcp:true（claude）均零调用；workerDone reject（含 HubHttpError 409/422）只 warn worker_auto_done_failed 且 onTurnResult 照常返回
verify:
  - cd sillyhub-daemon && pnpm exec vitest run tests/daemon-mission-worker-artifact.test.ts && pnpm typecheck
constraints:
  - 只对 mission_worker 且 caps.mcp===false 生效（claude 自报路径与 artifacts 零变化，防 _worker_done_core 双写）
  - 不 await（不阻塞 onTurnResult 返回），不改动既有 notifyRunResult/submitMessages 链
  - 多轮会话每轮成功各代报一次（backend 幂等语义，最新 summary 为终态）
---
