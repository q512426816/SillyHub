---
author: sillyspec-fr-index
created_at: 2026-10-10T13:38:29.760Z
---

# FR 索引 — unmapped

> fr-index 从归档变更 requirements.md 幂等提炼（「最近确认」= 归档时 HEAD）。条目字段行为机械解析契约，勿手改。
> superseded 条目保留供取代链回溯；brainstorm 注入默认只给 active。
> 模块卡：modules/unmapped.md（域=模块 id 同构；行为条目↔模块契约互跳）

## FR-unmapped-700 daemon claude 引擎逐调用计时
变更：2026-10-10-live-token-speed-daemon-timing
状态：active
摘要：单调用轮
全文：.sillyspec/changes/archive/2026-10-10-live-token-speed-daemon-timing/requirements.md#FR-01
最近确认：b15fafc3b

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-10-live-token-speed-daemon-timing:task-02:acc-0-6145b3a7
  tests: sillyhub-daemon/tests/interactive/claude-events.test.ts
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-10-live-token-speed-daemon-timing
  status: active
- row: 2026-10-10-live-token-speed-daemon-timing:task-02:acc-1-aaf685f4
  tests: sillyhub-daemon/tests/interactive/claude-events.test.ts
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-10-live-token-speed-daemon-timing
  status: active
- row: 2026-10-10-live-token-speed-daemon-timing:task-02:acc-2-29de5afe
  tests: sillyhub-daemon/tests/interactive/claude-events.test.ts
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-10-live-token-speed-daemon-timing
  status: active

## FR-unmapped-701 daemon codex 引擎生成窗口计时
变更：2026-10-10-live-token-speed-daemon-timing
状态：active
摘要：调用间夹工具
全文：.sillyspec/changes/archive/2026-10-10-live-token-speed-daemon-timing/requirements.md#FR-02
最近确认：b15fafc3b

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-10-live-token-speed-daemon-timing:task-03:acc-0-4ac8d91b
  tests: sillyhub-daemon/tests/interactive/codex-app-server-driver.test.ts
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-10-live-token-speed-daemon-timing
  status: active
- row: 2026-10-10-live-token-speed-daemon-timing:task-03:acc-1-dba29b16
  tests: sillyhub-daemon/tests/interactive/codex-app-server-driver.test.ts
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-10-live-token-speed-daemon-timing
  status: active
- row: 2026-10-10-live-token-speed-daemon-timing:task-03:acc-2-bcdd0983
  tests: sillyhub-daemon/tests/interactive/codex-app-server-driver.test.ts
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-10-live-token-speed-daemon-timing
  status: active

## FR-unmapped-702 daemon pi 引擎 message_end 折叠（含显式降级路径）
变更：2026-10-10-live-token-speed-daemon-timing
状态：active
摘要：正常路径
全文：.sillyspec/changes/archive/2026-10-10-live-token-speed-daemon-timing/requirements.md#FR-03
最近确认：b15fafc3b

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-10-live-token-speed-daemon-timing:task-04:acc-0-77afbadf
  tests: sillyhub-daemon/tests/interactive/pi-rpc-driver.test.ts
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-10-live-token-speed-daemon-timing
  status: active
- row: 2026-10-10-live-token-speed-daemon-timing:task-04:acc-1-6d39ea23
  tests: sillyhub-daemon/tests/interactive/pi-rpc-driver.test.ts
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-10-live-token-speed-daemon-timing
  status: active

## FR-unmapped-703 usage 契约与 schema 同步
变更：2026-10-10-live-token-speed-daemon-timing
状态：active
摘要：旧事件兼容
全文：.sillyspec/changes/archive/2026-10-10-live-token-speed-daemon-timing/requirements.md#FR-04
最近确认：b15fafc3b

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-10-live-token-speed-daemon-timing:task-01:acc-0-f32728c9
  tests: backend/app/modules/daemon/tests/test_run_sync_ctx_tokens.py | frontend/src/components/daemon/__tests__/turn-speed.test.ts | frontend/src/components/daemon/__tests__/turn-timeline-token-speed.test.tsx | sillyhub-daemon/tests/interactive/claude-events.test.ts | sillyhub-daemon/tests/interactive/codex-app-server-driver.test.ts | sillyhub-daemon/tests/interactive/pi-rpc-driver.test.ts
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-10-live-token-speed-daemon-timing
  status: active
