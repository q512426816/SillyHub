---
id: task-07
title: 'consensus task state machine in consensus.py'
title_zh: '汇总状态机（登记/收口判定/注入幂等/健康检查）'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-09-11 22:17:10
priority: P0
depends_on: ['task-01', 'task-03']
blocks: []
requirement_ids: [FR-1.3, FR-1.4, FR-1.5, FR-1.7, FR-3.1, FR-3.2, FR-3.3]
decision_ids: [D-004@v1, D-008@v1]
allowed_paths:
  - NEW:backend/app/modules/daemon/group/service/consensus.py
  - backend/app/modules/daemon/tests/test_group_consensus.py
target_files:
  - NEW:backend/app/modules/daemon/group/service/consensus.py
  - NEW:backend/app/modules/daemon/tests/test_group_consensus.py
provides: "record_collaborator_outcome / deliver_collaborator_opinion / inject_converge_directive / _assert_coordinator_reachable / _assert_group_active"
expects_from: "task-03 consensus.py 首版（create_consensus_task/状态卡 helper）; task-01 表结构"
goal: >
  在 consensus.py 首版上扩展状态机：意见登记与收口判定、收口指令注入（等齐/超时两版，行锁+status 幂等）、意见定向注入（busy steering/409 排队）、coordinator 影子健康与群解散前置检查。
implementation:
  - "record_collaborator_outcome(db, task_id, member_id, state, opinion_text=None)：行锁读任务→members 明细置 delivered/failed/timeout→状态卡更新→收口判定（全员终态且≥1 delivered 且 open→inject_converge_directive + status=closing）"
  - "deliver_collaborator_opinion(db, target_member_id, source_member_name, opinion_text, source_summary)：照 send_direct_message 的 inject_session_as_service（busy_strategy=inject 中途 steering、409 竞态降级排队）注入意见转交 preamble"
  - "inject_converge_directive(db, task, timed_out)：注入前 _assert_coordinator_reachable（影子 ended/failed→aborted+状态卡）与 _assert_group_active（群 ended_at/deleted_at→静默 aborted）；prompt=触发消息摘要+delivered 成员意见全文（截 CONSENSUS_OPINION_MAX_CHARS）+未响应名单+收口要求；轮 metadata 含 consensus_task_id/consensus_role=converge/source_carrier_run_id=载体run，无 dm_target；status 幂等（closing/timeout/closed/aborted 拒绝重入）"
  - "NEW test_group_consensus.py：收口判定矩阵（等齐/超时/部分失败/全失败 aborted/影子不可用/群解散）+ 注入幂等（重复调用不二次注入）"
acceptance:
  - "收口判定矩阵六场景单测全绿"
  - "重复 inject_converge_directive（status 已 closing）不产生第二次注入"
  - "coordinator 影子 ended 时收口转 aborted 且状态卡 phase=aborted"
  - "群解散后注入路径静默 aborted 无异常抛出"
verify:
  - "cd backend && uv run ruff check app/modules/daemon/group/service/consensus.py && uv run pytest -q --no-cov app/modules/daemon/tests/test_group_consensus.py"
constraints:
  - "不接线钩子（task-08）"
  - "不做 sweeper（task-09）"
  - "所有 DB 写在独立小事务（fail-open 不阻断上报主流程）"
---

<!-- task-07: 汇总状态机（登记/收口判定/注入幂等/健康检查）（骨架由 taskcard CLI 预生成，主代理降级直填——环境无子代理） -->
