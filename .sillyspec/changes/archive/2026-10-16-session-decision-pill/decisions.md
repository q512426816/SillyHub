---
author: qinyi
created_at: 2026-10-16 11:02:17
generated_by: sillyspec-fourpiece-init
change: 2026-10-16-session-decision-pill
---

# 决策记录（Decisions）

<!-- 增量落盘：每解决一个有实现影响的问题当场追加一条（格式见 brainstorm Step 3 模板）；幂等按 D-xxx@vN 判重 -->
<!-- 引用规范：evidence 等处的源码位置写仓根相对全路径+行号（src/foo.js:123）——裸文件名在 docs-check 层1 靠 basename 全仓扫描找候选，找不到候选或关键词窗口不匹配即失效，到 pre-push 才拦（2026-09-19 实证 64 处返工） -->

## D-001@v1: 决策 pill 类型范围——三类全含，后两类仅实时 pending
- type: boundary
- priority: P0
- status: accepted
- source: user
- question: 会话决策 pill 覆盖哪些"让我决策的信息"类型？是否含历史？
- answer: 用户选择"三类全要，但后两类只看当前待决策"：AskUser 提问含 pending+已答历史；工具审批（canUseTool）与 Plan 审批仅聚合当前实时 pending，不追历史（历史用聊天时间线回看）。
- normalized_requirement: pill 聚合三类决策信息——AskUser 提问（pending + answered/cancelled 历史，数据源 session_dialog_requests 表 REST）；工具审批与 Plan 审批仅当前会话实时 pending 态（SSE/内存态），不为二者新增后端持久化。
- impacts: [FR-01, FR-02]
- 模块域: frontend_components
- evidence: backend/app/modules/daemon/model.py:285（SessionDialogRequest 表）、backend/app/modules/daemon/permission_service.py:6-15（普通审批纯内存 5min 超时、dialog 持久化）、frontend/src/lib/daemon/sessions.ts:163-190（fetchPendingDialogs/fetchSessionDialogHistory）、用户第 1 轮问答选择
- 故障面: 工具审批/Plan 审批 pending 依赖 SSE 实时态——页面刷新后丢失（与聊天流卡片同现状），pill 上不显示刷新前漏掉的实时审批
- 退役判据: 后续若为工具审批/Plan 新增持久化，本边界升级为全类型含历史

## D-002@v1: pending 项点击动作——定位回聊天流卡片，普通工具审批跳聚合页
- type: boundary
- priority: P1
- status: accepted
- source: user
- question: 点击 pill 列表里的待决策项后做什么？
- answer: 用户选方案 1（定位回聊天流卡片）：pending 卡 sticky top-0 常驻聊天流顶部不会滚丢，被最小化的可还原。普通工具审批（无 dialog_kind）会话页无卡，跳 approvals 聚合页作答（现有唯一作答面）。
- normalized_requirement: AskUser/Plan 类 pending 项点击 → 滚动定位或还原时间线对应卡片；普通工具审批 pending 项点击 → 跳转 workspace approvals 聚合页。
- impacts: [FR-03]
- 模块域: frontend_components
- evidence: frontend/src/components/daemon/turn-timeline.tsx:1512-1522（pending 卡 sticky top-0 常驻）、frontend/src/components/daemon/session-panel/session-panel-page.tsx:1538-1541（无 dialog_kind 审批会话页丢弃）、frontend/src/components/permissions/session-permission-panel.tsx（approvals 聚合页作答面）、用户第 2 轮问答

## D-002@v2: pending 项点击动作收窄——普通审批部分由 D-005 取代
- type: boundary
- priority: P1
- status: superseded
- supersedes: D-002@v1
- source: design-grill
- question: D-002@v1 中"普通工具审批 pending 项点击跳 approvals 聚合页"与 D-005（普通审批不进 pill）矛盾，如何收口？
- answer: 方案 C 确认后普通审批不进 pill，其点击行为自然消失；D-002 收窄为仅 AskUser/Plan 类 pending 项点击定位还原聊天流卡片。
- normalized_requirement: pill 仅含 AskUser/Plan 两类 pending 项，点击 → 滚动定位或还原时间线对应卡片；无普通审批条目与跳转逻辑。
- impacts: [FR-03]
- 模块域: frontend_components
- evidence: design.md 总体方案 §3、D-005 落盘轮（用户第 4 轮问答）

