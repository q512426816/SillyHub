---
author: qinyi
created_at: 2026-10-12 20:57:41
---

# 决策记录（Decisions）— 2026-10-12-session-defects

> 证据基线：生产会话 47e2ff1a 导出（`会话导出_完整信息_20261012_121913.zip`，30 runs / 5654 logs / 174 task 行）。
> 全部决策在 brainstorm Step 3/4/5 经用户确认（AskUserQuestion 留痕）。

---

## D-001@v1

- **type**: scope
- **status**: accepted
- **source**: 用户（brainstorm Step 3，AskUserQuestion「修复范围」选「全部五组」）
- **question**: 本变更修复范围如何切分？
- **answer**: 全部五组：F1 错误归因+自动压缩续跑、F2 日志时间戳与消息碎片、F3 任务幽灵行、F4 策略写守卫路径解析、F5 导出与元数据。
- **normalized_requirement**: 五组缺陷全部在本变更内交付修复，不得以「另行立项」裁撤任一组。
- **impacts**: [FR-01~FR-05 全部, tasks 全量]
- **evidence**: 生产导出 runs 3-12（Prompt is too long ×10）/ run 26（SERVICE_RESTART_INTERRUPTED）/ run 30（429 配额）/ 05:50:34.59Z 时间戳聚集 ×8 簇 / 任务表 23 组幽灵成对行 / deny 文案 `<工作区>/-p`
- **priority**: P0
- **锚点**: .sillyspec/changes/2026-10-12-session-defects/proposal.md:1
- **模块域**: sillyhub-daemon, backend, frontend

## D-002@v1

- **type**: architecture
- **status**: accepted
- **source**: 用户（brainstorm Step 4，AskUserQuestion「实施策略」选「两波风险分层」）
- **question**: 五组缺陷的实施顺序用哪种策略？
- **answer**: 两波风险分层：波1 数据管道可靠性（F2/F3/F5，机械性低风险先行）→ 波2 行为类（F1/F4，高风险后行）。波边界即验收检查点。
- **normalized_requirement**: execute 阶段任务编排必须先完成波1 全部任务再进入波2；波1 验收（单测+复现测试）通过是波2 的前置。
- **impacts**: [plan Wave 划分, FR-02/FR-03/FR-05 先于 FR-01/FR-04]
- **evidence**: F1 调试依赖干净日志时间戳（波1 先行收益）；fire 会话 15 任务三仓先例证明波内可并行。
- **priority**: P1
- **故障面**: 波1 若因 F3 根因调查超期，会阻塞波2 全部高优修复——对策：F3 调查任务限时，兜底方案（导出/列表去重）可独立交付。
- **退役判据**: 若波2 期间发现波1 数据面仍有阻断性缺陷，允许单点回补波1（不推翻分层）。

## D-003@v1

- **type**: architecture
- **status**: accepted
- **source**: 用户质询（brainstorm Step 4 期间：「自动压缩不应该是 agent 本身的能力吗」）+ 代码查证
- **question**: 上下文超限的全自动压缩续跑，压缩逻辑由谁实现？
- **answer**: 压缩能力是 agent CLI 原生能力，平台不重造。平台仅编排：daemon 分类器补 `context_overflow` 归因 → backend auto_resume 新增 context_overflow 分支调既有 `compact_session`（claude 分路注入原生 `/compact`；pi/codex 分路走 `session_compact` RPC → `driver.compact(handle)`）→ 成功后重放本轮用户消息。平台零压缩实现。
- **normalized_requirement**: 平台代码不得自行实现任何上下文压缩逻辑；自动恢复链路只允许调用 `compact_session` 既有双分路入口；压缩成功判定与失败兜底不得自造协议。
- **impacts**: [FR-01, task-F1 全部]
- **evidence**: backend/app/modules/daemon/session/service/compact.py:49-53（COMPACT_PROMPT="/compact" + COMPACT_RPC_METHOD="session_compact" 双分路）；daemon interactive/session-manager.ts:1275（compact→driver.compact）；会话 47e2ff1a run 13 用户手动 /compact 实证端到端可用。
- **priority**: P0
- **锚点**: backend/app/modules/daemon/session/service/auto_resume.py:338
- **模块域**: backend, sillyhub-daemon
- **故障面**: compact 完成检测若误判（如压缩中静默超时）可能重放消息到未压缩会话再次爆窗——对策：熔断（D-005@v1 见 rejected/确认序）+ 连续计数上限。
- **退役判据**: 若上游 Claude CLI 未来原生支持「超窗自动压缩后续跑」且平台 daemon 可观测到，则退役本编排分支。

