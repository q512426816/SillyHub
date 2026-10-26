---
author: qinyi
created_at: 2026-10-26 14:05:56
---

# decisions.md — 2026-10-26-session-change-progress-hover

> 决策台账。前序步骤（对话式探索/提出方案/分段展示设计）经 AskUserQuestion 确认的决策补录；
> 冲突时新版本 supersedes 旧版本，不覆盖。

## D-001@v1: 轻量变更耗时口径=总时长
- type: definition
- priority: P1
- status: accepted
- source: brainstorm-step3（AskUserQuestion 用户选择）
- question: CLI flow-state.yaml 只有 updatedAt 一个时间戳，无 ①②③ 相位级起止时间，轻量耗时怎么显示？
- answer: 显示总时长（创建 → 最后活跃），本次不做相位级耗时。
- normalized_requirement: 轻量下拉项显示一行总时长文本（created_at → updated_at 差值，人性化格式）；相位级耗时待 sillyspec CLI 侧补时间戳后另立变更。
- impacts: [FR-轻量展示, 前端轻量相位行渲染]
- evidence: flow-state.yaml 实际样例（.sillyspec/changes/archive/2026-10-01-review-followup-reset-guard-machineid/flow-state.yaml 仅 updatedAt）；用户 2026-10-26 AskUserQuestion 回答「显示总时长」
- 复潮条件: sillyspec CLI flow-state 落相位时间戳后，可升级为相位级耗时展示

## D-002@v1: 全量异常态=异色圈+状态字
- type: definition
- priority: P1
- status: accepted
- source: brainstorm-step3（AskUserQuestion 用户选择）
- question: waiting/blocked/revising/stale/failed 等异常态在进度圈上如何与正常推进区分？
- answer: 异常态圈变警示色 + 小字状态标注（如「等输入」「修订中 r2」「已失效」「阻断」「失败」），已完成占比退居其次。
- normalized_requirement: 阶段状态非 pending/in-progress/completed 时，圈渲染警示色（主题 warning/error token——themes.ts:46 实际键名）+ 状态字映射；正常态不受影响。
- impacts: [FR-全量展示, 前端圈渲染组件]
- evidence: 用户 2026-10-26 AskUserQuestion 回答「异色圈+状态字（推荐）」

## D-003@v1: 进度展示位置=下拉项内嵌+入口旁单个总进度圈
- type: architecture
- priority: P0
- status: accepted
- source: brainstorm-step3（AskUserQuestion）+ 用户 2026-10-26 会话中途补充消息
- question: 进度展示放在悬浮框哪个位置？入口外露形态是什么？
- answer: 下拉列表每项内嵌进度行（全量 5 圈横排/轻量 ①②③ 相位行）+ 悬浮框「变更」按钮旁仅露**单个总进度圈**——只展示最新进行中（updated_at 最新非归档）的一个变更；全量与轻量统一为总进度圈口径（全量=总步骤完成占比，轻量=按相位/任务归一的总完成度）。
- normalized_requirement: 入口总进度圈一个圆环，环内或旁标百分比/计数；多变更只渲染最新进行中一个；下拉项内嵌完整进度行；大弹窗保持现状（文件树）不加进度。
- impacts: [FR-入口外露, FR-下拉项内嵌, 前端悬浮框组件结构]
- 故障面: 入口圈依赖 active 列表排序，列表查询失败时圈不渲染（降级现状计数徽标，无遮蔽性故障）
- 退役判据: 用户反馈入口圈信息冗余（与计数徽标重复）时可移除，下拉项内嵌进度行不受影响
- evidence: 用户 AskUserQuestion 回答「下拉项内嵌，额外补充外部悬浮显示进度圈圈（如果有多个，只展示最新的进行中的进度圈圈就行）」+ 中途补充「全量=总进度圈；轻量=总进度圈」

