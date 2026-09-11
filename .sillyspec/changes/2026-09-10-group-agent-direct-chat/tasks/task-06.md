---
id: task-06
title: 'cross mention replies become agent-to-agent direct messages'
title_zh: '互@私聊改造（回复注入发起方不进群）'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-09-11 22:17:10
priority: P0
depends_on: ['task-04', 'task-05']
blocks: []
requirement_ids: [FR-2.1, FR-2.2, FR-2.3, FR-2.4]
decision_ids: [D-005@v1]
allowed_paths:
  - backend/app/modules/daemon/group/service/mentions.py
  - backend/app/modules/daemon/tests/test_group_cross_mention.py
  - backend/app/modules/daemon/tests/test_group_mention_pipeline.py
target_files:
  - backend/app/modules/daemon/group/service/mentions.py
  - backend/app/modules/daemon/tests/test_group_cross_mention.py
  - backend/app/modules/daemon/tests/test_group_mention_pipeline.py
expects_from: "task-04 触发签名; task-05 拦截谓词; task-02 ROLE_PROMPT_AGENT_DM 常量"
goal: >
  互@触发的协作轮改私聊语义：_trigger_group_member 调用点统一带 dm_target_member_id=发起方、dm_kind=agent_dm + 私聊角色段——回复注入发起方影子会话、群时间线零泄漏；护栏全沿用。
implementation:
  - "mentions.py run_cross_mention_detection 触发调用点：传 role_prompt=ROLE_PROMPT_AGENT_DM.format(发起方名) + turn_overrides 含 dm_target_member_id=发起方成员id 与 dm_kind=agent_dm"
  - "护栏零改动：链深度/同成员次数/滑窗限频/Redis fail-closed 逻辑不动"
  - "协作轮内互@检测不早退（允许被咨询成员回复中 @ 其他成员继续私聊）；shadow_direct 直聊轮早退语义保留"
  - "typing 事件保留（群内运行态可见）"
  - "更新 test_group_cross_mention.py 断言：互@回复不进群时间线、影子 metadata 含 dm 键；test_group_mention_pipeline.py 补 split_broadcast 断言（文本序/广播展开/去重）"
acceptance:
  - "互@触发后被@成员回复仅出现在发起方影子会话，群时间线零行"
  - "防环护栏行为与现状一致（深度超限/限频被拦用例全绿）"
  - "更新后的既有测试语义断言与 design D-005 一致"
verify:
  - "cd backend && uv run ruff check app/modules/daemon/group/service/mentions.py && uv run pytest -q --no-cov app/modules/daemon/tests/test_group_cross_mention.py app/modules/daemon/tests/test_group_mention_pipeline.py"
constraints:
  - "不改护栏参数与结构"
  - "不动检测时机（挂接点不变）"
---

<!-- task-06: 互@私聊改造（回复注入发起方不进群）（骨架由 taskcard CLI 预生成，主代理降级直填——环境无子代理） -->
