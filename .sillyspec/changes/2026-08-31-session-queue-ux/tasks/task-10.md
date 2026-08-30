---
id: task-10
title: 'frontend 队列测试——既有 __tests__/message-queue-bar.test.tsx（约 10 用例）适配重构 + 新增（拖拽换位全量上传 dataTransfer mock/编辑浮层三态/⚡ 调用/TASK_WAKEUP 隐藏 ✎）+ 既有 hooks/__tests__/use-message-queue.test.ts（约 9 用例）适配三新方法 + daemon.test queue_changed 分发 + session-panel 接线用例'
title_zh: 'frontend 队列测试——既有 __tests__/message-queue-bar.test.tsx（约 10 用例）适配重构 + 新增（拖拽换位全量上传 dataTransfer mock/编辑浮层三态/⚡ 调用/TASK_WAKEUP 隐藏 ✎）+ 既有 hooks/__tests__/use-message-queue.test.ts（约 9 用例）适配三新方法 + daemon.test queue_changed 分发 + session-panel 接线用例'
author: 'qinyi'
created_at: 2026-08-31 04:00:53
priority: P0
depends_on: ['task-06', 'task-07', 'task-08', 'task-09']
blocks: []
requirement_ids: [FR-03, FR-04, FR-05, FR-06]
decision_ids: [D-001, D-003, D-006, D-009]
expects_from:
  task-06:
    - contract: SessionStreamHandlers.onQueueChanged
      needs: ['可选 handler onQueueChanged?(event: SessionStreamEnvelope): void——lib/daemon.ts streamSession envelope switch 新增 queue_changed case 分发（不入 run_id 白名单）']
    - contract: reorderSessionQueue
      needs: ['(sessionId: string, entryIds: string[]) => Promise<void>（PATCH /sessions/{id}/queue/reorder，204 无响应体；ids 全量有序；422 QUEUE_ORDER_MISMATCH）']
    - contract: updateSessionQueueEntry
      needs: ['(sessionId: string, entryId: string, prompt: string) => Promise<SessionQueueEntry>（PATCH /sessions/{id}/queue/{entry_id}，200 返回更新后条目；409 TASK_WAKEUP 条目 / 422 空/超长）']
    - contract: dispatchNowSessionQueueEntry
      needs: ['(sessionId: string, entryId: string) => Promise<{ interrupted: boolean }>（POST /sessions/{id}/queue/{entry_id}/dispatch-now；409 会话非 active）']
    - contract: SessionQueueEntry 补 position 字段
      needs: ['position?: number（可选，服务端返回序为准，task-10 mock 适配）']
  task-07:
    - contract: useMessageQueue 三方法
      needs: ['reorderEntry(ids: string[]): void', 'editEntry(id: string, prompt: string): void', 'dispatchNowEntry(id: string): void']
  task-08:
    - contract: MessageQueueBarProps 三回调
      needs: ['onReorder(ids: string[]): void', 'onEdit(id: string, prompt: string): void', 'onDispatchNow(id: string): void']
    - contract: QueueEntry 系统通知条目标记
      needs: ['TASK_WAKEUP 前缀（[后台任务通知]）条目隐藏 ✎ 编辑按钮（D-009）']
  task-09:
    - contract: session-panel 队列接线
      needs: ['SSE onQueueChanged → useMessageQueue.refresh()', 'bar 三回调透传 hook 三方法', '队列 API 错误静默（对齐 hook catch 模式）']
allowed_paths:
  - frontend/src/components/daemon/__tests__/message-queue-bar.test.tsx
  - frontend/src/hooks/__tests__/use-message-queue.test.ts
  - frontend/src/lib/daemon.test.ts
  - frontend/src/components/daemon/__tests__/session-panel-dialog-attachments.test.tsx
goal: >
  为 Wave5-7 前端队列产物补齐测试面（design §8 前端 vitest 段 + FR-03/04/05/06
  验收）：既有 message-queue-bar.test.tsx 约 10 用例与 use-message-queue.test.ts
  约 9 用例适配 task-07/08 新契约；新增拖拽换位全量上传（dataTransfer mock）/
  编辑浮层三态/⚡ 立即发送/TASK_WAKEUP 隐藏 ✎/daemon.test queue_changed 分发/
  session-panel 接线用例。
