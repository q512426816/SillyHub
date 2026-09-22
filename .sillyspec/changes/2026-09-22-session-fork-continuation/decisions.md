---
author: qinyi
created_at: 2026-09-22 11:25:23
generated_by: sillyspec-fourpiece-init
change: 2026-09-22-session-fork-continuation
---

# 决策记录（Decisions）

<!-- 增量落盘：每解决一个有实现影响的问题当场追加一条（格式见 brainstorm Step 3 模板）；幂等按 D-xxx@vN 判重 -->
<!-- 引用规范：evidence 等处的源码位置写仓根相对全路径+行号（src/foo.js:123）——裸文件名在 docs-check 层1 靠 basename 全仓扫描找候选，找不到候选或关键词窗口不匹配即失效，到 pre-push 才拦（2026-09-19 实证 64 处返工） -->

## D-001@v1: 通用会话分叉为纲，handoff 续接为特例后置
- type: premise
- priority: P0
- status: accepted
- source: user
- question: 分叉能力是 sillyspec handoff 专用还是通用会话能力？
- answer: 用户明确要通用：「这个能力我想更通用点，不光 handoff 指令才能用，正常会话中我也想要能随时选择具体某个时间点会话去做分叉继续对话」。handoff 自动续接定位为该通用能力的「机械选点」特例，不阻塞通用路径交付。
- normalized_requirement: 分叉入口对任意普通会话可用（不依赖 sillyspec 变更上下文）；选点 UX 引擎无关；handoff 特例后置独立交付。
- impacts: [FR-01]
- evidence: 用户原话（2026-09-22 本变更前置 explore 第 4 轮）；代码事实 sillyhub-daemon/src/interactive/session-manager/persistence.ts:456-465（现状 resume 仅整会话、无选点）

## D-002@v1: 分叉溯源 UX = 子代理式「块 + 点击浮层看原会话」
- type: boundary
- priority: P1
- status: accepted
- source: user
- question: 分叉会话如何回看被分叉的原会话？
- answer: 用户要「类似子代理这样，点击可以看原会话信息」——复用分身浮层形态（WorkerSessionOverlay 内嵌完整 SessionPanel），方向反过来指向父会话；多跳分叉呈链式可逐级回看。
- normalized_requirement: 分叉会话内提供常驻溯源块（分叉自哪个会话、锚在哪轮），点击以浮层打开原会话完整记录；组件复用 frontend/src/components/daemon/session-panel/worker-session-overlay.tsx 既有形态。
- impacts: [FR-05]
- evidence: frontend/src/components/daemon/session-panel/worker-session-overlay.tsx:40-83（通用浮层仅吃 subSessionId+onClose）；用户原话（explore 第 3 轮）

## D-003@v1: 分叉点粒度 = 轮（AgentRun）边界
- type: term
- priority: P0
- status: accepted
- source: code
- question: 「具体某个时间点」映射到什么数据粒度？
- answer: 平台数据模型一轮=一个 AgentRun（轮次序=run 创建序是既有语义），引擎侧 Claude resumeSessionAt 以消息 UUID 为锚——平台选点粒度定为轮边界（第 N 轮后分叉），引擎锚点由该轮末尾消息映射派生，不发明新粒度。
- normalized_requirement: 选点 UI 以轮为单位；分叉语义=新会话继承截至第 N 轮（含）的全部上下文，第 N+1 轮起两侧独立。
- impacts: [FR-02]
- evidence: backend/app/modules/agent/model.py:45-115（AgentRun=轮）；backend/app/modules/daemon/router/session_insights.py:306-311（轮次序语义注释）；sillyhub-daemon/node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts:1886-1892（resumeSessionAt 消息 UUID 语义）

## D-004@v1: 引擎两档——claude 原生真分叉 + codex/pi 种子式降级
- type: architecture
- priority: P0
- status: accepted
- source: user
- question: v1 各引擎分叉语义怎么定？
- answer: 用户拍板「claude 真分叉 + 其余种子式」——claude 走 SDK resumeSessionAt+forkSession 真截断；codex/pi 用「截至分叉点的前情转述作首条消息」降级（新会话读到的是转述而非原生历史）。能力位按引擎分档，UI 明确标注两档语义差异。
- normalized_requirement: ProviderCaps 增分叉能力位（区分原生/种子两档，三端生成单源）；claude 分叉后新会话上下文=截断原生历史；codex/pi 分叉=转述种子；前端按能力位出按钮+降级标注。
- impacts: [FR-03, FR-04]
- evidence: sillyhub-daemon/node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts:1886-1930（resumeSessionAt/resumeDropsTurn）与 :1548-1551（forkSession）；sillyhub-daemon/src/interactive/providers.ts（PROVIDER_CAPS 15 键三端生成单源）；用户回答（2026-09-22 AskUserQuestion）
- 故障面: 种子档被误当真分叉——前情细节有损（转述≠原文），UI 不标注会引发「模型忘了」误报；能力位取值错误会让 codex/pi 走到原生参数路径直接失败
- 退役判据: codex/pi 引擎出现原生任意点恢复能力时，该档能力位置 true 并退役种子链路

