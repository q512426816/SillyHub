---
author: qinyi
created_at: 2026-09-11 16:48:21
---

# 决策记录 — 2026-09-10-group-agent-direct-chat

格式：id / status: accepted|rejected|superseded / source: user|code|docs / question / answer / normalized_requirement / impacts / evidence。修正走新版本 D-xxx@v2 + supersedes。

---

- id: D-001
- status: accepted
- source: code
- question: 群聊现有触发/投影/互@机制基线是什么？
- answer: 源码核实（scan 基线落后 79 天，以源码为准）：①`daemon/group/service/messages.py:send_group_message` 多 @ 并行触发（`_trigger_member_isolated` 独立 session 协程），各成员回复经 `run_sync/group_bridge.py` 的 [[GROUP]] 标记段投影进群时间线，@轮无标记时收口兜底行防死寂；②互@协作 `mentions.py:run_cross_mention_detection`——agent 回复文本 @ 其他 agent 在 turn_completed 后触发对方（护栏：链深度 cross_mention_depth/同链同成员次数/滑窗限频，Redis，fail-closed），互@触发的回复照常投影进群；③用户影子直聊 `messages.py:send_direct_message` + `prepare_shadow_direct_turn`——`source="shadow_direct"` 轮不进群时间线（[[GROUP]] 转发段例外），影子会话详情对群成员可见。
- normalized_requirement: 新机制必须与上述三链路共存且不破坏现状行为（开关关闭时零行为变化）；agent 间私聊可复用影子直聊的「轮 metadata 标记 + 投影过滤」模式。
- impacts: [FR-1, FR-2, FR-3, task-*]
- evidence: backend/app/modules/daemon/group/service/{messages,mentions,shadow,helpers}.py; backend/app/modules/daemon/run_sync/service/group_bridge.py

- id: D-002
- status: accepted
- source: user
- question: 汇总模式如何启用？（Q1）
- answer: 群级设置开关：开启后该群的多 @ 消息（@ ≥2 个 agent 成员，含 @全体展开）自动走汇总收口模式；关闭=现状（各自回复进群）。存量群默认关闭零行为变化。
- normalized_requirement: 开关落 AgentGroupChat（settings_json 或新列，建群向导/群设置面板可配）；开关关闭时 send_group_message 行为与现状逐字节一致。
- impacts: [FR-1]
- evidence: 用户轮次 2

- id: D-003
- status: accepted
- source: user
- question: 「第一个被 @」的判定顺序？（Q2）
- answer: 按用户消息文本中 @ 出现的先后顺序（"@小码 @大黄"→小码为汇总人）；@全体与单 @ 并存时，单 @ 的第一个优先于 @全体展开序；仅 @全体时用群 agent 成员表序（joined_at）第一个。
- normalized_requirement: 汇总人选择 = 单 @ 命中序（文本出现序）优先，否则 @全体展开序（成员表序）第一个；现有 `_parse_group_mentions` 返回按命中去重保序，需保证文本出现序（广播词在文本中的位置参与排序）。
- impacts: [FR-1]
- evidence: 用户轮次 2

- id: D-004
- status: accepted
- source: user
- question: 汇总人收口时机与超时？（Q3）
- answer: 带超时收口：等待所有非汇总成员交意见，超时（默认 10 分钟，群设置可调）后拿已到意见收口；未交成员在汇总中如实标注未响应。
- normalized_requirement: 收口触发 = 全员意见到齐 OR 超时定时器到点；超时值群级可配（默认 600s）；收口汇总须包含超时未响应成员的说明。
- impacts: [FR-1, FR-3]
- evidence: 用户轮次 2

- id: D-005
- status: accepted
- source: user
- question: 现有互@（agent @ agent 触发对方回复进群）行为如何处理？（Q4）
- answer: 默认改私聊：agent 回复中 @ 其他 agent 触发的协作一律走私聊通道——被触发方回复进发起方会话不进群时间线；结论是否发群由发起方（或所在汇总链的汇总人）决定。
- normalized_requirement: 互@触发的轮 metadata 标记为协作轮，投影层强制不进群（[[GROUP]] 标记也拦）；协作轮收口不触发群内兜底行；协作链护栏（深度/次数/限频）沿用现有 Redis 机制。
- impacts: [FR-2]
- evidence: 用户轮次 2

- id: D-006
- status: accepted
- source: user
- question: 协调过程在群内的可见性？（Q5）
- answer: 群内显示系统状态行（如「小码正在汇总 3 位成员的意见…」+ 各成员已交/未交状态，ephemeral 或轻量落库），过程细节在各成员影子会话时间线查看；最终汇总结论以汇总人身份发进群。
- normalized_requirement: 状态行覆盖：汇总开始/成员交意见/成员失败/超时收口/汇总发出；汇总结论行落群时间线（载体 run 投影，与普通 [[GROUP]] 投影同形态）。
- impacts: [FR-1, FR-3]
- evidence: 用户轮次 2

- id: D-007
- status: accepted
- source: user
- question: 如何保证 agent「听话」不刷群？（用户补充硬约束）
- answer: 双层：硬约束在后端——协作轮（非汇总成员被触发的轮）投影层按 turn metadata 强制拦截（无论是否打 [[GROUP]] 标记均不进群），收口编排（等齐/超时/意见转发）由后端状态机驱动，不依赖 agent 自觉；软引导在 prompt——协作轮 prompt 明确角色（被咨询方，回复不会出现在群里，意见将转交汇总人）。
- normalized_requirement: 投影拦截以 metadata 为单一判定源（对齐 shadow_direct 先例）；意见转交/收口指令均为后端注入的标准轮（可审计、可回放）；prompt 软引导仅作补充非 correctness 依赖。
- impacts: [FR-1, FR-2, FR-3]
- evidence: 用户轮次 2（补充）

- id: D-008
- status: accepted
- source: user
- question: 收口编排的状态管理技术方案？（Step 4 三选一）
- answer: 方案二：汇总任务表（AgentGroupConsensusTask 单表，成员明细 JSONB 列）+ 后台常驻扫描循环（照 main.py lease_expiry_sweeper / scheduled_send 先例）扫超时任务强制收口。淘汰方案一（Redis-only：重启丢状态、协调链悬挂、不可回放）与方案三（折中恢复逻辑更绕）。
- normalized_requirement: 任务行含 group_id/carrier_run_id（唯一）/coordinator_member_id/deadline_at/status(open|closed|timeout|aborted)/members 明细（member_id、name、state: pending|delivered|failed|timeout、delivered_at）；崩溃恢复=启动后 open 任务由后台循环自然接管；协调状态行落库（channel='system' 挂载体 run）回放可见。
- impacts: [FR-1, FR-3, task-*]
- evidence: 用户轮次 3；backend/app/main.py:240-288 后台循环先例