## D-004@v1: 数据链路=方案A后端投影扩展
- type: architecture
- priority: P0
- status: accepted
- source: brainstorm-step4（AskUserQuestion 用户选择）
- question: 进度数据链路架构选哪个？（A 后端投影 / B 前端拉详情 / C SSE 实时推）
- answer: 方案 A：全量细度在 backend enrich_summaries 从 latest_progress 提取（每阶段步骤分组+耗时）；轻量由 daemon 补采集 flow status --json 经 heartbeat 上行后投影进 ChangeSummary；前端单点消费现有 15s 轮询。
- normalized_requirement: ChangeSummary 加计算字段（零 migration，同 step_progress/usage 先例）；前端零新增请求；全量线不动 daemon/CLI。
- impacts: [FR-数据链路, backend 投影, daemon 采集, 前端消费]
- 故障面: latest_progress 畸形/缺字段时投影 fail-open（R-01），新增失败模式仅为「进度字段空导致前端降级」，不触及既有列表渲染路径
- 退役判据: 若后续平台改为事件驱动进度（SSE/WebSocket 推送），本投影提取器可整体下线，DTO 字段保持 optional 兼容
- evidence: 六表上行载荷 stages 含 started_at/completed_at/revision/stale_reason、steps 含 status/completed_at/wait_reason（sillyspec src/progress.js serializeForSync）；ChangeSummary 计算字段先例（backend/app/modules/change/schema.py step_progress/usage/pending_review）

## D-005@v1: execute 阶段圈口径=Task 表 n/m
- type: definition
- priority: P1
- status: accepted
- source: brainstorm-step3（用户原话需求）
- question: execute 阶段进度圈用什么口径？CLI execute 步骤是 Wave 粒度（「Wave N 执行」）不是任务粒度。
- answer: execute 圈按 Task 表聚合 done/total 展示「n/m 任务」，不用 Wave 步骤数。
- normalized_requirement: backend 对 execute 阶段圈补充 task_progress{n,m}（Task 表按 change_id 聚合，status=done 计分子、全量（除 cancelled）计分母）；其余阶段圈保持步骤占比口径。
- impacts: [FR-全量展示, backend 聚合]
- evidence: backend/app/modules/task/model.py Task 表（status 6 值，tasks.md 勾选→done）；sillyspec src/stages/execute.js steps 为 Wave 粒度；用户原话「执行进度要按 tasks 展示 已完成数/总任务数」

## D-006@v1: brainstorm→thin 分流态归轻量渲染
- type: consistency
- priority: P1
- status: accepted
- source: 用户 session 提示词原话
- question: 从全量 brainstorm 中途分流为轻量的变更（adopted_from='brainstorm'）用哪种渲染？
- answer: 归轻量渲染（①②③ 相位行）+ 小字「自头脑风暴转入」标注；不走全量 5 圈。
- normalized_requirement: is_thin=true 的变更一律轻量渲染（含分流出身）；分流出身（steps 有 brainstorm 痕迹或 adopted_from）附加转入标注。
- impacts: [FR-轻量展示, 前端渲染分支]
- evidence: flow.js:700 adopted_from='brainstorm' 通道；frontend/src/lib/thin-lineage.ts 三分支判定；用户提示词原话「brainstorm→thin 分流态归轻量渲染」

## D-007@v1: 升厚变更切换全量渲染+标注
- type: consistency
- priority: P1
- status: accepted
- source: brainstorm-step3（用户原话需求）
- question: 轻量变更实测失败自动升厚（tier=thick）后怎么渲染？
- answer: 显示「已升厚→走全量」标注并切换为全量 5 阶段圈渲染。
- normalized_requirement: thin_flow.upgraded=true 时徽标区显示「已升厚」、进度行切全量 5 圈（升厚后 current_stage 恢复阶段机值，自然走全量渲染分支）。
- impacts: [FR-轻量展示, daemon 上行字段]
- evidence: flow.js:1728 实测失败自动升厚（tier:'thick'+upgrade_reason）；flow-state.yaml legacy_fallback 字段；用户原话「升厚的变更显示已升厚→走全量」