## D-005@v1: 原会话分叉后保留可继续（git 语义）
- type: boundary
- priority: P1
- status: accepted
- source: user
- question: 分叉后原会话 A 的状态？
- answer: 用户选「保留可继续」——分叉对原会话零状态影响，两边并行各聊各的；防双活约束不适用于通用分叉场景，handoff 特例的「交接后冻结」语义由后置变更另行定义。
- normalized_requirement: 分叉动作不修改原会话任何字段（状态/当前轮/指针）；原会话可继续正常对话；分叉记录单向挂在子会话侧。
- impacts: [FR-02]
- evidence: 用户回答（2026-09-22 AskUserQuestion）

## D-006@v1: handoff 自动续接不并入本变更
- type: boundary
- priority: P0
- status: accepted
- source: user
- question: handoff 阶段边界自动切窗是否本期交付？
- answer: 用户选「不并入，后置独立变更」——本变更只交付通用手动分叉闭环（选点→分叉→谱系展示→溯源回看）；handoff 触发器、种子链、sillyspec CLI --json 补种子字段全部后置。
- normalized_requirement: 本变更不含任何 sillyspec handoff 集成与自动触发；变更验收面不包含机械切窗场景。
- impacts: [FR-01]
- evidence: 用户回答（2026-09-22 AskUserQuestion）

## D-007@v1: 分叉执行链路 = 方案C（backend 主导管道扩展 + pi 原生 fork 接线）
- type: architecture
- priority: P0
- status: accepted
- source: user
- question: 分叉执行链路架构选型（A=backend主导管道扩展 / B=daemon统一fork RPC文件手术 / C=A+pi原生接线）
- answer: 用户选方案C——以方案A为基座（backend 主导：claude 走既有 create-with-resume 管道加 fork 参数透传 resumeSessionAt+forkSession，daemon 不新增协议消息；种子组装在 backend 读库），追加 pi 原生 fork 接线：pi RPC 的 fork/switch_session 截断语义先 spike 实测，能截断则 pi 原生档、不能则退种子档；codex v1 种子档。
- normalized_requirement: 执行链路 backend 主导（lease.metadata 扩展 fork 字段 → daemon 既有 resume 链 → driver 参数，无新 WS 协议消息）；pi 定档以 spike 断言「能否截断到指定消息」为前置门，spike 结论落盘后再锁 FR 档位。
- impacts: [FR-03, FR-04]
- evidence: 用户回答（2026-09-22 方案选择轮，AskUserQuestion）；pi RPC fork 命令线索 sillyhub-daemon/src/interactive/pi-rpc-driver.ts:780-782（注释「平台明确未接」）；claude 侧先例 sillyhub-daemon/src/interactive/claude-sdk-driver.ts:476-479（forkSession 生产使用）
- 故障面: pi spike 失败退种子档（预期内降级）；pi fork 若实为「整文件分叉无截断」而误标原生档 → 分叉点语义错误，必须以 spike 断言截断行为定档
- 退役判据: codex 后续版本提供任意点恢复 API 时升原生档，退役种子链路

## D-009@v1: 执行期裁决——task-01 连带更新两个既有字段全集守卫测试
- type: risk
- priority: P2
- status: accepted
- source: code
- question: task-01 卡面 allowed_paths 只含 model.py/迁移/新测试，但既有 test_agent_session_model.py（len==30 全集断言）与 test_mission_session_id.py:245（字段集合相等）加列必红——改还是不改？
- answer: 子代理按 CLAUDE.md 规则 8 与两文件历代加列同步惯例，连带维护性更新并随卡提交（各 +3~7 行守卫清单追加）；属 plan 期 related_tests 漏声明的连带测试债，非越权扩功能。
- normalized_requirement: 后续加列类任务 plan 期必须排查字段全集守卫测试并声明 related_tests；本次两文件已入 task-01 review changedFiles 披露。
- impacts: [task-01]
- evidence: backend/app/modules/agent/tests/test_agent_session_model.py（len 断言）；backend/app/modules/agent/tests/test_mission_session_id.py:245；commit c3b0da10f（worktree 分支 sillyspec/2026-09-22-session-fork-continuation）

