---
id: task-12
title: 'patrol 孤儿子会话扫描补收口'
title_zh: 'patrol 孤儿子会话扫描补收口'
author: 'qinyi'
created_at: 2026-08-25 20:57:40
priority: P1
depends_on: ['task-10']
blocks: []
requirement_ids: [FR-06]
decision_ids: [D-001@v1]
allowed_paths:
  - backend/app/modules/agent/patrol.py
  - backend/app/modules/agent/tests/test_worker_subsession_patrol_orphan.py
  - backend/app/modules/agent/tests/test_patrol.py
expects_from:
  - 'task-01 mission_worker_sessions(mission_id) 一层枚举分身子会话——孤儿扫描的子会话枚举来源（独立查询不复用 _active_mission_ids）'
  - 'task-08 is_worker_complete / mission_derive_status 单一真相源口径——「子会话仍活跃」判定与活跃 turn 词表（agent.model.ACTIVE_RUN_STATUSES）同源，禁 patrol 另写判据'
goal: >
  patrol 新增孤儿子会话扫描职责——独立查询（方向与 _active_mission_ids 相反）找出
  mission 已 converged/cancelled 但分身子会话仍活跃（pending/active/reconnecting）的行，
  逐个补发 SessionService.end_session 收口；兜底 task-10 converge 批量收口的 best-effort
  部分失败与 cancel 链漏网，实现零孤儿（FR-06 / design §5.D 末行 + 风险表）。
implementation:
  - '独立查询——选 converged_at 非空 OR cancelled_at 非空的终态 mission，经 mission_worker_sessions 取其 status ∈ (pending, active, reconnecting) 的子会话；查询自带 limit（对齐 ACTIVE_MISSION_LIMIT=100 惯例）防 mission 积压单轮过载，不碰活跃 mission'
  - '补收口——逐个 SessionService(self._session).end_session(子会话 id, user_id=子会话属主即 session.user_id, reason=mission_terminal_orphan)；end_session 幂等（已 ended/failed 早退）且含 SESSION_END best-effort 链，直接复用'
  - 'run_once 挂职责⑤——独立 try/except 互不阻断（对齐既有四职责异常隔离模式）；PATROL_COUNT_KEYS 追加 orphan_sessions_ended 计数键，round_done 日志随之携带'
  - '新增 test_worker_subsession_patrol_orphan.py——converged/cancelled 两形态命中补发 end_session、活跃 mission 子会话不动、无子会话存量 mission 零命中、单个收口失败不阻断其余；test_patrol.py 既有断言（计数键动态构造）不破'
acceptance:
  - 'mission 终态 + 子会话活跃 → 扫描轮内补发 end_session，子会话 ended + lease completed + SESSION_END 已发'
  - '活跃 mission 的子会话绝不被收口；存量 mission（无子会话）扫描零命中零行为变化'
  - '孤儿扫描抛错不影响同轮收敛兜底/重派/僵尸/worker 恢复职责（异常隔离保持）'
  - 'task-10 收口部分失败场景（单会话 end 异常）由下一轮扫描补齐'
verify:
  - cd backend && uv run pytest app/modules/agent/tests/test_worker_subsession_patrol_orphan.py app/modules/agent/tests/test_patrol.py -q --no-cov
  - cd backend && uv run pytest app/modules/agent -q --no-cov -n auto
  - cd backend && uv run ruff check app/modules/agent/patrol.py && uv run mypy app/modules/agent/patrol.py
constraints:
  - '独立查询不复用 _active_mission_ids（那是活跃 mission 名单，方向相反）；不改动 _active_mission_ids 与既有四职责行为'
  - '收口复用 SessionService.end_session（P0-2 SESSION_END 链），禁止直接翻 DB 会话状态或重造 kill 逻辑'
  - '判死/awaiting_input 超时收敛判据不在本卡改（mission_derive_status 换算已由 task-09 完成）'
  - '扫描 best-effort——单个收口异常 log.warning 继续不阻断 patrol 主循环；更大范围回归归 task-15'
---

<!-- 骨架由 sillyspec taskcard 生成（LF 行尾 + frontmatter 已闭合 + 硬校验 9 字段齐全）。
     用 Edit tool 填充上方占位符（allowed_paths/goal/implementation/acceptance/verify/constraints 等），
     勿用 Write 整文件重写——会引入 CRLF 行尾/漏闭合 ---/漏字段回归。
     ⚠️ plan --done 硬校验会拦截未替换的占位符（FR-XX / D-XXX / src/example/file.ts /
     一句话说明这个 task / 具体步骤 1 / 可验证的验收条件 1 / 边界约束 1）——占位符视同缺字段。
     可选字段按需插进上方 frontmatter（规则见 taskcard-rules）：
     provides:      仅当本 task 给其他 task 提供接口/DTO/响应时填
     expects_from:  仅当本 task 消费其他 task 的契约时填
     related_tests: 仅当本 task 改动导致既有测试断言失效时填（测试路径须同时进 allowed_paths） -->
