---
author: qinyi
created_at: 2026-09-11
scale: large
---

# 设计文档（Design）— 群聊汇总模式与 agent 间私聊通道

> 变更：2026-09-10-group-agent-direct-chat
> 决策依据：decisions.md D-001 ~ D-008（用户确认）
> 原型：prototype-consensus-mode.html（用户已确认）

## 1. 背景

群聊现状（D-001，源码核实）：用户一条消息 @ 多个 agent 时**每个成员各自触发、各自把回复投影进群时间线**（`send_group_message` → `_trigger_member_isolated` 并行 fan-out → `group_bridge` [[GROUP]] 标记段投影），群里出现一堆 agent 回复刷屏；agent 之间的互@协作（`run_cross_mention_detection`）触发的回复同样进群。

用户诉求：跨工作区需求评审场景中，@ 多个 agent 时期望**第一个被 @ 的 agent 作为汇总人收口**，其余成员意见私下转交，最终一条总结进群；agent 之间意见分歧可直接私聊讨论不刷群；且必须可靠驾驭 agent——不能只靠 prompt 提示，要后端硬约束（D-007）。

## 2. 设计目标

1. **FR-1 汇总收口模式**：群级开关开启后，@ ≥2 个 agent 成员的消息自动进入汇总模式——汇总人=单 @ 首个（文本出现序；纯 @全体则成员表序首个），被咨询成员意见私下转交汇总人，收齐或超时（默认 600s 群可配）后汇总人输出一条总结进群。
2. **FR-2 agent 间私聊**：互@触发的协作轮回复不再进群，注入发起方影子会话；多轮往返讨论在私聊内闭环，防环护栏沿用。
3. **FR-3 可靠性与可观测**：汇总任务落库状态机（崩溃可恢复、最坏超时必收口）；协调状态卡落库可回放；意见转交/收口指令均为后端注入的标准轮，全程可审计。
4. **FR-4 零回归**：开关关闭（默认）时全链路与现状逐字节一致。

## 3. 非目标

- 不做前端独立的「汇总任务进度查询 API」——状态卡走现有 logs 流（SSE log 事件 + 回放读库）。
- 不做 agent 间私聊的独立会话形态——私聊注入发生在**成员既有影子会话**内（对齐影子直聊哲学：群成员可查会话时间线）。
- 不做收口轮失败后的自动重试（首版：状态卡标注 + 群内 system 兜底行，人工可重新 @ 触发）。
- 不改动 daemon 侧（全部编排 in backend，复用 SESSION_INJECT 通道）。
- 不做汇总人中途更换/人工接管收口（后续增量）。

## 4. 拆分判断

单变更承载：FR-1/FR-2 共享同一套原语（协作轮标记 + 投影拦截 + 回复定向注入），拆开会导致互@改造做两遍；改动面集中在 group 子域 + group_bridge + 前端三处，无跨变更文件重叠。不拆分。

## 5. 总体方案

### 5.1 轮 metadata 协议扩展（核心判定源）

影子会话每轮 user_input 的 `turn_metadata`（现有 `source_group_id` / `source_member_id` / `source_carrier_run_id` / `chain_depth` / `sender_user_id` 等）新增键：

| 键 | 类型 | 写入方 | 语义 |
|---|---|---|---|
| `consensus_task_id` | str(uuid) | 触发侧 | 本轮归属的汇总任务（协作轮/汇总人首轮/收口轮均带） |
| `consensus_role` | str | 触发侧 | `collaborator`（被咨询）/ `coordinator`（汇总人首轮）/ `converge`（收口轮） |
| `dm_target_member_id` | str(uuid) | 触发侧 | 本轮回复的定向注入目标成员（汇总模式=汇总人；互@私聊=发起方）；**无此键=普通轮** |
| `dm_kind` | str | 触发侧 | `consensus`（汇总意见）/ `agent_dm`（互@私聊），审计用 |

**投影拦截统一谓词**（D-007 硬约束，`group_bridge`）：`shadow_direct` 轮（现有）∪ `dm_target_member_id` 非空轮 ∪ `consensus_role == "coordinator"` 轮 → 双写投影跳过 + 收口兜底行跳过（[[GROUP]] 标记也拦）。唯一例外：`consensus_role == "converge"` 收口轮正常投影（总结进群）。

