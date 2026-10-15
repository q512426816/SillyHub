---
id: task-01
title: 'Add group cross mention mode column and DTO passthrough'
title_zh: '数据模型与 DTO——加列+迁移+透传+模型单测'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-10-15 12:29:18
priority: P0
depends_on: []
blocks: [task-02, task-03, task-04]
requirement_ids: [FR-01]
decision_ids: [D-001@v1, D-002@v1, D-005@v1]
allowed_paths:
  - backend/app/modules/agent/model.py
  - backend/migrations/versions/
  - backend/app/modules/agent/schema.py
  - backend/app/modules/daemon/group/service/crud.py
  - backend/app/modules/agent/tests/test_group_chat_models.py
  - backend/tests/test_align_platform_change_events_migration.py
target_files:
  - backend/app/modules/agent/model.py
  - NEW:backend/migrations/versions/20261015120000_add_group_cross_mention_mode.py
  - backend/app/modules/agent/schema.py
  - backend/app/modules/daemon/group/service/crud.py
  - backend/app/modules/agent/tests/test_group_chat_models.py
  - backend/tests/test_align_platform_change_events_migration.py
provides:
  - contract: AgentGroupChat.cross_mention_mode
    fields: [cross_mention_mode]
goal: >
  群聚合根新增互@模式列 cross_mention_mode（private|public，默认 private）并贯通 DTO 与迁移，为分流/投影/前端提供数据基座。
implementation:
  - backend/app/modules/agent/model.py:1471 AgentGroupChat 增加 cross_mention_mode 列（String(16) NOT NULL server_default private 加 CHECK 两值约束，注释写明 D-001 语义与 D-002 存量零变化）
  - 新建迁移 backend/migrations/versions/grp1m0de_add_group_cross_mention_mode.py（加列+CHECK+server_default，down_revision 指向当前 head，先 uv run alembic heads 核对）
  - backend/app/modules/agent/schema.py GroupChatCreate 加可选字段（None 即 private）、GroupChatUpdate 加可选字段（None 不变）、GroupChatRead 加恒透出字段（Literal 两值）
  - backend/app/modules/daemon/group/service/crud.py 写体透传两处：create_group_chat 的 AgentGroupChat 构造（约 :307 邻域）与 update_group_chat 的 if-None 局部更新（约 :519 邻域）；读体经 GroupChatRead 基类 model_validate 自动透出（router 子类继承，router.py 零改动）
  - backend/app/modules/agent/tests/test_group_chat_models.py 先写后补断言：新列默认 private、CHECK 拒非法值、Create 缺省落 private、Update None 不变
acceptance:
  - 新列默认与存量语义等价（server_default private），CHECK 拒绝第三种值
  - Create 不传字段时落 private，Update 传 None 不改变现值，Read 恒透出两值之一
  - 迁移可 upgrade 并可 downgrade（数据可清空前提下的直加列）
  - test_group_chat_models.py 全绿
verify:
  - cd backend && uv run pytest -q app/modules/agent/tests/test_group_chat_models.py --no-cov
constraints:
  - 存量群零变化（D-002）——不加数据回填、不改任何既有列
  - 不改 agent_cross_mention 与 cross_mention_depth 既有列及其语义
  - 不动 consensus 相关字段（D-005 互斥在读取侧判定，本卡只落数据基座）
related_tests: []
---
