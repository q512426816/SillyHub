---
id: task-08
title: patrol-schedule-loop-session-adaptation
title_zh: patrol/schedule_loop 适配——awaiting_input 超时自动收敛 + 僵尸判定按会话活跃 + redispatch 存量 no-op
author: qinyi
created_at: 2026-08-22 03:35:53
priority: P1
depends_on: [task-02, task-06]
blocks: [task-14]
requirement_ids: [FR-05, FR-08]
decision_ids: [D-008@v1]
allowed_paths:
  - backend/app/modules/agent/patrol.py
  - backend/app/modules/agent/orchestrator.py
  - backend/app/modules/agent/tests/test_patrol.py
  - backend/app/modules/agent/tests/test_orchestrator.py
  - backend/app/core/config.py
expects_from:
  task-02:
    - contract: derive_status
      needs: [converged, has_session, session_active_turn]
  task-06:
    - contract: CONVERGE_SEMANTICS
      needs: [converge 终态置位入口]
goal: >
  mission 挂到会话后 patrol 与 schedule_loop 的存续口径从「主控 run 常驻 running」改为「会话活跃
  turn」——awaiting_input 超时自动收敛、僵尸判定按会话活跃、redispatch 对会话 mission no-op（存量 external 保留），防新链路 mission 挂死（design §5/§7.5/§9、D-008）。
implementation:
  - patrol.py 两处适配——(a) awaiting_input 超时自动收敛 活跃 mission 中主控轮与分身全终态且未 converge 且会话无活跃 turn（task-02 派生态）持续超 mission_patrol_awaiting_input_timeout_minutes（core/config.py 新增 默认 30 下界 5）时走 task-06 的 converge 终态置位入口推进 done/degraded 计入 converged 计数 时钟起点取 mission 最新 role=orchestrator run 的 finished_at 缺失跳过不猜（对齐断链语义）(b) 僵尸判定按会话活跃 判死条件=分身 run（role!=orchestrator）非终态+承载 daemon 持续离线超 mission_patrol_zombie_after_minutes+主控会话无活跃 turn 存量 external（session_id 为 NULL）保持原主 run 判定链路零回归
  - orchestrator.py——schedule_loop 三重收敛信号按 session 维度判定主控存续（会话 mission 主控轮为短生命周期 turn run 终态后不被强改状态 收敛锚点取该 mission 最新 orchestrator run 与 task-06 锚点一致）；redispatch_pending_main_runs 候选查询 join AgentMission 过滤 session_id 为 NULL 对会话 mission 显式 no-op 存量 external 重派行为保留
  - 测试——test_patrol.py 追加超时收敛（未超时不收敛/时钟缺失跳过/新配置默认值与 ge 下界）与僵尸会话维度判定用例；test_orchestrator.py 补 schedule_loop 会话判定与 redispatch 存量分流回归
acceptance:
  - awaiting_input 超 30 分钟（mission_patrol_awaiting_input_timeout_minutes 配置化）自动 converge 进终态 done/degraded
  - 僵尸判定=分身非终态+主控会话无活跃 turn+超时；redispatch_pending_main_runs 对会话 mission no-op；存量 external 判定/重派与 complete_lease 自动收敛不回归
  - 相关 patrol/orchestrator 测试通过（agent 模块全量含 deselect 两项）
verify:
  - cd backend && uv run pytest app/modules/agent -q --no-cov --deselect app/modules/agent/tests/test_dispatch_metadata.py::test_build_claim_payload_propagates_bundle_fields --deselect app/modules/agent/tests/test_execution_context.py::test_get_execution_context_task_run
constraints:
  - 契约字段以 task-02/task-06 卡片实际声明为准（AWAITING_INPUT_STATUS/CONVERGE_SEMANTICS）postcheck 对账时对齐；不改 derive_status 判据与 converge 置位语义本身（task-02/06 所属）只在 patrol/schedule_loop 消费侧适配 超时配置字段落 core/config.py（mission_patrol_* 唯一配置来源）allowed_paths 外文件不动
---

<!-- 骨架由 sillyspec taskcard 生成（LF 行尾 + frontmatter 已闭合 + 硬校验 9 字段齐全）。
     用 Edit tool 填充上方占位符（allowed_paths/goal/implementation/acceptance/verify/constraints 等），
     勿用 Write 整文件重写——会引入 CRLF 行尾/漏闭合 ---/漏字段回归。
     可选字段按需插进上方 frontmatter（规则见 taskcard-rules）：
     provides:      仅当本 task 给其他 task 提供接口/DTO/响应时填
     expects_from:  仅当本 task 消费其他 task 的契约时填
     related_tests: 仅当本 task 改动导致既有测试断言失效时填（测试路径须同时进 allowed_paths） -->
