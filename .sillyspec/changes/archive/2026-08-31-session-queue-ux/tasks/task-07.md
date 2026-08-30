---
id: task-07
title: 'useMessageQueue——reorderEntry/editEntry/dispatchNowEntry（load 刷新模式，对齐 removeEntry）'
title_zh: 'useMessageQueue——reorderEntry/editEntry/dispatchNowEntry（load 刷新模式，对齐 removeEntry）'
author: 'qinyi'
created_at: 2026-08-31 04:15:00
priority: P0
depends_on: ['task-06']
blocks: []
requirement_ids: [FR-04, FR-05, FR-06]
decision_ids: [D-001@v1, D-003@v1]
expects_from:
  task-06:
    - contract: reorderSessionQueue
      needs: ['(sessionId: string, entryIds: string[]) => Promise<void>（PATCH /sessions/{id}/queue/reorder，204 无响应体；ids 全量有序；422 QUEUE_ORDER_MISMATCH）']
    - contract: updateSessionQueueEntry
      needs: ['(sessionId: string, entryId: string, prompt: string) => Promise<SessionQueueEntry>（PATCH /sessions/{id}/queue/{entry_id}，200 返回更新后条目；409 TASK_WAKEUP 条目 / 422 空/超长）']
    - contract: dispatchNowSessionQueueEntry
      needs: ['(sessionId: string, entryId: string) => Promise<{ interrupted: boolean }>（POST /sessions/{id}/queue/{entry_id}/dispatch-now；409 会话非 active）']
allowed_paths:
  - frontend/src/hooks/use-message-queue.ts
provides:
  - contract: useMessageQueue 三方法
    fields: ['reorderEntry(ids: string[]): void', 'editEntry(id: string, prompt: string): void', 'dispatchNowEntry(id: string): void']
goal: >
  useMessageQueue 补 reorderEntry/editEntry/dispatchNowEntry 三方法（FR-04/05/06 的前端动作层），
  逐字对齐 removeEntry/retryEntry 的 load 刷新模式调 task-06 三支新 API client 后立即 load
  以服务端为准收敛（失败静默），为 task-08 bar / task-09 panel 提供排队三操作入口。
implementation:
  - "UseMessageQueueReturn 补三方法声明（JSDoc 注明对应 FR 与端点）：reorderEntry(ids: string[])——拖拽松手后的全量有序 id 列表（D-003 全量上传，永远整表上传不传部分序）；editEntry(id: string, prompt: string)——✎ 保存的新文本（FR-06）；dispatchNowEntry(id: string)——⚡ 立即发送（打断当前轮语义，D-001/FR-05，pending 与 failed 条目均可用）"
  - "从 @/lib/daemon 补导入三 client：reorderSessionQueue / updateSessionQueueEntry / dispatchNowSessionQueueEntry（调用前 grep 确认导出存在——task-06 合入后；不许编造方法名）"
  - "三实现逐字照搬 removeEntry/retryEntry 既有模式（use-message-queue.ts:136-158）：sessionId === \"\" 预会话守卫直接 return；void api(...).catch(静默注释).then(() => load(sessionId)) 三段式——API 失败不抛给调用方、一律 load 以服务端为准（R-02 拖拽 vs 派发竞态：落手瞬间条目恰被派发删除 → 后端 422 QUEUE_ORDER_MISMATCH → catch 静默 + load 后条目已消失自然收敛，不弹错不回滚本地）"
  - "editEntry 的 409（TASK_WAKEUP 系统通知条目——前端 bar 已隐藏其 ✎，此处 409 属双保险）/ 422（空/超 8000）与 dispatchNowEntry 的 409（会话非 active）同走静默 + load（不向 bar/panel 传播错误，UI 状态只由服务端 load 结果驱动）"
  - "dispatchNowEntry 不消费响应 interrupted 字段（R-04：空闲分支服务端当场派发成功即删行，响应无条目体；忙时打断后接力派发是既有终态钩子链路）——UI 收敛统一依赖 SSE queue_changed（task-09 接线）+ 本方法 then 的 load"
  - "return 对象补三方法；文件头注释块同步补 2026-08-31-session-queue-ux 段落（CLAUDE.md 规则 18 注释与实现一致）"
acceptance:
  - "cd frontend && pnpm exec tsc --noEmit 0 错误"
  - "三方法签名与 provides 一致，行为对齐 removeEntry 模式：调 API → 无论成败均 load 刷新 → 不向调用方抛错（方法级行为断言归 task-10）"
  - "既有行为零回归：removeEntry/retryEntry/refresh/5s 轮询/epoch 丢弃逐字未动，QueueEntry 结构未动；cd frontend && pnpm test -- src/hooks/__tests__/use-message-queue.test.ts 既有用例全绿（本卡纯增量）"
verify:
  - "cd frontend && pnpm exec tsc --noEmit"
  - "cd frontend && pnpm test -- src/hooks/__tests__/use-message-queue.test.ts"
constraints:
  - "仅改 frontend/src/hooks/use-message-queue.ts；不写新测试、不改既有测试（三方法用例与既有用例适配全归 task-10）"
  - "不动 QueueEntry 结构与既有方法/轮询/epoch 逻辑（load 刷新 + 静默 catch 模式照搬，不发明新状态机）"
  - "零新依赖、不引 react-query（文件头既有铁律：dialog 模式无 QueryClientProvider，纯 useState + fetch）"
  - "API 失败一律静默 + load（R-02/R-04）：不弹 UI 错误、不本地造 failed 态（failed 只来自服务端 load 结果）"
  - "代码风格遵循 .sillyspec/docs/SillyHub/scan/CONVENTIONS.md；注释中文对齐既有文件"
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
