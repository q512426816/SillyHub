---
author: sillyspec-fr-index
created_at: 2026-10-12T11:08:58.569Z
---

# FR 索引 — components-agent-log

> fr-index 从归档变更 requirements.md 幂等提炼（「最近确认」= 归档时 HEAD）。条目字段行为机械解析契约，勿手改。
> superseded 条目保留供取代链回溯；brainstorm 注入默认只给 active。
> 模块卡：modules/components-agent-log.md（域=模块 id 同构；行为条目↔模块契约互跳）

## FR-components-agent-log-001 后端：启动清理判死前检查「最后一条 ask 信号日志（pending_input 通道或 tool_call 通道 tool_kind=ask）晚于最后一条 user_input 日志」，命中则跳过判死保持 running。
变更：2026-10-12-stale-run-askwait-fix
状态：active
摘要：主路径（等待回答豁免）；边界（已回答不豁免）；边界（pending_input 通道同享豁免）
全文：.sillyspec/changes/archive/2026-10-12-stale-run-askwait-fix/requirements.md#FR-01
最近确认：c782a92497f30a946075b57442b9dcd11dcd74f8

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-12-stale-run-askwait-fix:flow:测试绑定FR-01
  tests: backend/app/modules/agent/tests/test_cleanup_stale_runs_error_code.py「test_stale_run_awaiting_user_answer_skipped」 | backend/app/modules/agent/tests/test_cleanup_stale_runs_error_code.py「test_stale_run_awaiting_user_pending_input_channel_skipped」 | backend/app/modules/agent/tests/test_cleanup_stale_runs_error_code.py「test_stale_run_user_answered_after_ask_still_killed」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-12-stale-run-askwait-fix
  status: active

## FR-components-agent-log-002 后端：SERVICE_RESTART_INTERRUPTED 终态化的 output_redacted 改为中文可读原因（经 failure_summary 透出前端错误卡），error_detail 形状不变。
变更：2026-10-12-stale-run-askwait-fix
状态：active
摘要：主路径
全文：.sillyspec/changes/archive/2026-10-12-stale-run-askwait-fix/requirements.md#FR-02
最近确认：c782a92497f30a946075b57442b9dcd11dcd74f8

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-12-stale-run-askwait-fix:flow:测试绑定FR-02
  tests: backend/app/modules/agent/tests/test_cleanup_stale_runs_error_code.py「test_stale_run_failed_branch_writes_error_code」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-12-stale-run-askwait-fix
  status: active

## FR-components-agent-log-003 前端：buildErrorLogItem 对无模型错误键（type/code/message/retryable/hint/raw/reset_at 均缺）的字典返回 null，回落 buildSystemFailureItem。
变更：2026-10-12-stale-run-askwait-fix
状态：active
摘要：主路径；边界（部分键仍解析）
全文：.sillyspec/changes/archive/2026-10-12-stale-run-askwait-fix/requirements.md#FR-03
最近确认：c782a92497f30a946075b57442b9dcd11dcd74f8

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-12-stale-run-askwait-fix:flow:测试绑定FR-03
  tests: frontend/src/components/agent-log/__tests__/normalize.test.ts「buildErrorLogItem 无模型错误键的系统字典 → null（回落 buildSystemFailureItem）」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-12-stale-run-askwait-fix
  status: active

## FR-components-agent-log-004 前端：SYSTEM_ERROR_CODE_META 收录 SERVICE_RESTART_INTERRUPTED（PowerOff 图标、中性蓝灰、中文 hint）。
变更：2026-10-12-stale-run-askwait-fix
状态：active
摘要：主路径
全文：.sillyspec/changes/archive/2026-10-12-stale-run-askwait-fix/requirements.md#FR-04
最近确认：c782a92497f30a946075b57442b9dcd11dcd74f8

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-12-stale-run-askwait-fix:flow:测试绑定FR-04
  tests: frontend/src/components/agent-log/__tests__/run-error-item.test.tsx「SERVICE_RESTART_INTERRUPTED → 「服务重启中断」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-12-stale-run-askwait-fix
  status: active

## FR-components-agent-log-005 前端：任务日志页（agent-run-panel/agent-log-viewer）透传 error_code + failure_summary，normalizeLogs 兜底链接入 buildSystemFailureItem。
变更：2026-10-12-stale-run-askwait-fix
状态：active
摘要：主路径；边界（成功路径零回归）
全文：.sillyspec/changes/archive/2026-10-12-stale-run-askwait-fix/requirements.md#FR-05
最近确认：c782a92497f30a946075b57442b9dcd11dcd74f8

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-12-stale-run-askwait-fix:flow:测试绑定FR-05
  tests: frontend/src/components/agent-log/__tests__/normalize.test.ts「normalizeLogs errorCode + failureSummary → 末尾追加系统失败项（中文 message）」 | frontend/src/components/agent-log/__tests__/normalize.test.ts「normalizeLogs errorDetail 为系统字典（无模型错误键）→ 回落系统失败映射」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-12-stale-run-askwait-fix
  status: active

## FR-components-agent-log-006 后端测试：等待用户回答的 running 轮豁免判死（保持 running）；已回答（user_input 晚于 ask）的停滞轮照常判死；failed 分支补 output_redacted 中文断言。
变更：2026-10-12-stale-run-askwait-fix
状态：active
摘要：主路径
全文：.sillyspec/changes/archive/2026-10-12-stale-run-askwait-fix/requirements.md#FR-06
最近确认：c782a92497f30a946075b57442b9dcd11dcd74f8

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-12-stale-run-askwait-fix:flow:测试绑定FR-06
  tests: backend/app/modules/agent/tests/test_cleanup_stale_runs_error_code.py
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-12-stale-run-askwait-fix
  status: active

## FR-components-agent-log-007 前端测试：alien 字典回落、SERVICE_RESTART_INTERRUPTED 卡片元数据、normalizeLogs 兜底链。
变更：2026-10-12-stale-run-askwait-fix
状态：active
摘要：主路径
全文：.sillyspec/changes/archive/2026-10-12-stale-run-askwait-fix/requirements.md#FR-07
最近确认：c782a92497f30a946075b57442b9dcd11dcd74f8

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-12-stale-run-askwait-fix:flow:测试绑定FR-07
  tests: frontend/src/components/agent-log/__tests__/normalize.test.ts | frontend/src/components/agent-log/__tests__/run-error-item.test.tsx
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-12-stale-run-askwait-fix
  status: active
