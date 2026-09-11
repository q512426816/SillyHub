# 任务分解（Tasks）— 2026-09-10-group-agent-direct-chat

> 注册表唯一真相（execute 从本文件解析任务清单）；实现细节见 tasks/task-NN.md（TaskCard）。

- [ ] task-01: 数据模型与迁移（AgentGroupChat 两列 + agent_group_consensus_tasks 表 + alembic） (depends_on: —)
- [ ] task-02: schema 与设置链路（Create/Update/Read + 触发响应 DTO + 角色 prompt 常量 + crud 透传） (depends_on: —)
- [ ] task-03: @解析 split_broadcast + 发送侧汇总分支（汇总人选择/建任务+状态卡/fan-out 标记/失败 aborted） (depends_on: task-01,02,04)
- [ ] task-04: 触发原语扩展（_trigger_group_member role_prompt/turn_overrides + 角色段常量） (depends_on: —)
- [ ] task-05: 投影层硬拦截（ctx 扩展 + submit_steps 双写/兜底行拦截，converge 放行） (depends_on: task-04)
- [ ] task-06: 互@私聊改造（触发加 dm 标记/护栏零改动/既有断言更新） (depends_on: task-04,05)
- [ ] task-07: 汇总状态机 consensus.py（登记/收口判定/注入幂等/健康检查） (depends_on: task-01,03)
- [ ] task-08: 收口钩子接线（意见聚合→定向转交→任务推进→converge 闭合→失败兜底） (depends_on: task-05,07)
- [ ] task-09: sweeper 循环与 main.py 挂载（30s 扫超时强制收口） (depends_on: task-07)
- [ ] task-10: 前端与类型（gen:types/向导开关/设置区/状态卡渲染/组件测试） (depends_on: task-02)

---

## task-01 数据模型与迁移

- `AgentGroupChat` + `consensus_mode`（bool 默认 False）/`consensus_timeout_seconds`（int 默认 600）两列；新表 `AgentGroupConsensusTask`（members JSONB 明细、deadline_at、status、三索引、FK CASCADE 链）；alembic 迁移。
- target_files: backend/app/modules/agent/model.py, NEW:backend/app/migrations/versions/20260910_group_consensus.py
- 验收：迁移可升可降；默认值/索引存在。

## task-02 schema 与设置链路

- `GroupChatCreate`/`GroupChatUpdate`/`GroupChatRead` 扩展两字段（60~3600 校验）；`GroupMessageSendRead.consensus_task_id`、`GroupMemberTriggerRead.consensus_role`；建群/改群透传。角色 prompt 段常量（design §5.8 五段）+ `CONSENSUS_OPINION_MAX_CHARS=4000` 一并落 helpers.py（避免与 task-04 同 Wave 共享文件）。
- target_files: backend/app/modules/agent/schema.py, backend/app/modules/daemon/group/service/helpers.py, backend/app/modules/daemon/group/service/crud.py
- provides: consensus 两设置字段 schema；两个触发响应 DTO 字段；ROLE_PROMPT_* 常量
- 验收：create/update 端到端测试；非法值 400 中文。（注：GroupMessageSendRead/GroupMemberTriggerRead 落 helpers.py 非 schema.py）

## task-03 @解析与发送侧汇总分支

- `_parse_group_mentions` split_broadcast 模式（explicit 文本序 / broadcast 成员表序）；`send_group_message` 汇总判定（开关+≥2 agent）、汇总人选择、建任务、状态卡落库、fan-out 标记（coordinator/collaborator turn_metadata + role_prompt）、coordinator 失败 aborted（design §12.1）。
- target_files: backend/app/modules/daemon/group/service/mentions.py, backend/app/modules/daemon/group/service/messages.py
- 验收：三场景汇总人选择测试；开关关闭零变化对照断言。
- related_tests: test_group_p1.py, test_group_p2.py, test_group_chat_management.py（发送路径回归，开关关闭应全绿）

## task-04 触发原语扩展