## D-008@v1: 双 spike 定档——pi 档位与 claude 锚点结论
- type: architecture
- priority: P0
- status: accepted
- source: code
- question: pi 分叉走原生还是种子档？claude resumeSessionAt 锚点取什么消息？
- answer: 实测 pi=native（判据：RPC fork 命令以用户消息 entryId 为锚实测截断成立——fork 后 get_messages 6→2、新会话探针「name=Alice; code=none; color=none」不知截去轮、原会话文件零改动；截断唯一入口是 RPC fork 命令，CLI --fork 旗标为全量复制）；claude 锚点=轮末最后一个 chain-entry 消息 UUID（普通轮=轮末 SDKAssistantMessage.uuid，resume+resumeSessionAt+forkSession 实机断言知前2轮不知第3轮、transcript 物理截断；end-turn tool 轮/中断轮细则按 sdk.d.ts 归纳标待实机确认）；resumeDropsTurn 守卫=CLI 2.1.216 不支持 --resume-drops-turn（真 UUID 亦 unknown option 硬崩 exit 1、query() reject），SDK 0.3.247 类型已声明——守卫不可启用，省略即官方明示的未校验截断（截断语义不受影响），v1 driver 禁传该参数
- normalized_requirement: pi caps sessionFork=native（锚=第 N+1 轮用户消息 entryId、末轮后分叉走 clone 全量，驱动层需落库 entryId 并经活 RPC 会话发 fork 命令）；claude engine_anchor 回填=轮末 chain-entry 消息 UUID（普通轮取末 assistant uuid）；FR-07 需从「codex/pi 恒 NULL」修订为「codex 恒 NULL、pi=用户消息 entryId」；claude driver 组合参数面=resume+resumeSessionAt+forkSession 三件（禁传 resumeDropsTurn，含 undefined——会序列化成 null 硬崩）；claude 后台 job worker lane 禁用此对参数（该 lane 静默忽略截断）
- impacts: [FR-04, FR-07]
- evidence: spike-pi-fork.md（本目录）；SDK 实装 0.3.247（sdk.d.ts:723/728-733 forkSession、:1551 Options.forkSession、:1892 resumeSessionAt、:1943 resumeDropsTurn、:1927-1932 PRINT/HEADLESS lane 限制）；claude.exe 2.1.216（~/.local/bin，daemon 生产解析路径）实测；pi 0.81.1（rpc.md:613-639 fork 命令、rpc-types.d.ts:105、agent-session-runtime.js:171-247、session-manager.js:1077+ createBranchedSession、main.js:195-206 CLI --fork=全量）
- 故障面: pi 会话上游 API 错误被静默吞成空 assistant 轮（无错误事件，daemon 侧不浮出）；锚点取「末 assistant uuid」遇 end-turn tool 轮/中断轮时按细则应取轮末最后条目，取错会触发守卫拒绝或截断错位（守卫当前不可用则静默错位）；claude CLI 后续升级支持 --resume-drops-turn 前，任何传参尝试都是进程级硬崩
- 退役判据: claude CLI 升级支持 --resume-drops-turn 后启用守卫并补校验拒绝路径实测；pi 若大版本改 fork 锚语义须重跑本 spike

## D-010@v1: 执行期裁决——D-008 pi=native 的规格落实（FR-07 修订+卡片定值）
- type: architecture
- priority: P0
- status: accepted
- source: design-grill
- question: spike 定档 pi=native 后，FR-07「codex/pi 恒 NULL」与 task-03/04/06 卡面的「pi 待定/claude-only」如何落实？
- answer: ①caps 定值：pi sessionFork=native（task-03 直接落值，不再待定）；②engine_anchor 语义分档——claude=该轮末 chain-entry UUID（轮终态回填，task-04 原案）；pi=该轮首条用户消息 entryId（daemon 上报链落库）；pi 档 fork 语义=「分叉在第 N 轮后」→ 取第 N+1 轮 engine_anchor 为锚 position before，N 为末轮则走 clone 全量分叉；codex 恒 NULL；③task-06 claude driver 禁传 resumeDropsTurn（undefined 序列化 null 硬崩）+后台 job lane 禁用截断参数对；pi 分支确认实装（活 RPC 会话发 fork 命令）。
- normalized_requirement: requirements FR-07 与 design 数据模型/兼容策略的 engine_anchor 注释按分档语义修订；task-03 卡 pi=native；task-04 卡增 pi 回填分支（entryId 上报链可得性由实现实测，不可得则停人裁决 pi 降 seed——破坏性不自行降）；task-06 卡增守卫禁传与 pi 实装确认。
- impacts: [FR-04, FR-07, task-03, task-04, task-06]
- evidence: D-008@v1（spike-pi-fork.md 实测）；decisions.md 本文件
- 故障面: pi entryId 若不在既有上报链，需 daemon 侧增报字段（task-06 范围内），漏报则 pi 档 fork 拿不到锚
- 退役判据: 同 D-008

