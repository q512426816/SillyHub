---
id: task-04
title: '三端点 + DTO + 事件——PATCH /queue/reorder（先注册；ids 全集校验 422 QUEUE_ORDER_MISMATCH）+ PATCH /queue/{entry_id}（1..8000；TASK_WAKEUP 前缀 409；failed 重置 pending+清 error+尝试派发）+ POST /queue/{entry_id}/dispatch-now（置队首+忙时 _send_interrupt_control 抽取复用/空闲直发；非 active 409；响应 {interrupted}）+ queue_changed 补发（reordered/edited/dispatch_now）+ 门面委托 + SessionQueueEntry.position'
title_zh: '三端点 + DTO + 事件——PATCH /queue/reorder（先注册；ids 全集校验 422 QUEUE_ORDER_MISMATCH）+ PATCH /queue/{entry_id}（1..8000；TASK_WAKEUP 前缀 409；failed 重置 pending+清 error+尝试派发）+ POST /queue/{entry_id}/dispatch-now（置队首+忙时 _send_interrupt_control 抽取复用/空闲直发；非 active 409；响应 {interrupted}）+ queue_changed 补发（reordered/edited/dispatch_now）+ 门面委托 + SessionQueueEntry.position'
author: 'qinyi'
created_at: 2026-08-31 04:15:00
priority: P0
depends_on: [task-03]
blocks: [task-05, task-06]
requirement_ids: [FR-03, FR-04, FR-05, FR-06]
decision_ids: [D-001, D-003, D-007, D-009]
allowed_paths:
  - backend/app/modules/daemon/session/service.py
  - backend/app/modules/daemon/service.py
  - backend/app/modules/daemon/schema.py
  - backend/app/modules/daemon/router.py
provides:
  - contract: 'reorder/update/dispatch-now 三门面方法 + SessionQueueEntry.position DTO + queue_changed 补发'
    fields:
      - '422 QUEUE_ORDER_MISMATCH'
      - 'edit 空文本/超长 422 与 TASK_WAKEUP 前缀 409'
      - 'dispatch-now {interrupted} 与非 active 409'
      - '404 条目不存在'
  - contract: 'PATCH /api/daemon/sessions/{session_id}/queue/reorder'
    fields:
      - '请求体 { entry_ids: list[uuid] }（全量有序，D-003）'
      - '响应 204；422 QUEUE_ORDER_MISMATCH'
  - contract: 'PATCH /api/daemon/sessions/{session_id}/queue/{entry_id}'
    fields:
      - '请求体 { prompt } 1..8000 字'
      - '响应 200 { entry: SessionQueueEntry }；404/422/409'
  - contract: 'POST /api/daemon/sessions/{session_id}/queue/{entry_id}/dispatch-now'
    fields:
      - '响应 200 { interrupted: bool }（D-001）'
      - '404 条目不存在；409 会话非 active'
  - contract: 'SessionQueueEntry DTO（router._queue_entry_dto）补 position: int（D-002）'
    fields:
      - 'position 字段进入 openapi.json 与生成类型'
      - 'queue_changed 事件补发 action ∈ {reordered, edited, dispatch_now}'
expects_from:
  - 'task-02: AgentSessionQueuedMessage.position 字段 + 行锁内 MAX+1（置队首/全量重写 position 依赖）'
  - 'task-03: dispatch_queued_messages 循环入口（edit 重置后与 dispatch-now 空闲分支复用）'
goal: >
  新增 reorder / edit / dispatch-now 三个队列操作端点与 DTO（含错误类、门面委托、
  queue_changed 事件补发、SessionQueueEntry.position），落地 FR-03/04/05/06 的
  后端接口契约（dispatch-now=打断当前轮立即派发，D-001）。