**互@检测**：`shadow_direct` 早退保留（现有）；协作轮/汇总人首轮**不早退**——被咨询成员意见里 @ 其他成员=转私聊讨论（协作网内），汇总人首轮回复里 @ 成员=主动追问，均为 D-005 允许的私聊语义。

### 5.2 数据模型

**AgentGroupChat 加两列**（照 `agent_cross_mention` 顶层列先例）：

- `consensus_mode: bool` 默认 `False`（关）
- `consensus_timeout_seconds: int` 默认 `600`（60~3600）

**新表 `agent_group_consensus_tasks`**（汇总任务状态机，D-008）：

| 列 | 类型 | 说明 |
|---|---|---|
| id | uuid PK | |
| group_id | uuid FK agent_group_chats CASCADE | |
| carrier_run_id | uuid FK agent_runs CASCADE + UNIQUE | 触发消息载体 run（防同消息重复建任务） |
| coordinator_member_id | uuid FK agent_group_members CASCADE | 汇总人 |
| status | String(16) | `open` / `closing`（收口指令已注入）/ `closed`（收口轮完成）/ `timeout`（超时收口指令已注入）/ `aborted`（全员失败） |
| members | JSON | `[{member_id, member_name, state: pending\|delivered\|failed\|timeout, delivered_at}]`（被咨询成员明细，不含汇总人） |
| deadline_at | DateTime(tz) | 触发时刻 + timeout_seconds |
| created_by | uuid FK users | 发送者 |
| created_at / converged_at | DateTime(tz) | |

索引：`ix_agct_group`（group_id）、`ix_agct_status_deadline`（status, deadline_at，扫描循环）、`uq_agct_carrier_run`。

### 5.3 发送侧编排（`messages.py`）

`send_group_message` 在 @ 解析后、触发前插入汇总分支：

1. **判定**：`group.consensus_mode` 且去重后 agent 目标数 ≥2；不满足 → 原路径零变化。
2. **@ 解析改造**：`_parse_group_mentions` 增加 `split_broadcast` 模式，返回 `(explicit_hits, broadcast_expanded)` 两段（explicit=单 @ 命中按文本出现序；broadcast=@全体按成员表序）。
3. **汇总人选择**（D-003）：`coordinator = explicit_hits[0] if explicit_hits else broadcast_expanded[0]`；`collaborators = (explicit_hits + broadcast_expanded) 去重 - coordinator`。
4. **建任务** + 状态卡落库（见 5.6）。
5. **fan-out**（复用 `_trigger_member_isolated` 并行协程，`_trigger_group_member` 加两个新参数）：
   - coordinator：`role_prompt=汇总人角色段`、`turn_metadata += {consensus_task_id, consensus_role: "coordinator"}`；
   - collaborator：`role_prompt=被咨询角色段`、`turn_metadata += {consensus_task_id, consensus_role: "collaborator", dm_target_member_id: coordinator.id, dm_kind: "consensus"}`。
6. **失败登记**：gather 部分失败项 → 任务明细 `state=failed` + 状态卡更新（消息本身照常落时间线，现有部分失败语义不变）。
7. 全员触发失败（含 coordinator）→ 任务 `aborted` + 状态卡终态；coordinator 成功而 collaborator 全失败 → 立即注入收口指令（无意见可汇，汇总人说明情况收口）。

### 5.4 收口钩子（`group_bridge._close_group_hooks` 扩展）

协作轮 turn_completed（completed 状态）后新增编排（与互@检测同挂接点、同 fail-open 语义，独立小事务）：

