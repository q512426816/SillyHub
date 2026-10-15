---
author: sillyspec-fr-index
created_at: 2026-10-15T00:59:46.351Z
---

# FR 索引 — auto-frontend

> fr-index 从归档变更 requirements.md 幂等提炼（「最近确认」= 归档时 HEAD）。条目字段行为机械解析契约，勿手改。
> superseded 条目保留供取代链回溯；brainstorm 注入默认只给 active。
> 伪域（auto- 前缀）：由文件路径段投票派生，无模块卡——为该域补模块卡后，新变更将自动落回真域

## FR-auto-frontend-221 决策/FR 结构化条目卡在带「变更：」字段时输出 data-entry-anchor-qualified=文件#变更号#决策号（既有 data-entry-anchor 裸锚保留不破坏旧深链）
变更：2026-10-14-decision-anchor-change-qualified
状态：active
摘要：主路径
全文：.sillyspec/changes/archive/2026-10-14-decision-anchor-change-qualified/requirements.md#FR-01
最近确认：0ef23e479d8a39229486671e590a4d19864849d5

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-14-decision-anchor-change-qualified:flow:测试绑定FR-01
  tests: frontend/src/components/knowledge/__tests__/entry-card-list.test.tsx「结构化卡：带变更字段输出复合锚属性，裸锚保留」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-14-decision-anchor-change-qualified
  status: active

## FR-auto-frontend-222 沉淀资产卡弹窗定位优先按复合锚精确匹配，查无再退裸锚（FR/决策/触达/手册各形态均不回退）
变更：2026-10-14-decision-anchor-change-qualified
状态：active
摘要：主路径
全文：.sillyspec/changes/archive/2026-10-14-decision-anchor-change-qualified/requirements.md#FR-02
最近确认：0ef23e479d8a39229486671e590a4d19864849d5

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-14-decision-anchor-change-qualified:flow:测试绑定FR-02
  tests: frontend/src/components/changes/detail/__tests__/change-assets-card.test.tsx「决策行弹窗定位：同 id 跨变更按变更号+决策号复合锚精确命中」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-14-decision-anchor-change-qualified
  status: active

## FR-auto-frontend-223 沉淀资产卡 FR/决策行的知识库深链 anchor 参数带变更号前缀，知识库页深链滚动对含 # 的 anchor 先试复合锚再退裸锚
变更：2026-10-14-decision-anchor-change-qualified
状态：active
摘要：主路径
全文：.sillyspec/changes/archive/2026-10-14-decision-anchor-change-qualified/requirements.md#FR-03
最近确认：0ef23e479d8a39229486671e590a4d19864849d5

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-14-decision-anchor-change-qualified:flow:测试绑定FR-03
  tests: frontend/src/app/(dashboard)/workspaces/[id]/__tests__/knowledge-page.test.tsx「anchor 含变更号前缀（变更号#决策号）：先试复合锚精确落卡」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-14-decision-anchor-change-qualified
  status: active

## FR-auto-frontend-224 知识触达行与手册/INDEX 锚点行为不变
变更：2026-10-14-decision-anchor-change-qualified
状态：active
摘要：主路径
全文：.sillyspec/changes/archive/2026-10-14-decision-anchor-change-qualified/requirements.md#FR-04
最近确认：0ef23e479d8a39229486671e590a4d19864849d5

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-14-decision-anchor-change-qualified:flow:测试绑定FR-04
  tests: frontend/src/components/changes/detail/__tests__/change-assets-card.test.tsx「知识触达：锚点条目行点击弹窗打开，弹窗深链沿用 file+anchor（不整页跳转）」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-14-decision-anchor-change-qualified
  status: active

## FR-auto-frontend-225 相关组件测试同步更新并通过（entry-card-list / change-assets-card / knowledge-page）
变更：2026-10-14-decision-anchor-change-qualified
状态：active
摘要：主路径
全文：.sillyspec/changes/archive/2026-10-14-decision-anchor-change-qualified/requirements.md#FR-05
最近确认：0ef23e479d8a39229486671e590a4d19864849d5

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-14-decision-anchor-change-qualified:flow:测试绑定FR-05
  tests: frontend/src/components/knowledge/__tests__/entry-card-list.test.tsx「结构化卡：带变更字段输出复合锚属性，裸锚保留」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-14-decision-anchor-change-qualified
  status: active