implementation:
  - "message-queue-bar.test.tsx 既有约 10 用例适配 task-08 重构：所有 render 补传新 props onReorder/onEdit/onDispatchNow（vi.fn()）；QueueEntry 若扩 position 字段则 makeEntry fixture 同步补；既有断言语义零丢失（状态文案 aria-label「等待中/发送失败/发送中」、↻ ✕ 回调带 id、满员 N/max、📎 附件数、40 字截断展开/收起）"
  - "bar 新增用例——拖拽换位（FR-04）：jsdom 无原生 DnD，fireEvent.dragStart/dragOver/drop 携带 dataTransfer mock（createEvent + 属性注入，D-006 零新依赖）；断言换位后松手 onReorder 收到全量有序 id 序（D-003 不允许部分上传）、dragover 期间目标条高亮、dragend 高亮复位"
  - "bar 新增用例——编辑浮层三态（FR-06）：点 ✎ 展开 textarea 初值=entry.prompt；取消=不回调不改展示；保存=onEdit(id, 新文本)；failed 条目编辑保存后条目说明转等待中提示；prompt 以「[后台任务通知]」开头（TASK_WAKEUP_PROMPT_PREFIX，session/service.py:147）的条目不渲染 ✎（D-009，后端 409 双保险）"
  - "bar 新增用例——⚡ 立即发送（FR-05，D-001 打断语义）：pending 与 failed 条目均渲染 ⚡ 且点击调 onDispatchNow(id)；sending 条目不渲染（投递中不可操作现状保持）"
  - "use-message-queue.test.ts 既有约 9 用例适配：vi.mock @/lib/daemon 出口补 reorderSessionQueue/updateSessionQueueEntry/dispatchNowSessionQueueEntry 三 mock；新增三方法用例照 removeEntry/retryEntry 既有模式——mockResolvedValue + act 内调方法 + waitFor queue 收敛 + 端点参数断言（首参 sess-1、条目 id / prompt / ids 序）"
  - "lib/daemon.test.ts 新增 queue_changed 分发用例（FR-03）：照 subscribeAgentSessionsEvents（task-05，:499 起）的 vi.mock fetch-sse + sseConns[n].onmessage 注入模式驱动 streamSession，喂 kind=queue_changed envelope 断言 handlers.onQueueChanged 被调；对照断言该事件不触发 onTurnStarted/postTurn 对账等 run_id 白名单副作用（task-06 case 不入白名单）"
  - "session-panel 接线用例（session-panel-dialog-attachments.test.tsx，既有队列三 API mock + MessageQueueBar 渲染格局，:62-90/:328-361）：@/lib/daemon mock 补三新 client；① 捕获 streamSession 传入的 handlers，触发 onQueueChanged → fetchSessionQueue 重新拉取（SSE 即时刷新，FR-03）；② bar 上换位落手/编辑保存/⚡ 点击分别透传 reorder/update/dispatch-now 端点（带 sess-1 与正确条目 id/prompt/ids）"
acceptance:
  - "四测试文件全绿（message-queue-bar / use-message-queue / daemon.test / session-panel-dialog-attachments），既有用例仅适配 props/mock/fixture，断言语义零缩水"
  - "拖拽用例证明 onReorder 全量有序上传（D-003）；TASK_WAKEUP 前缀条目无 ✎（D-009）；⚡ 在 pending+failed 两态均回调 onDispatchNow"
  - "hook 三方法用例证明「调对应端点 + load 重新拉取」双行为（对齐 removeEntry 既有模式）"
  - "daemon.test 证明 queue_changed envelope 命中 onQueueChanged 且不误触发其它 handler；panel 用例证明 SSE → refresh 与三回调透传（FR-03/04/05/06 前端链路）"
  - "cd frontend && pnpm exec tsc --noEmit 0 错"
verify:
  - 'cd frontend && pnpm exec vitest run src/components/daemon/__tests__/message-queue-bar.test.tsx src/hooks/__tests__/use-message-queue.test.ts'
  - 'cd frontend && pnpm exec vitest run src/lib/daemon.test.ts src/components/daemon/__tests__/session-panel-dialog-attachments.test.tsx'
  - 'cd frontend && pnpm exec tsc --noEmit'
constraints:
  - "禁止跑全量测试（vitest run 无参），仅本卡 4 文件（CLAUDE.md 规则 0，全量留 CI）"
  - "只改测试不改实现源码：测试暴露的实现缺陷回 task-06/07/08/09 对应卡修（CLAUDE.md 规则 9，禁止改断言凑绿）"
  - "既有用例适配只补 props/mock/fixture 字段；新用例照既有中文标题与断言口径（.sillyspec/docs/frontend/scan/CONVENTIONS.md 第 7 条）"
  - "jsdom DnD 用 dataTransfer mock（fireEvent.dragStart/dragOver/drop + createEvent 属性注入），不引三方 polyfill（D-006 零新依赖）"
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
