---
author: sillyspec-fr-index
created_at: 2026-10-08T01:03:54.861Z
---

# FR 索引 — auto-sillyspec

> fr-index 从归档变更 requirements.md 幂等提炼（「最近确认」= 归档时 HEAD）。条目字段行为机械解析契约，勿手改。
> superseded 条目保留供取代链回溯；brainstorm 注入默认只给 active。
> 伪域（auto- 前缀）：由文件路径段投票派生，无模块卡——为该域补模块卡后，新变更将自动落回真域

## FR-auto-sillyspec-053 service.update() 对 models 做显式 None-pop，与 agent_kinds 既有防护同款对齐
变更：2026-10-08-provider-update-models-none-guard
状态：active
摘要：显式 null 更新
全文：.sillyspec/changes/archive/2026-10-08-provider-update-models-none-guard/requirements.md#FR-01
最近确认：87e292759e4934ec73c9c92152c38de97610509e

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-08-provider-update-models-none-guard:flow:测试绑定FR-01
  tests: backend/app/modules/llm_provider/tests/test_agent_kinds_multi.py「TestMultiKindUpdateSemantics::test_explicit_null_models_is_noop」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-08-provider-update-models-none-guard
  status: active

## FR-auto-sillyspec-054 PATCH body models=null 不再 500，原模型列表保持不变（补回归测试覆盖）
变更：2026-10-08-provider-update-models-none-guard
状态：active
摘要：回归用例双断言
全文：.sillyspec/changes/archive/2026-10-08-provider-update-models-none-guard/requirements.md#FR-02
最近确认：87e292759e4934ec73c9c92152c38de97610509e

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-08-provider-update-models-none-guard:flow:测试绑定FR-02
  tests: backend/app/modules/llm_provider/tests/test_agent_kinds_multi.py「TestMultiKindUpdateSemantics::test_explicit_null_models_is_noop」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-08-provider-update-models-none-guard
  status: active

## FR-auto-sillyspec-055 本模块相关测试文件全绿
变更：2026-10-08-provider-update-models-none-guard
状态：active
摘要：相关面验证
全文：.sillyspec/changes/archive/2026-10-08-provider-update-models-none-guard/requirements.md#FR-03
最近确认：87e292759e4934ec73c9c92152c38de97610509e

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-08-provider-update-models-none-guard:flow:测试绑定FR-03
  tests: backend/app/modules/llm_provider/tests/test_agent_kinds_multi.py「全文件」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-08-provider-update-models-none-guard
  status: active

## FR-auto-sillyspec-056 前端 change-patch.json 文件预览渲染结构化清单面，scopeAudit 子对象在场时叠加对账快照视图，缺席时降级说明
变更：2026-10-09-close-trace-single-set-platform
状态：active
摘要：主路径
全文：.sillyspec/changes/archive/2026-10-09-close-trace-single-set-platform/requirements.md#FR-01
最近确认：2f6d525155a2b7cd8ec208e77f0f83e5f9a43967

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-09-close-trace-single-set-platform:flow:测试绑定FR-01
  tests: frontend/src/components/files/__tests__/structured-views.test.tsx
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-09-close-trace-single-set-platform
  status: active

## FR-auto-sillyspec-057 旧形态归档（四件套/heavy 双件）预览不回归
变更：2026-10-09-close-trace-single-set-platform
状态：active
摘要：主路径
全文：.sillyspec/changes/archive/2026-10-09-close-trace-single-set-platform/requirements.md#FR-02
最近确认：2f6d525155a2b7cd8ec208e77f0f83e5f9a43967

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-09-close-trace-single-set-platform:flow:测试绑定FR-02
  tests: frontend/src/components/files/__tests__/structured-views.test.tsx
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-09-close-trace-single-set-platform
  status: active

## FR-auto-sillyspec-058 tsc --noEmit 通过；change 模块相关测试无新增失败（预存环境错误除外）
变更：2026-10-09-close-trace-single-set-platform
状态：active
摘要：主路径
全文：.sillyspec/changes/archive/2026-10-09-close-trace-single-set-platform/requirements.md#FR-03
最近确认：2f6d525155a2b7cd8ec208e77f0f83e5f9a43967

## FR-auto-sillyspec-059 清扫只收「最近无心跳」的任务（心跳宽限 + is_async 豁免）
变更：2026-10-11-task-sweep-liveness-guard
状态：active
摘要：后台任务跨轮存活不被误收
全文：.sillyspec/changes/archive/2026-10-11-task-sweep-liveness-guard/requirements.md#FR-01
最近确认：460c2474d9377ddeef2971b481f8a56cd0700b5a

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-11-task-sweep-liveness-guard:flow:测试绑定FR-01
  tests: backend/app/modules/daemon/tests/test_agent_session_tasks.py「test_finalize_sweeps_only_stale_sync」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-11-task-sweep-liveness-guard
  status: active

## FR-auto-sillyspec-060 清扫收口行可被 running 心跳复活（误收自愈）；真实终态行维持吸收
变更：2026-10-11-task-sweep-liveness-guard
状态：active
摘要：误收自愈；真实终态不复活
全文：.sillyspec/changes/archive/2026-10-11-task-sweep-liveness-guard/requirements.md#FR-02
最近确认：460c2474d9377ddeef2971b481f8a56cd0700b5a

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-11-task-sweep-liveness-guard:flow:测试绑定FR-02
  tests: backend/app/modules/daemon/tests/test_agent_session_tasks.py「test_sweep_stopped_row_revives_on_running_heartbeat」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-11-task-sweep-liveness-guard
  status: active

## FR-auto-sillyspec-061 run 收口安排延迟复扫（孤儿不靠重启兜底）
变更：2026-10-11-task-sweep-liveness-guard
状态：active
摘要：新鲜后沉默的孤儿
全文：.sillyspec/changes/archive/2026-10-11-task-sweep-liveness-guard/requirements.md#FR-03
最近确认：460c2474d9377ddeef2971b481f8a56cd0700b5a

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-11-task-sweep-liveness-guard:flow:测试绑定FR-03
  tests: backend/app/modules/daemon/tests/test_agent_session_tasks.py「test_delayed_resweep_catches_now_silent」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-11-task-sweep-liveness-guard
  status: active

## FR-auto-sillyspec-062 既有行为回归
变更：2026-10-11-task-sweep-liveness-guard
状态：active
摘要：回归
全文：.sillyspec/changes/archive/2026-10-11-task-sweep-liveness-guard/requirements.md#FR-04
最近确认：460c2474d9377ddeef2971b481f8a56cd0700b5a

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-11-task-sweep-liveness-guard:flow:测试绑定FR-04
  tests: backend/app/modules/daemon/tests/test_agent_session_tasks.py「test_genuine_stopped_absorbs_running_heartbeat」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-11-task-sweep-liveness-guard
  status: active
