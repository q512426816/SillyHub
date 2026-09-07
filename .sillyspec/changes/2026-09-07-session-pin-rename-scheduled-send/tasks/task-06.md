---
id: task-06
title: 'backend-tests-pin-rename-scheduled-send'
title_zh: 'backend 测试——pin/rename、scheduled CRUD、sweeper 四分支'
author: 'qinyi'
created_at: 2026-09-07 23:32:39
priority: P0
depends_on: ['task-02', 'task-03', 'task-04']
blocks: []
requirement_ids: [FR-01, FR-02, FR-03, FR-04, FR-05, FR-06]
decision_ids: [D-001@v1, D-003@v1]
allowed_paths:
  - backend/app/modules/daemon/tests/test_session_pin_rename.py
  - backend/app/modules/daemon/tests/test_scheduled_messages_crud.py
  - backend/app/modules/daemon/tests/test_scheduled_send_sweeper.py
target_files:
  - NEW:backend/app/modules/daemon/tests/test_session_pin_rename.py
  - NEW:backend/app/modules/daemon/tests/test_scheduled_messages_crud.py
  - NEW:backend/app/modules/daemon/tests/test_scheduled_send_sweeper.py
goal: >
  补三份后端测试文件锁定置顶/重命名与定时发送行为——幂等、归属 404、
  排序置顶组内最前、参数校验、SSE publish、scheduled CRUD 边界与
  sweeper 四分支派发（含 queue_full），作为 task-02/03/04 的验收证据。
implementation:
  - test_session_pin_rename.py——pin/unpin 幂等（已置顶再 pin 仍 204 不更新时间戳）、非属主/不存在 404 不泄露存在性、置顶行排组内最前且多置顶按最近活跃、rename strip 后空/超 255 字 422、三操作均断言 publish_sessions_changed 广播（照既有 mocked_redis 先例）
  - test_scheduled_messages_crud.py——创建校验（dispatch_at 早于 now+60s 422、prompt 与附件全空 422、终态/软删会话 409、非归属 404）、列表全状态按 dispatch_at 升序、取消 pending 204 且写 cancelled_at、取消非 pending 409
  - test_scheduled_send_sweeper.py——直调 scheduled_send_sweep_once 注入 AsyncSession（照 test_session_reconnect_sweep.py 范式）四分支各独立用例——空闲到 dispatched+dispatched_at、忙轮消息落 agent_session_queued_messages 后条目 dispatched、终态/软删置 failed 且 error_code=session_inactive、忙轮且队列满 5 置 failed 且 error_code=queue_full；另测单条 inject 抛 AppError 不连坐同轮其它条目、dispatched 条目二跑不重发
  - 造数照既有 daemon tests 风格——_make_user/_make_runtime/_make_session helper、mocked_hub、mocked_redis、AppError 按 status_code 断言；不依赖 30s 循环时序
acceptance:
  - 三个新测试文件全绿，未改动任何既有测试文件与实现源码
  - sweeper 四分支（含 queue_full）+ 失败隔离 + 幂等不重发均有独立断言
  - pin/unpin/rename 均断言 SSE publish（reason=status_changed）
verify:
  - cd backend && uv run pytest app/modules/daemon/tests/test_session_pin_rename.py app/modules/daemon/tests/test_scheduled_messages_crud.py app/modules/daemon/tests/test_scheduled_send_sweeper.py -q --no-cov
constraints:
  - 禁跑全量测试（CLAUDE.md 规则 0），只跑上述三文件，全局回归归 task-10
  - 测试失败先判实现 bug 并回报，禁止改断言迁就（CLAUDE.md 规则 9）
  - 时间造数一律 UTC tz-aware，比较在 Python 侧算好绑定（对齐 sweep.py NFR 惯例）
---

<!-- 骨架由 sillyspec taskcard 生成（LF 行尾 + frontmatter 已闭合 + 硬校验 9 字段齐全）。
     用 Edit tool 填充上方占位符（allowed_paths/goal/implementation/acceptance/verify/constraints 等），
     勿用 Write 整文件重写——会引入 CRLF 行尾/漏闭合 ---/漏字段回归。
     ⚠️ plan --done 硬校验会拦截未替换的占位符（FR-XX / D-XXX / src/example/file.ts /
     一句话说明这个 task / 具体步骤 1 / 可验证的验收条件 1 / 边界约束 1）——占位符视同缺字段。
     target_files 格式（可选，对账用精确文件级意图声明，与 allowed_paths 语义不同）：
                    精确文件路径（仓根相对、正斜杠），当前不存在、将由本 task 新建的文件加
                    NEW: 前缀（如 NEW:src/foo.js）；禁 glob（src/**）、禁目录前缀（src/dir/）、
                    禁绝对路径；无明确文件级意图时保留 [] 占位行不动。
     可选字段按需插进上方 frontmatter（规则见 taskcard-rules）：
     repo:          仅跨仓 task 填（local.yaml repos: 注册的仓 key；缺省=main。allowed_paths 相对该仓根写，
                    禁止带仓库名前缀/绝对路径——review 对账按仓根相对路径匹配，带前缀永不命中）
     provides:      仅当本 task 给其他 task 提供接口/DTO/响应时填
     expects_from:  仅当本 task 消费其他 task 的契约时填
     related_tests: 仅当本 task 改动导致既有测试断言失效时填（测试路径须同时进 allowed_paths） -->
