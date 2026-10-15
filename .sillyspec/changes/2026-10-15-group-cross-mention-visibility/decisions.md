---
author: qinyi
created_at: 2026-10-15 11:33:20
generated_by: sillyspec-fourpiece-init
change: 2026-10-15-group-cross-mention-visibility
---

# 决策记录（Decisions）

<!-- 增量落盘：每解决一个有实现影响的问题当场追加一条（格式见 brainstorm Step 3 模板）；幂等按 D-xxx@vN 判重 -->
<!-- 引用规范：evidence 等处的源码位置写仓根相对全路径+行号（src/foo.js:123）——裸文件名在 docs-check 层1 靠 basename 全仓扫描找候选，找不到候选或关键词窗口不匹配即失效，到 pre-push 才拦（2026-09-19 实证 64 处返工） -->

> 背景：本变更源自对 DS Bot（Fei2411/DeepSeek-Bot）源码级公开委派链路的调研（父会话已完成双方代码级分析）。用户指令已定边界：群设置增加互@模式（私聊化 vs 公开委派）、复用 [[GROUP]] 投影与现有护栏。三处 P0/P1 取舍已经 AskUserQuestion 提问，用户未及作答，按仓库既有惯例保守裁定，**D-002/D-003/D-004 为可否决项**（proposal 中同步列出）。

## D-001@v1: 互@模式建模——主开关布尔保留 + 新增模式枚举
- type: architecture
- priority: P0
- status: accepted
- source: code
- question: 互@模式（私聊化/公开委派）在数据模型上如何表达？
- answer: `AgentGroupChat` 保留现有布尔 `agent_cross_mention` 作为互@总开关，新增 `cross_mention_mode` 枚举（`'private'` | `'public'`，server default `'private'`）；模式仅在总开关开启时生效，总开关关闭=严格 openclaw 模式语义不变。项目未上线、数据可清空，迁移直接加列。
- normalized_requirement: 新群/存量群 `cross_mention_mode` 默认 `'private'`；`agent_cross_mention=false` 时模式字段不产生任何行为差异（互@纯文本）。
- impacts: [FR-01, FR-02]
- evidence: backend/app/modules/agent/model.py:1471（AgentGroupChat 护栏参数区）；backend/app/modules/daemon/group/service/mentions.py:338-345（现互@分源读 turn metadata）
- 故障面: 布尔与枚举双字段可能出现「开关关、模式 public」的悬挂态——读取侧必须以开关优先，设置界面在开关关闭时禁用模式选择器。
- 退役判据: 若后续互@语义简化为单一公开/关闭两态（私聊模式被淘汰），可并回布尔字段并删除枚举。

## D-002@v1: 默认值——存量群与新群均默认私聊化（可否决）
- type: compatibility
- priority: P1
- status: accepted
- source: docs
- question: 新群默认互@模式取哪个？存量群怎么办？
- answer: 沿用 2026-09-10 群级开关变更 D-002「存量群零变化」惯例：存量群行为不变（等价 private），新建群默认 private；公开委派作为建群向导第三步与群设置里的可选项呈现。用户提问未及作答，AI 保守裁定。
- normalized_requirement: 存量群升级后互@行为与升级前完全一致；新建群向导默认不勾选公开委派。
- impacts: [FR-01, FR-03]
- evidence: .sillyspec/changes/archive/2026-09-10-group-agent-direct-chat/design.md:235（D-002 群级开关+存量群零变化先例）

