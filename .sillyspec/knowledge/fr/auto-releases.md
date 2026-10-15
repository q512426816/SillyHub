---
author: sillyspec-fr-index
created_at: 2026-10-15T06:41:34.707Z
---

# FR 索引 — auto-releases

> fr-index 从归档变更 requirements.md 幂等提炼（「最近确认」= 归档时 HEAD）。条目字段行为机械解析契约，勿手改。
> superseded 条目保留供取代链回溯；brainstorm 注入默认只给 active。
> 伪域（auto- 前缀）：由文件路径段投票派生，无模块卡——为该域补模块卡后，新变更将自动落回真域

## FR-auto-releases-001 行首状态点单一源判定：failed→红点；ended→绿点；活性 working→动态转圈；活性 blocked→琥珀点；reconnecting→动态转圈；其余（active 空闲/pending/suspended/活性 idle/unknown/无活性数据）→零渲染留白
变更：2026-10-15-session-status-dot-semantics
状态：active
摘要：主路径
全文：.sillyspec/changes/archive/2026-10-15-session-status-dot-semantics/requirements.md#FR-01
最近确认：205ec5afb2097446b431f91cccd00ee00744e0ec

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-15-session-status-dot-semantics:flow:测试绑定FR-01
  tests: frontend/src/components/sessions/__tests__/session-list-panel.test.tsx「行首状态槽语义（2026-10-15-session-status-dot-semantics）」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-15-session-status-dot-semantics
  status: active

## FR-auto-releases-002 终态权威：failed/ended 判定优先于活性信号，终态会话不因陈旧活性数据转圈或琥珀
变更：2026-10-15-session-status-dot-semantics
状态：active
摘要：主路径
全文：.sillyspec/changes/archive/2026-10-15-session-status-dot-semantics/requirements.md#FR-02
最近确认：205ec5afb2097446b431f91cccd00ee00744e0ec

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-15-session-status-dot-semantics:flow:测试绑定FR-02
  tests: frontend/src/components/sessions/__tests__/session-list-panel.test.tsx「failed → 红点（异常失败）；活性 working 不覆盖（终态权威）」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-15-session-status-dot-semantics
  status: active

## FR-auto-releases-003 行尾活性小灯移除，悬停详情卡（Popover）与未读红角标迁移到行首点（有活性数据才可悬停出卡，未读角标挂行首槽右上角）
变更：2026-10-15-session-status-dot-semantics
状态：active
摘要：主路径
全文：.sillyspec/changes/archive/2026-10-15-session-status-dot-semantics/requirements.md#FR-03
最近确认：205ec5afb2097446b431f91cccd00ee00744e0ec

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-15-session-status-dot-semantics:flow:测试绑定FR-03
  tests: frontend/src/components/sessions/__tests__/session-list-panel.test.tsx「活性未读红角标（原行尾小灯迁入行首槽）」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-15-session-status-dot-semantics
  status: active

## FR-auto-releases-004 批量多选模式行首槽仍为勾选框，状态点与悬停卡零渲染（与现状一致）
变更：2026-10-15-session-status-dot-semantics
状态：active
摘要：主路径
全文：.sillyspec/changes/archive/2026-10-15-session-status-dot-semantics/requirements.md#FR-04
最近确认：205ec5afb2097446b431f91cccd00ee00744e0ec

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-15-session-status-dot-semantics:flow:测试绑定FR-04
  tests: frontend/src/components/sessions/__tests__/session-list-panel.test.tsx
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-15-session-status-dot-semantics
  status: active

## FR-auto-releases-005 相关测试更新并通过（session-list-panel 测试 + 门户页测试涉及点），lint 通过
变更：2026-10-15-session-status-dot-semantics
状态：active
摘要：主路径
全文：.sillyspec/changes/archive/2026-10-15-session-status-dot-semantics/requirements.md#FR-05
最近确认：205ec5afb2097446b431f91cccd00ee00744e0ec

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-15-session-status-dot-semantics:flow:测试绑定FR-05
  tests: frontend/src/components/sessions/__tests__/session-list-panel.test.tsx | frontend/src/components/sessions/__tests__/sessions-portal.test.tsx | frontend/src/hooks/__tests__/use-session-liveness.test.ts | sessions/page.test.tsx
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-15-session-status-dot-semantics
  status: active

## FR-auto-releases-006 执行完成通知（用户补充）：非终态→ended 且当前不在该会话上 → 绿色通知角标，点击进入后消失
变更：2026-10-15-session-status-dot-semantics
状态：active
摘要：主路径
全文：.sillyspec/changes/archive/2026-10-15-session-status-dot-semantics/requirements.md#FR-06
最近确认：205ec5afb2097446b431f91cccd00ee00744e0ec

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-15-session-status-dot-semantics:flow:测试绑定FR-06
  tests: frontend/src/components/sessions/__tests__/session-list-panel.test.tsx「执行完成通知（2026-10-15 用户补充…）」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-15-session-status-dot-semantics
  status: active
