---
author: sillyspec-fr-index
created_at: 2026-10-15T08:11:06.236Z
---

# FR 索引 — components-daemon

> fr-index 从归档变更 requirements.md 幂等提炼（「最近确认」= 归档时 HEAD）。条目字段行为机械解析契约，勿手改。
> superseded 条目保留供取代链回溯；brainstorm 注入默认只给 active。
> 模块卡：modules/components-daemon.md（域=模块 id 同构；行为条目↔模块契约互跳）

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
