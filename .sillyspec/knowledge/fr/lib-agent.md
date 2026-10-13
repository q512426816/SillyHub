---
author: sillyspec-fr-index
created_at: 2026-10-13T07:38:36.111Z
---

# FR 索引 — lib-agent

> fr-index 从归档变更 requirements.md 幂等提炼（「最近确认」= 归档时 HEAD）。条目字段行为机械解析契约，勿手改。
> superseded 条目保留供取代链回溯；brainstorm 注入默认只给 active。
> 模块卡：modules/lib-agent.md（域=模块 id 同构；行为条目↔模块契约互跳）

## FR-lib-agent-001 后端 /sessions/{id}/logs?slim=true 截断 tool_call 行时，必须从完整原文解析 tool_use_id 并随 DTO 回传（解析失败不阻断截断）
变更：2026-10-13-slim-subagent-false-running
状态：active
摘要：超长 Agent 派发行截断时回传配对键；非 JSON tool_call 行截断容错
全文：.sillyspec/changes/archive/2026-10-13-slim-subagent-false-running/requirements.md#FR-01
最近确认：e2f9ac59f5559975780f65378a7e491fd40307ec

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-13-slim-subagent-false-running:flow:测试绑定FR-01
  tests: backend/app/modules/daemon/tests/test_session_fast_replay.py::TestSessionLogsRunIdAndSlim::test_slim_truncated_row_returns_tool_use_id「slim
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-13-slim-subagent-false-running
  status: active

## FR-lib-agent-002 前端历史装配在 tool_call JSON 解析失败时必须回退消费回传的 tool_use_id：子代理日志正确挂进派发 tool 段，不再产生 stub
变更：2026-10-13-slim-subagent-false-running
状态：active
摘要：slim 历史回放子代理正确挂靠（会话 f231ca18 实证形态）；跨 run 终态行重挂
全文：.sillyspec/changes/archive/2026-10-13-slim-subagent-false-running/requirements.md#FR-02
最近确认：e2f9ac59f5559975780f65378a7e491fd40307ec

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-13-slim-subagent-false-running:flow:测试绑定FR-02
  tests: frontend/src/components/daemon/__tests__/runtime-session-helpers.test.tsx「regroup 回退登记跨 run 终态行」 | frontend/src/components/daemon/__tests__/session-log-assembler.test.ts「slim 截断回退 toolUseId：子日志挂进派发段不产生 stub」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-13-slim-subagent-false-running
  status: active

## FR-lib-agent-003 恢复配对后子代理块状态必须由 result 配对与 [TASK_*] 元数据接管（终态显示已完成/失败，不再恒「运行中」）
变更：2026-10-13-slim-subagent-false-running
状态：active
摘要：已完成后台子代理的终态显示
全文：.sillyspec/changes/archive/2026-10-13-slim-subagent-false-running/requirements.md#FR-03
最近确认：e2f9ac59f5559975780f65378a7e491fd40307ec

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-13-slim-subagent-false-running:flow:测试绑定FR-03
  tests: frontend/src/components/daemon/__tests__/session-log-assembler.test.ts「恢复配对后 taskStatus 终态接管头部显示」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-13-slim-subagent-false-running
  status: active

## FR-lib-agent-004 历史批量装配（logsToSegments）结束后仍残留的孤儿 stub 必须渲染为中性已结束态（灰点、无脉冲、不显示「运行中」），实时路径 stub 行为零变化
变更：2026-10-13-slim-subagent-false-running
状态：active
摘要：派发行彻底缺失的历史孤儿；实时暂态 stub 不受影响
全文：.sillyspec/changes/archive/2026-10-13-slim-subagent-false-running/requirements.md#FR-04
最近确认：e2f9ac59f5559975780f65378a7e491fd40307ec

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-13-slim-subagent-false-running:flow:测试绑定FR-04
  tests: frontend/src/components/daemon/__tests__/session-log-assembler.test.ts「历史孤儿 stub 标记 orphaned」 | frontend/src/components/daemon/__tests__/turn-segment-views.test.tsx「孤儿 stub 灰点无脉冲不显示运行中、实时 stub 仍脉冲」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-13-slim-subagent-false-running
  status: active

## FR-lib-agent-005 非 slim 路径（实时 SSE / 非 slim 历史）行为必须零变化；真实运行中的会话不受影响
变更：2026-10-13-slim-subagent-false-running
状态：active
摘要：解析成功时零回归
全文：.sillyspec/changes/archive/2026-10-13-slim-subagent-false-running/requirements.md#FR-05
最近确认：e2f9ac59f5559975780f65378a7e491fd40307ec

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-13-slim-subagent-false-running:flow:测试绑定FR-05
  tests: frontend/src/components/daemon/__tests__/session-log-assembler.test.ts「解析成功时零回归（行内值优先）」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-13-slim-subagent-false-running
  status: active

## FR-lib-agent-006 新增/更新的前后端相关测试必须全部通过（不跑全量，全量留给 CI）
变更：2026-10-13-slim-subagent-false-running
状态：active
摘要：相关测试绿
全文：.sillyspec/changes/archive/2026-10-13-slim-subagent-false-running/requirements.md#FR-06
最近确认：e2f9ac59f5559975780f65378a7e491fd40307ec
