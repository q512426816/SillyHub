---
id: task-03
title: 'dispatch_queued_messages 循环化（连续失败 ≥2 停；非终态非 active 保持 pending；终态 {ended,failed} 才批量 fail）+ SessionService 新增 _fire_background_task helper + confirm_session_reconnected active commit 点后 fire 派发钩子'
title_zh: 'dispatch_queued_messages 循环化（连续失败 ≥2 停；非终态非 active 保持 pending；终态 {ended,failed} 才批量 fail）+ SessionService 新增 _fire_background_task helper + confirm_session_reconnected active commit 点后 fire 派发钩子'
author: 'qinyi'
created_at: 2026-08-31 04:15:00
priority: P0
depends_on: [task-02]
blocks: [task-04]
requirement_ids: [FR-01, FR-02]
decision_ids: [D-004, D-005, D-008, D-010]
allowed_paths:
  - backend/app/modules/daemon/session/service.py
provides:
  - contract: dispatch_queued_messages 循环化 + confirm_session_reconnected 恢复钩子
    fields:
      - 连续失败 ≥2 即停
      - 非终态非 active 保持 pending
      - 终态 {ended, failed} 批量 fail
      - active commit 后 fire 派发
      - SessionService._fire_background_task helper（对齐 run_sync/service.py:391 模式）
expects_from:
  - 'task-02: 队首排序键 ORDER BY position, created_at（dispatch 循环每轮取队首用）'
goal: >
  dispatch_queued_messages 从「取一条、失败即停」改为循环派发（连续失败≥2 停、
  非终态非 active 保持 pending、终态才批量 fail），并在 confirm_session_reconnected
  翻 active 的 commit 点后 fire 派发钩子，消除队头永久滞留（P1/P3 根因，FR-01/02）。
implementation:
  - dispatch_queued_messages（session/service.py:4292-4389）外层 while 循环，每轮开头重取会话行锁（with_for_update）后分支：
  - 会话终态（status ∈ {ended, failed}，会话状态词表无 cancelled，D-010）→ _fail_pending_queued_messages（:4167）+ commit + return（现状保留）
  - 非 active 且非终态（pending/reconnecting/suspended）→ rollback + return，pending 原样保留（FR-02/D-005——替换现 :4308-4313 非 active 即全量 fail 的分支，P3 根因）
  - await _get_current_run(session.id) 非 None → rollback + return（现状，会话忙）
  - 取队首 pending（ORDER BY position, created_at，task-02 排序键）→ page_context/attachment_ids 宽容解析（现状 :4333-4344）→ _inject_into_session
  - 派发成功：删行 + queue_changed(action=dispatched)（现状 :4377-4389）→ 连续失败计数清零，继续下一轮循环（run 已活跃则下轮 current_run 分支自然退出）
  - AppError 失败：条目 failed 留队 + queue_changed(action=failed)（现状 :4356-4372）→ 连续失败计数 +1；计数 ≥2 退出循环（R-05/D-004），否则继续下一条（瞬态单点失败不拖队）
  - SessionService 新增类属性 _background_tasks: set[asyncio.Task] 与 _fire_background_task/_on_background_task_done（逐字对齐 run_sync/service.py:375-419：asyncio.create_task + 强引用防 GC + done_callback 记异常，D-008——run_sync 不动）
  - confirm_session_reconnected（:4946）：session.status="active" commit（:5008）+ _publish_session_event/publish_sessions_changed/mark_ready 全部完成后、return "active" 前——先查该会话有无 pending 排队条目（select id ... limit 1，对齐 run_sync :1915-1927 先查后 fire 防空转），有才 self._fire_background_task(dispatch_next_queued_message(session_id))；dispatch 内部自查自弃（会话可能又翻非 active）；stale-lease（:4985）与幂等早退（:4999）路径不 fire
  - dispatch_next_queued_message 模块级函数（:6212，独立 DB session H1 模式）零改动复用
acceptance:
  - FR-01：会话空闲且多条 pending 时，单次 dispatch 调用连续派发至队空/会话忙/连续失败≥2（第一条成功后继续而非立即返回）
  - FR-02/D-005：status=reconnecting（或 suspended）时 dispatch 直接返回，全部 pending 保持 pending 不被批量转 failed；status=ended/failed 时仍批量 _fail_pending_queued_messages（现状不回归）
  - R-05/D-004：连续 2 条派发失败即停止本轮循环，剩余 pending 不被逐条转 failed 刷屏；成功一条后计数清零
  - D-008：confirm_session_reconnected 翻 active 的 commit 成功路径且有 pending 时 fire 恰一次派发后台任务；无 pending 不起任务（防空转）；run_sync/service.py 与 recover_session_after_daemon_restart（:4498）零改动
  - 单会话至多一个活跃 run 不变式保持（循环靠下轮 current_run 复查自然串行）
verify:
  - cd backend && uv run pytest app/modules/daemon/tests/test_session_queue.py app/modules/daemon/tests/test_session_recovery.py app/modules/daemon/tests/test_session_reconnect_sweep.py -q --no-cov
constraints:
  - 终态集合硬编码 {ended, failed}（D-010；以 agent/model.py 会话状态词表为准，无 cancelled，不得自造）
  - 恢复钩子只允许挂 confirm_session_reconnected 的 active commit 点之后（D-008；recover_session_after_daemon_restart 只置 reconnecting 从不翻 active，挂那里必空转——Grill 阻断项修正）
  - run_sync/service.py、daemon 侧（sillyhub-daemon）零改动（D-007/D-008）；fire 必须复用 dispatch_next_queued_message 的独立 DB session 模式，不得复用请求级 session
  - 不做常驻后台 sweeper（NG-03）；不改入队/MAX+1/排序键（task-02 已落）；不加新端点/DTO（task-04 范围）
  - 后台任务异常经 done_callback 记日志，不得影响已 commit 的 active 翻转事务
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