## D-008@v2: 轻量数据通道=daemon heartbeat 载荷扩展+条目 workspace 维度+backend 全新逐变更写入路径
- type: architecture
- priority: P0
- status: accepted
- supersedes: D-008@v1
- source: design-grill（2026-10-26 S2 独立评审阻断 1）
- question: thin_flows 如何定位并写入目标变更行？（v1 假设按 workspace+change_key 匹配既有消费逻辑——Grill 实证该逻辑不存在）
- answer: ①载荷条目加 workspace_id 键（sillyspec_status 是 daemon 实例级全局键、多工作区 status_map 级化，无 workspace 维度无法定位）；②backend 新增逐变更写入路径（既有语义是整包快照直写 daemon_instances，不逐条改 changes 表）：行锁事务 SELECT FOR UPDATE→merge stages["thin_flow"]→UPDATE；③reparse 重建 stages 丢键由下跳 heartbeat 自愈。
- normalized_requirement: DaemonHeartbeatThinFlow 必含 workspace_id；写入不刷 changes.updated_at（D-014@v1）；坏条目/未匹配行单条丢弃整批不拒。
- impacts: [FR-03, FR-06, backend heartbeat 消费, daemon 载荷组装]
- 故障面: 行锁事务防 read-modify-write 竞态；自愈窗口 ≤1 心跳周期内 thin_flow 显示为 None（前端降级现状）；新增失败模式无遮蔽性故障
- 退役判据: 同 D-008@v1（CLI 六表并入协议后整链可移除）
- evidence: backend/app/modules/daemon/runtime/service.py:462-468（整包直写实证）；heartbeat.py:264-268（status_map 级化）；Grill review.json brainstorm-review-2026-10-26-134910

## D-013@v1: 入口圈选取=前端显式 updated_at 重排
- type: consistency
- priority: P1
- status: accepted
- source: design-grill（阻断 2）
- question: FR-05"updated_at 最新"与后端列表序"未归档优先+created_at desc"打架，active[0] 是否可用？
- answer: 不可用——前端显式按 updated_at 取 max 重排选取，禁用列表序直接取首。
- normalized_requirement: ChangeTotalProgressRing 的目标变更 = [...active].sort(updated_at desc)[0]；不依赖后端返回序。
- impacts: [FR-05, change-total-progress-ring.tsx]
- evidence: session-change-files-hover.tsx:63（后端排序注释）；Grill review.json

## D-014@v1: heartbeat thin_flow 写入不刷 changes.updated_at
- type: definition
- priority: P1
- status: accepted
- source: design-grill（瑕疵 4）
- question: heartbeat 每跳落 thin_flow 若刷 updated_at，入口圈（按 updated_at 选取）会系统性偏向轻量变更？
- answer: 写 stages["thin_flow"] 不刷 changes.updated_at——updated_at 语义保持"最后变更元数据变更"。
- normalized_requirement: UPDATE 语句只 set stages 列；入口圈选取口径因此对全量/轻量中立。
- impacts: [FR-05, backend heartbeat 写入路径]
- evidence: Grill review.json 瑕疵 4；D-013@v1

## D-008@v1: 轻量数据通道=daemon heartbeat 载荷扩展（已被 D-008@v2 取代）
- type: architecture
- priority: P0
- status: superseded
- supersedes_by: D-008@v2（Grill 阻断 1：v1 的"按 workspace+change_key 匹配既有消费逻辑"假设不成立——既有语义是整包快照直写）
- source: brainstorm-step6 设计期决策（基于方案 A 落地路径）
- question: flow status --json 的采集结果经哪条通道上行平台？（CLI platform sync 六表协议不动——thin 红线不落数据库）
- answer: daemon sillyspec-manager.ts 采集器补跑 `flow status --json`（与现有 progress show --json 同模式），结果并入 heartbeat sillyspec_status 载荷（hub-client.ts 已有该键先例）；backend heartbeat 消费侧解析落 change.stages JSON 列（thin_flow 子对象）。
- normalized_requirement: 不改 sillyspec CLI；daemon 采集频率与现有 progress 采集同拍；旧 daemon 无该键时平台侧 thin_flow 为空 → 前端降级现状展示。
- impacts: [FR-数据链路, daemon 采集器, backend heartbeat 消费, 兼容策略]
- 故障面: daemon 采集失败→thin_flows 缺席→平台 thin_flow 停在旧值（陈旧展示不报错）；heartbeat 坏条目单条丢弃整批不拒（design 生命周期表）
- 退役判据: sillyspec CLI 若将来把 flow 状态并入六表上行（协议统一），daemon 采集与 heartbeat 扩展链路可整体移除，backend 直读 latest_progress
- evidence: sillyhub-daemon/src/sillyspec-manager.ts progress 采集三态矩阵；hub-client.ts:47 heartbeat sillyspec_status 键；backend changes 表 stages JSON 列（model.py:196）