1. **意见聚合**：聚合本 run 全量 assistant 文本（`is_group_projectable_reply` 同口径过滤 + 剥 `[ASSISTANT]` 前缀，单成员意见截 `CONSENSUS_OPINION_MAX_CHARS=4000` 字）——**非**投影段口径（协作轮无投影）。
2. **定向注入**：注入 `dm_target_member_id` 对应影子会话（`inject_session_as_service`，busy_strategy="inject" 中途注入 steering、409 竞态降级排队——与群消息/直聊同机制）。注入 prompt = 意见转交 preamble（`【成员意见转交】「X」…`，多任务并行时标注来源消息摘要）。
3. **任务推进**（`dm_kind == "consensus"` 时）：任务行锁读 → 成员 `state=delivered` + 状态卡更新 → 收口判定：全员终态（delivered|failed|timeout）且 ≥1 delivered 且任务仍 open → 注入收口指令 + `status=closing`。
4. **收口指令**：注入 coordinator 影子会话，prompt 含触发消息摘要 + 各 delivered 成员意见全文 + 未响应名单 + 收口要求（输出 [[GROUP]] 总结段、标注分歧与未响应）。轮 metadata：`{consensus_task_id, consensus_role: "converge", source_carrier_run_id: 任务载体 run}`——**无 dm_target**，投影放行。
5. **收口轮完成**（converge 轮 turn_completed）→ 任务 `closed` + 状态卡终态。收口轮 failed → 状态卡标注 + 群内 system 兜底行（「汇总收口失败，各成员意见可在其会话时间线查看」——防死寂，对齐兜底行哲学）。

### 5.5 互@私聊（`mentions.py` 改造）

`run_cross_mention_detection` 触发调用点（`_trigger_group_member`）统一加 `dm_target_member_id=发起方成员 id`、`dm_kind="agent_dm"` + 私聊角色段——互@触发的回复注入发起方会话、不进群（D-004）。护栏（链深度/同成员次数/限频/Redis fail-closed）全部沿用零改动。typing 事件保留（运行态可见）。

### 5.6 状态卡（落库 + 实时更新）

- **落库**：`channel='system'` 行挂任务载体 run（回放走 `get_agent_session_logs` 按群会话聚合天然覆盖，与投影行同机制）。`metadata_ = {consensus_task_id, consensus_card: {coordinator_name, phase: collecting|converging|closed|timeout|aborted, members: [{name, state}], updated_at}}`，`content` = 人类可读单行摘要。
- **更新**：每次成员状态变化（delivered/failed/timeout）或任务状态迁移，**UPDATE 同一 log 行** + 重发同 log_id 的 log 事件（SSE）。前端按 `metadata.consensus_card` 渲染状态卡组件，同 log_id 事件做内容替换（原型：进行中/超时两态）。
- **中间不打断**：状态卡与汇总结论之间群时间线零杂音。

### 5.7 超时扫描循环（新 `consensus.py` + `main.py` 挂载）

`consensus_sweeper_loop()`：常驻 asyncio task（照 `lease_expiry_sweeper` 先例，main.py lifespan 挂载），30s 间隔：

1. 查 `status='open' AND deadline_at < now()`；
2. 行锁（FOR UPDATE）逐任务：未终态成员标 `timeout`；≥1 delivered → 注入超时版收口指令（如实标注未响应名单）+ `status=timeout`；0 delivered → `aborted` + 状态卡终态；
3. 崩溃恢复天然覆盖：任务表是唯一状态源，重启后未超时任务由收口钩子继续推进，超时任务被循环扫到。

### 5.8 prompt 角色段（软引导，非 correctness 依赖）

- **collaborator**：「【协作指令】你是被咨询成员：直接给出分析意见——本回复不会出现在群里，将私下转交汇总人「X」；如需与其他成员讨论分歧，可在回复中 @ 对方（同样私下转交）。无需使用 [[GROUP]] 标记。」
- **coordinator 首轮**：「【协作指令】你是指定汇总人：先独立分析（本轮不会出现在群里）；成员意见将陆续私下转交给你；收到【收口指令】后输出最终总结（[[GROUP]] 段发群）。收到收口指令前不要向群里发言。」
- **agent_dm**：「【私聊指令】成员「X」私聊向你发起协作——本回复不会出现在群里，将直接转交对方。」
- **意见转交**：「【成员意见转交】「X」对本次协作的意见（私下转交，不进群）：…。你可在回复中 @ 该成员继续讨论。」
- **收口指令**：「【收口指令】触发消息：「摘要」；已收意见：…；未响应：…。请输出最终汇总结论：给群内看的总结放 [[GROUP]]…[[/GROUP]] 段，整合各意见、标注分歧与未响应成员。」

### 5.9 接口与前端

