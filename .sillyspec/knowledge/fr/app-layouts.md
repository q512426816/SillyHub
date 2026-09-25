---
author: sillyspec-fr-index
created_at: 2026-09-25T23:00:56.833Z
---

# FR 索引 — app-layouts

> fr-index 从归档变更 requirements.md 幂等提炼（「最近确认」= 归档时 HEAD）。条目字段行为机械解析契约，勿手改。
> superseded 条目保留供取代链回溯；brainstorm 注入默认只给 active。
> 模块卡：modules/app-layouts.md（域=模块 id 同构；行为条目↔模块契约互跳）

## FR-app-layouts-001 全量同步回执计数
变更：2026-09-26-spec-sync-receipt-visibility
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-09-26-spec-sync-receipt-visibility/requirements.md#FR-01
最近确认：a901cde0e6cd4f02dccea7d87a38b171642286d4

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-09-26-spec-sync-receipt-visibility:flow:FR-01
  tests: backend/app/modules/spec_workspace/tests/test_platform_deleted_guard.py
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-09-26-spec-sync-receipt-visibility
  status: active

## FR-app-layouts-002 增量同步回执计数（daemon/CLI 双轨）
变更：2026-09-26-spec-sync-receipt-visibility
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-09-26-spec-sync-receipt-visibility/requirements.md#FR-02
最近确认：a901cde0e6cd4f02dccea7d87a38b171642286d4

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-09-26-spec-sync-receipt-visibility:flow:FR-02
  tests: backend/app/modules/spec_workspace/tests/test_sync_incremental.py
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-09-26-spec-sync-receipt-visibility
  status: active

## FR-app-layouts-003 冲突进注册表
变更：2026-09-26-spec-sync-receipt-visibility
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-09-26-spec-sync-receipt-visibility/requirements.md#FR-03
最近确认：a901cde0e6cd4f02dccea7d87a38b171642286d4

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-09-26-spec-sync-receipt-visibility:flow:FR-03
  tests: backend/app/modules/spec_workspace/tests/test_platform_deleted_guard.py
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-09-26-spec-sync-receipt-visibility
  status: active

## FR-app-layouts-004 全绿闭环
变更：2026-09-26-spec-sync-receipt-visibility
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-09-26-spec-sync-receipt-visibility/requirements.md#FR-04
最近确认：a901cde0e6cd4f02dccea7d87a38b171642286d4

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-09-26-spec-sync-receipt-visibility:flow:FR-04
  tests: backend/app/modules/spec_workspace/tests/test_platform_deleted_guard.py
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-09-26-spec-sync-receipt-visibility
  status: active

## FR-app-layouts-005 工作区冲突横幅
变更：2026-09-26-spec-sync-receipt-visibility
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-09-26-spec-sync-receipt-visibility/requirements.md#FR-05
最近确认：a901cde0e6cd4f02dccea7d87a38b171642286d4

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-09-26-spec-sync-receipt-visibility:flow:FR-05
  tests: frontend/src/components/__tests__/spec-sync-conflict-banner.test.ts
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-09-26-spec-sync-receipt-visibility
  status: active

## FR-app-layouts-006 契约同步与零回归
变更：2026-09-26-spec-sync-receipt-visibility
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-09-26-spec-sync-receipt-visibility/requirements.md#FR-06
最近确认：a901cde0e6cd4f02dccea7d87a38b171642286d4

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-09-26-spec-sync-receipt-visibility:flow:FR-06
  tests: src/components/__tests__/spec-sync-conflict-banner.test.ts
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-09-26-spec-sync-receipt-visibility
  status: active