- row: 2026-10-10-live-token-speed-daemon-timing:task-01:acc-1-3494725c
  tests: backend/app/modules/daemon/tests/test_run_sync_ctx_tokens.py | frontend/src/components/daemon/__tests__/turn-speed.test.ts | frontend/src/components/daemon/__tests__/turn-timeline-token-speed.test.tsx | sillyhub-daemon/tests/interactive/claude-events.test.ts | sillyhub-daemon/tests/interactive/codex-app-server-driver.test.ts | sillyhub-daemon/tests/interactive/pi-rpc-driver.test.ts
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-10-live-token-speed-daemon-timing
  status: active
- row: 2026-10-10-live-token-speed-daemon-timing:task-01:acc-2-7ae30047
  tests: backend/app/modules/daemon/tests/test_run_sync_ctx_tokens.py | frontend/src/components/daemon/__tests__/turn-speed.test.ts | frontend/src/components/daemon/__tests__/turn-timeline-token-speed.test.tsx | sillyhub-daemon/tests/interactive/claude-events.test.ts | sillyhub-daemon/tests/interactive/codex-app-server-driver.test.ts | sillyhub-daemon/tests/interactive/pi-rpc-driver.test.ts
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-10-live-token-speed-daemon-timing
  status: active

## FR-unmapped-704 backend 提取与写回
变更：2026-10-10-live-token-speed-daemon-timing
状态：active
摘要：乱序防御
全文：.sillyspec/changes/archive/2026-10-10-live-token-speed-daemon-timing/requirements.md#FR-05
最近确认：b15fafc3b

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-10-live-token-speed-daemon-timing:task-05:acc-0-cd45ab1f
  tests: backend/app/modules/daemon/tests/test_run_sync_ctx_tokens.py
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-10-live-token-speed-daemon-timing
  status: active
- row: 2026-10-10-live-token-speed-daemon-timing:task-05:acc-1-9d7b3d5c
  tests: backend/app/modules/daemon/tests/test_run_sync_ctx_tokens.py
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-10-live-token-speed-daemon-timing
  status: active
- row: 2026-10-10-live-token-speed-daemon-timing:task-05:acc-2-c4c134e7
  tests: backend/app/modules/daemon/tests/test_run_sync_ctx_tokens.py
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-10-live-token-speed-daemon-timing
  status: active
- row: 2026-10-10-live-token-speed-daemon-timing:task-05:acc-3-5c300bde
  tests: backend/app/modules/daemon/tests/test_run_sync_ctx_tokens.py
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-10-live-token-speed-daemon-timing
  status: active

## FR-unmapped-705 tokens SSE 事件与 summary 下发
变更：2026-10-10-live-token-speed-daemon-timing
状态：active
摘要：旧 daemon 兼容
全文：.sillyspec/changes/archive/2026-10-10-live-token-speed-daemon-timing/requirements.md#FR-06
最近确认：b15fafc3b

## FR-unmapped-706 前端运行中实时显示与门控放宽
变更：2026-10-10-live-token-speed-daemon-timing
状态：active
摘要：运行中实时速度；运行中无计时数据（cursor / 旧 daemon）
全文：.sillyspec/changes/archive/2026-10-10-live-token-speed-daemon-timing/requirements.md#FR-07
最近确认：b15fafc3b

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-10-live-token-speed-daemon-timing:task-06:acc-0-8e69e39b
  tests: frontend/src/components/daemon/__tests__/turn-speed.test.ts | frontend/src/components/daemon/__tests__/turn-timeline-token-speed.test.tsx
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-10-live-token-speed-daemon-timing
  status: active
- row: 2026-10-10-live-token-speed-daemon-timing:task-06:acc-1-08cb0074
  tests: frontend/src/components/daemon/__tests__/turn-speed.test.ts | frontend/src/components/daemon/__tests__/turn-timeline-token-speed.test.tsx
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-10-live-token-speed-daemon-timing
  status: active
- row: 2026-10-10-live-token-speed-daemon-timing:task-06:acc-2-55c2c0f6
  tests: frontend/src/components/daemon/__tests__/turn-speed.test.ts | frontend/src/components/daemon/__tests__/turn-timeline-token-speed.test.tsx
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-10-live-token-speed-daemon-timing
  status: active

## FR-unmapped-707 相关测试通过（不跑全量）
变更：2026-10-10-live-token-speed-daemon-timing
状态：active
摘要：三侧绿
全文：.sillyspec/changes/archive/2026-10-10-live-token-speed-daemon-timing/requirements.md#FR-08
最近确认：b15fafc3b