## D-004@v1

- **type**: architecture
- **status**: accepted
- **source**: AI 设计（Step 5 展示，用户确认）
- **question**: 日志时间戳塌缩与消息碎片在哪一层修？
- **answer**: 时间戳：daemon wire 层消息对象增加可选 `timestamp`（事件到达时刻捕获），backend 落库优先取 wire 值（钟差 ±5 分钟外或非法回落本地时钟）。碎片：daemon wire 层按 message id 缓冲连续 assistant/thinking delta，消息完结单行落库；并核查 segment_id partial→final 覆盖链路补删残留。字段可选，daemon/backend 可独立发版（向后兼容）。
- **normalized_requirement**: 新批次日志行 timestamp 必须反映事件发生时刻（同毫秒聚集行数 ≤2）；同一 assistant 消息最终只落一行完整内容；wire 新字段缺席时行为与现状完全一致。
- **impacts**: [FR-02]
- **evidence**: 生产导出同一时间戳 8~31 行聚集 ×8 簇（最甚 07:56:08.553Z×31）；sillyhub-daemon/src/event-wire.ts:285（ts 仅进 tool_call content，消息本体无时间字段）；backend AgentRunLog.timestamp default now（backend/app/modules/agent/model.py:548 段）。
- **priority**: P0
- **锚点**: sillyhub-daemon/src/event-wire.ts:285
- **模块域**: sillyhub-daemon, backend

## D-005@v1

- **type**: architecture
- **status**: accepted
- **source**: AI 设计（Step 5 展示，用户确认）
- **question**: 任务幽灵行（同名 stopped(空)+completed(真) 成对）如何修复？
- **answer**: 先根因调查（以生产成对模式为复现目标，追 task_id 生命周期与 sweep 竞态），再修：核心不变量「一个逻辑任务一行、真实终态不被清扫覆盖」；兜底：导出与任务列表渲染按（会话+任务名）取最新真实终态行去重。
- **normalized_requirement**: 修复后同会话同名任务在 agent_session_task 至多一行真实终态；生产导出模式的复现测试修复后转绿；导出/列表不得再出现同任务双行。
- **impacts**: [FR-03, FR-05（导出兜底共用）]
- **evidence**: 导出 174 行任务中 23 组成对（stopped(None)+completed(摘要)）；backend/app/modules/daemon/agent_task_store.py（upsert 键 (session_id, task_id)；RUN_CLOSE_SWEEP_REASON 清扫标记）。
- **priority**: P1
- **故障面**: 调查可能定位到 daemon 侧 task_id 重生成（恢复/replay 路径），修复跨 daemon+backend 两端——对策：调查任务限时 1 天，兜底去重可先行交付。

## D-006@v1

- **type**: architecture
- **status**: accepted
- **source**: AI 设计（Step 5 展示，用户确认）
- **question**: 可自动恢复的失败轮（context_overflow/quota）对 interactive 会话状态语义是什么？
- **answer**: 不应终态化。现行 `helpers.py:99` 多轮对话失败返 active——但生产实证会话 47e2ff1a 终态 failed，存在未知翻 failed 路径，本变更含调查任务：找出真实翻 failed 路径并修正（恢复预算耗尽才 failed）。
- **normalized_requirement**: interactive 会话（spec_strategy=interactive 且 change_id is NULL）遭遇单次 context_overflow/quota 失败轮时会话保持 active；自动恢复预算（D-003 熔断 + quota 链上限）耗尽后才允许 failed。
- **impacts**: [FR-01]
- **evidence**: backend/app/modules/daemon/session/service/helpers.py:99-130（多轮返 active）；导出 session.status=failed 与该逻辑矛盾；run 3-12 连续失败未翻 failed（佐证多轮保护生效）但终态仍 failed（待查路径）。
- **priority**: P1
- **锚点**: backend/app/modules/daemon/session/service/helpers.py:99
- **模块域**: backend

