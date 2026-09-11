---
id: task-02
title: 'consensus schema, trigger DTOs and role prompt constants'
title_zh: 'schema 与设置链路（含角色 prompt 常量）'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-09-11 22:17:10
priority: P0
depends_on: []
blocks: []
requirement_ids: [FR-1.1, FR-1.6]
decision_ids: [D-002@v1, D-006@v1]
allowed_paths:
  - backend/app/modules/agent/schema.py
  - backend/app/modules/daemon/group/service/helpers.py
target_files:
  - backend/app/modules/agent/schema.py
  - backend/app/modules/daemon/group/service/helpers.py
provides: "GroupChatCreate/Update/Read.consent 两字段; GroupMessageSendRead.consensus_task_id; GroupMemberTriggerRead.consensus_role; helpers ROLE_PROMPT_* 常量与 CONSENSUS_OPINION_MAX_CHARS"
goal: >
  打通设置与响应链路：群 Create/Update/Read 扩展两字段（60~3600 校验），触发响应 DTO 加 consensus_task_id/consensus_role，角色 prompt 五段常量与意见截断常量落 helpers.py。
implementation:
  - "schema.py：GroupChatCreate + consensus_mode: bool=False、consensus_timeout_seconds: int=Field(600, ge=60, le=3600)；GroupChatUpdate 两字段 Optional None=不改；GroupChatRead 透出（照 agent_cross_mention 字段形态）"
  - "schema.py：GroupMessageSendRead + consensus_task_id: uuid|None"
  - "helpers.py：GroupMemberTriggerRead + consensus_role: str|None"
  - "helpers.py：常量 ROLE_PROMPT_COLLABORATOR / ROLE_PROMPT_COORDINATOR / ROLE_PROMPT_AGENT_DM / OPINION_TRANSFER_HEADER / CONVERGE_DIRECTIVE（文案照 design 5.8，占位符用 str.format 填充）+ CONSENSUS_OPINION_MAX_CHARS = 4000"
acceptance:
  - "建群带 consensus_mode=true 与 timeout=120 落库正确；timeout=30 返回 422/400 中文错误"
  - "PATCH 两字段局部更新（None 不改）生效"
  - "常量 import 无循环依赖（helpers 不 import consensus/shadow）"
verify:
  - "cd backend && uv run ruff check app/modules/agent/schema.py app/modules/daemon/group/service/helpers.py && uv run pytest -q --no-cov -k 'group_chat' app/modules/agent/tests/ app/modules/daemon/tests/test_group_chat_management.py"
constraints:
  - "不加新端点"
  - "不动 settings_json"
  - "常量只定义不消费（消费方在 task-03/06/07/08）"
---

<!-- task-02: schema 与设置链路（含角色 prompt 常量）（骨架由 taskcard CLI 预生成，主代理降级直填——环境无子代理） -->