## D-003@v1: 事实修正——Plan 审批已有持久化历史（dialog_kind='plan_approval' 同表）
- type: premise
- priority: P1
- status: accepted
- source: code
- question: Plan 审批是否真的无持久化历史（澄清时我方陈述有误）？
- answer: 代码查证：ExitPlanMode 审批已复用 AskUserQuestion dialog 基建（dialog_kind='plan_approval'）持久化到 session_dialog_requests，无 5min 超时；fetchSessionDialogHistory 自然返回两类。故历史展示零成本包含 Plan 审批，不需过滤。
- normalized_requirement: 历史/恢复数据源统一用 session_dialog_requests（AskUserQuestion + plan_approval 两类 dialog_kind），不加类型过滤。
- impacts: [FR-01, FR-02]
- 模块域: frontend_components
- evidence: sillyhub-daemon/src/interactive/session-manager/permission.ts:460-476（ExitPlanMode 升级为 dialog 持久化注释）、backend/app/modules/daemon/model.py:285（同表）

## D-004@v1: 实现方案——C 前端自包含聚合（仅 AskUser 提问 + Plan 审批）
- type: architecture
- priority: P0
- status: accepted
- source: user
- question: 决策 pill 的数据层实现方案（A 前端聚合含普通审批收集 / B 后端聚合端点 / C 仅 dialogs 自包含）？
- answer: 用户选方案 C：新组件仿 session-change-files-hover 自包含——pending 复用父级现有 SSE 状态链（pendingRequests + planPending），历史组件内 react-query fetchSessionDialogHistory；普通工具审批不收集（门户会话不会发生）。
- normalized_requirement: 纯前端实现：新组件 session-decisions-hover + session-panel-page 挂载与 props 透传；数据源三类零新增——①pending AskUser/plan_approval dialog（父级 pendingRequests SSE 态 + fetchPendingDialogs 刷新恢复已有）②Plan pending 机制 1（父级 planPending SSE 态）③历史（fetchSessionDialogHistory REST）。无后端改动、无新状态收集逻辑。
- impacts: [FR-01, FR-02, FR-03, task-01, task-02]
- 模块域: frontend_components
- evidence: 用户方案选择轮（第 4 轮问答）；frontend/src/components/daemon/session-change-files-hover.tsx:91-109（自包含参照）、frontend/src/components/daemon/session-panel/session-panel-page.tsx:2672-2696（fetchPendingDialogs/fetchSessionDialogHistory 恢复链已有）
- 故障面: 普通审批若未来权限模式变更后发生，pill 不显示（缺口明确记录，非静默失败）
- 退役判据: 权限模式支持普通审批人审的会话入口上线时，升级聚合范围

## D-005@v1: rejected 方案 A——前端聚合 + 普通审批实时收集
- type: architecture
- priority: P1
- status: rejected
- source: user
- question: 是否为普通工具审批（无 dialog_kind 的 canUseTool 请求）新增前端实时收集进 pill？
- answer: （落选）
- normalized_requirement: 不实现：父级 onPermissionRequest 不新增无 dialog_kind 分支收集。
- impacts: []
- 模块域: frontend_components
- evidence: 用户第 3/4 轮问答（"目前来说不是授予agent完全访问权限的吗 普通审批不用用户决策吧"→查证门户会话 ask_user_only=true 全放行）
- 否决理由: 门户会话（manual_approval=true + ask_user_only=true）除 AskUserQuestion 外全部自动放行，普通审批收集是死代码，白增状态面
- 复潮条件: 出现普通审批人审的会话入口（ask_user_only=false 的门户会话/新权限模式），且用户需要在会话内看到这些等待点

## D-006@v1: rejected 方案 B——后端聚合端点 GET /sessions/{id}/decisions
- type: architecture
- priority: P1
- status: rejected
- source: user
- question: 是否后端新增会话决策聚合端点（dialogs 表 + 内存 pending 审批一站式）？
- answer: （落选）
- normalized_requirement: 不实现后端聚合端点。
- impacts: []
- evidence: 用户第 4 轮问答选 C
- 否决理由: 跨模块后端改动（daemon 模块 + OpenAPI + 前端/daemon 双端 gen:types 义务）与功能价值不成比例；普通审批在后端内存态重启照丢，聚合收益有限
- 复潮条件: 决策数据需要刷新强一致（含内存 pending）或移动端/第三方也要消费会话决策聚合时
