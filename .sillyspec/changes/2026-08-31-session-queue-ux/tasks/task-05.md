---
id: task-05
title: 'backend 测试——新 test_session_queue_actions.py（MAX+1/reorder 全量与 MISMATCH/edit 三态/409/dispatch-now 空闲与忙时 mock hub/循环化连续失败上限与瞬态续派/非 active 保持 pending/confirm 恢复钩子）+ 既有排队用例适配'
title_zh: 'backend 测试——新 test_session_queue_actions.py（MAX+1/reorder 全量与 MISMATCH/edit 三态/409/dispatch-now 空闲与忙时 mock hub/循环化连续失败上限与瞬态续派/非 active 保持 pending/confirm 恢复钩子）+ 既有排队用例适配'
author: 'qinyi'
created_at: 2026-08-31 04:15:00
priority: P0
depends_on: ['task-02', 'task-03', 'task-04']
blocks: []
requirement_ids: [FR-01, FR-02, FR-04, FR-05, FR-06]
decision_ids: [D-002, D-003, D-004, D-005, D-008, D-009, D-010]
expects_from:
  task-02:
    - contract: AgentSessionQueuedMessage.position 列 + 入队行锁内 MAX+1
      needs: ['list/dispatch 排序键 ORDER BY position, created_at']
  task-03:
    - contract: dispatch_queued_messages 循环化 + confirm_session_reconnected 恢复钩子
      needs: ['连续失败 ≥2 即停', '非终态非 active 保持 pending', '终态 {ended, failed} 批量 fail', 'active commit 后 fire 派发']
  task-04:
    - contract: reorder/update/dispatch-now 三门面方法 + SessionQueueEntry.position DTO + queue_changed 补发
      needs: ['422 QUEUE_ORDER_MISMATCH', 'edit 空文本/超长 422 与 TASK_WAKEUP 前缀 409', 'dispatch-now {interrupted} 与非 active 409', '404 条目不存在']
allowed_paths:
  - backend/app/modules/daemon/tests/test_session_queue_actions.py
  - backend/app/modules/daemon/tests/test_session_queue.py
  - backend/app/modules/daemon/tests/test_session_user_preamble.py
goal: >
  为 Wave 2-4 的全部新排队语义补 backend 行为锁（design §8）：新建
  test_session_queue_actions.py 覆盖 position MAX+1、reorder 全量校验、edit 三态
  与 409、dispatch-now 空闲/忙时（mock hub）、dispatch 循环化（连续失败上限/
  瞬态续派/非 active 保持 pending）、confirm_session_reconnected 恢复钩子，
  并把既有排队用例（test_session_queue.py、test_session_user_preamble.py）
  适配到 position 排序与循环派发语义——锁死 RISK-1 派发核心回归。