- `_trigger_group_member` + `role_prompt`/`turn_overrides` 参数（懒建/复用两分支都写 metadata）；角色常量消费方（常量本体在 task-02 的 helpers.py）。
- target_files: backend/app/modules/daemon/group/service/shadow.py
- provides: _trigger_group_member(role_prompt, turn_overrides) 扩展签名
- 验收：触发后影子 user_input metadata 含新键；prompt 头含角色段。

## task-05 投影拦截

- `_GroupBridgeContext` + `dm_target_member_id`/`consensus_role` 字段；`submit_steps` 投影双写与 `_emit_group_mention_projection_fallback` 兜底行统一拦截（dm/coordinator 轮；converge 轮放行）。
- target_files: backend/app/modules/daemon/run_sync/service/group_bridge.py, backend/app/modules/daemon/run_sync/service/submit_steps.py
- 验收：协作轮 [[GROUP]] 也零投影行；converge 轮正常投影。

## task-06 互@私聊改造

- `run_cross_mention_detection` 触发调用点加 dm_target（发起方）+ agent_dm 角色段；护栏零改动；typing 保留。
- target_files: backend/app/modules/daemon/group/service/mentions.py, backend/app/modules/daemon/tests/test_group_cross_mention.py, backend/app/modules/daemon/tests/test_group_mention_pipeline.py
- 验收：互@触发回复注入发起方会话、群时间线零行；断言按 D-005 语义更新。

## task-07 汇总状态机（consensus.py 新文件）

- `record_collaborator_outcome`（登记 + 状态卡 UPDATE + 收口判定）/`inject_converge_directive`（等齐版/超时版，行锁+status 幂等）/`deliver_collaborator_opinion`（定向注入，busy inject/409 排队）；coordinator 影子健康检查（§12.2）与群解散检查（§12.3）。在 task-03 创建的 consensus.py 上扩展。
- target_files: NEW:backend/app/modules/daemon/group/service/consensus.py（task-03 创建后本卡扩展）, NEW:backend/app/modules/daemon/tests/test_group_consensus.py
- expects_from: task-03 consensus.py 首版
- 验收：收口判定矩阵（等齐/超时/部分失败/全失败/影子不可用/群解散）单测。

## task-08 收口钩子接线

- `_close_group_hooks` 挂意见聚合（全量 assistant 文本，`_build_group_fallback_summary` 口径扩全量，单成员截 4000 字）→ `deliver_collaborator_opinion` → `record_collaborator_outcome`；converge 轮完成 → 任务 closed + 状态卡终态；失败路径兜底 system 行。
- target_files: backend/app/modules/daemon/run_sync/service/group_bridge.py, NEW:backend/app/modules/daemon/tests/test_group_consensus.py
- 验收：意见转交调用、任务推进集成测试（mock daemon 上报链路）。

## task-09 sweeper 循环与挂载

- `consensus_sweeper_loop`（30s，扫 open+过期，行锁，超时收口/aborted）；main.py lifespan 挂载（照 lease_expiry_sweeper，finally cancel+gather）。
- target_files: NEW:backend/app/modules/daemon/group/service/consensus.py, backend/app/main.py, NEW:backend/app/modules/daemon/tests/test_group_consensus.py
- 验收：伪造过期任务的收口测试；启动挂载冒烟。

## task-10 前端与类型

- `pnpm gen:types`（提交 api-types.ts + openapi.json）；create-group-wizard 开关+超时；member-panel 群设置区；group-chat-panel 状态卡渲染（consensus_card 驱动、同 log_id 替换）。
- target_files: frontend/src/lib/api-types.ts, frontend/src/components/group-chat/create-group-wizard.tsx, frontend/src/components/group-chat/member-panel.tsx, frontend/src/components/group-chat/group-chat-panel.tsx, frontend/src/components/group-chat/__tests__/group-chat-panel.test.tsx, frontend/src/components/group-chat/__tests__/member-panel.test.tsx
- 验收：组件测试；交互走查对照原型 prototype-consensus-mode.html。
