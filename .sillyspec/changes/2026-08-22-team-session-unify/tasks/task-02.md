---
id: task-02
title: 'derive-status awaiting-input extension with NULL guard'
title_zh: 'derive_status 兼容扩展——awaiting_input 档 + session_id NULL 守卫 + 判据矩阵全格单元测试'
author: 'qinyi'
created_at: 2026-08-22 03:35:53
priority: P0
depends_on: [task-01]
blocks: [task-08]
requirement_ids: [FR-08]
decision_ids: [D-009@v1, D-007@v2]
allowed_paths:
  - backend/app/modules/agent/mission.py
  - backend/app/modules/agent/tests/test_derive_status_matrix.py
provides:
  - contract: derive_status
    fields: [converged, has_session, session_active_turn]
    note: mission.py 纯函数新增 keyword-only 布尔入参（默认 False），按 design §5 判据矩阵落 awaiting_input 档；存量调用方（router.py:870 / finalizer.py:578 / orchestrator.py:614）不传新参时返回值逐字节不变；task-08 patrol 消费新档
  - contract: get_active_mission_for_session
    fields: [session_id]
    note: mission.py 新增辅助查询（design §6）——按 session_id 取活跃 mission（converged_at IS NULL 且 cancelled_at IS NULL）取最新一条，无活跃返回 None；task-03 预建 409 / task-04 inject 双标记 / task-05 mcp_tools 会话定位消费
expects_from: []
goal: >
  derive_status 按 design §5 Phase1 判据矩阵兼容扩展——新增 awaiting_input 档（仅
  session_id 非 NULL 的会话 mission 进入），存量 mission（session_id NULL）判定零回归
  （complete_lease 自动收敛依赖 derive∈{done,degraded}），并补 get_active_mission_
  for_session 辅助查询与矩阵全格单测（R-03）。
implementation:
  - 'mission.py derive_status（:29-54）签名加 keyword-only 入参 converged=False、has_session=False、session_active_turn=False；cancelled 位置参数不动；docstring 同步返回值清单与进档条件'
  - '判据按序落地（design §5 矩阵）——cancelled 置位→cancelled；无 role!=orchestrator 分身 run 且无主控轮回填→planning；任一 run（主控轮或分身）pending/running→running；全终态+未 converge+无会话活跃 turn+has_session→awaiting_input；其余按 completed/failed 组合落 degraded/done/failed'
  - 'NULL 守卫——has_session=False（存量 external/bootstrap mission）永不进 awaiting_input，保持原 done/degraded/failed 判定；converged 或 session_active_turn 置位时不进新档；_ACTIVE/_DONE/_FAILED 集合语义不动，awaiting_input 仅派生值不落库（design §8）'
  - 'mission.py 新增 get_active_mission_for_session(db, session_id)——WHERE session_id=X AND converged_at IS NULL AND cancelled_at IS NULL'
  - '新建 tests/test_derive_status_matrix.py 纯函数直测（AgentRun 对象构造即用不依赖 DB）——矩阵全格——cancelled / 空 runs→planning / 仅主控轮回填无分身 / 任一活跃→running / 全终态×converge×cancel×session_id NULL 与非 NULL×会话活跃 turn 有无全组合，逐格断言 awaiting_input、degraded、done、failed'
  - '存量组合逐格断言——has_session=False 各格输出与改动前一致（永不 awaiting_input），complete_lease 收敛依赖的 derive∈{done,degraded} 语义不回归'
acceptance:
  - design §5 判据矩阵全格（主控轮×分身×converge×cancel×session_id NULL 存量组合）单测通过
  - session_id NULL 的存量 mission 永不派生 awaiting_input——done/degraded/failed 保持原判定，complete_lease 自动收敛不回归
  - 会话 mission 全终态+未 converge+无活跃 turn→awaiting_input；converge 置位或有活跃 turn 时不进该档
  - 存量调用方不传新参时 derive_status 返回值与改动前一致；get_active_mission_for_session 可 import 且终态 mission 不返回
verify:
  - cd backend && uv run pytest app/modules/agent -q --no-cov --deselect app/modules/agent/tests/test_dispatch_metadata.py::test_build_claim_payload_propagates_bundle_fields --deselect app/modules/agent/tests/test_execution_context.py::test_get_execution_context_task_run
  - cd backend && uv run ruff check app/modules/agent/mission.py app/modules/agent/tests/test_derive_status_matrix.py
constraints:
  - derive_status 保持纯函数——converged、session 维度、会话活跃 turn 由调用方查明后以布尔入参传入，函数内不查 DB
  - 只改 mission.py 与新测试文件——不动 control.py/patrol.py/finalizer.py（task-07/08 范围），不动 daemon 侧（task-03/04 范围）
  - 测试不依赖真实 DB 会话（纯函数直测）；不迁移历史 mission 数据（design §3 非目标）
---

<!-- 骨架由 sillyspec taskcard 生成（LF 行尾 + frontmatter 已闭合 + 硬校验 9 字段齐全）。
     用 Edit tool 填充上方占位符（allowed_paths/goal/implementation/acceptance/verify/constraints 等），
     勿用 Write 整文件重写——会引入 CRLF 行尾/漏闭合 ---/漏字段回归。
     可选字段按需插进上方 frontmatter（规则见 taskcard-rules）：
     provides:      仅当本 task 给其他 task 提供接口/DTO/响应时填
     expects_from:  仅当本 task 消费其他 task 的契约时填
     related_tests: 仅当本 task 改动导致既有测试断言失效时填（测试路径须同时进 allowed_paths） -->
