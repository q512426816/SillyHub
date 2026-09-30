---
author: sillyspec-fr-index
created_at: 2026-09-28T13:59:17.523Z
---

# FR 索引 — auto-backend

> fr-index 从归档变更 requirements.md 幂等提炼（「最近确认」= 归档时 HEAD）。条目字段行为机械解析契约，勿手改。
> superseded 条目保留供取代链回溯；brainstorm 注入默认只给 active。
> 伪域（auto- 前缀）：由文件路径段投票派生，无模块卡——为该域补模块卡后，新变更将自动落回真域

## FR-auto-backend-079 uncategorized.md 全部条目迁出，文件仅保留收件箱头注与清账说明
变更：2026-09-28-knowledge-inbox-clear
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 系统就绪；When uncategorized.md 全部条目迁出，文件仅保留收件箱头注与清账说明；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-09-28-knowledge-inbox-clear/requirements.md#FR-01
最近确认：e723b484ed1475bdff0907cd3be3dfbf5bc8e4a1

## FR-auto-backend-080 每条按内容归入 known-issues / patterns / conventions / te
变更：2026-09-28-knowledge-inbox-clear
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 系统就绪；When 每条按内容归入 known-issues / patterns / conventions / testing-gotchas / sillyspec-gotc；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-09-28-knowledge-inbox-clear/requirements.md#FR-02
最近确认：e723b484ed1475bdff0907cd3be3dfbf5bc8e4a1

## FR-auto-backend-081 已修复项按 known-issues 既有惯例标题带状态标记（已修复），未修复或现状认知项标记为待关
变更：2026-09-28-knowledge-inbox-clear
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 系统就绪；When 已修复项按 known-issues 既有惯例标题带状态标记（已修复），未修复或现状认知项标记为待关注；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-09-28-knowledge-inbox-clear/requirements.md#FR-03
最近确认：e723b484ed1475bdff0907cd3be3dfbf5bc8e4a1

## FR-auto-backend-082 丢失标题的 SSE 路由条目补写标题后归入 FastAPI 路由顺序同族条目
变更：2026-09-28-knowledge-inbox-clear
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given api 相关模块就绪；When 丢失标题的 SSE 路由条目补写标题后归入 FastAPI 路由顺序同族条目；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-09-28-knowledge-inbox-clear/requirements.md#FR-04
最近确认：e723b484ed1475bdff0907cd3be3dfbf5bc8e4a1

## FR-auto-backend-083 INDEX.md 五个分类节补齐迁移条目索引行，Uncategorized 节改为已清空说明，索引锚
变更：2026-09-28-knowledge-inbox-clear
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 迁移 相关模块就绪；When INDEX.md 五个分类节补齐迁移条目索引行，Uncategorized 节改为已清空说明，索引锚点可解析；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-09-28-knowledge-inbox-clear/requirements.md#FR-05
最近确认：e723b484ed1475bdff0907cd3be3dfbf5bc8e4a1

## FR-auto-backend-084 known-issues.md 内指向 uncategorized 旧条目的交叉引用改为指向新位置
变更：2026-09-28-knowledge-inbox-clear
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 系统就绪；When known-issues.md 内指向 uncategorized 旧条目的交叉引用改为指向新位置；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-09-28-knowledge-inbox-clear/requirements.md#FR-06
最近确认：e723b484ed1475bdff0907cd3be3dfbf5bc8e4a1

## FR-auto-backend-085 sillyspec knowledge validate 无 errors
变更：2026-09-28-knowledge-inbox-clear
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 系统就绪；When sillyspec knowledge validate 无 errors；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-09-28-knowledge-inbox-clear/requirements.md#FR-07
最近确认：e723b484ed1475bdff0907cd3be3dfbf5bc8e4a1