## D-003@v1: 公开委派 v1 投影口径——只投影最终结果（可否决）
- type: boundary
- priority: P0
- status: accepted
- source: user
- question: 公开委派模式下群里能看到什么（最终结果 vs 结果+过程进度播报）？
- answer: v1 只投影被委派成员的**最终回复**（复用 [[GROUP]] 标记抽取），干活过程留在影子会话不刷群；进度播报（DS Bot 式阶段性播报+短句合流）留作后续独立增量。理由：D-005 当初互@私聊化的动机是「分歧讨论污染群时间线」，最小口径（只进结果）直接化解该动机，先把「群里看得到协作结果」的核心价值验证掉。
- normalized_requirement: 公开模式下被委派成员的投影行仅来自其收口回复的 [[GROUP]] 段；过程轮/中间文本零投影；@ 轮无标记时沿用现有首段兜底（group_bridge.py:304）。
- impacts: [FR-02, FR-04]
- evidence: backend/app/modules/daemon/run_sync/service/group_bridge.py:163（[[GROUP]] 抽取）；.sillyspec/changes/archive/2026-09-10-group-agent-direct-chat/proposal.md:10（私聊化原始动机）
- 故障面: 委派耗时长的场景群里长时间无动静——缓解：发起方触发时群内系统行「已把任务转给 X」即时可见（依托现有 typing/系统行通道，不新增投影）。

## D-004@v1: 结果回流语义——轻注入发起方，不自动触发（可否决）
- type: architecture
- priority: P0
- status: accepted
- source: user
- question: 被委派成员结果进群后，发起委派的成员是否自动接话（DS Bot askedBy 语义）？
- answer: 不自动触发。结果投影进群的同时，向发起方影子会话**纯注入一条轻通知**（复用现有 direct-message 纯注入通道语义，不带触发），发起方下次被 @ 时自然知晓并接话。理由：自动接话=每次委派多一轮 agent 运行成本，且引入 A@B→B@A 乒乓风险；控制权留在用户。DS Bot 的迟到回流+askedBy 自动接话在本架构下对应「投影独立于链推进（天然迟到可达）+ 轻注入」，语义保留、成本削减。
- normalized_requirement: 公开模式委派收口时：①投影行落载体 run；②发起方影子会话追加一条注入行（不创建 run、不占用队列）；③不产生对发起方的触发调用。
- impacts: [FR-04]
- evidence: backend/app/modules/daemon/group/router.py:433（direct-message 纯注入先例）；backend/app/modules/daemon/group/service/mentions.py:457-484（现私聊轮 role_prompt+dm_target 注入路径）
- 故障面: 发起方影子会话被注入行无限累积（长链多委派）——注入行计入同链通知上限（复用同链同成员 2 次护栏口径）。

## D-005@v1: consensus 互斥——汇总模式开启时公开模式不接管
- type: boundary
- priority: P1
- status: accepted
- source: code
- question: 公开委派模式与现有 consensus_mode（汇总收口）如何共存？
- answer: `consensus_mode=true` 的群，协作轮走 consensus 自有语义（私下转交+coordinator 收口），互@模式不改变其行为；两者是互斥的协作策略，consensus 优先。仅当 consensus_mode=false 且互@模式=public 时走公开委派。
- normalized_requirement: consensus_mode=true 时 cross_mention_mode 无行为效果；触发判定顺序：consensus 分支先于互@模式分支。
- impacts: [FR-02]
- evidence: backend/app/modules/daemon/run_sync/service/group_bridge.py:54-58（dm_kind=consensus|agent_dm 分源与投影拦截谓词）

## D-006@v1: 投影谓词改造——新增公开委派轮型，私聊轮拦截不变
- type: architecture
- priority: P0
- status: accepted
- source: code
- question: 现有 projection_blocked 对 dm_target 非空轮整轮硬拦截（D-007@2026-09-10），公开委派的投影如何放行？
- answer: 互@触发时按群模式分流：public 群的被@成员轮 turn metadata 记 `dm_kind='agent_public'`（不含 dm_target），role_prompt 用公开委派指令（要求 [[GROUP]] 标记给群结论 + 注明「结果将直接进群」）；projection_blocked 谓词仅拦 `dm_kind='agent_dm'`（私聊）与 consensus 协作轮，agent_public 轮放行走 [[GROUP]] 投影。护栏（链深≤群设置、同链同成员 2 次、限频滑窗、Redis fail-closed）三层原样沿用，公开模式不放宽。
- normalized_requirement: agent_public 轮的投影行为与普通 @ 轮一致（[[GROUP]] 抽取 + 无标记兜底）；agent_dm 轮行为与现状完全一致；两种轮型的触发/护栏计数同源。
- impacts: [FR-02, FR-04, task-02, task-03]
- evidence: backend/app/modules/daemon/group/service/mentions.py:457-484（turn_overrides 携带 dm_target 的现路径）；backend/app/modules/daemon/run_sync/service/group_bridge.py:69-76（TurnGroupMeta.dm_target/projection_blocked）
- 故障面: 轮型标记错误会导致该进群的没进/不该进的进了——单测双断言钉死两种轮型的投影矩阵。
- 退役判据: 若投影口径统一为按 [[GROUP]] 标记单一判定（轮型无关），dm_kind 分支可收敛。

