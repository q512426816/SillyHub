---
id: task-03
title: 'mention split_broadcast parse and send-side consensus branch'
title_zh: '@解析 split_broadcast 与发送侧汇总分支（建任务+状态卡首版）'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-09-11 22:17:10
priority: P0
depends_on: ['task-01', 'task-02', 'task-04']
blocks: []
requirement_ids: [FR-1.1, FR-1.2, FR-1.3]
decision_ids: [D-003@v1, D-008@v1]
allowed_paths:
  - backend/app/modules/daemon/group/service/messages.py
  - backend/app/modules/daemon/group/service/mentions.py
  - backend/app/modules/daemon/group/service/consensus.py
target_files:
  - backend/app/modules/daemon/group/service/messages.py
  - backend/app/modules/daemon/group/service/mentions.py
  - NEW:backend/app/modules/daemon/group/service/consensus.py
provides: "consensus.py 首版 create_consensus_task / _render_status_card / _update_status_card; split_broadcast 解析; send_group_message 汇总分支"
expects_from: "task-01 模型与表; task-02 DTO+常量; task-04 _trigger_group_member(role_prompt, turn_overrides)"
related_tests:
  - backend/app/modules/daemon/tests/test_group_p1.py
  - backend/app/modules/daemon/tests/test_group_p2.py
  - backend/app/modules/daemon/tests/test_group_chat_management.py
goal: >
  发送侧汇总编排：@解析支持 explicit/broadcast 两段拆分，开关开启且 ≥2 agent 目标时选汇总人、建任务+状态卡、fan-out 打角色与 metadata、coordinator 失败立即 aborted；开关关闭路径零变化。
implementation:
  - "mentions.py：_parse_group_mentions 加 split_broadcast 参数（默认 False 兼容旧调用），True 时返回 (explicit_hits 文本出现序, broadcast_expanded 成员表序)"
  - "consensus.py（新建首版）：create_consensus_task（uq carrier_run_id 防重、members 初始化 pending、deadline=now+timeout）+ _render_status_card（channel=system 行挂载体 run，metadata_.consensus_card 含 coordinator_name/phase/members/updated_at）+ _update_status_card（UPDATE 同 log 行）"
  - "messages.py send_group_message：@解析后插入汇总分支——判定 group.consensus_mode 且去重 agent 目标≥2；coordinator=explicit[0] if explicit else broadcast[0]；collaborators=(explicit+broadcast) 去重减 coordinator"
  - "fan-out：coordinator 传 role_prompt=ROLE_PROMPT_COORDINATOR + turn_overrides 含 consensus_task_id/consensus_role=coordinator；collaborator 传 ROLE_PROMPT_COLLABORATOR + consensus_task_id/consensus_role=collaborator/dm_target_member_id=coordinator.id/dm_kind=consensus"
  - "失败语义（design 12.1）：gather 后 coordinator 失败→任务 aborted+状态卡终态；仅 collaborator 失败→登记 failed；消息落时间线语义不变"
  - "GroupMessageSendRead 返回 consensus_task_id"
acceptance:
  - "汇总人三场景：单@多个取文本首个；纯@全体取成员表序首个；单@+@全体时单@优先且目标并集去重"
  - "开关关闭：send_group_message 全路径与现状零差异（对照断言）"
  - "coordinator 触发失败路径任务转 aborted 且状态卡 phase=aborted"
  - "同 carrier_run 重复触发不重复建任务（唯一约束生效）"
verify:
  - "cd backend && uv run ruff check app/modules/daemon/group/service/ && uv run pytest -q --no-cov app/modules/daemon/tests/test_group_p1.py app/modules/daemon/tests/test_group_p2.py app/modules/daemon/tests/test_group_chat_management.py"
constraints:
  - "不做意见转交/收口（task-07/08）"
  - "不碰投影（task-05）"
  - "开关关闭零行为变化是回归底线"
---

<!-- task-03: @解析 split_broadcast 与发送侧汇总分支（建任务+状态卡首版）（骨架由 taskcard CLI 预生成，主代理降级直填——环境无子代理） -->
