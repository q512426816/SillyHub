---
author: WhaleFall
created_at: 2026-10-14 09:44:05
---

# 决策记录（Decisions）

## D-001@v1: 方案方向定为「消息流预览卡 + 跳转附近预取」
- type: architecture
- priority: P0
- status: accepted
- source: user
- question: 长会话打开后未加载轮次在消息流完全隐身（实测 35 轮仅尾部 12 行有内容），跳转后出现成片「时间· 未指定· 主机· 本机默认」零信息配置占位行，看中间内容必须逐轮点击左侧导航，如何改善？
- answer: 用户在探索阶段从 5 个候选方案（预览卡/附近预取/一键全载/静默回填/头尾折叠）中亲手选定组合「预览卡 + 附近预取」（AskUserQuestion 实选记录于 2026-10-14 会话）。
- normalized_requirement: 未加载轮次在消息流原位渲染可读预览卡（数据来自 turn-outline 大纲摘要）；点击导航跳转某轮时自动并行预取其前后各 1 轮；两者均复用既有 run_id 单轮直达链路，不引入新的后端端点。
- impacts: [FR-01, FR-02, FR-03, task-?, verify-?]
- modules: [frontend_components]
- evidence: 探索实测（frontend/src/components/daemon/session-panel/session-panel-page.tsx:2268 handleJumpToTurn 单轮直达既有链路；frontend/src/lib/daemon/sessions.ts:715 fetchSessionTurnOutline 大纲接口）；用户选择记录 2026-10-14 会话 AskUserQuestion 答复「预览卡 + 附近预取（推荐）」
- 故障面: 预览卡渲染量大（数百轮会话）需依赖既有 content-visibility 屏外跳过；预取请求翻倍需已加载判重防重复 prepend。
- 退役判据: 若未来后端提供轮次分页 API（按轮批量取全文），预览卡+直达链路可整体替换为虚拟滚动方案。

## D-002@v1: 后端零改动，纯前端实现
- type: boundary
- priority: P0
- status: accepted
- source: code
- question: 预览卡与预取的数据从哪来，是否需要新后端端点？
- answer: 不需要。turn-outline 接口（GET /api/daemon/sessions/{id}/turn-outline）已一次下发全量轮次摘要（prompt_summary 60 字/answer_summary/时间/状态/发送者），左侧导航正在消费；run_id 单轮直达（getAgentSessionLogs({run_id})）已支持整轮日志拉取；2026-10-13-load-earlier-full-turn 已铺轮边界合并机制。
- normalized_requirement: 本变更不修改 backend/ 与 sillyhub-daemon/ 任何文件；frontend 接口类型零新增（不触发 pnpm gen:types）。
- impacts: [FR-01, FR-02, task-?]
- modules: [frontend_components]
- evidence: frontend/src/lib/daemon/sessions.ts:709-721（fetchSessionTurnOutline 注释「无 runs 端点的 500 条截断」）；frontend/src/components/daemon/session-panel/session-panel-page.tsx:2350-2420（单轮直达经 prepend 通道）

## D-003@v1: 预览卡展开后保持完整加载（不缩回预览态）
- type: premise
- priority: P1
- status: accepted
- source: user
- question: 用户点开预览卡看完该轮后，卡片是保持完整内容还是缩回摘要？
- answer: 保持完整加载（对齐聊天软件直觉：看过的消息不再消失）；会话切换时随既有 turnState 清理机制整体释放，不做卡级回收。
- normalized_requirement: 预览卡被展开（直达加载完成）后，原位替换为完整轮块并保持，直至会话切换或页面刷新。
- impacts: [FR-01, task-?]
- modules: [frontend_components]
- evidence: 既有行为先例——handleJumpToTurn 直达加载的轮次即永久保留在 turns 状态（session-panel-page.tsx prepend 通道），本决策延续该语义不做新回收机制。

## D-004@v1: 实现架构采用合并式单一数据源（方案 A）
- type: architecture
- priority: P0
- status: accepted
- source: user
- question: 预览卡数据如何进入消息流渲染链路——合并进统一数据列表（A）还是双源渲染时拼接（B）？
- answer: 用户选定方案 A 合并式：大纲条目在 displayTurns 派生层归并（已加载轮用真实 turn，未加载轮合成预览骨架条目），turn-timeline 对骨架条目渲染预览卡分支。方案 B 双源拼接因「两套数据对账竞态」历史高发（ql-20260903-002 同 run 双块 / 2026-09-29-jump-empty-turn-dup 重复直达 / ql-20260916-016 空壳墙）被否决。
- normalized_requirement: 消息流渲染只消费单一列表源（displayTurns）；未加载轮预览条目与已加载轮真实条目同列表共存、同 run_id 键空间去重（加载完成后骨架条目被真实轮条目原位替换，不得同屏双块）。
- impacts: [FR-01, FR-02, task-?]
- modules: [frontend_components]
- evidence: 用户选择记录 2026-10-14 会话 AskUserQuestion 答复「方案 A 合并式（推荐）」；竞态先例 frontend/src/components/daemon/session-panel/session-panel-page.tsx:2354（评审 medium：短轮二次直达重复块）、frontend/src/lib/daemon/session-stream.ts:584（空壳墙 43 空壳实证）
- 故障面: displayTurns 派生复杂度上升（归并逻辑需纯函数外提单测）；outline 刷新触发全量重派生（outline 仅会话切换拉取一次，成本可接受）。
- 退役判据: 若后端未来提供轮次分页全文 API，归并层可替换为服务端分页驱动。

## D-005@v1: 跳转 hit() 内容门显式排除预览卡
- type: risk
- priority: P1
- status: accepted
- source: code
- question: handleJumpToTurn 的 hit() 以「行 textContent > 60 字」判已加载，预览卡自带大纲摘要（后端截 60 字）+ 标签文案可能超阈值，点击未加载轮会被误判已加载而跳过直达——如何防？
- answer: TurnPreviewCard 根节点挂 data-turn-preview="true" 标记，hit() 命中带标记的行直接返回 null（视同未命中，继续直达/翻页）。execute 期实现时发现的边界（非破坏性：局部、可逆、不越 allowed_paths、不改既有决策语义），按 execute-step4 歧义裁决权限自行裁决继续。
- normalized_requirement: turn-timeline.tsx TurnPreviewCard 携带 data-turn-preview 标记；session-panel-page.tsx hit() 对带标记行返回 null；集成测试 session-preview-integration.test.tsx「预览卡不被 hit 误判」用例为回归锚。
- impacts: [FR-03, task-02, task-03]
- modules: [frontend_components]
- evidence: frontend/src/components/daemon/turn-timeline.tsx（TurnPreviewCard data-turn-preview）；frontend/src/components/daemon/session-panel/session-panel-page.tsx:2422 附近 hit() 守卫；测试 frontend/src/components/daemon/__tests__/session-preview-integration.test.tsx
- 故障面: 若未来其它跳转/定位路径也用 textContent 内容门判已加载，需同样排除预览卡（grep data-turn-preview 消费点单一，当前仅 hit()）。
- 退役判据: 预览卡被真实块替换后标记随节点消失，无长期维护成本；若 hit() 改为结构化判定（如按 turn 状态查询）可移除本标记。