## D-011@v1: 执行期裁决——锚点数据源改走消息级 metadata 通道，task-04 依赖反转挪 W5
- type: architecture
- priority: P0
- status: accepted
- source: design-grill
- question: task-04 停人实测：pi entryId 与 claude chain-entry uuid 均不在 daemon→backend 上报链（pi-events.ts:245-249 生命周期事件零 IR 产出；claude-events.ts:431-463 只读 message.id 拼 segmentId 从不读顶层 uuid，链内 msg_xxx 与 resumeSessionAt 要求的链 UUID 不同值域）——锚点从哪来？
- answer: 走消息级 metadata 通道：task-06 两个 driver 在归一化产物上补挂引擎原生锚进 AgentEvent.metadata 固定键 engineAnchor（claude=record 顶层 uuid；pi=用户消息 entryId），不碰 event-wire 平铺契约（metadata 键现成，event-wire.ts:81-116）不碰 claude-events/pi-events（driver 层持有 raw+归一化双视角，均在 task-06 allowed_paths 内）；backend 侧 AgentRunLog.metadata_ 列现成持久。task-04 改为消费端：从该轮已落库消息 metadata.engineAnchor 取值回填 AgentRun.engine_anchor（claude=轮末 assistant 消息；pi=轮首 user 消息）。task-04 因此增依赖 task-06、从 W2 挪 W5（与 task-08 同波，文件正交）；不降档、不推翻 D-008（正是落实其锚值语义）。
- normalized_requirement: metadata 键名定 engineAnchor（camel，daemon 侧惯例）；task-06 卡增两 driver 补挂职责与单测；task-04 卡改消费端实现+depends_on [task-01, task-06]+W5；plan.md W2/W5 段与关键路径同步。
- impacts: [FR-07, task-04, task-06]
- evidence: task-04 停人回传（pi-events.ts:233-249/event-wire.ts:81-116/claude-events.ts:431-463/sdk.d.ts:3086-3094 证据链）；backend/app/modules/agent/model.py AgentRunLog metadata_ 列
- 故障面: driver 漏挂或 backend 漏读该键→engine_anchor 恒 NULL→该轮入口灰（R-05 既有降级面，不炸链路）
- 退役判据: 引擎侧原生提供可截断锚的上报 API 时收敛为单一来源

## D-012@v1: 执行期裁决——lease.metadata fork 参数组统一契约（claude/pi 双形态）
- type: architecture
- priority: P0
- status: accepted
- source: design-grill
- question: pi 原生 fork 走活 RPC 命令（D-008）与 claude spawn 期 options 形态不同，下行参数契约如何统一？
- answer: lease.metadata fork 参数组四键：resume_at_uuid（claude 链 UUID）、fork_session(bool)、fork_anchor_entry_id（pi 用户 entryId）、fork_mode('resume_at'|'rpc_fork'|'clone')。fork.py 按 provider×锚可得性定 mode：claude→engine_anchor 有=resume_at、无=422；pi→at_run 下一轮 engine_anchor 有=rpc_fork、末轮=clone；codex(seed)→不写 fork 键纯种子。daemon（task-06）按 mode 消费：resume_at→claude SDK options 三件（禁 resumeDropsTurn）；rpc_fork→对源会话活 RPC 发 fork 命令（源死则加载源文件起临时 RPC 再 fork）；clone→pi 全量分叉。CreateSessionInput 对应增 resumeAtUuid/forkSession/forkAnchorEntryId/forkMode 四可选键。
- normalized_requirement: 键名与值域如上；fork.py 输出 mode 进 SessionForkResponse.tier 语义不变（native/seed）；task-05/06 卡同步该契约。
- impacts: [FR-03, FR-04, task-05, task-06]
- evidence: D-008@v1（pi fork 活 RPC 语义）；design.md 接口定义（claude 形态）扩展
- 故障面: rpc_fork 时源 pi 会话文件不可达（跨机/已删）→ fork 失败 4xx，文案提示
- 退役判据: pi 提供 spawn 期截断参数时收敛为 resume_at 同形态