implementation:
  - "backend/app/modules/daemon/schema.py：新增 QueueReorderRequest{entry_ids: list[uuid]}、QueueEntryUpdateRequest{prompt: str = Field(min_length=1, max_length=8000)}（max_length 对齐 SessionInjectRequest :279 的 8000）、QueueDispatchNowResponse{interrupted: bool}"
  - session/service.py 新增错误类（对齐 :416-454 既有命名/注释风格）：DaemonSessionQueueOrderMismatch（code="HTTP_422_DAEMON_SESSION_QUEUE_ORDER_MISMATCH"，http_status=422）与编辑不支持类（TASK_WAKEUP 条目，http_status=409）
  - session/service.py reorder_queued_messages(session_id, entry_ids, user_id)：_get_owned_session_for_update 行锁（R-01）内取该会话全部 pending+failed 条目；entry_ids 集合 != 现有条目 id 全集（多/少/含他 session 条目）→ 422 MISMATCH（D-003 全量上传，不允许部分重排）；按列表序重写 position=0..n-1；commit + _publish_session_event queue_changed(action="reordered")
  - session/service.py update_queued_message(session_id, entry_id, prompt, user_id)：行锁内取条目（None → DaemonSessionQueueEntryNotFound 404）；entry.prompt.startswith(TASK_WAKEUP_PROMPT_PREFIX)（:147 常量）→ 409（D-009，防 like 去重匹配失配）；改 prompt + updated_at；status=="failed" → pending + error_msg=None；commit + queue_changed(action="edited")；若重置过 failed → 复用 dispatch_queued_messages 尝试派发（对齐 retry :4279-4280 模式）
  - session/service.py dispatch_queued_message_now(session_id, entry_id, user_id)：行锁内取条目（404）；session.status != "active" → DaemonSessionNotActive 409（终态/挂起均拒，与 interrupt :3934 同口径，D-001）；failed → pending + error_msg=None；本条 position 置队首（全量重写该会话队列 position，≤5 行，D-002）；commit + queue_changed(action="dispatch_now")；再判活跃 run：无 → await dispatch_queued_messages 同步派发本条（R-04，条目可能当场删行）→ 返回 interrupted=False；有 → _send_interrupt_control(session)（从 interrupt_session :3959-3994 抽出 runtime 解析 + ControlCommandService.enqueue_and_push(KIND_SESSION_INTERRUPT) 段为共用私有 helper，interrupt_session 改调它，行为不变）→ 返回 interrupted=True（置顶 commit 先于 interrupt，失败不回滚——R-03；控制指令三段式 WS 不通已落库待补拉不算异常，仅 DaemonRuntimeOffline 等真 AppError 向上抛）
  - backend/app/modules/daemon/service.py：门面新增 reorder_queued_messages/update_queued_message/dispatch_queued_message_now 三方法，委托模式对齐 :790-820 既有 list/delete/retry
  - 'router.py：SessionQueueEntry（:2082）与 _queue_entry_dto（:2095）补 position 字段（int）；注册三端点——PATCH /sessions/{session_id}/queue/reorder（204）必须先于 PATCH /sessions/{session_id}/queue/{entry_id} 声明（FastAPI 按注册顺序匹配，字面量 reorder 否则被 {entry_id} 路径参数捕获 → 422，design §5）；PATCH /queue/{entry_id} 返回 200，body 为 entry 键包裹的 _queue_entry_dto(entry) 产物（design §5 明确 entry 包裹键，区别于 retry 的裸 DTO）；POST /queue/{entry_id}/dispatch-now 返回 QueueDispatchNowResponse；错误经 AppError http_status 机制自然映射'
acceptance:
  - reorder：全量一致 → 204 且 position 按上传序 0..n-1 重写、发 queue_changed(action=reordered)；ids 多/少/错 → 422 code HTTP_422_DAEMON_SESSION_QUEUE_ORDER_MISMATCH（FR-04/D-003）
  - edit：成功 → 200 且 body.entry 为 SessionQueueEntry（含 position）；空文本/超 8000 → 422；TASK_WAKEUP 前缀条目 → 409；failed 条目保存后 status=pending、error_msg=None 且触发一次派发尝试（FR-06/D-009）
  - dispatch-now：条目 position 变为会话最小；有活跃 run → interrupted=true 且经控制指令下发 SESSION_INTERRUPT（daemon 零改动，D-007）；无活跃 run → interrupted=false 且当场派发（条目可能已删行）；会话非 active → 409；条目不存在 → 404（FR-05/D-001/R-03/R-04）
  - GET /sessions/{id}/queue 列表项含 position 且按 position 升序返回（消费 task-02 排序键）
  - reordered/edited/dispatch_now 三动作均补发 queue_changed；既有 enqueued/deleted/failed/dispatched/merged 事件点无回归（FR-03）
  - interrupt 端点行为不变（_send_interrupt_control 抽取为纯重构，无语义漂移）
verify:
  - cd backend && uv run pytest app/modules/daemon/tests/test_session_queue.py app/modules/daemon/tests/test_session_router.py app/modules/daemon/tests/test_ws_hub_session_control.py -q --no-cov
  - cd backend && uv run python -c "from app.main import app; spec = app.openapi(); ps = spec['paths']; assert '/api/daemon/sessions/{session_id}/queue/reorder' in ps and '/api/daemon/sessions/{session_id}/queue/{entry_id}/dispatch-now' in ps; print('routes ok')"
constraints:
  - 路由注册顺序铁律：/queue/reorder 先于 /queue/{entry_id}（design §5；漏写会被路径参数吞掉字面量）
  - 三个写操作全走 _get_owned_session_for_update 会话行锁（R-01）；reorder/dispatch-now 的 position 重写只在锁内做（≤5 行全量重写，D-002）
  - dispatch-now 置顶 commit 必须先于 interrupt 发送，interrupt 失败不回滚置顶（R-03）；TASK_WAKEUP 条目 409 双保险（D-009，前端隐藏 ✎ 归 task-08）
  - 不改 sillyhub-daemon（D-007）；edit 仅改 prompt 文本，附件/配置快照不动（NG-01）；prompt 上限 8000 对齐 SessionInjectRequest
  - 不写新测试文件（test_session_queue_actions.py 归 task-05）；本卡仅保证既有排队/路由用例不回归
  - SessionQueueEntry 响应字段变化会进 openapi.json——gen:types 产物提交归 task-06，本卡不跑前端命令
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
