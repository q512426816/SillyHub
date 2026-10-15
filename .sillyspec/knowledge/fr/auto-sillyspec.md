---
author: sillyspec-fr-index
created_at: 2026-10-15T02:42:45.628Z
---

# FR 索引 — auto-sillyspec

> fr-index 从归档变更 requirements.md 幂等提炼（「最近确认」= 归档时 HEAD）。条目字段行为机械解析契约，勿手改。
> superseded 条目保留供取代链回溯；brainstorm 注入默认只给 active。
> 伪域（auto- 前缀）：由文件路径段投票派生，无模块卡——为该域补模块卡后，新变更将自动落回真域

## FR-auto-sillyspec-079 切片力场新增同类型内聚力——同类聚簇、异类分块
变更：2026-10-15-graph-type-cluster
状态：active
摘要：交错网格收敛聚簇
全文：.sillyspec/changes/archive/2026-10-15-graph-type-cluster/requirements.md#FR-01
最近确认：2fc26800908a29fc957f059032fbaff1678b793b

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-15-graph-type-cluster:flow:测试绑定FR-01
  tests: frontend/src/components/knowledge/__tests__/graph-canvas.test.ts「类型内聚力：交错网格收敛后类内紧+类间分」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-15-graph-type-cluster
  status: active

## FR-auto-sillyspec-080 内聚力豁免面——单成员类型与 NaN 坐标零受力
变更：2026-10-15-graph-type-cluster
状态：active
摘要：异类两节点与 NaN 自愈不受扰
全文：.sillyspec/changes/archive/2026-10-15-graph-type-cluster/requirements.md#FR-02
最近确认：2fc26800908a29fc957f059032fbaff1678b793b

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-15-graph-type-cluster:flow:测试绑定FR-02
  tests: frontend/src/components/knowledge/__tests__/graph-canvas.test.ts「类型内聚力：单成员类型与 NaN 坐标豁免（既有自愈口径不变）」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-15-graph-type-cluster
  status: active

## FR-auto-sillyspec-081 既有交互与引擎语义不变
变更：2026-10-15-graph-type-cluster
状态：active
摘要：回归面全绿
全文：.sillyspec/changes/archive/2026-10-15-graph-type-cluster/requirements.md#FR-03
最近确认：2fc26800908a29fc957f059032fbaff1678b793b

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-15-graph-type-cluster:flow:测试绑定FR-03
  tests: frontend/src/components/knowledge/__tests__/graph-canvas.test.ts | frontend/src/components/knowledge/__tests__/knowledge-graph-page.test.tsx
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-15-graph-type-cluster
  status: active

## FR-auto-sillyspec-082 常量导出与聚簇断言单测
变更：2026-10-15-graph-type-cluster
状态：active
摘要：单测钉死
全文：.sillyspec/changes/archive/2026-10-15-graph-type-cluster/requirements.md#FR-04
最近确认：2fc26800908a29fc957f059032fbaff1678b793b

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-15-graph-type-cluster:flow:测试绑定FR-04
  tests: frontend/src/components/knowledge/__tests__/graph-canvas.test.ts「类型内聚力：增益常量具名导出」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-15-graph-type-cluster
  status: active
