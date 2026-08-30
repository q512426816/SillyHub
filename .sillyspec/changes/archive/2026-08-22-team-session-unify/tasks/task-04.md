---
id: task-04
title: 'inject orchestrator-run dual tagging'
title_zh: 'inject 主控轮双标记——活跃 mission 回填 mission_id 与 role=orchestrator + objective 首条回填'
author: 'qinyi'
created_at: 2026-08-22 03:35:53
priority: P0
depends_on: [task-01]
blocks: [task-05, task-06]
requirement_ids: [FR-01]
decision_ids: [D-009@v1]
allowed_paths:
  - backend/app/modules/daemon/session/service.py
  - backend/app/modules/daemon/tests/test_inject_orchestrator_tagging.py
provides:
  - contract: ORCHESTRATOR_RUN_TAGGING
    fields: [run.mission_id, run.role]
    note: 会话存在活跃 mission 时 inject 当轮 AgentRun 回填 mission_id + role=orchestrator（session/service.py _inject_into_session :1399 建 run 处，双标记）；task-05 懒建补回填、task-06 _get_main_run/finalizer 锚点、task-08 patrol 主控存续判定消费
expects_from:
  task-02:
    - contract: get_active_mission_for_session
      needs: [session_id]
  task-03:
    - contract: SESSION_OBJECTIVE_PLACEHOLDER
      needs: [SESSION_OBJECTIVE_PLACEHOLDER]
goal: >
  inject 链路在会话存在活跃 mission 时为当轮 AgentRun 落主控轮双标记（mission_id+
  role=orchestrator，D-009 核心机制），并以首条 inject 消息文本回填 objective 占位；
  无活跃 mission 时行为逐字节不变。
implementation:
  - 'session/service.py _inject_into_session（:1185 起，:1399 建 run 处）——建 run 前调 get_active_mission_for_session 查会话活跃 mission；命中则 run.mission_id=mission.id、run.role=orchestrator（双标记），同事务落库'
  - 'objective 占位回填——命中活跃 mission 且 objective==SESSION_OBJECTIVE_PLACEHOLDER（task-03 常量）时以本条 inject 消息文本回填（用户 prompt 原文，附件标记行不参与）；仅首条生效，非占位不覆盖'
  - 'turn 冲突守卫复用——:1232-1240 既有 current run 检查保证单活跃轮，双标记时序安全（design §5 Phase 1）；create_session 首 turn 不做双标记（mission 预建晚于会话创建，活跃 mission 仅 inject 轮命中）'
  - 'inject_session 与 inject_session_as_service 两调用方共用 _inject_into_session 同一段双标记逻辑，不另开分叉'
  - '新建 tests/test_inject_orchestrator_tagging.py——活跃 mission 时当轮 run 双标记断言；占位首条回填 + 第二条不覆盖；无活跃 mission 时 run 不带 mission_id/role（行为不变）；既有 inject 用例零回归'
acceptance:
  - 活跃 mission 存在时 inject 当轮 AgentRun 带 mission_id+role=orchestrator 双标记
  - objective 占位在首条 inject 后被消息文本回填；非占位 objective 不被覆盖
  - 无活跃 mission 时 inject 行为与改动前一致——run 无 mission_id/role 标记，既有会话链路零回归
  - 双标记与 objective 回填同 inject 事务（失败回滚不落半标记）
verify:
  - cd backend && uv run pytest app/modules/daemon/tests/test_inject_orchestrator_tagging.py -v
  - cd backend && uv run pytest app/modules/agent app/modules/daemon -q --no-cov --deselect app/modules/agent/tests/test_dispatch_metadata.py::test_build_claim_payload_propagates_bundle_fields --deselect app/modules/agent/tests/test_execution_context.py::test_get_execution_context_task_run
  - cd backend && uv run ruff check app/modules/daemon/session/service.py
constraints:
  - 只动 session/service.py inject 链路与新测试文件——不动 create_session / daemon 路由 / DTO（task-03 范围），不动 mcp_tools / converge（task-05/06 范围）
  - 不实现 awaiting_input 状态推进（task-02 派生 + task-08 patrol 消费）与 dispatch 懒建补回填（task-05）
  - run 既有字段（agent_session_id / user_id / 配置快照）语义不动；objective 回填文本口径=用户 prompt 原文
---

<!-- 骨架由 sillyspec taskcard 生成（LF 行尾 + frontmatter 已闭合 + 硬校验 9 字段齐全）。
     用 Edit tool 填充上方占位符（allowed_paths/goal/implementation/acceptance/verify/constraints 等），
     勿用 Write 整文件重写——会引入 CRLF 行尾/漏闭合 ---/漏字段回归。
     可选字段按需插进上方 frontmatter（规则见 taskcard-rules）：
     provides:      仅当本 task 给其他 task 提供接口/DTO/响应时填
     expects_from:  仅当本 task 消费其他 task 的契约时填
     related_tests: 仅当本 task 改动导致既有测试断言失效时填（测试路径须同时进 allowed_paths） -->