implementation:
  - "新文件 fixture 范式照抄 test_session_queue.py（_create_user/_create_runtime/_mock_hub/mocked_hub patch app.modules.daemon.ws_hub.get_daemon_ws_hub、mocked_redis patch session.service.get_redis、_setup_busy_session、_queue_rows、_finish_run），文件头 docstring 写明 2026-08-31-session-queue-ux / design §8 / FR-01~02+04~06 映射；服务层直调 DaemonService（同既有范式），不新建 conftest fixture"
  - "TestEnqueuePosition：忙轮连入 3 条普通消息 → 断言 position 严格递增（MAX+1）；TASK_WAKEUP 通知 merge 路径复用既有 _wakeup_prompt 构造 → 仍 1 行且 position 不变（task-02 契约回归）"
  - "TestReorder：传全量 ids（乱序）→ 行 position 按传入序重写 0..n-1 且 list_queued_messages 返回序随之变化；多一个/少一个/错 id → 断言 task-04 定义的全集不匹配领域异常（router 侧 422 QUEUE_ORDER_MISMATCH 语义）"
  - "TestEditEntry：改 prompt 成功（prompt/updated_at 变、attachment_ids/配置快照不动）；空文本与 8001 字 → 422 语义；TASK_WAKEUP 前缀条目 → 409 不支持编辑（D-009）；failed 条目编辑保存 → status 翻 pending + error_msg 清空 + 触发派发（mock hub 在线断言新 run 建立、行删除）；pending 条目编辑保持 pending 不派发"
  - "TestDispatchNow：空闲分支（首 turn 已完结、无活跃 run）→ 当场派发（行删、新 run prompt=条目 prompt、响应 interrupted=false）；忙时分支（_setup_busy_session 占用）→ 条目 position 置队首（其余顺移）+ mocked_hub.send_session_control 断言 interrupt 控制下发 + interrupted=true（终态钩子接力属既有集成链路，单测只锁指令在途语义）；会话 reconnecting/suspended 与终态 → 409；entry_id 不存在 → 404；failed 条目 → 先翻 pending 再走上述分支"
  - "TestDispatchLoop：队头失败后下一条继续派发（瞬态单点失败不拖队，第 1 条 failed 第 2 条成功新 run）；连续 2 次失败即退出循环（第 3 条保持 pending 不被连环转 failed，R-05/D-004）；会话 reconnecting（非终态非 active）→ 全部条目保持 pending 不动（FR-02/D-005，P3 回归锚）；会话 ended → pending 批量转 failed（D-010 终态集合 {ended, failed}，断言 cancelled 不触发批量 fail）"
  - "TestReconnectHook：confirm_session_reconnected 翻 active 并 commit 后断言派发被 fire 一次（对齐 test_run_sync_fire_background_task.py 的 _fire_background_task 验证手法：spy 断言被调度、强引用持有）；队列无 pending 时派发自查自弃不抛（D-008 锚点=confirm 的 active commit 点，非 recover_session_after_daemon_restart）"
  - "既有适配（test_session_queue.py）：_queue_rows 相关断言补 position 升序（或查询改 ORDER BY position）；test_dispatch_failure_marks_entry_failed 在循环化后单条失败语义确认（连续失败计数 1 < 2、队列仅 1 条 → 循环自然结束，failed 留队断言不变）；test_session_user_preamble.py 排队行断言补 position 存在性（防御性回归，忙轮排队 prompt 剥离断言不动）"
acceptance:
  - "cd backend && uv run pytest app/modules/daemon/tests/test_session_queue_actions.py app/modules/daemon/tests/test_session_queue.py app/modules/daemon/tests/test_session_user_preamble.py -q --no-cov 全绿"
  - "test_session_queue_actions.py 覆盖 design §8 列举的全部语义点且各有显式命名用例：入队 MAX+1 / reorder 全量与 MISMATCH / edit 空、超长、failed 重置+派发、TASK_WAKEUP 409 / dispatch-now 空闲直发与忙时置顶+interrupt（mock hub）/ 循环化连续失败上限、瞬态续派、非 active 保持 pending、终态批量 fail / confirm_session_reconnected 恢复钩子"
  - "既有两文件零用例删除、零跳过（skip/xfail）；适配仅限 position/循环化相关断言，排队/merge/retry 既有断言语义不动"
  - "git status 改动仅 allowed_paths 三个文件——不触 conftest.py 与业务代码；发现 Wave 2-4 实现缺陷时回报归属 task，不在测试里 mock 掉真实语义（CLAUDE.md 规则 9）"
  - "不写 Alembic 迁移用例（design §6：测试库走 create_all，迁移本体静态审查+部署冒烟覆盖）"
verify:
  - 'cd backend && uv run pytest app/modules/daemon/tests/test_session_queue_actions.py app/modules/daemon/tests/test_session_queue.py app/modules/daemon/tests/test_session_user_preamble.py -q --no-cov'
constraints:
  - "禁止跑全量测试（CLAUDE.md 规则 0）：仅跑 verify 枚举的三个相关文件，命令形态对齐 local.yaml daemon 模块（uv run pytest -q --no-cov），文件级直跑不加 -n auto"
  - "测试遵循既有范式：fixtures/断言风格对齐 test_session_queue.py（服务层直调 + mocked_hub/mocked_redis），注释风格对齐 test_session_review_fixes.py（文件头列覆盖点与设计锚）"
  - "CLAUDE.md 规则 9：非测试逻辑有误禁止改测试凑绿——dispatch-now/循环化行为与 design §4/§7 不符时回 task-03/04 修实现"
  - "疑点即报不扩文件：confirm_session_reconnected 恢复钩子若波及 test_session_recovery.py / test_session_readiness.py / test_session_reopen.py / test_session_suspend.py（均不在本卡 allowed_paths），不擅自改，回报主代理裁定归属（hook 无 pending 应自查自弃，预期不受影响）"
  - "迁移本体不在 pytest 覆盖面（design §6）；position 语义全部经 create_all 建表路径验证"
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
