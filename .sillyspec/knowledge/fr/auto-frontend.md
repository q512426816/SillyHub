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
待复核：2026-09-28-fr-review-batch
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

## FR-auto-frontend-105 PageHeader 组件左侧内容列有 min-w-0，flex 收缩可用，超长标题/副标题不再撑破
变更：2026-09-28-change-detail-header-overflow
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 组件 相关模块就绪；When PageHeader 组件左侧内容列有 min-w-0，flex 收缩可用，超长标题/副标题不再撑破头部宽度；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-09-28-change-detail-header-overflow/requirements.md#FR-01
最近确认：389282de4db4ae033db1905cd02834f70d14ba1b

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-09-28-change-detail-header-overflow:flow:FR-01
  tests: frontend/src/components/layout/__tests__/page-header.test.ts
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-09-28-change-detail-header-overflow
  status: active

## FR-auto-frontend-106 详情页头部描述行在 1600/1280 宽度下有省略号截断，document.scrollWidth
变更：2026-09-28-change-detail-header-overflow
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 系统就绪；When 详情页头部描述行在 1600/1280 宽度下有省略号截断，document.scrollWidth 等于视口宽（无横向滚动）；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-09-28-change-detail-header-overflow/requirements.md#FR-02
最近确认：389282de4db4ae033db1905cd02834f70d14ba1b

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-09-28-change-detail-header-overflow:flow:FR-02
  tests: frontend/src/components/layout/__tests__/page-header.test.ts
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-09-28-change-detail-header-overflow
  status: active

## FR-auto-frontend-107 详情页标题超长时也能截断（flex 行内 truncate 项补 min-w-0）
变更：2026-09-28-change-detail-header-overflow
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 系统就绪；When 详情页标题超长时也能截断（flex 行内 truncate 项补 min-w-0）；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-09-28-change-detail-header-overflow/requirements.md#FR-03
最近确认：389282de4db4ae033db1905cd02834f70d14ba1b

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-09-28-change-detail-header-overflow:flow:FR-03
  tests: frontend/src/components/layout/__tests__/page-header.test.ts
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-09-28-change-detail-header-overflow
  status: active

## FR-auto-frontend-108 相关前端测试与 tsc 通过
变更：2026-09-28-change-detail-header-overflow
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 前端 / 测试 相关模块就绪；When 相关前端测试与 tsc 通过；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-09-28-change-detail-header-overflow/requirements.md#FR-04
最近确认：389282de4db4ae033db1905cd02834f70d14ba1b

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-09-28-change-detail-header-overflow:flow:FR-04
  tests: __tests__/page-restore-assets.test.ts | frontend/src/components/layout/__tests__/page-header.test.ts | page-last-signal.test.ts | page-team-toggle.test.ts
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-09-28-change-detail-header-overflow
  status: active

## FR-auto-frontend-109 263 条待复核条目逐条产出裁决：相符翻正（candidate 行 confirm 翻 active
变更：2026-09-28-fr-review-batch
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 测试 相关模块就绪；When 263 条待复核条目逐条产出裁决：相符翻正（candidate 行 confirm 翻 active，无行；Then bind 真实测试）/ 绑定过时重绑 / 内容过时最小修正 / 特性已死标 superseded+退役理由 / 无测试面清标记留档报告
全文：.sillyspec/changes/archive/2026-09-28-fr-review-batch/requirements.md#FR-01
最近确认：bccffba0b0d15714673700b5743c33378eff8c06

## FR-auto-frontend-110 每条翻正的证据路径必须是盘上真实测试形态文件（test_*.py / *.test.*），不许悬空路
变更：2026-09-28-fr-review-batch
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 测试 相关模块就绪；When 每条翻正的证据路径必须是盘上真实测试形态文件（test_*.py / *.test.*），不许悬空路径；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-09-28-fr-review-batch/requirements.md#FR-02
最近确认：bccffba0b0d15714673700b5743c33378eff8c06

## FR-auto-frontend-111 复核完成的条目清除「待复核：」标记行，未复核的不动
变更：2026-09-28-fr-review-batch
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 系统就绪；When 复核完成的条目清除「待复核：」标记行，未复核的不动；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-09-28-fr-review-batch/requirements.md#FR-03
最近确认：bccffba0b0d15714673700b5743c33378eff8c06

## FR-auto-frontend-112 fr 文件条目格式不被破坏（标题/状态/场景正文/绑定子块结构保持）
变更：2026-09-28-fr-review-batch
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 系统就绪；When fr 文件条目格式不被破坏（标题/状态/场景正文/绑定子块结构保持）；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-09-28-fr-review-batch/requirements.md#FR-04
最近确认：bccffba0b0d15714673700b5743c33378eff8c06

## FR-auto-frontend-113 sillyspec knowledge validate 无 errors
变更：2026-09-28-fr-review-batch
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 系统就绪；When sillyspec knowledge validate 无 errors；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-09-28-fr-review-batch/requirements.md#FR-05
最近确认：bccffba0b0d15714673700b5743c33378eff8c06

## FR-auto-frontend-114 分批（按域分波）处理，每波显式 pathspec 提交
变更：2026-09-28-fr-review-batch
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 系统就绪；When 分批（按域分波）处理，每波显式 pathspec 提交；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-09-28-fr-review-batch/requirements.md#FR-06
最近确认：bccffba0b0d15714673700b5743c33378eff8c06