## D-009@v1: 已归档项不渲染进度行
- type: boundary
- priority: P2
- status: accepted
- source: brainstorm-step3 agent 推断（用户未否决，默认口径）
- question: 已归档变更（折叠组）是否渲染进度？
- answer: 不渲染——终态无信息量，保持现状名称+时间。
- normalized_requirement: 归档组条目维持现有渲染，不加进度行。
- impacts: [FR-全量展示, FR-轻量展示]
- evidence: session-change-files-hover.tsx 现状归档折叠组
- 复潮条件: 用户提出归档项也要看历史进度时再加（只读终态渲染）

## D-012@v2: 变更计数徽标双色——蓝=blue-* 固定阶真信息蓝
- type: definition
- priority: P2
- status: accepted
- supersedes: D-012@v1
- source: 用户 2026-10-26 会话中途补充消息 + design-grill（瑕疵 1 修正 token 口径）
- question: 悬浮框「变更」按钮计数徽标目前恒绿色（bg-emerald-600），如何区分有无未完成变更？蓝色用什么色阶？
- answer: 有未完成（active>0）时徽标改蓝；无未完成（active=0，仅剩归档）保持绿色（完成态语义）。蓝色用 **blue-* 固定阶**（本场景是 CLAUDE.md 规则 20 的"真信息蓝"语义，不随主题换肤）——semantic.info 不可用（两主题下均为青，themes.ts D-003@v2"info 不再是蓝"）。
- normalized_requirement: 计数徽标双态：active.length>0 → blue 固定阶（具体阶级 execute 取 blue-600 对齐现状饱和度）；active.length===0 → 绿（现状 bg-emerald-600 系）。呼吸动画逻辑不变。
- impacts: [FR-08, frontend/src/components/daemon/session-change-files-hover.tsx 计数徽标]
- 锚点: frontend/src/components/daemon/session-change-files-hover.tsx:211
- evidence: session-change-files-hover.tsx:211-218 现状恒 bg-emerald-600；frontend/src/styles/themes.ts semantic.info 两主题取值（青）；Grill review.json 瑕疵 1

## D-010@v1: 落选方案B（前端按需拉详情）
- type: architecture
- priority: P2
- status: rejected
- source: brainstorm-step4
- question: ChangeSummary 不动、前端对每个变更项再调详情/聚合端点？
- answer: 否决。
- 否决理由: 下拉 N 个变更项=N+1 请求，15s 轮询下放大；悬浮框紧凑场景逐项延迟可见；数据口径散在两端。
- 复潮条件: 变更列表项数百级、ChangeSummary 载荷成为瓶颈时重新评估。
- impacts: []
- evidence: brainstorm-step4 方案对比表

## D-011@v1: 落选方案C（daemon SSE 实时推）
- type: architecture
- priority: P2
- status: rejected
- source: brainstorm-step4
- question: daemon 把进度变化走会话 SSE 事件流实时推前端？
- answer: 否决。
- 否决理由: 会话 SSE 是会话域事件流，混入变更进度域语义膨胀；daemon 离线时前端无数据；15s 轮询对进度展示足够。
- 复潮条件: 用户对进度实时性提出秒级要求且接受通道语义扩展时重议。
- impacts: []
- evidence: brainstorm-step4 方案对比表
