---
id: task-08
title: 'close hooks wiring: opinion aggregation to converge closure'
title_zh: '收口钩子接线（意见聚合→转交→任务推进→converge 闭合）'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-09-11 22:17:10
priority: P0
depends_on: ['task-05', 'task-07']
blocks: []
requirement_ids: [FR-1.3, FR-1.4, FR-1.5, FR-3.2]
decision_ids: [D-007@v1]
allowed_paths:
  - backend/app/modules/daemon/run_sync/service/group_bridge.py
  - NEW:backend/app/modules/daemon/tests/test_group_consensus.py
target_files:
  - backend/app/modules/daemon/run_sync/service/group_bridge.py
  - NEW:backend/app/modules/daemon/tests/test_group_consensus.py
expects_from: "task-07 状态机函数; task-05 拦截谓词与 _close_group_hooks 结构"
goal: >
  把状态机接进轮终态钩子：协作轮 turn_completed 聚合全量 assistant 文本→定向注入→任务推进；converge 轮完成→任务 closed+状态卡终态；失败路径群内 system 兜底行防死寂。
implementation:
  - "_close_group_hooks 扩展（与互@检测同挂接点、同 fail-open 独立小事务）：turn_metadata 有 dm_kind=consensus 且 completed→意见聚合（全量 assistant 文本，is_group_projectable_reply 同口径+剥 [ASSISTANT] 前缀，截 CONSENSUS_OPINION_MAX_CHARS）→deliver_collaborator_opinion→record_collaborator_outcome(delivered)"
  - "协作轮 failed/interrupted→record_collaborator_outcome(failed)"
  - "converge 轮 turn_completed→任务 closed+状态卡终态；converge 轮 failed→状态卡标注+群内 system 兜底行（意见可去成员会话查看）"
  - "test_group_consensus.py 补集成用例（mock daemon 上报链路：两 collaborator 上报→两次转交注入→等齐→收口指令→converge 上报→closed）"
acceptance:
  - "mock 链路集成用例全绿（意见转交调用次数与目标正确、任务状态推进 open→closing→closed）"
  - "converge 失败路径产生兜底 system 行且任务不死锁"
  - "钩子异常（注入失败）不影响上报主流程（fail-open）"
verify:
  - "cd backend && uv run ruff check app/modules/daemon/run_sync/service/group_bridge.py && uv run pytest -q --no-cov app/modules/daemon/tests/test_group_consensus.py app/modules/daemon/tests/test_group_bridge_projection.py"
constraints:
  - "不改 _close_group_hooks 既有互@逻辑"
  - "聚合口径是全量非投影段（协作轮无投影）"
---

<!-- task-08: 收口钩子接线（意见聚合→转交→任务推进→converge 闭合）（骨架由 taskcard CLI 预生成，主代理降级直填——环境无子代理） -->
