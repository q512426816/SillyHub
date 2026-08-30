---
id: task-06
title: 'lib/daemon.ts——streamSession switch 加 queue_changed case → onQueueChanged?.()（不入 run_id 白名单）+ reorderSessionQueue/updateSessionQueueEntry/dispatchNowSessionQueueEntry 三 client + SessionQueueEntry 类型补 position + pnpm gen:types 产物'
title_zh: 'lib/daemon.ts——streamSession switch 加 queue_changed case → onQueueChanged?.()（不入 run_id 白名单）+ reorderSessionQueue/updateSessionQueueEntry/dispatchNowSessionQueueEntry 三 client + SessionQueueEntry 类型补 position + pnpm gen:types 产物'
author: 'qinyi'
created_at: 2026-08-31 04:15:00
priority: P0
depends_on: ['task-04']
blocks: []
requirement_ids: [FR-03, FR-04, FR-05, FR-06]
decision_ids: [D-001, D-002, D-003]
expects_from:
  task-04:
    - contract: 'PATCH /api/daemon/sessions/{session_id}/queue/reorder'
      needs: ['请求体 { entry_ids: list[uuid] }（全量有序，D-003）', '响应 204；422 QUEUE_ORDER_MISMATCH']
    - contract: 'PATCH /api/daemon/sessions/{session_id}/queue/{entry_id}'
      needs: ['请求体 { prompt } 1..8000 字', '响应 200 { entry: SessionQueueEntry }；404/422/409']
    - contract: 'POST /api/daemon/sessions/{session_id}/queue/{entry_id}/dispatch-now'
      needs: ['响应 200 { interrupted: bool }（D-001）', '404 条目不存在；409 会话非 active']
    - contract: 'SessionQueueEntry DTO（router._queue_entry_dto）补 position: int（D-002）'
      needs: [position 字段进入 openapi.json 与生成类型]
allowed_paths:
  - frontend/src/lib/daemon.ts
  - frontend/src/lib/api-types.ts
  - backend/openapi.json
provides:
  - contract: reorderSessionQueue
    fields:
      - '(sessionId: string, entryIds: string[]) => Promise<void>（PATCH /sessions/{id}/queue/reorder，204 无响应体；ids 全量有序；422 QUEUE_ORDER_MISMATCH）'
  - contract: updateSessionQueueEntry
    fields:
      - '(sessionId: string, entryId: string, prompt: string) => Promise<SessionQueueEntry>（PATCH /sessions/{id}/queue/{entry_id}，200 返回更新后条目；409 TASK_WAKEUP 条目 / 422 空/超长）'
  - contract: dispatchNowSessionQueueEntry
    fields:
      - '(sessionId: string, entryId: string) => Promise<{ interrupted: boolean }>（POST /sessions/{id}/queue/{entry_id}/dispatch-now；409 会话非 active）'
  - contract: SessionStreamHandlers.onQueueChanged
    fields:
      - '可选 handler onQueueChanged?(event: SessionStreamEnvelope): void——lib/daemon.ts streamSession envelope switch 新增 queue_changed case 分发（不入 run_id 白名单）'
  - contract: SessionQueueEntry 补 position 字段
    fields:
      - 'position?: number（可选，服务端返回序为准，task-10 mock 适配）'
goal: >
  lib/daemon.ts 前端契约层接入队列实时与新动作：streamSession 消费 queue_changed
  事件（P2 根因——envelope switch 无该 case 事件被静默丢弃）触发可选回调
  onQueueChanged、新增 reorder/update/dispatch-now 三个 API client（模式对齐既有
  retrySessionQueueEntry/archiveAgentSession）、SessionQueueEntry 补 position，
  并跑 pnpm gen:types 刷新 api-types.ts + openapi.json（CLAUDE.md 规则 21），
  供 Wave 6-7 的 hook/UI 消费。
implementation:
  - "SessionEventKind 联合（daemon.ts:1162-1172）补 \"queue_changed\"；SessionStreamEnvelope 增可选 action?: string | null（后端 queue_changed 载荷键 action=enqueued/merged/dispatched/failed/deleted/reordered/edited/dispatch_now，透传不解析）；SessionStreamHandlers（:1347-1403）末尾增可选 onQueueChanged?(event: SessionStreamEnvelope): void + JSDoc（FR-03：SSE 即时刷新，5s 轮询保留兜底，双源并发由 use-message-queue 既有 epoch 丢弃兜底）"
  - "streamSession dispatch switch（:1595-1664）在 agent_task_status case 后加 case \"queue_changed\": handlers.onQueueChanged?.(envelope); break；铁律：queue_changed 不得加入 :1573-1586 的 run_id 必填白名单（turn_started/log/turn_completed/tokens/plan_mode_entered/bash_status/bash_chunk/agent_task_status）——它是会话级事件无 run_id，加入会在缺 run_id 时被误判丢弃"
  - "三 client 加在 retrySessionQueueEntry（:991-1000）之后，写法对齐（encodeURIComponent 路径段 + apiFetch）：reorderSessionQueue(sessionId: string, entryIds: string[]): Promise<void> → PATCH /queue/reorder + json { entry_ids: entryIds }（D-003 全量有序上传）；updateSessionQueueEntry(sessionId: string, entryId: string, prompt: string): Promise<SessionQueueEntry> → PATCH /queue/{entryId} + json { prompt }；dispatchNowSessionQueueEntry(sessionId: string, entryId: string): Promise<QueueDispatchNowResponse> → POST /queue/{entryId}/dispatch-now（新 interface QueueDispatchNowResponse { interrupted: boolean }，D-001）"
  - "SessionQueueEntry（:961-970）补 position?: number + JSDoc（D-002：task-04 起后端必回填；声明可选——use-message-queue.test.ts 的 entry() 工厂属 task-10 范围本卡不可改，必填会令本卡 verify tsc 红；前端渲染以服务端返回序为准，不依赖该字段本地重排）"
  - "gen:types 产物：cd frontend && pnpm gen:types 刷新 src/lib/api-types.ts + backend/openapi.json（task-04 的 QueueReorderRequest/QueueEntryUpdateRequest/QueueDispatchNowResponse/SessionQueueEntry.position 应进入生成类型），两产物随本卡一并改动（CLAUDE.md 规则 21：不让类型落后后端形成债）"
