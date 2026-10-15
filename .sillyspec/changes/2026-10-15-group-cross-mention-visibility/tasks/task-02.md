---
id: task-02
title: 'Route cross mention trigger by three-state mode'
title_zh: '触发三态分流——mentions 分流+公开指令常量+单测'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-10-15 12:29:18
priority: P0
depends_on: [task-01]
blocks: []
requirement_ids: [FR-02]
decision_ids: [D-006@v1, D-011@v1, D-005@v1]
allowed_paths:
  - backend/app/modules/daemon/group/service/helpers.py
  - backend/app/modules/daemon/group/service/mentions.py
  - backend/app/modules/daemon/tests/test_group_cross_mention.py
  - backend/app/modules/daemon/tests/test_group_mention_pipeline.py
target_files:
  - backend/app/modules/daemon/group/service/helpers.py
  - backend/app/modules/daemon/group/service/mentions.py
  - backend/app/modules/daemon/tests/test_group_cross_mention.py
  - backend/app/modules/daemon/tests/test_group_mention_pipeline.py
expects_from:
  task-01:
    - contract: AgentGroupChat.cross_mention_mode
      needs: [cross_mention_mode]
goal: >
  互@触发按三态优先级分流（源轮 consensus_task_id 优先于群模式），public 群产出 agent_public 轮型（无 dm_target 带发起方 id）。
implementation:
  - backend/app/modules/daemon/group/service/helpers.py 新增 ROLE_PROMPT_AGENT_PUBLIC 常量（发起方名+委派语境+GROUP 标记要求+过程不进群约束，中文）
  - backend/app/modules/daemon/group/service/mentions.py:460-486 触发参数构造处加三态判定：源轮 consensus_task_id 非空走现状 consensus 分支；群 cross_mention_mode=public 走新分支 turn_overrides 记 dm_kind=agent_public 与 asked_by_member_id 不带 dm_target_member_id、role_prompt 用公开指令；其余走现状 agent_dm 路径逐比特不变
  - 护栏判定（mentions.py:403-453 链深/同成员/限频/Redis fail-closed）保持在分流之前，两模式共用计数，本卡不改护栏逻辑
  - test_group_cross_mention.py 新增断言：public 群触发轮 turn metadata 含 dm_kind=agent_public 与 asked_by_member_id 且无 dm_target_member_id；private 群与现状断言一致；consensus 源轮优先于 public 模式（D-011 泄漏窗口钉死）；护栏计数两模式同源（同链同成员 2 次口径跨模式累计）
  - test_group_mention_pipeline.py 补 public 分支的 pipeline 断言
acceptance:
  - public 群互@轮型为 agent_public 且无 dm_target；private 群触发参数与变更前逐比特一致（既有断言零改动全绿）
  - consensus 任务进行中切 public 的群，互@仍走 consensus 轮型（三态优先级）
  - 护栏计数两模式共享且超限行为一致
  - 本卡测试全绿
verify:
  - cd backend && uv run pytest -q app/modules/daemon/tests/test_group_cross_mention.py app/modules/daemon/tests/test_group_mention_pipeline.py --no-cov
constraints:
  - 不放宽任何护栏参数；不动 Redis fail-closed 语义
  - dm_kind=agent_public 字面量与 design 接口定义一致（task-03 与测试按此消费）
  - 不动 private 现路径的任何参数构造（零回归红线）
related_tests: []
---
