---
author: sillyspec-fr-index
created_at: 2026-10-16T01:30:35.950Z
---

# FR 索引 — test-utils

> fr-index 从归档变更 requirements.md 幂等提炼（「最近确认」= 归档时 HEAD）。条目字段行为机械解析契约，勿手改。
> superseded 条目保留供取代链回溯；brainstorm 注入默认只给 active。
> 模块卡：modules/test-utils.md（域=模块 id 同构；行为条目↔模块契约互跳）

## FR-test-utils-001 活性由 working/blocked 转移到 idle 且当前不在该会话上 → 行首亮绿点+完成角标（aria-label 此会话已执行完成），点击进入后角标与绿点消失（空闲回归留白）
变更：2026-10-15-session-turn-completion-semantics
状态：active
摘要：主路径
全文：.sillyspec/changes/archive/2026-10-15-session-turn-completion-semantics/requirements.md#FR-01
最近确认：fcd4a40489512f45d8e646965833e5e7c13e400b

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-15-session-turn-completion-semantics:flow:测试绑定FR-01
  tests: frontend/src/components/sessions/__tests__/session-list-panel.test.tsx「active + 活性 idle + 完成标记…→ 绿点 + 完成角标」 | frontend/src/components/sessions/__tests__/session-list-panel.test.tsx「点击进入…消失（空闲回归留白）」 | frontend/src/components/sessions/__tests__/session-list-panel.test.tsx「绿点+完成角标出现」 | frontend/src/hooks/__tests__/use-session-liveness.test.ts「working→idle：写轮次完成标记」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-15-session-turn-completion-semantics
  status: active

## FR-test-utils-002 会话终态 ended 的完成通知（上一变更 FR-06）保留，与轮次完成共用同一落盘键与同一角标
变更：2026-10-15-session-turn-completion-semantics
状态：active
摘要：主路径
全文：.sillyspec/changes/archive/2026-10-15-session-turn-completion-semantics/requirements.md#FR-02
最近确认：fcd4a40489512f45d8e646965833e5e7c13e400b

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-15-session-turn-completion-semantics:flow:测试绑定FR-02
  tests: frontend/src/components/sessions/__tests__/session-list-panel.test.tsx「执行完成通知（2026-10-15 用户补充：非终态→ended 且不在该会话上）」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-15-session-turn-completion-semantics
  status: active

## FR-test-utils-003 原红色「有新的空闲状态未读」角标退役——working/blocked→idle 的提醒统一为绿色执行完成语义
变更：2026-10-15-session-turn-completion-semantics
状态：active
摘要：主路径
全文：.sillyspec/changes/archive/2026-10-15-session-turn-completion-semantics/requirements.md#FR-03
最近确认：fcd4a40489512f45d8e646965833e5e7c13e400b

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-15-session-turn-completion-semantics:flow:测试绑定FR-03
  tests: frontend/src/components/sessions/__tests__/session-list-panel.test.tsx「active 空闲（无活性数据）→ 留白」 | frontend/src/hooks/__tests__/use-session-liveness.test.ts
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-15-session-turn-completion-semantics
  status: active

## FR-test-utils-004 完成时正选中该会话不标记（两个来源一致）；历史空闲（首见即 idle 无转移基线）不误报
变更：2026-10-15-session-turn-completion-semantics
状态：active
摘要：主路径
全文：.sillyspec/changes/archive/2026-10-15-session-turn-completion-semantics/requirements.md#FR-04
最近确认：fcd4a40489512f45d8e646965833e5e7c13e400b

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-15-session-turn-completion-semantics:flow:测试绑定FR-04
  tests: frontend/src/components/sessions/__tests__/session-list-panel.test.tsx「完成时正选中该会话（用户就在其上）→ 不标记不亮角标」 | frontend/src/components/sessions/__tests__/session-list-panel.test.tsx「首见不标」 | frontend/src/hooks/__tests__/use-session-liveness.test.ts「suppress 谓词命中」 | frontend/src/hooks/__tests__/use-session-liveness.test.ts「首见（无 prevState）→idle：不写完成标记」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-15-session-turn-completion-semantics
  status: active

## FR-test-utils-005 相关测试更新全过（session-list-panel + use-session-liveness），lint 零告警
变更：2026-10-15-session-turn-completion-semantics
状态：active
摘要：主路径
全文：.sillyspec/changes/archive/2026-10-15-session-turn-completion-semantics/requirements.md#FR-05
最近确认：fcd4a40489512f45d8e646965833e5e7c13e400b

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-15-session-turn-completion-semantics:flow:测试绑定FR-05
  tests: frontend/src/components/sessions/__tests__/session-list-panel.test.tsx | frontend/src/components/sessions/__tests__/sessions-portal.test.tsx | frontend/src/hooks/__tests__/use-session-liveness.test.ts
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-15-session-turn-completion-semantics
  status: active