acceptance:
  - "cd frontend && pnpm exec tsc --noEmit 0 错误（既有调用方不传 onQueueChanged 也编译通过——可选回调零破坏）"
  - "queue_changed 语义双断言可机械核对：grep 'queue_changed' frontend/src/lib/daemon.ts 命中 SessionEventKind 联合与 switch case；且 :1573-1586 run_id 白名单 kind 集合不含 queue_changed"
  - "三 client 函数名/路径/方法与 design §5 一致：reorderSessionQueue（PATCH /queue/reorder）、updateSessionQueueEntry（PATCH /queue/{entryId}）、dispatchNowSessionQueueEntry（POST /queue/{entryId}/dispatch-now），供 task-07 按名消费"
  - "cd frontend && pnpm gen:types 后 api-types.ts 含 QueueReorderRequest/QueueEntryUpdateRequest/QueueDispatchNowResponse 且 SessionQueueEntry 含 position；二次执行幂等（git diff --exit-code 无漂移，对齐 pnpm gen:types:check 守门语义）"
  - "git status 改动仅 frontend/src/lib/daemon.ts、frontend/src/lib/api-types.ts、backend/openapi.json 三个文件；daemon.test.ts 不动（queue_changed 分发用例归 task-10）"
verify:
  - 'cd frontend && pnpm exec tsc --noEmit'
  - 'cd frontend && pnpm gen:types（产物含新 DTO/字段）'
  - 'git diff --exit-code -- frontend/src/lib/api-types.ts backend/openapi.json（二次 gen:types 后跑，幂等核对）'
constraints:
  - "CLAUDE.md 规则 21：gen:types 前先确认前端 node_modules 健康（pnpm exec tsc --version 能跑、node_modules/.bin 有 openapi-typescript shim）——node_modules 半坏会报一堆假的 CSSProperties/Cannot find module 错，误判成代码问题；修复用 pnpm install --force（普通 install 命中缓存不修）"
  - "queue_changed 不入 run_id 白名单（会话级事件无 run_id）；handler 声明为可选回调，不破坏既有 streamSession 调用方（session-panel 现状零改动编译通过）"
  - "position 声明为可选 position?: number 而非必填：use-message-queue.test.ts 的 entry() 工厂（:34-46）属 task-10 allowed_paths，本卡不得改测试文件，必填会破坏 Wave 内自绿；task-10 适配时再在 mock 补字段"
  - "不改后端代码与 schema（三端点契约由 task-04 产出本卡只消费；backend/openapi.json 变更仅来自 gen:types 的 dump 步骤）；不跑全量测试、不加前端依赖（NG-02/NG-06）"
  - "gen:types 若暴露与本次改动无关的旧类型债，按规则 21 惯例顺手补齐修好，不为躲报错改回手写或回退产物"
---

<!-- 骨架由 sillyspec taskcard 生成（LF 行尾 + frontmatter 已闭合 + 硬校验 9 字段齐全）。
     用 Edit tool 填充上方占位符（allowed_paths/goal/implementation/acceptance/verify/constraints 等），
     勿用 Write 整文件重写——会引入 CRLF 行尾/漏闭合 ---/漏字段回归。
     ⚠️ plan --done 硬校验会拦截未替换的占位符（FR-XX / D-XXX / src/example/file.ts /
     一句话说明这个 task / 具体步骤 1 / 可验证的验收条件 1 / 边界约束 1）——占位符视同缺字段。
     可选字段按需插进上方 frontmatter（规则见 taskcard-rules）：
     repo:          仅跨仓 task 填（local.yaml repos: 注册的仓 key；缺省=main。allowed_paths 相对该仓根写，
                    禁止带仓库名前缀/绝对路径——review 对账按仓根相对路径匹配，带前缀永不命中）
     provides:      仅当本 task 给其他 task 提供接口/DTO/响应时填
     expects_from:  仅当本 task 消费其他 task 的契约时填
     related_tests: 仅当本 task 改动导致既有测试断言失效时填（测试路径须同时进 allowed_paths） -->
