---
author: sillyspec-fr-index
created_at: 2026-09-28T14:14:42.799Z
---

# FR 索引 — auto-frontend

> fr-index 从归档变更 requirements.md 幂等提炼（「最近确认」= 归档时 HEAD）。条目字段行为机械解析契约，勿手改。
> superseded 条目保留供取代链回溯；brainstorm 注入默认只给 active。
> 伪域（auto- 前缀）：由文件路径段投票派生，无模块卡——为该域补模块卡后，新变更将自动落回真域

## FR-auto-frontend-092 backend assets.py：knowledge_touch 并入实时命中——查本变更 inj
变更：2026-09-28-knowledge-touch-live
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 上限 相关模块就绪；When backend assets.py：knowledge_touch 并入实时命中——查本变更 inject 行的 matched_anchors（file#sl；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-09-28-knowledge-touch-live/requirements.md#FR-01
最近确认：2cb3e7633c0df0ff5b263c3eb3fc845f2dcb5e3e

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-09-28-knowledge-touch-live:flow:FR-01
  tests: backend/app/modules/change/tests/test_assets.py
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-09-28-knowledge-touch-live
  status: active

## FR-auto-frontend-093 frontend 资产卡：在途态标签「知识触达（注入命中 · 实时）」区分归档态「待复核标记反查」；
变更：2026-09-28-knowledge-touch-live
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 测试 相关模块就绪；When frontend 资产卡：在途态标签「知识触达（注入命中 · 实时）」区分归档态「待复核标记反查」；空态文案改写（在途也能有知识触达，FR/决策/测试绑定仍是归；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-09-28-knowledge-touch-live/requirements.md#FR-02
最近确认：2cb3e7633c0df0ff5b263c3eb3fc845f2dcb5e3e

## FR-auto-frontend-094 审计结论（不动）：文档区读变更目录实时可见；FR/决策/测试绑定/模块触达为归档时生成的结构化产物，
变更：2026-09-28-knowledge-touch-live
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 测试 相关模块就绪；When 审计结论（不动）：文档区读变更目录实时可见；FR/决策/测试绑定/模块触达为归档时生成的结构化产物，设计内；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-09-28-knowledge-touch-live/requirements.md#FR-03
最近确认：2cb3e7633c0df0ff5b263c3eb3fc845f2dcb5e3e

## FR-auto-frontend-095 在途变更（未归档）若已有知识注入，资产卡即可见知识触达条目（数据来自 knowledge_hits
变更：2026-09-28-knowledge-touch-live
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 系统就绪；When 在途变更（未归档）若已有知识注入，资产卡即可见知识触达条目（数据来自 knowledge_hits inject 行，非标记）；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-09-28-knowledge-touch-live/requirements.md#FR-04
最近确认：2cb3e7633c0df0ff5b263c3eb3fc845f2dcb5e3e

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-09-28-knowledge-touch-live:flow:FR-04
  tests: frontend/src/components/changes/detail/__tests__/change-assets-card.test.ts
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-09-28-knowledge-touch-live
  status: active

## FR-auto-frontend-096 归档后标记反查与实时命中合并且去重（同一条目不重复出现）
变更：2026-09-28-knowledge-touch-live
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 系统就绪；When 归档后标记反查与实时命中合并且去重（同一条目不重复出现）；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-09-28-knowledge-touch-live/requirements.md#FR-05
最近确认：2cb3e7633c0df0ff5b263c3eb3fc845f2dcb5e3e

## FR-auto-frontend-097 裸文件锚点（无 #）可显示
变更：2026-09-28-knowledge-touch-live
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 系统就绪；When 裸文件锚点（无 #）可显示；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-09-28-knowledge-touch-live/requirements.md#FR-06
最近确认：2cb3e7633c0df0ff5b263c3eb3fc845f2dcb5e3e

## FR-auto-frontend-098 live 合并上限 100 条
变更：2026-09-28-knowledge-touch-live
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 上限 相关模块就绪；When live 合并上限 100 条；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-09-28-knowledge-touch-live/requirements.md#FR-07
最近确认：2cb3e7633c0df0ff5b263c3eb3fc845f2dcb5e3e

## FR-auto-frontend-099 backend 资产测试新增在途命中用例 + frontend 卡测试同步，全绿
变更：2026-09-28-knowledge-touch-live
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 测试 相关模块就绪；When backend 资产测试新增在途命中用例 + frontend 卡测试同步，全绿；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-09-28-knowledge-touch-live/requirements.md#FR-08
最近确认：2cb3e7633c0df0ff5b263c3eb3fc845f2dcb5e3e

## FR-auto-frontend-100 tsc/eslint/ruff/mypy 0
变更：2026-09-28-knowledge-touch-live
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 系统就绪；When tsc/eslint/ruff/mypy 0；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-09-28-knowledge-touch-live/requirements.md#FR-09
最近确认：2cb3e7633c0df0ff5b263c3eb3fc845f2dcb5e3e

## FR-auto-frontend-101 工作区详情页不再渲染 Agent 状态总览卡片
变更：2026-09-28-remove-liveness-overview-card
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 系统就绪；When 工作区详情页不再渲染 Agent 状态总览卡片；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-09-28-remove-liveness-overview-card/requirements.md#FR-01
最近确认：2f29e2693a12839bf3f71fb8684b5db57fc628b3

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-09-28-remove-liveness-overview-card:flow:FR-01
  tests: page.test.ts
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-09-28-remove-liveness-overview-card
  status: active

## FR-auto-frontend-102 agent-liveness-overview-card.tsx 组件文件删除且无残留 import
变更：2026-09-28-remove-liveness-overview-card
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 组件 相关模块就绪；When agent-liveness-overview-card.tsx 组件文件删除且无残留 import；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-09-28-remove-liveness-overview-card/requirements.md#FR-02
最近确认：2f29e2693a12839bf3f71fb8684b5db57fc628b3

## FR-auto-frontend-103 page.test.tsx 清理对应 mock 后工作区详情页测试通过
变更：2026-09-28-remove-liveness-overview-card
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 测试 相关模块就绪；When page.test.tsx 清理对应 mock 后工作区详情页测试通过；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-09-28-remove-liveness-overview-card/requirements.md#FR-03
最近确认：2f29e2693a12839bf3f71fb8684b5db57fc628b3

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-09-28-remove-liveness-overview-card:flow:FR-03
  tests: page.test.ts
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-09-28-remove-liveness-overview-card
  status: active

## FR-auto-frontend-104 会话列表活性链路（use-session-liveness / liveness-badge）不受影
变更：2026-09-28-remove-liveness-overview-card
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 系统就绪；When 会话列表活性链路（use-session-liveness / liveness-badge）不受影响；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-09-28-remove-liveness-overview-card/requirements.md#FR-04
最近确认：2f29e2693a12839bf3f71fb8684b5db57fc628b3

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-09-28-remove-liveness-overview-card:flow:FR-04
  tests: frontend/src/components/sessions/__tests__/session-list-panel.test.ts | frontend/src/hooks/__tests__/use-session-liveness.test.ts
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-09-28-remove-liveness-overview-card
  status: active