- **schema**：`GroupChatCreate` + `consensus_mode: bool=False`、`consensus_timeout_seconds: int=Field(600, ge=60, le=3600)`；`GroupChatUpdate` 两字段 None=不改；`GroupChatRead` 透出；`GroupMessageSendRead` + `consensus_task_id: uuid|None`；`GroupMemberTriggerRead` + `consensus_role: str|None`。
- **无新端点**：设置走现有 POST/PATCH 群端点；状态卡走现有 SSE log 事件与 logs 回放。
- **前端**：`create-group-wizard`（开关+超时输入，照 `agent_cross_mention` 形态）；`member-panel` 群设置区（PATCH 顶层列字段）；`group-chat-panel` 状态卡渲染分支（`metadata.consensus_card` 驱动，同 log_id 替换更新）；`pnpm gen:types` 重生成 api-types。

## 6. 文件变更清单

### backend

| 操作 | 文件路径 | 说明 |
|---|---|---|
| 修改 | backend/app/modules/agent/model.py | `AgentGroupChat` +`consensus_mode`/`consensus_timeout_seconds` 两列；新表 `AgentGroupConsensusTask`。数据流：producer=PATCH 群设置/建群 → DB 列 → consumer=send_group_message 判定与 deadline 计算 |
| 新增 | NEW:backend/app/migrations/versions/20260910_group_consensus.py | 两列 + 新表 + 三索引 |
| 修改 | backend/app/modules/agent/schema.py | Create/Update/Read/GroupMessageSendRead/GroupMemberTriggerRead 扩展。数据流：producer=后端 DTO → OpenAPI → `pnpm gen:types` → consumer=前端表单与响应处理 |
| 修改 | backend/app/modules/daemon/group/service/helpers.py | DTO 字段（consensus_role/consensus_task_id）；协作角色段常量 + CONSENSUS_OPINION_MAX_CHARS |
| 修改 | backend/app/modules/daemon/group/service/crud.py | 建群/改群透传 consensus_mode/consensus_timeout_seconds 两顶层列 |
| 修改 | backend/app/modules/daemon/group/service/messages.py | `send_group_message` 汇总分支（判定/汇总人选择/建任务/fan-out 标记/失败登记）。数据流：producer=本分支写 `turn_metadata.consensus_task_id/consensus_role/dm_target_member_id` → 影子 run user_input 日志 → consumer=group_bridge 投影拦截与收口钩子 |
| 修改 | backend/app/modules/daemon/group/service/mentions.py | `_parse_group_mentions` split_broadcast 模式；`run_cross_mention_detection` 触发加 dm 标记（互@私聊） |
| 修改 | backend/app/modules/daemon/group/service/shadow.py | `_trigger_group_member` +`role_prompt`/`turn_overrides` 参数（协作角色段 + metadata 附加键） |
| 新增 | NEW:backend/app/modules/daemon/group/service/consensus.py | 任务状态机：建任务/意见登记/收口判定/收口指令注入/状态卡 UPDATE/`consensus_sweeper_loop` |
| 修改 | backend/app/modules/daemon/run_sync/service/group_bridge.py | 投影拦截谓词扩展（dm/coordinator 轮）；`_close_group_hooks` 挂意见聚合转交与任务推进；converge 轮收口闭合 |
| 修改 | backend/app/modules/daemon/run_sync/service/submit_steps.py | 投影双写判定消费新 ctx 字段（dm_target_member_id/consensus_role）——拦截点对齐 shadow_direct 现有消费位置 |
| 修改 | backend/app/main.py | lifespan 挂载 `consensus_sweeper_loop`（照 lease_expiry_sweeper 先例） |
| 修改 | backend/app/modules/daemon/tests/test_group_bridge_projection.py | 投影拦截断言（dm/coordinator 零投影、converge 放行、普通轮不变） |
| 新增 | NEW:backend/app/modules/daemon/tests/test_group_consensus.py | 汇总人选择 3 场景/任务创建/意见转交/收口判定（等齐、超时、全失败）/投影拦截/状态卡/互@私聊/开关关闭零行为 |
| 修改 | backend/app/modules/daemon/tests/test_group_cross_mention.py | 互@行为语义变更（回复不进群、注入发起方）——行为有意变更的断言更新 |
| 修改 | backend/app/modules/daemon/tests/test_group_mention_pipeline.py | @解析 split_broadcast 模式断言（文本序/广播展开/去重） |