## D-007@v1

- **type**: bugfix-approach
- **status**: accepted
- **source**: AI 设计（Step 5 展示，用户确认）
- **question**: 策略写守卫两类误拒（flag 当路径、相对路径锚点错误）如何修？
- **answer**: ① shell-paths.ts 全部捕获目标过滤 `-` 前缀 token（tee/mkdir/touch 捕获组补过滤，cp/mv 已有）；② 相对路径解析锚点从 daemon process.cwd() 改为会话工作区根（write-guard 裁决时以 session rootPath 为基）；③ deny 文案在 realpath 与原始拼写不一致时附双拼写提示。
- **normalized_requirement**: `mkdir -p x`/`unzip -p` 类命令不再产出 `-p` 目标路径；会话工作区内相对路径写操作在 allowed_roots 含工作区（任一拼写）时放行；deny 文案必须含可操作信息。
- **impacts**: [FR-04]
- **evidence**: 生产 deny 文案「目标路径：/mnt/c/Users/Vzi/Desktop/2026/2026消防设施器材/-p 原因：目标目录未配置为可写目录」（会话 47e2ff1a 02:51:18Z）；sillyhub-daemon/src/policy/shell-paths.ts:125-135（tee/mkdir 捕获组无 - 过滤）；sillyhub-daemon/src/policy/path-utils.ts:64（pathResolve 按 daemon cwd）。
- **priority**: P0
- **锚点**: sillyhub-daemon/src/policy/shell-paths.ts:130
- **模块域**: sillyhub-daemon

## D-008@v1

- **type**: scope
- **status**: accepted
- **source**: 用户确认（Step 3 范围决策附随）+ CLAUDE.md 规则 15
- **question**: sillyspec CLI 自身缺陷（cwd 耦合、deps 门控脆弱）是否在本变更修复？
- **answer**: 不修码。按 CLAUDE.md 规则 15 记录到 `docs/sillyspec/`（活跃坑），由 sillyspec 工具仓后续处理。
- **normalized_requirement**: 本变更代码改动不得触及 sillyspec 工具自身；`docs/sillyspec/` 新增两条工具缺陷记录（CLI 主仓定位、deps 门控重供链路）。
- **impacts**: [task-记档 ×2]
- **evidence**: 会话 47e2ff1a 8 条「CLI 错误目录」日志；npm ci 离线失败→手工改 meta.json 绕过记录。
- **priority**: P2

---

## 落选方案

## D-R01@v1 平台自实现上下文压缩

- **type**: architecture
- **status**: rejected
- **source**: brainstorm Step 4 方案对比
- **question**: 上下文压缩是否由平台自行实现（自建摘要管道）？
- **answer**: 否决。
- **否决理由**: 重造 agent 原生能力；与 agent CLI 的压缩实现双轨漂移；平台自建摘要质量无法对齐 CLI 原生 /compact，且需维护双份 prompt 摘要协议。
- **复潮条件**: agent CLI 原生 compact 通道不可用（caps.compact=false 且无 RPC 回执）且用户明确要求平台兜底压缩时。
- **normalized_requirement**: 平台代码不得出现自建摘要/压缩实现。
- **impacts**: [FR-01]
- **evidence**: backend/app/modules/daemon/session/service/compact.py 已有原生编排入口，自建无增量价值。
- **priority**: P1

## D-R02@v1 仅修 F1 单组

