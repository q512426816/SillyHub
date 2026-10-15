---
id: task-03
title: 'Project public delegation rounds and inject notice'
title_zh: '投影与回流——放行 agent_public 轮+轻注入 helper+单测'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-10-15 12:29:18
priority: P0
depends_on: [task-01]
blocks: []
requirement_ids: [FR-03, FR-04]
decision_ids: [D-003@v1, D-004@v2, D-006@v1, D-007@v1]
allowed_paths:
  - backend/app/modules/daemon/run_sync/service/group_bridge.py
  - backend/app/modules/daemon/group/service/delegation_notice.py
  - backend/app/modules/daemon/tests/test_group_bridge_projection.py
target_files:
  - backend/app/modules/daemon/run_sync/service/group_bridge.py
  - NEW:backend/app/modules/daemon/group/service/delegation_notice.py
  - backend/app/modules/daemon/tests/test_group_bridge_projection.py
expects_from:
  task-01:
    - contract: AgentGroupChat.cross_mention_mode
      needs: [cross_mention_mode]
goal: >
  公开委派轮投影进群（GROUP 标记抽取+兜底）并在收口后向发起方影子会话轻注入一条通知，不建 run 不派发。
implementation:
  - backend/app/modules/daemon/run_sync/service/group_bridge.py 上下文结构识别 dm_kind=agent_public（无 dm_target 天然绕过 projection_blocked 谓词 :83-85 谓词零改动）；投影行 metadata 增 delegation_of（发起方成员名）
  - 收口钩子 _close_group_hooks（completed 时 :427 起）投影行落库后调用 _inject_delegation_notice
  - 新建 backend/app/modules/daemon/group/service/delegation_notice.py 纯日志注入 helper：向发起方影子会话最近 run 追加 AgentRunLog（channel=user_input，metadata 含 delegation_notice True、delegated_member_name、chain_run_id），不建 run 不入队不派发；同链通知上限按同链同成员 2 次口径 DB metadata+Redis 双轨计数（沿链深护栏双轨先例 mentions.py:394-453），超限丢弃并出群内系统行；失败静默降级记 structlog warning
  - test_group_bridge_projection.py 新增断言：agent_public 轮 GROUP 段进群/无标记兜底首段 200 字/thinking 不进群/agent_dm 轮拦截不变；轻注入行落发起方影子会话且无新 run 创建；同链第二次注入后第三次丢弃；打断（非 completed）零投影零注入
acceptance:
  - agent_public 轮投影矩阵四断言全绿（进群/兜底/过程不进/私聊拦截不变）
  - 轻注入仅追加影子会话日志行，无 run/队列/派发副作用，注入失败不影响投影
  - 同链通知上限 2 次后丢弃并有系统行；打断零副作用
  - 本卡测试全绿
verify:
  - cd backend && uv run pytest -q app/modules/daemon/tests/test_group_bridge_projection.py --no-cov
constraints:
  - 轻注入原语为新建独立文件，不复用 send_direct_message（D-004@v2 评审定论）
  - 不改 projection_blocked 对 agent_dm 与 consensus 轮的拦截行为
  - delegation_of 仅供前端展示预留，本卡不做前端渲染（task-04 范围）
related_tests: []
---
