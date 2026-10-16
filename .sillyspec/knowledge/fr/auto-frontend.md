---
author: sillyspec-fr-index
created_at: 2026-10-16T03:46:10.980Z
---

# FR 索引 — auto-frontend

> fr-index 从归档变更 requirements.md 幂等提炼（「最近确认」= 归档时 HEAD）。条目字段行为机械解析契约，勿手改。
> superseded 条目保留供取代链回溯；brainstorm 注入默认只给 active。
> 伪域（auto- 前缀）：由文件路径段投票派生，无模块卡——为该域补模块卡后，新变更将自动落回真域

## FR-auto-frontend-268 决策 pill 入口与显隐
变更：2026-10-16-session-decision-pill
状态：active
摘要：默认场景
依据决策：D-001@v1、D-004@v1
场景正文：
- 场景：默认场景 — Given 会话面板处于真会话态（sessionId 非空）；When 当前会话存在任一决策信息（pending 提问/Plan 审批，或已答历史非空且已加载）；Then 输入条上方右侧渲染"待决策"悬浮 pill（与变更文件 pill 并排同一悬浮行），计数徽标 = 当前待决策数（pending 提问 + plan 审批 + p
全文：.sillyspec/changes/archive/2026-10-16-session-decision-pill/requirements.md#FR-01
最近确认：7083eb2b2bd5c6cffe84962df65bbda379485f26

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-16-session-decision-pill:flow:测试绑定FR-01
  tests: frontend/src/components/daemon/__tests__/session-decisions-hover.test.tsx「三类全空（pending 空 + 历史空/未加载）不渲染入口（FR-01）」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-16-session-decision-pill
  status: active

## FR-auto-frontend-269 分组下拉列表
变更：2026-10-16-session-decision-pill
状态：active
摘要：默认场景
依据决策：D-001@v1、D-003@v1、D-004@v1
场景正文：
- 场景：默认场景 — Given pill 已渲染；When 用户 hover（或触屏点击）pill；Then 弹出分组下拉：待决策（N）置顶——每项显示问题标题（resolvePendingTitle 同口径）、类型徽标（plan_approval/planPendin
全文：.sillyspec/changes/archive/2026-10-16-session-decision-pill/requirements.md#FR-02
最近确认：7083eb2b2bd5c6cffe84962df65bbda379485f26

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-16-session-decision-pill:flow:测试绑定FR-02
  tests: frontend/src/components/daemon/__tests__/session-decisions-hover.test.tsx「hover 弹下拉：待决策置顶（提问/Plan 徽标），已答历史默认折叠（FR-02）」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-16-session-decision-pill
  status: active

## FR-auto-frontend-270 pending 项点击定位还原
变更：2026-10-16-session-decision-pill
状态：active
摘要：默认场景
依据决策：D-002@v2、D-004@v1
场景正文：
- 场景：默认场景 — Given 下拉打开且待决策组非空；When 用户点击一条 pending dialog 项 用户点击 planPending 项；Then 下拉收起，时间线滚动到顶，对应 sticky 提问卡高亮闪烁（约 1.2s）；若该卡处于最小化状态则先还原再高亮 下拉收起，滚动定位到输入区上方 Plan 审批
全文：.sillyspec/changes/archive/2026-10-16-session-decision-pill/requirements.md#FR-03
最近确认：7083eb2b2bd5c6cffe84962df65bbda379485f26

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-16-session-decision-pill:flow:测试绑定FR-03
  tests: frontend/src/components/daemon/__tests__/session-decisions-hover.test.tsx「点 pending dialog 项：上抛 onFocusPending(requestId)；点 plan 项上抛 'plan' 哨兵（FR-03）」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-16-session-decision-pill
  status: active

## FR-auto-frontend-271 历史只读详情弹窗
变更：2026-10-16-session-decision-pill
状态：active
摘要：默认场景
依据决策：D-004@v1
场景正文：
- 场景：默认场景 — Given 下拉打开且历史组已展开；When 用户点击一条历史项
全文：.sillyspec/changes/archive/2026-10-16-session-decision-pill/requirements.md#FR-04
最近确认：7083eb2b2bd5c6cffe84962df65bbda379485f26

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-16-session-decision-pill:flow:测试绑定FR-04
  tests: frontend/src/components/daemon/__tests__/session-decisions-hover.test.tsx「点历史项收起下拉并开只读详情弹窗：问题/选项/当时选择 ✓/时间（FR-04）」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-16-session-decision-pill
  status: active

## FR-auto-frontend-272 兼容与挂载改造
变更：2026-10-16-session-decision-pill
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 既有调用点（dialog 模式/其它潜在消费方）；When session-change-files-hover 未传新可选 prop embedded、TurnTimeline 未传 focusDialogReques；Then 两组件行为与改造前完全一致（可选 prop 默认值兜底）
全文：.sillyspec/changes/archive/2026-10-16-session-decision-pill/requirements.md#FR-05
最近确认：7083eb2b2bd5c6cffe84962df65bbda379485f26

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-16-session-decision-pill:flow:测试绑定FR-05
  tests: frontend/src/components/daemon/__tests__/session-change-files-hover.test.tsx | frontend/src/components/daemon/__tests__/turn-timeline-dialog-minimize.test.tsx
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-16-session-decision-pill
  status: active