### frontend

| 操作 | 文件路径 | 说明 |
|---|---|---|
| 生成 | frontend/src/lib/api-types.ts | `pnpm gen:types`（OpenAPI 同步提交 openapi.json） |
| 修改 | frontend/src/components/group-chat/create-group-wizard.tsx | 汇总模式开关 + 超时输入 |
| 修改 | frontend/src/components/group-chat/member-panel.tsx | 群设置区开关 + 超时（PATCH 顶层列） |
| 修改 | frontend/src/components/group-chat/group-chat-panel.tsx | 状态卡渲染分支（consensus_card 驱动、同 log_id 替换） |
| 修改 | frontend/src/components/group-chat/__tests__/group-chat-panel.test.tsx | 状态卡渲染测试（collecting/timeout/closed、同 log_id 替换） |
| 修改 | frontend/src/components/group-chat/__tests__/member-panel.test.tsx | 群设置区开关/超时交互测试 |

daemon（sillyhub-daemon）：**零改动**。

## 7. 接口定义

```python
# consensus.py 核心签名
async def create_consensus_task(db, *, group, carrier_run_id, coordinator: AgentGroupMember,
    collaborators: list[AgentGroupMember], timeout_seconds: int, created_by: uuid) -> AgentGroupConsensusTask
async def record_collaborator_outcome(db, *, task_id, member_id, state: str, opinion_text: str | None) -> None
    # 登记 delivered/failed/timeout + 状态卡 UPDATE + 收口判定（内聚）
async def inject_converge_directive(db, *, task, timed_out: bool) -> None
    # 收口指令注入 coordinator（等齐版/超时版），status → closing/timeout
async def deliver_collaborator_opinion(db, *, target_member_id, source_member_name,
    opinion_text: str, task: AgentGroupConsensusTask | None) -> None
    # 意见定向注入（互@私聊 task=None）
async def consensus_sweeper_loop() -> None  # main.py lifespan 常驻

# _trigger_group_member 新参数（shadow.py）
role_prompt: str | None = None,          # 协作角色段（拼 prompt 头 preamble）
turn_overrides: dict | None = None       # 合入 turn_metadata（consensus_*/dm_* 键）
```

## 7.5 生命周期契约表

| 事件 | 发起方 | 接收方 | 必需字段 | 状态变化 |
|---|---|---|---|---|
| 意见转交注入 | backend（收口钩子） | coordinator/发起方影子会话 | session_id, prompt(意见全文), turn_metadata(dm 来源标注), busy=inject | 影子新 user_input 轮（可 steering 中途注入/排队） |
| 收口指令注入 | backend（收口判定/超时循环） | coordinator 影子会话 | session_id, prompt(意见汇总+未响应名单), turn_metadata(consensus_role=converge, source_carrier_run_id=任务载体) | 任务 open→closing / open→timeout；影子新轮 |
| 收口轮完成 | daemon→run_sync close | backend 任务闭合 | run_id, status=completed, turn_metadata.converge | 任务 closing/timeout→closed；总结投影进群 |
| 超时扫描 | backend sweeper | 任务表+状态卡 | task_id, deadline_at | 未终态成员→timeout；open→timeout/aborted |
| 协作轮失败 | daemon→run_sync close | backend 收口钩子 | run_id, status=failed/killed | 成员 state=failed（终态参与收口判定） |

## 8. 测试策略

- 后端单测（test_group_consensus.py）：@ 解析 split_broadcast（文本序/广播展开/混合去重）；汇总人选择三场景；协作轮 metadata 落库；投影拦截（collaborator/coordinator 轮零投影行、[[GROUP]] 也拦、converge 轮放行）；意见聚合与注入调用（mock inject）；收口判定矩阵（等齐/超时/部分失败/全失败）；状态卡 UPDATE 与 publish；sweeper 超时路径；互@私聊（触发带 dm 标记、回复注入发起方、群时间线零行）；开关关闭全路径零变化（对照现状断言）。
- 既有互@测试更新：行为语义有意变更（D-004），非测试逻辑有误。
- 前端：状态卡渲染（collecting/timeout/closed 态、同 log_id 替换）、向导/设置面板交互。

## 9. 风险与缓解