- **type**: scope
- **status**: rejected
- **source**: brainstorm Step 3 范围选项
- **question**: 是否仅修最痛的 F1？
- **answer**: 否决（用户选全部五组）。
- **否决理由**: F2/F3 数据质量缺陷直接干扰 F1 的问题定位与验收观测；F4 是高频误拒主诉；分批立项拉长修复周期。
- **复潮条件**: 排期资源不足需砍范围时，按 F2→F3→F5→F4 顺序降级裁撤（F1 保留）。
- **normalized_requirement**: （已被 D-001 取代，留档备查）
- **impacts**: [scope]
- **evidence**: 生产实证五组缺陷同源（同一会话导出）。
- **priority**: P2

## D-009@v1: 幽灵成对行根因与修复落点（执行期裁决）

- **type**: consistency
- **priority**: P0
- **status**: accepted
- **source**: execute Wave1 task-03 根因调查（歧义裁决：非破坏性，未越 allowed_paths）
- **question**: 生产 21 组「同名 stopped(空摘要)+completed(真摘要)」成对行的真实成因是什么？修复落 backend 还是 daemon？
- **answer**: 根因=daemon 侧 tool_use 派生 running 事件以 tool-use call id 冒充 task_id（sillyhub-daemon/src/interactive/claude-events.ts:895 `strOf(toolInput?.['task_id']) || tId`——Agent 工具入参无 task_id 时回落 call id），SDK 真帧用 harness task_id，同任务双 id 在 (session_id, task_id) 定位键下各落一行；call-id 行永收不到终态、被清扫成 stopped(空摘要)。修复落 **backend upsert**（task-03 白名单内）：事件带 tool_use_id 且异于 task_id 时，同会话 task_id==tool_use_id 且同名的冒名行重映射转正（真实行缺）或吸收删除（真实行已并存）；daemon 侧停止伪造 id 属源修，超出本 task 边界，记档待后续变更（读侧去重 task-06 兜底历史数据）。
- **normalized_requirement**: 事件带 tool_use_id 关联键时同实例 MUST 单行；无 tool_use_id 的同名异 task_id（合法重试重生成）MUST 保持各一行；task_name 不同 MUST NOT 合并。
- **impacts**: [FR-04, task-03, task-06]
- **evidence**: 生产导出 21 个成对名各仅 1 个 TASK_STARTED id（排除重试重生成）；agent_task_store.py upsert 定位键与唯一约束实测；复现测试先红（2 failed）后绿（33 passed）。
- **锚点**: backend/app/modules/daemon/agent_task_store.py:_resolve_row_with_ghost_reconciliation
- **模块域**: backend
- **故障面**: 冒名行 task_name 与真帧名不一致时不合并（残留成对行）——由 task-06 读侧去重兜底；tool_use_id 与真实 harness task_id 撞串理论上可误并（概率趋零，字符串空间不同）。
- **退役判据**: daemon 侧源修落地（tool_use 派生事件不再伪造 task_id）后，本合并逻辑退化为纯防御，可在 daemon 版本对齐后移除。

## D-010@v1: F2b 合并缓冲器接入边界（执行期裁决）

- **type**: boundary
- **priority**: P1
- **status**: accepted
- **source**: execute Wave3 task-02（歧义裁决：非破坏性，未越 allowed_paths）
- **question**: coalescer 的批处理道（task-runner）接线在 allowed_paths 之外（event-wire.ts + backend submit_steps 有限），如何落地？
- **answer**: coalescer 以可选参接入 eventToSubmitMessages（不传=legacy 直发零回归），unit 级验收达标；task-runner 批处理道接线超出本 task allowed_paths，留待 follow-up（一行传参改动）。生产主受害面（interactive 会话）由既有 override 协议覆盖（claude-events D-004@v1：partial flush→完整行 override:true→backend 按 segment_id 跨调用 DELETE，submit_steps.py:295/:352 实证链路完整）；生产残留成对片段源自事故时点（10-10）daemon 尚未包含该协议，无需本变更再修。
- **normalized_requirement**: FR-03 验收在 wire 单元级达成（3 delta+完结→单行完整内容）；interactive 路径行为由既有 override 协议保证，不因本裁决退化。
- **impacts**: [FR-03, task-02]
- **evidence**: message-coalescer.test.ts 13 用例绿；submit_steps.py override/DELETE 链路审计（:275-:352）；claude-events.ts 头注（D-004@v1 移植说明）。
- **锚点**: sillyhub-daemon/src/agent-log/message-coalescer.ts:1
- **模块域**: sillyhub-daemon
- **退役判据**: task-runner 接线落地且流式 delta 全走缓冲后，可选参的 legacy 分支可移除。