## D-007@v1: 停止语义——沿用现有打断，打断即无投影
- type: boundary
- priority: P1
- status: accepted
- source: code
- question: 公开委派的停止语义（DS Bot stoppedRoomTurns「迟到内容不进群」）如何对应？
- answer: 沿用现有 interrupt（任意群成员可打断成员运行）；互@投影挂接点在影子 run 收口（completed）钩子，被打断（非 completed）的 run 天然不投影、不回流——DS Bot 需要专门集合防迟到垃圾，本架构下该语义免费成立，无需新增机制。
- normalized_requirement: 被打断的委派轮不产生投影行、不产生发起方注入行；群内已有打断系统行（现状）即用户可见反馈。
- impacts: [FR-04]
- evidence: backend/app/modules/daemon/run_sync/service/group_bridge.py:427（_close_group_hooks completed 挂接点）；backend/app/modules/daemon/group/router.py:460（interrupt 端点）

## D-008@v1: 实现方案选定——方案 A（结果单投 + 轻注入）
- type: architecture
- priority: P0
- status: accepted
- source: user
- question: 公开委派采用哪种实现方案（A 结果单投+轻注入 / B 结果双投 / C 完整 DS Bot 语义）？
- answer: 选方案 A：互@触发按群模式分流轮型，public 群被@成员轮记 dm_kind='agent_public'（无 dm_target）+ 公开委派 role_prompt，投影谓词放行该轮 [[GROUP]] 投影，收口时向发起方影子会话纯注入轻通知（不触发运行）；护栏三层原样沿用。理由：改动面最小且集中（mentions/group_bridge/模型加列/设置 UI）、私聊路径零回归（轮型分流互不干扰）、零新增运行成本；B/C 的增量（双写/进度播报/自动接话）均可在 A 之上独立叠加，演进路径开放。【AskUserQuestion 未及作答，AI 按推荐裁定，待用户否决——否决则本条 supersede】
- normalized_requirement: public 轮不写 dm_target；其投影走 [[GROUP]] 抽取+兜底；收口副作用=投影行+发起方注入行两项，无触发调用。
- impacts: [FR-01, FR-02, FR-03, FR-04, task-01, task-02, task-03, task-04]
- evidence: 本变更方案选择轮次（brainstorm step 4）；父会话 DS Bot 委派链路源码分析
- 故障面: 轮型分流漏判会导致公开群互@仍走私聊——触发分流单测钉死 public/private 两群型的 dm_kind 断言。
- 退役判据: 若方案 C（进度播报+自动接话）复潮并取代最小口径，本条随 D-003/D-010 复议一并 supersede。

## D-009@v1: 落选——方案 B（结果双投：群投影 + 发起方 DM 注入）
- type: architecture
- priority: P0
- status: rejected
- source: user
- question: 公开委派采用哪种实现方案（A 结果单投+轻注入 / B 结果双投 / C 完整 DS Bot 语义）？
- answer: 落选。
- normalized_requirement: 不采用公开轮双写（群投影与发起方 DM 完整注入并存）。
- impacts: []
- evidence: 本变更方案选择轮次（brainstorm step 4）
- 否决理由: 同一回复 token 双份消耗（群投影+DM 注入各自进入模型上下文），且对群的回复注入私聊会话语境错位，与轻通知语义重叠需后续拆除，违反 D-004。
- 复潮条件: 用户明确要求发起方在下次触发前就拥有委派结果全文（而非摘要通知），且可接受双份 token 成本时重议。