## FR-auto-backend-086 收养后的语义标题在模板 H1 documents 推送与全量 reparse 后保持不变（不被回翻为
变更：2026-09-30-title-adopt-clobber-guard
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 系统就绪；When 收养后的语义标题在模板 H1 documents 推送与全量 reparse 后保持不变（不被回翻为 key 派生名）；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-09-30-title-adopt-clobber-guard/requirements.md#FR-01
最近确认：5da89fb8c48a2117e379b3d759cc72b19e1b33c4

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-09-30-title-adopt-clobber-guard:flow:FR-01
  tests: backend/app/modules/change/tests/test_title_normalization.py::TestAdoptedTitleClobberGuard::test_adopted_title_survives_template_docs_push（documents | backend/app/modules/change/tests/test_title_normalization.py::TestAdoptedTitleClobberGuard::test_apply_parsed_fallback_keeps_semantic_title（reparse
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-09-30-title-adopt-clobber-guard
  status: active

## FR-auto-backend-087 自定义 H1（--title 改名通道）经 documents 推送/reparse 仍能覆盖既有标
变更：2026-09-30-title-adopt-clobber-guard
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 系统就绪；When 自定义 H1（--title 改名通道）经 documents 推送/reparse 仍能覆盖既有标题（改名能力不回归）；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-09-30-title-adopt-clobber-guard/requirements.md#FR-02
最近确认：5da89fb8c48a2117e379b3d759cc72b19e1b33c4

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-09-30-title-adopt-clobber-guard:flow:FR-02
  tests: backend/app/modules/change/tests/test_title_normalization.py::TestAdoptedTitleClobberGuard::test_apply_parsed_fallback_keeps_semantic_title | backend/app/modules/change/tests/test_title_normalization.py::TestAdoptedTitleClobberGuard::test_custom_h1_docs_push_overrides_adopted_title（documents | backend/app/modules/change/tests/test_title_normalization.py::TestUpsertDocumentsTitle::test_custom_h1_in_deepest_doc_wins（既有改名回归保护
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-09-30-title-adopt-clobber-guard
  status: active

## FR-auto-backend-088 body.changes[].title 超 500 字时截断到 500 再落库，收养段写库异常仅告
变更：2026-09-30-title-adopt-clobber-guard
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 系统就绪；When body.changes[].title 超 500 字时截断到 500 再落库，收养段写库异常仅告警不阻断 progress 上行（200 不变）；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-09-30-title-adopt-clobber-guard/requirements.md#FR-03
最近确认：5da89fb8c48a2117e379b3d759cc72b19e1b33c4

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-09-30-title-adopt-clobber-guard:flow:FR-03
  tests: backend/app/modules/platform_sync/tests/test_change_deleted_guard.py::test_long_cli_title_truncated_progress_still_ok（600
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-09-30-title-adopt-clobber-guard
  status: active

## FR-auto-backend-089 兜底形态判定（空/等于 key/等于去日期前缀）与 500 上限收敛到 title_norm 一处，
变更：2026-09-30-title-adopt-clobber-guard
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 上限 相关模块就绪；When 兜底形态判定（空/等于 key/等于去日期前缀）与 500 上限收敛到 title_norm 一处，三条写路径共用；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-09-30-title-adopt-clobber-guard/requirements.md#FR-04
最近确认：5da89fb8c48a2117e379b3d759cc72b19e1b33c4

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-09-30-title-adopt-clobber-guard:flow:FR-04
  tests: backend/app/modules/change/tests/test_title_normalization.py::TestIsFallbackDisplayTitle（四态兜底判定纯函数 | backend/app/modules/change/tests/test_title_normalization.py::TestUpsertDocumentsTitle::test_existing_row_title_refreshed（裸模板文本仍可被刷新——判定收敛不破坏既有语义）
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-09-30-title-adopt-clobber-guard
  status: active

## FR-auto-backend-090 相关测试全绿（platform_sync 收养/documents 交互 + title_norm
变更：2026-09-30-title-adopt-clobber-guard
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 测试 相关模块就绪；When 相关测试全绿（platform_sync 收养/documents 交互 + title_norm 助手 + _apply_parsed 守卫）；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-09-30-title-adopt-clobber-guard/requirements.md#FR-05
最近确认：5da89fb8c48a2117e379b3d759cc72b19e1b33c4

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-09-30-title-adopt-clobber-guard:flow:FR-05
  tests: backend/app/modules/change/tests/test_title_normalization.py | backend/app/modules/platform_sync/tests/test_change_deleted_guard.py | backend/app/modules/platform_sync/tests/test_router.py
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-09-30-title-adopt-clobber-guard
  status: active