## D-013@v1: 执行期裁决——task-05 六条非破坏裁决披露
- type: risk
- priority: P1
- status: accepted
- source: code
- question: task-05 实现期与卡面/代码现实的六处偏差如何处置？
- answer: ①router/__init__.py _ENDPOINT_ORDER 登记新端点（+4 行，表自带 fail-fast 指示，不登记 app 无法 import）；②native 档补传 resume_session_id+源 runtime 钉定（design「复用 create-with-resume 管道」原文要求，worker_redispatch 先例，源 id 缺→422 可退种子档）；③pi 下一轮存在但锚缺失→422 不降 clone（降级会静默多带分叉点后内容，语义错误）；④fork 异常族定义于 fork.py（errors.py 不在 allowed_paths）经包 __init__ 聚合；⑤create 空 prompt 豁免键=fork_of_session_id、user_input 空内容不落行（零回归，22+139 相邻测试守护）；⑥B.engine_fork_anchor 取实际定位锚（pi rpc_fork=N+1 轮锚，D-012 position-before 语义）。
- normalized_requirement: 六条均为实现必要偏差，不改 D-001~012 语义；task-06 消费键形以本条+D-012 为准（fork_mode 恒写+resume_session_id 承载源会话）。
- impacts: [task-05, task-06]
- evidence: commit 8c5ea3e0b（11 文件）；test_session_fork.py 22/22+相邻 139 绿

## D-014@v1: 执行期裁决——W4 双卡裁决汇总（pi 预 fork 方案/路径漂移//runs DTO 增列归属）
- type: architecture
- priority: P1
- status: accepted
- source: code
- question: task-06/07 实现期的三处实质偏差如何定案？
- answer: ①pi fork 采用「短命 RPC 预 fork」替代卡面「源会话活 RPC」——实证 pi fork/clone 会劫持 RPC 进程自身活跃会话（teardownCurrent+apply），活 RPC 方案须 switch_session 切回且违反 D-005 零侵扰；短命方案（临时 pi --mode rpc --session <源> → fork/clone → get_state 读新分支 → 杀 temp → B 以分支文件 spawn）附带支持源会话已结束场景，失败原样上抛不降级。②pi entryId 不在 message 事件（仅 SessionEntry 落盘后存在）→ message_end(role=user) 回查 get_fork_messages 取轮首锚，失败仅 warn=锚缺失入口灰。③task-07 发现 /runs SessionRunRead 未透出 AgentRun.engine_anchor（native 档门控无数据源）→ session_insights.py 一行增列+gen:types 归 task-08，engineAnchor prop 由 /runs 数据接线。另：task-06 路径漂移两处（建会话真身在 session-manager.ts 非 index.ts facade；CreateSessionInput 在 interactive/types.ts）=代码现实修正。
- normalized_requirement: 上述形态为定案实现；task-08 增 session_insights.py DTO 增列与 prop 接线；pi 锚缺失=入口灰不伪造。
- impacts: [FR-03, FR-04, FR-07, task-06, task-08]
- evidence: commit fa91e133a/02a6c15db；pi 0.81.1 agent-session-runtime.js fork() 劫持实证；pi-events AgentSessionEvent 无 entryId 实测

## D-015@v1: 执行期裁决——W5 双卡裁决汇总（取数形态/卡外接线文件/E2E 缓验）
- type: risk
- priority: P1
- status: accepted
- source: code
- question: task-04/08 实现期实质偏差定案？
- answer: ①task-04 锚取数走 flat_messages×published_logs 双指针内存形态（autoflush=False 下 SELECT 看不到本调用待提交行，查库会致测试/生产行为分叉）；claude 末条优先覆盖、pi 轮首锚仅空时写、provider 取 AgentRun.provider。②task-08 卡外连带 5 文件必要接线：turn-timeline.tsx（轮容器真身，TurnForkEntry 挂载点，group 类加轮标签行防 CopyButton 误触发）、lib/daemon/sessions.ts（SessionRunRead 手写镜像补 engine_anchor）、3 个 dialog 测试 mock 补齐（挂载期新增谱系 fetch）。③onForked 跳 B 采用 WorkerSessionOverlay 浮层（面板无法外部切 sessionId，浮层为既有「打开另一会话」形态）。④列表多跳 v1 单层分组（C 回落主行带徽标，多跳完整表达在面板面包屑）。⑤E2E 缓验：平台本机未运行（探测实证），e2e-claude-fork.md 如实记录+引用 spike SDK 级不知情实证+8 步补验清单，verify 阶段或人工启动平台后照单执行——不伪造。
- normalized_requirement: 上述为定案；E2E 补验清单为 verify 阶段输入。
- impacts: [task-04, task-08, verify]
- evidence: commit d03d3864f/6cbfb966c；e2e-claude-fork.md 探测证据表
