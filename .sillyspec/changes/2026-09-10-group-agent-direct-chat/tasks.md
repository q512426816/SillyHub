# 任务分解（Tasks）— 2026-09-10-group-agent-direct-chat

> 实现顺序即依赖顺序：task-01 → 02 → 03 → 04 → 05 → 06 → 07 → 08 → 09 → 10。plan 阶段可细化波次。

## task-01 数据模型与迁移

- `AgentGroupChat` + `consensus_mode`（bool 默认 False）/`consensus_timeout_seconds`（int 默认 600）两列；新表 `AgentGroupConsensusTask`（members JSONB 明细、deadline_at、status、三索引、FK CASCADE 链）；alembic 迁移。
- 验收：迁移可升可降；模型单测（默认值/索引存在）。

## task-02 schema 与设置链路

- `GroupChatCreate`/`GroupChatUpdate`/`GroupChatRead` 扩展两字段（60~3600 校验）；`GroupMessageSendRead.consent_task_id`、`GroupMemberTriggerRead.consensus_role`；建群/改群透传。
- 验收：create/update 端到端测试；非法值 400 中文。

## task-03 @解析与发送侧汇总分支

- `_parse_group_mentions` split_broadcast 模式（explicit 文本序 / broadcast 成员表序）；`send_group_message` 汇总判定（开关+≥2 agent）、汇总人选择、建任务、状态卡落库、fan-out 标记（coordinator/collaborator turn_metadata + role_prompt）、coordinator 失败 aborted（§12.1）。
- 验收：三场景汇总人选择测试；开关关闭零变化对照断言。

## task-04 触发原语扩展

- `_trigger_group_member` + `role_prompt`/`turn_overrides` 参数（懒建/复用两分支都写 metadata）；协作角色 prompt 段四款（collaborator/coordinator/agent_dm/意见转交/收口指令文案常量）。
- 验收：触发后影子 user_input metadata 含新键；prompt 头含角色段。

## task-05 投影拦截

- `_GroupBridgeContext` + `dm_target_member_id`/`consensus_role` 字段；`submit_steps` 投影双写与 `_emit_group_mention_projection_fallback` 兜底行统一拦截（dm/coordinator 轮；converge 轮放行）。
- 验收：协作轮 [[GROUP]] 也零投影行；converge 轮正常投影。

## task-06 互@私聊改造

- `run_cross_mention_detection` 触发调用点加 dm_target（发起方）+ agent_dm 角色段；护栏零改动；typing 保留。
- 验收：互@触发回复注入发起方会话、群时间线零行；既有 test_group_mentions 断言按 D-004 语义更新。

## task-07 汇总状态机（consensus.py 新文件）

- `create_consensus_task`/`record_collaborator_outcome`（delivered/failed/timeout 登记 + 状态卡 UPDATE + 收口判定）/`inject_converge_directive`（等齐版/超时版，行锁+status 幂等）/`deliver_collaborator_opinion`（意见定向注入，busy inject/409 排队）；coordinator 影子健康检查（§12.2）与群解散检查（§12.3）。
- 验收：收口判定矩阵（等齐/超时/部分失败/全失败/影子不可用/群解散）单测。

## task-08 收口钩子接线

- `_close_group_hooks` 挂意见聚合（全量 assistant 文本，`_build_group_fallback_summary` 口径扩全量，单成员截 4000 字）→ `deliver_collaborator_opinion` → `record_collaborator_outcome`；converge 轮完成 → 任务 closed + 状态卡终态；失败路径兜底 system 行。
- 验收：mock daemon 上报链路的集成测试（意见转交调用、任务推进）。

## task-09 sweeper 循环与挂载

- `consensus_sweeper_loop`（30s，扫 open+过期，行锁，超时收口/aborted）；main.py lifespan 挂载（照 lease_expiry_sweeper，finally cancel+gather）。
- 验收：伪造过期任务的收口测试；启动挂载冒烟。

## task-10 前端与类型

- `pnpm gen:types`（提交 api-types.ts + openapi.json）；create-group-wizard 开关+超时；member-panel 群设置区；group-chat-panel 状态卡渲染（consensus_card 驱动、同 log_id 替换）。
- 验收：组件测试；交互走查对照原型 prototype-consensus-mode.html。