| 风险 | 缓解 |
|---|---|
| 收口 prompt 过长（多成员长意见） | 单成员意见截 4000 字 + 超限标注（「意见过长已截断，全文见成员会话」） |
| 收口轮失败/未产出总结 | 状态卡标注 + 群内 system 兜底行（防死寂）；人工可重新 @ 触发 |
| 意见注入与 coordinator 忙轮竞态 | 复用 busy_strategy="inject"/409 降级排队既有机制 |
| sweeper 与收口钩子并发触发收口 | 任务行锁（FOR UPDATE）+ status 幂等判定（closing/timeout 后不再注入） |
| 前端同 log_id 更新渲染 | 状态卡分支按 log_id 替换内容（现有 seenLogIds 去重逻辑适配，plan 阶段核实渲染路径） |
| 存量群行为 | 默认关，零迁移行为变化 |

## 10. 约束（Constraints）

- 开关关闭时 `send_group_message`/投影/互@全链路与现状逐字节一致（回归底线；启用方式见 D-002）。
- 单聊（kind='chat'）/worker/quick-chat 会话零进入（群判定谓词 `session_kind='group_member'` 精确，现有口径）。
- daemon 侧零改动、零新协议。
- 收口兜底哲学：任何路径群里必有可见终态（总结/状态卡终态/兜底 system 行），不允许死寂（可见性语义见 D-006）。

## 11. 自审（Self-Review）

- **与决策对齐**：D-002（群级开关+存量群零变化）→ §5.3 判定与默认值；D-003（单@文本序优先）→ §5.3 选择规则与 split_broadcast；D-004（超时10分钟可调）→ 列默认 600 + 范围 60~3600；D-005（互@改私聊）→ §5.5；D-006（状态行）→ §5.6 状态卡；D-007（硬驾驭）→ §5.1 投影拦截统一谓词 + 后端驱动收口；D-008（DB 状态机）→ §5.2/§5.7。全部覆盖。
- **数据流闭环**：consensus_mode（DB 列→发送判定）、consensus_task_id/dm_target_member_id（触发侧 metadata→投影拦截→收口钩子）、consensus_card（状态机→system 行+SSE→前端）、DTO→OpenAPI→api-types 四条链均有 producer/consumer 标注，无 dormant 字段。
- **幂等与并发**：收口注入双触发风险由任务行锁+status 幂等判定兜底（§9）；uq carrier_run 防重复建任务；sweeper 与钩子并发安全。
- **风险判级接受**：命中 integration-critical 合理（触碰 main.py 启动入口 + 影子会话注入链路），verify 阶段按真实集成证据验收，不覆盖降级。
- **遗留核实点**（plan 阶段落地前核实）：前端同 log_id 更新渲染的具体适配位置（group-chat-panel seenLogIds 逻辑）；submit_steps 投影双写拦截的准确插入行。

## 12. Design Grill 修正补遗（自审发现 P1 边界，2026-09-11）

1. **coordinator 触发失败的任务处置**（§5.3 第 7 条收紧）：fan-out gather 中 coordinator 触发失败（机器不可用/队列满/引擎门控等）→ 任务**立即 aborted** + 状态卡终态（「汇总人未能参与，本轮协作中止」）——意见转交失去目的地，不再等待 collaborator；仅 collaborator 全失败而 coordinator 成功 → 立即注入收口指令（汇总人说明情况收口，原第 7 条语义）。
2. **收口指令注入前的 coordinator 影子健康检查**（§5.4 第 3 步前置）：注入收口指令/意见转交前查 coordinator 影子会话状态；`ended`/`failed`（用户 reset-memory 或手动结束）→ 任务 aborted + 状态卡「汇总人会话不可用，协作中止」（意见已注入部分保留在各成员影子会话时间线，可人工查看）。实现路径：照 `send_direct_message` 的影子状态防御查询先例（messages.py）。
3. **群解散/删除与成员移除**：收口钩子与收口指令注入前查群 `ended_at`/`deleted_at`（照 `get_group_accessible_session` 的软删过滤先例）——群已解散/删除 → open 任务静默 aborted（状态卡随群失效无需发布）；被咨询成员被移除（`removed_at`）不影响进行中任务——其意见照常转交（若 run 在跑），未跑则由超时兜底标 timeout，收口闭环不受损。