## D-011@v1: 会话 47e2ff1a 翻 failed 真实路径（调查结论）

- **type**: consistency
- **priority**: P0
- **status**: accepted
- **source**: execute Wave3 task-09 调查（D-006 预授权的落点调查）
- **question**: helpers.py:99 多轮保护（interactive+change_id=NULL→active）下，生产会话 47e2ff1a 为何终态 failed？
- **answer**: run 级变更归因（2026-10-12-run-level-change-attribution，inject.py:621 run.change_id=session.current_change_id）让聊天轮携带 change_id → is_multi_turn 判定失效 → 走单轮收口分支，run 30（429 配额失败）→ session failed。时间线吻合：runs 3-12（纯聊天轮 change_id=NULL）失败会话存活，run 30（变更上下文轮）失败即终态。修复=helpers 增会话级可恢复失败豁免（interactive + error_detail.type∈{quota_exceeded,context_overflow} → active，闸拒绝覆写优先级不变）。
- **normalized_requirement**: interactive 会话遭遇可自动恢复失败时 MUST 保持 active（自动恢复与手动续发的共同前置门）；非可恢复失败与非会话型轮语义零变化。
- **impacts**: [FR-01, task-09, task-08]
- **evidence**: inject.py:621（run.change_id 回填）；helpers.py 判定；test_apply_session_terminal_status 4 新用例先红后绿（21 全绿含既有语义零回归）。
- **锚点**: backend/app/modules/daemon/session/service/helpers.py:_is_recoverable_model_failure
- **模块域**: backend
- **故障面**: 自动恢复预算耗尽后会话仍保持 active（用户手动续发门保留）——语义取「活跃可续发」而非「终态」，重复失败累积可见于失败轮历史。
- **退役判据**: 若未来引入会话级「恢复预算」持久状态，可把豁免收窄为预算内（当前 active 语义为其超集，行为安全）。

## D-012@v1: task-runner 门面 golden 连带修复（执行期裁决）

- **type**: consistency
- **priority**: P1
- **status**: accepted
- **source**: execute Step 11 全量测试（task-runner.test.ts ×7 失败归因）
- **question**: F2a wire timestamp 经 task-runner 门面 `_eventToMessages` 透传，门面 golden 精确断言 ×7 失效——测试文件在 task-01 related_tests 与 allowed_paths 之外，如何处置？
- **answer**: 单点修复——`callEventToMessages` helper 剥离动态 timestamp 后比较（与 event-wire.test.ts 比较器同口径），golden 值断言语义不变；属 plan 阶段连带测试归属漏列（plan-postcheck 该项为 best-effort），本修为测试文件断言更新（零生产代码、可逆、局部），按非破坏性自行裁决落盘留痕。另两失败经主仓对照实证与本变更无关：pi-rpc-driver-turn-result（全量并行负载下 flaky，单跑 13/13 绿）、provider-injection-smoke.integ（主仓同败，需真实 codex CLI 的环境用例）。
- **normalized_requirement**: 门面 golden 断言剥离动态字段后必须全绿；生产行为断言不得为凑绿删改。
- **impacts**: [FR-02, task-01, task-12]
- **evidence**: task-runner.test.ts 72/72 绿；主仓 main 同败对照（provider-injection-smoke）。
- **锚点**: sillyhub-daemon/tests/task-runner.test.ts:callEventToMessages
- **模块域**: sillyhub-daemon
- **退役判据**: 若门面层后续改为显式注入时钟（可测时间），剥离逻辑可移除改精确断言。
