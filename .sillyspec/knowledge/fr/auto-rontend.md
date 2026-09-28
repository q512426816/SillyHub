---
author: sillyspec-fr-index
created_at: 2026-09-28T08:50:38.116Z
---

# FR 索引 — auto-rontend

> fr-index 从归档变更 requirements.md 幂等提炼（「最近确认」= 归档时 HEAD）。条目字段行为机械解析契约，勿手改。
> superseded 条目保留供取代链回溯；brainstorm 注入默认只给 active。
> 伪域（auto- 前缀）：由文件路径段投票派生，无模块卡——为该域补模块卡后，新变更将自动落回真域

## FR-auto-rontend-001 每池/每域/收件箱加「查看明细」深链（?file=fr/<domain>.md / uncatego
变更：2026-09-28-knowledge-gov-ux-detail
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 系统就绪；When 每池/每域/收件箱加「查看明细」深链（?file=fr/<domain>.md / uncategorized.md，复用页面既有深链消费能力，同页软导航）；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-09-28-knowledge-gov-ux-detail/requirements.md#FR-01
最近确认：e0dfce4423e82de941a678aa712f6c910cb159e5

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-09-28-knowledge-gov-ux-detail:flow:FR-01
  tests: frontend/src/components/knowledge/__tests__/governance-cards.test.ts
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-09-28-knowledge-gov-ux-detail
  status: active

## FR-auto-rontend-002 rot/收件箱卡加「复制 AI 处理指令」按钮（clipboard 复制即用提示词，含分布/计数；失
变更：2026-09-28-knowledge-gov-ux-detail
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 系统就绪；When rot/收件箱卡加「复制 AI 处理指令」按钮（clipboard 复制即用提示词，含分布/计数；失败降级为内联展示提示词文本）；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-09-28-knowledge-gov-ux-detail/requirements.md#FR-02
最近确认：e0dfce4423e82de941a678aa712f6c910cb159e5

## FR-auto-rontend-003 binding-unresolved 卡正文补明细（锚点 id 列表）
变更：2026-09-28-knowledge-gov-ux-detail
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 系统就绪；When binding-unresolved 卡正文补明细（锚点 id 列表）；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-09-28-knowledge-gov-ux-detail/requirements.md#FR-03
最近确认：e0dfce4423e82de941a678aa712f6c910cb159e5

## FR-auto-rontend-004 伪域未知池（如 auto-round5）也给查看链接
变更：2026-09-28-knowledge-gov-ux-detail
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 系统就绪；When 伪域未知池（如 auto-round5）也给查看链接；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-09-28-knowledge-gov-ux-detail/requirements.md#FR-04
最近确认：e0dfce4423e82de941a678aa712f6c910cb159e5

## FR-auto-rontend-005 四类卡都能看到具体数据入口（深链到本页对应知识文件）
变更：2026-09-28-knowledge-gov-ux-detail
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 系统就绪；When 四类卡都能看到具体数据入口（深链到本页对应知识文件）；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-09-28-knowledge-gov-ux-detail/requirements.md#FR-05
最近确认：e0dfce4423e82de941a678aa712f6c910cb159e5

## FR-auto-rontend-006 rot
变更：2026-09-28-knowledge-gov-ux-detail
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 系统就绪；When rot；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-09-28-knowledge-gov-ux-detail/requirements.md#FR-06
最近确认：e0dfce4423e82de941a678aa712f6c910cb159e5

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-09-28-knowledge-gov-ux-detail:flow:FR-06
  tests: frontend/src/components/knowledge/__tests__/governance-cards.test.ts
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-09-28-knowledge-gov-ux-detail
  status: active

## FR-auto-rontend-007 inbox 有一键复制处理指令入口（复制成功有反馈
变更：2026-09-28-knowledge-gov-ux-detail
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 系统就绪；When inbox 有一键复制处理指令入口（复制成功有反馈；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-09-28-knowledge-gov-ux-detail/requirements.md#FR-07
最近确认：e0dfce4423e82de941a678aa712f6c910cb159e5

## FR-auto-rontend-008 clipboard 不可用时内联显示可手动复制）
变更：2026-09-28-knowledge-gov-ux-detail
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 系统就绪；When clipboard 不可用时内联显示可手动复制）；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-09-28-knowledge-gov-ux-detail/requirements.md#FR-08
最近确认：e0dfce4423e82de941a678aa712f6c910cb159e5

## FR-auto-rontend-009 分池行查看链接跳转参数正确（?file=fr/<domain>.md）
变更：2026-09-28-knowledge-gov-ux-detail
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 系统就绪；When 分池行查看链接跳转参数正确（?file=fr/<domain>.md）；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-09-28-knowledge-gov-ux-detail/requirements.md#FR-09
最近确认：e0dfce4423e82de941a678aa712f6c910cb159e5

## FR-auto-rontend-010 既有测试同步更新全绿，tsc
变更：2026-09-28-knowledge-gov-ux-detail
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 测试 相关模块就绪；When 既有测试同步更新全绿，tsc；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-09-28-knowledge-gov-ux-detail/requirements.md#FR-10
最近确认：e0dfce4423e82de941a678aa712f6c910cb159e5

## FR-auto-rontend-011 eslint 0 错
变更：2026-09-28-knowledge-gov-ux-detail
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 系统就绪；When eslint 0 错；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-09-28-knowledge-gov-ux-detail/requirements.md#FR-11
最近确认：e0dfce4423e82de941a678aa712f6c910cb159e5
