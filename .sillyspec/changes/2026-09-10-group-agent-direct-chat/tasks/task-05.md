---
id: task-05
title: 'projection hard interception for dm and coordinator turns'
title_zh: '投影层硬拦截（dm/coordinator 轮不进群）'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-09-11 22:17:10
priority: P0
depends_on: ['task-04']
blocks: []
requirement_ids: [FR-2.1, FR-4.1]
decision_ids: [D-005@v1, D-007@v1]
allowed_paths:
  - backend/app/modules/daemon/run_sync/service/group_bridge.py
  - backend/app/modules/daemon/run_sync/service/submit_steps.py
  - backend/app/modules/daemon/tests/test_group_bridge_projection.py
target_files:
  - backend/app/modules/daemon/run_sync/service/group_bridge.py
  - backend/app/modules/daemon/run_sync/service/submit_steps.py
  - backend/app/modules/daemon/tests/test_group_bridge_projection.py
provides: "_GroupBridgeContext.dm_target_member_id/consensus_role 字段与统一拦截谓词"
expects_from: "task-04 turn_metadata 写入（consensus_task_id/consensus_role/dm_target_member_id/dm_kind 键名）"
goal: >
  投影层硬驾驭：turn_metadata 携带 dm_target_member_id 或 consensus_role=coordinator 的轮一律不投影（[[GROUP]] 段也拦），仅 consensus_role=converge 收口轮放行——判定对齐 shadow_direct 现有消费位置。
implementation:
  - "group_bridge.py _GroupBridgeContext 加 dm_target_member_id/consensus_role 字段，_resolve_group_bridge_context 从影子 user_input turn_metadata 解析填充"
  - "统一拦截谓词（design 5.1）：shadow_direct 轮 ∪ dm_target_member_id 非空 ∪ consensus_role==coordinator → 投影跳过；例外 consensus_role==converge 放行（总结进群）"
  - "submit_steps.py 投影双写消费点与 _emit_group_mention_projection_fallback 兜底行同步应用谓词（拦截轮连兜底行也不发）"
  - "拦截对 [[GROUP]] 标记段同样生效（段级解析前整体短路）"
  - "test_group_bridge_projection.py 补拦截断言（dm/coordinator 零投影、converge 放行、普通轮不变）"
acceptance:
  - "coordinator/collaborator/dm 轮 submit 后群时间线零新增行（含 [[GROUP]] 段）"
  - "converge 轮正常投影（[[GROUP]] 段进群）"
  - "普通轮（无新键）与 shadow_direct 轮行为与现状一致"
verify:
  - "cd backend && uv run ruff check app/modules/daemon/run_sync/service/ && uv run pytest -q --no-cov app/modules/daemon/tests/test_group_bridge_projection.py"
constraints:
  - "拦截只看 metadata 不看内容（防 prompt 绕过）"
  - "不动 shadow_direct 既有判定结构，扩字段组合"
---

<!-- task-05: 投影层硬拦截（dm/coordinator 轮不进群）（骨架由 taskcard CLI 预生成，主代理降级直填——环境无子代理） -->