## D-010@v1: 落选——方案 C（完整 DS Bot 语义：进度播报 + 自动接话）
- type: architecture
- priority: P0
- status: rejected
- source: user
- question: 公开委派采用哪种实现方案（A 结果单投+轻注入 / B 结果双投 / C 完整 DS Bot 语义）？
- answer: 落选（v1 范围）。
- normalized_requirement: v1 不做过程进度投影与结果后自动触发发起方。
- impacts: []
- evidence: 本变更方案选择轮次（brainstorm step 4）
- 否决理由: 流式分段投影+合流窗口状态防刷屏改动面最大，每次委派多一轮运行成本且 A↔B 乒乓风险上升，v1 未验证核心价值前风险收益比最差，违反 D-003/D-004。
- 复潮条件: 方案 A 上线后用户反馈「委派过程黑盒/结果无人接话」成为高频诉求，且护栏实测足以约束乒乓时，作为独立增量变更重议。

## D-004@v2: 轻注入原语修正——新增纯日志 helper，不复用 send_direct_message
- type: architecture
- priority: P0
- status: accepted
- supersedes: D-004@v1
- source: design-grill
- question: 轻通知注入的实现载体（v1 称复用 direct-message 通道语义抽取 helper）是否成立？
- answer: 不成立。评审 UB-1 实证：send_direct_message（backend/app/modules/daemon/group/service/messages.py:732）为触发语义（:806-818 新建群载体 run、:848-849 busy_strategy=inject 注入活跃轮），无「只插日志行不触发」的可抽取对应物；且「载体 run」术语与代码冲突（载体 run 恒挂群会话）。修正为：新增 _inject_delegation_notice 纯写日志 helper（NEW:backend/app/modules/daemon/group/service/delegation_notice.py），直接向发起方影子会话最近 run 追加 AgentRunLog(user_input, delegation_notice metadata)，不建 run/不入队/不派发，失败静默降级记 warning。轻注入不触发的行为语义（v1 核心）不变。
- normalized_requirement: 公开委派收口的回流副作用=仅一条影子会话日志行；不产生 run/队列项/派发调用；注入失败不影响投影结果。
- impacts: [FR-04, task-02, task-03]
- evidence: backend/app/modules/daemon/group/service/messages.py:732,:806-818,:848-849；stage-reviews/brainstorm-review-2026-10-15-115811/review.json UB-1
- 故障面: 注入行与影子会话日志读取口径不符（成员会话视图异常行）——单测断言可渲染（R-03）。
- 退役判据: 若后续改为自动触发发起方接话（D-010 复潮），轻通知 helper 可被触发路径复用或删除。

## D-011@v1: 互@分流三态优先级——源轮 consensus_task_id 优先于群模式
- type: architecture
- priority: P0
- status: accepted
- source: design-grill
- question: consensus 任务进行中群主把互@模式切到 public，意见链轮会不会被误公开投影？
- answer: 会（若无优先级）。修正：互@触发分流按三态优先级执行——①源轮 consensus_task_id 非空 → consensus 协作轮型（现状，带 dm_target、投影拦截）；②群 cross_mention_mode='public' → agent_public；③其余 → agent_dm 现路径。现路径本就按源轮 consensus_task_id 优先记 dm_kind='consensus'（mentions.py:460-469），本决策把该优先级显式化并钉进单测。
- normalized_requirement: 分流判定顺序固定为 源轮 consensus_task_id > 群 cross_mention_mode；consensus 任务存活期间的互@轮零公开投影。
- impacts: [FR-02, task-02]
- evidence: backend/app/modules/daemon/group/service/mentions.py:460-469；stage-reviews/brainstorm-review-2026-10-15-115811/review.json UB-2
- 故障面: 无（纯优先级显式化，收紧泄漏窗口）。
- 退役判据: 若 consensus 与互@模式未来统一为单一协作策略引擎，三态判定收敛进该引擎。
