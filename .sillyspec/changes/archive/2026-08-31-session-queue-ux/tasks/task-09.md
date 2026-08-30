---
id: task-09
title: 'session-panel 接线——SSE onQueueChanged → refresh() + onReorder/onEdit/onDispatchNow 回调 + 队列 API 错误静默'
title_zh: 'session-panel 接线——SSE onQueueChanged → refresh() + onReorder/onEdit/onDispatchNow 回调 + 队列 API 错误静默'
author: 'qinyi'
created_at: 2026-08-31 04:15:00
priority: P0
depends_on: ['task-06', 'task-07', 'task-08']
blocks: []
requirement_ids: [FR-03, FR-04, FR-05, FR-06]
decision_ids: [D-001@v1, D-003@v1]
provides:
  - contract: session-panel 队列接线
    fields:
      - 'SSE onQueueChanged → useMessageQueue.refresh()'
      - 'bar 三回调透传 hook 三方法'
      - '队列 API 错误静默（对齐 hook catch 模式）'
expects_from:
  task-06:
    - contract: SessionStreamHandlers.onQueueChanged
      needs: ['可选 handler onQueueChanged?(event: SessionStreamEnvelope): void——lib/daemon.ts streamSession envelope switch 新增 queue_changed case 分发（不入 run_id 白名单）']
  task-07:
    - contract: useMessageQueue 三方法
      needs: ['reorderEntry(ids: string[]): void', 'editEntry(id: string, prompt: string): void', 'dispatchNowEntry(id: string): void']
  task-08:
    - contract: MessageQueueBarProps 三回调
      needs: ['onReorder(ids: string[]): void', 'onEdit(id: string, prompt: string): void', 'onDispatchNow(id: string): void']
allowed_paths:
  - frontend/src/components/daemon/session-panel.tsx
goal: >
  session-panel 双模式（page/dialog）接线收口：SSE queue_changed → onQueueChanged →
  队列 refresh()（A3 即时刷新，5s 轮询降级兜底）+ MessageQueueBar 三回调
  （onReorder/onEdit/onDispatchNow）接 useMessageQueue 三方法，打通拖拽/⚡/✎ 的
  端到端前端链路（A4/A5/A6 前端部分）。
implementation:
  - "dialog 模式：useMessageQueue 解构（session-panel.tsx:4043）补 reorderEntry/editEntry/dispatchNowEntry；establishStream 的 connGuard.tapStreamHandlers handlers（:4104-4106，onTurnStarted 已挂 queueRefreshRef 先例 :4109）补 onQueueChanged: () => queueRefreshRef.current?.()——FR-03：后端入队/派发/删除/失败/reordered/edited/dispatch_now 各动作均发 queue_changed，事件驱动立即 load 不等 5s 轮询；SSE 与轮询双源并发由 hook 既有 epoch 丢弃兜底（RISK-5）"
  - "dialog 模式 MessageQueueBar 挂载（:5417）补三 props：onReorder={(ids) => void reorderEntry(ids)}、onEdit={(id, prompt) => void editEntry(id, prompt)}、onDispatchNow={(id) => void dispatchNowEntry(id)}（onRemove 的 attachmentMetaRef 附件镜像清理与 onRetry 既有逻辑逐字保留）"
  - "page 模式：useMessageQueue 解构（:2316）补 refresh 与三方法；建流 effect 的 tapStreamHandlers handlers（:1501-1503）补 onQueueChanged: () => refresh()——effect 闭包在渲染后才执行，hook 声明（:2316）晚于 effect 注册无运行时问题；若 ESLint no-use-before-define 拦截，照 dialog 模式 queueRefreshRef（:3988-3989）ref 先例解耦；既有 onTurnStarted/onTurnCompleted 的 invalidateQueries([\"agentSessionQueue\", sessionId])（:1507/:1621 等）保留不动"
  - "page 模式 MessageQueueBar 挂载（:3587）同样补三回调（onRemove 附件镜像清理保留）"
  - "错误静默边界（tasks.md「队列 API 错误静默」）：三方法 API 失败已在 hook 内 catch 静默 + load（task-07）；panel 层不新增错误提示/toast（队列操作不打断聊天主流程）；onQueueChanged 只触发刷新不弹任何 UI"
  - "头注释与两处挂载点内联注释同步（CLAUDE.md 规则 18：注明 2026-08-31-session-queue-ux SSE 接线与三回调）"
acceptance:
  - "A3（FR-03 前端部分）：后端任一 queue_changed 事件到达后，page 与 dialog 两模式队列条立即 refresh（不等 5s 轮询）；不传/不触发时无副作用（onQueueChanged 为可选 handler）"
  - "A4/A5/A6 前端链路：bar 拖拽松手 → reorderEntry 全量上传（D-003）；✎ 保存 → editEntry；⚡ → dispatchNowEntry（D-001 打断语义）——两模式挂载点均已接线（接线正确性由 task-10 panel 用例 + 手动冒烟覆盖）"
  - "既有零回归：turn_started/turn_completed 刷队列、SSE 断线重连与连接横幅（tapStreamHandlers 包装语义逐字保留）、onRemove 附件镜像清理路径全部不动；近邻用例 session-panel-connection / session-panel-ctx-tokens 全绿"
  - "cd frontend && pnpm exec tsc --noEmit 0 错误"
verify:
  - "cd frontend && pnpm exec tsc --noEmit"
  - "cd frontend && pnpm test -- src/components/daemon/__tests__/session-panel-connection.test.tsx src/components/daemon/__tests__/session-panel-ctx-tokens.test.tsx"
  - "手动冒烟（dev 环境，有排队条目时）：拖拽换位 / ⚡ / ✎ 保存各操作一次，确认队列条即时（SSE）收敛、无错误弹窗；后端动作（另一端删除条目）本端 5s 内即时反映"
constraints:
  - "仅改 frontend/src/components/daemon/session-panel.tsx；不写/不改测试（daemon.test queue_changed 分发用例与 panel 接线用例归 task-10）；不动 lib/daemon.ts 与 use-message-queue.ts（本卡是契约消费方，缺陷记录回报不顺手改）"
  - "page 与 dialog 两模式必须同批接线（只接一半=功能只在半边 UI 生效）"
  - "既有 SSE handlers 语义逐字保留（tapStreamHandlers 包装、游标推进、重连等行为不动）；只新增 onQueueChanged 一条分发，不重构建流逻辑"
  - "不引入新组件/新依赖/新样式（视觉已由 task-08 bar 消化）"
  - "代码风格遵循 .sillyspec/docs/SillyHub/scan/CONVENTIONS.md；注释中文"
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
