---
author: qinyi
created_at: 2026-09-02 00:07:28
change: 2026-09-01-session-group-chat
---

# 决策记录：会话群聊

## D-001@v1: 触发模式 = @提及 + 独立记忆
- type: architecture
- priority: P0
- status: accepted
- source: 用户决策（需求澄清第 1 轮）
- question: 群聊里多个 agent 怎么被触发、怎么记上下文？
- answer: @昵称触发对应 agent、@全体广播；每个 agent 独立对话记忆；未被 @ 的消息仅进群背景摘要。参考 openclaw 主流模式，防刷屏。
- impacts: [FR-06/07/08, design §4]
- evidence: openclaw docs/channels/groups.md + src/channels/mention-gating.ts（源码调研）

## D-002@v1: 架构 = 影子会话桥接
- type: architecture
- priority: P0
- status: accepted
- source: 用户决策（方案选定）
- question: 群聊底层架构选哪种？
- answer: 群会话（kind='group'）统一时间线 + 每 agent 成员影子会话（kind='group_member'）独立记忆 + 桥接投影回群。备选 B 独立群聊域（2-3 倍工作量）与 C mission 团队扩展（任务/聊天语义冲突）被否。
- impacts: [design §2/§5]
- evidence: 设计核对报告 18 项假设 0 不可行

## D-003@v1: 成员模型 = 显式邀请制
- type: boundary
- priority: P1
- status: accepted
- source: 用户决策（需求澄清第 1 轮）
- question: 群成员（用户侧）怎么组织？
- answer: 建群拉 workspace 内用户 + 配置 agent 成员；仅群成员可看可聊（+workspace admin 兜底）。
- impacts: [FR-01, design §5.3]

## D-004@v1: agent 成员六要素配置 + 随时热切换
- type: definition
- priority: P0
- status: accepted
- source: 用户决策（需求澄清第 1 轮 + 追加）
- question: agent 成员配置什么？群聊中能否改？
- answer: 六要素 = 机器(runtime)/工作区/引擎(provider)/模型(llm_provider)/智能体方案(AgentProfile)/群内昵称（@提及词）；群聊中随时切换模型/引擎/方案（下轮边界生效、记忆不变）；机器/工作区切换 = 影子重建+记忆重置（确认提示）——记忆不变承诺的明确例外（Design Grill C9 修正）。
- impacts: [FR-11, design §3.3/§4.5]

## D-005@v1: 协作模式 = openclaw 同构平等成员（否决固定角色）
- type: architecture
- priority: P0
- status: accepted
- source: 用户决策（设计迭代第 2 轮，否决固定角色提案）
- question: agent 角色间怎么联动？要不要内置管理/分析/实现/测试/验收角色与派活工具？
- answer: 不做固定角色系统、不做派活工具、不做角色模板——平等成员 + 人格即角色（配什么样的人格方案就承担什么职责）；agent 间关联靠群背景摘要（含所有成员发言）+ @全体广播 + agent 互@协作（D-006）。分工是人格/工具/工作区配置的自然涌现。
- supersedes: （口头提案"管理者派活工具 + 角色模板"未立决策即被否）
- impacts: [design §1/§4.4]

## D-006@v1: agent 互@协作群级开关默认开启 + Redis 防环护栏
- type: definition
- priority: P0
- status: accepted
- source: 用户决策（设计迭代第 3 轮）
- question: agent 回复中的 @其他成员 是否触发？（openclaw 默认不触发防回声）
- answer: 群级开关默认开启：agent 回复最终文本中的 @昵称 与用户 @ 同管线触发对应成员（注入标注来源成员）。护栏（Design Grill C4 补载体）：协作链 id=触发用户消息载体 run_id，Redis group_chain 去重集+深度（TTL 30min）+ group_rate 滑动窗口限频（默认 6/分钟）+ 不自我触发；深度上限默认 2。
- impacts: [FR-10, design §4.4]

## D-007@v1: 影子会话不挂 parent_session_id（成员表反向指针）
- type: compatibility
- priority: P0
- status: accepted
- source: design-grill（前置核对报告 #1）
- question: 影子会话如何关联群？
- answer: 影子 parent_session_id=NULL，群↔影子关联仅经 agent_group_members.shadow_session_id 反向指针——规避 5 处以 parent 非空为 worker 唯一口径的链路（停机挂起/离线 sweep/自动恢复/自动重派/闸收口）误杀影子。
- impacts: [design §3.1/§5.1]

## D-008@v1: 桥接投影 = 事务内双写投影行（新 PK）+ 群频道事件携投影行 id
- type: architecture
- priority: P0
- status: accepted
- source: design-grill（C3 修正，初审 P0）
- question: agent 回复如何进群时间线且刷新回放一致？
- answer: submit_messages 事务内双写投影行到载体 run（**新 PK**——原 log_id 已被影子行占用；dedup_key 复用；身份进新增 agent_run_logs.metadata 列）；群频道实时事件 log_id 用投影行 id——实时/回放同 id，前端 seenLogIds 去重闭环；publish 阶段纯 Redis 不写库。
- impacts: [design §3.4/§5.2, T4]

## D-009@v1: 昵称全局唯一（用户与 agent 共用命名空间）
- type: definition
- priority: P1
- status: accepted
- source: design-grill（C1 修正）
- question: 用户与 agent 昵称可否同名？@路由歧义如何处理？
- answer: UNIQUE(group_id, display_name) 全局唯一，跨类型同名在建群/改名时拒绝——@路由无歧义。
- impacts: [design §3.3, FR-06]

## D-010@v1: 成员机器授权走 grants 分支（不照抄 worker 豁免）
- type: risk
- priority: P1
- status: accepted
- source: design-grill（C8 修正）
- question: agent 成员机器属主非群主时如何授权？
- answer: 走 _query_pinned_online_runtime(skip_owner_check=False, workspace_id=群ws) grants 授权分支（属主命中或 workspace grant）；worker 的 pinned_skip_owner_check=True 是服务端解析代表机器的豁免，群成员机器是群主任意选择的，必须授权校验；allowed_roots 预检保留第二道。
- impacts: [design §4.3, NFR-03]

## D-011@v1: 群时间线 = 平铺消息流全局 timestamp 排序
- type: definition
- priority: P1
- status: accepted
- source: design-grill（C13 修正）
- question: 回放与实时顺序如何一致？
- answer: 群视图不用单聊 run 分组 turn 模型；实时事件与回放读库统一按 log timestamp 全局排序平铺（get_agent_session_logs 的 run 锚分组会把迟到回复"吸回"触发消息组）。
- impacts: [design §7, FR-09]

## D-012@v1: 首期取舍（边界）
- type: boundary
- priority: P2
- status: accepted
- source: design-grill（P2 集处置）+ 用户需求边界
- question: 审批/计量/排队快照/run 视图等边界？
- answer: ①影子 manual_approval=False（审批不进群，权限按 lease 策略自动处理）；②影子计量归群主（群级分成员计量后续）；③排队消息按入队时刻摘要快照派发；④群不消费 run 级视图（载体 run 属预期）；⑤群不绑 change_id；⑥typing/presence 走 SSE 多路订阅合流 + Redis key TTL，草稿不落库不进上下文。
- impacts: [design §9, NFR]
