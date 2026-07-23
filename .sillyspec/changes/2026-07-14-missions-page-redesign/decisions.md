---
author: qinyi
created_at: 2026-07-14 10:16:00
---
# 决策台账 — 2026-07-14-missions-page-redesign

本变更的决策台账（非长期术语表）。每条含稳定版本 ID（D-xxx@vN）。后续 Design Grill 若修正，新版本 supersedes 旧版本。

## D-001@v1 — mission 固定 team 模式
- type: 架构取舍
- status: accepted
- source: 对话式探索 Q2（范围）
- question: mission 页面是否保留 single/team 选择？
- answer: 砍掉 single，mission 固定走 team 链路。
- normalized_requirement: 前端移除 mode 切换 UI（ModeCard + mode state）；createMission 固定传 mode="team"。
- impacts: mission-console 删 ModeCard/mode；后端 mode 字段 single 分支保留不删（零回归）；GLM CoordinatorPlanner（single 链路）对 mission 入口不再触达但代码保留。
- evidence: router.py:783 `constraints["mode"]=="team"` → OrchestratorService；orchestrator.py:113 与 single 互斥注释；mission_schema.py:17 `mode: Literal["single","team"]|None`。
- priority: P0

## D-002@v1 — 分身默认自动、高级手动预设
- type: 用户场景/默认值
- status: accepted
- source: 对话式探索 Q1（分身配置）
- question: team 模式下用户要不要手填 worker 列表？
- answer: 默认不填（主 agent 自动拆分身），"高级：手动配分身"折叠区可手动预设。
- normalized_requirement: TeamConfigPanel 改为 `<details>` 默认折叠；worker_preset 为空时不传/传空数组，主 agent 自动 dispatch_worker。复用 team-main-agent-orchestration D-002@v2 的 worker_preset 可空语义。
- impacts: 创建态 UI 形态（高级折叠默认关）；前端 workers state 初始为空。
- evidence: orchestrator.py:69-76 `render_orchestrator_prompt` 中 `mission.worker_preset` 空 → `preset_hint=''`，主 agent 自主 dispatch_worker。
- priority: P1

## D-003@v1 — 详情顶部成败总览 + AI 最终结论
- type: 用户场景/验收
- status: accepted
- source: 对话式探索 Q3（成败总览）
- question: 详情页成败总览展示什么？
- answer: 中文状态徽标 + 成败统计（X 成功 / Y 失败 / N 分身）+ 累计成本 + AI 最终结论（Finalizer summary）。
- normalized_requirement: 新增 MissionSummaryCard 组件；从 `mission.workers[].artifacts` 中找 `kind==="summary"` 的 artifact 作为 AI 结论展示。
- impacts: 前端新增总览卡组件；后端无改动（summary 已由 Finalizer 落库）。
- evidence: finalizer.py:183-190 `finalize_bootstrap_mission` 产 `AgentArtifact(kind="summary")` 挂 mission 首个 worker run（`_carrier_run`），mission∈{done,degraded} 时 converge 触发（converge_mission_for_completed_run:504）。
- priority: P1

## D-004@v1 — 单栏流式布局
- type: 架构取舍
- status: accepted
- source: 方案选择 step8（用户选 A）
- question: 页面布局方案？
- answer: 方案 A 单栏流式——输入框顶置，历史收进顶部下拉按钮，点历史/启动后整块换成详情。
- impacts: 保留现有 URL `?mission=<id>` 同页切换逻辑；创建态/详情态互斥（`!mission` / `mission`）。
- evidence: mission-console.tsx `readMissionIdFromUrl`/`writeMissionIdToUrl` + `!mission` 条件渲染。
- priority: P1

## D-005@v1 — 全量中文化 + 藏黑话
- type: 文案/展示
- status: accepted
- source: 用户硬约束 3+4
- question: 状态词/角色/术语如何呈现？
- answer: 状态全中文映射；角色中文化去 `[role]` 方括号代号；黑话隐藏（Coordinator→主控 / Worker→分身 / daemon→后台 / Mission→任务）；workspace/mission/run 三层标识完全不露给用户。
- normalized_requirement: 新增 STATUS_LABEL 映射（planning→规划中 / running→运行中 / done→已完成 / degraded→部分完成 / failed→失败 / cancelled→已取消）；ROLE_LABEL 保留翻译但不显 `[role]` 方括号；UI 文案全替换。
- impacts: 前端 STATUS_LABEL + WorkerRow 删 `[role]` 显示；描述/按钮文案重写。
- priority: P2

## D-006@v1 — 长文本折叠截断
- type: 展示细节
- status: accepted
- source: 用户硬约束 5
- question: 历史 mission 标题、worker 分工目标长文本如何处理？
- answer: 历史条目 truncate（省略号）+ `title` hover 全文；worker 分工目标（objective 几百字指令）默认折叠，点开看完整。
- impacts: 历史列表 button 加 truncate CSS；WorkerRow objective 包可折叠容器（受控 state / details）。
- priority: P2

## D-007@v1 — 历史记录默认收起
- type: 交互偏好
- status: accepted
- source: 用户诊断（历史 details open 抢焦点，创建表单被挤下方）
- question: 历史 Mission 列表默认展开还是收起？
- answer: 默认收起，收进顶部"历史(N)"下拉按钮，点击展开下拉列表。
- impacts: 历史 details 默认 close；改顶部按钮触发下拉（Dropdown/Popover）。
- priority: P2

## D-008@v1 — 范围限定 Mission 页面
- type: 非目标边界
- status: accepted
- source: 对话式探索 Q2（范围）
- question: 砸掉 single 的范围多大？
- answer: 本次只改 Mission 页面（`/workspaces/<id>/missions`）；execute/verify/会话入口的 single/team 以后单独变更处理。
- impacts: 不动 `changes/[cid]/page` 的 stage-team-config、`interactive-session-panel` 的 mode 分流；不阻塞 team-mode-platform-wide 变更（其主战场是 bootstrap/execute/verify/会话入口 team 透传）。该变更 Phase 1"mission 加 mode 选择"子目标因本次 D-001 作废，archive 时同步标记。
- evidence: team-mode-platform-wide proposal Phase 2-4 涉及 execute/verify/会话，本次不碰。
- priority: P0（边界）
