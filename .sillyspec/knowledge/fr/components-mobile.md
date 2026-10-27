---
author: sillyspec-fr-index
created_at: 2026-10-27T00:00:32.673Z
---

# FR 索引 — components-mobile

> fr-index 从归档变更 requirements.md 幂等提炼（「最近确认」= 归档时 HEAD）。条目字段行为机械解析契约，勿手改。
> superseded 条目保留供取代链回溯；brainstorm 注入默认只给 active。
> 模块卡：modules/components-mobile.md（域=模块 id 同构；行为条目↔模块契约互跳）

## FR-components-mobile-001 会话对话页运行状态条不再溢出（TurnLiveMarquee mobile 分支）
变更：2026-10-26-mobile-four-page-layout-fix
状态：active
摘要：mobile 宿主；desktop 锚定
全文：.sillyspec/changes/archive/2026-10-26-mobile-four-page-layout-fix/requirements.md#FR-01
最近确认：8efd55201

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-26-mobile-four-page-layout-fix:task-03:acc-0-c9fd775c
  tests: frontend/src/components/daemon/__tests__/session-panel-variant.test.tsx | frontend/src/components/daemon/__tests__/turn-live-marquee.test.tsx | frontend/src/components/daemon/__tests__/turn-segment-views.test.tsx | frontend/src/components/daemon/__tests__/turn-timeline-token-speed.test.tsx
  reason: spec
  state: active
  discovery: machine
  confirmed_by: agent
  confirmed_at: a5d11efcfb4cffd6f810b3f3f542685ab8fa5c57
  source_change: 2026-10-26-mobile-four-page-layout-fix
  status: active
- row: 2026-10-26-mobile-four-page-layout-fix:task-03:acc-1-cd96ea59
  tests: frontend/src/components/daemon/__tests__/session-panel-variant.test.tsx | frontend/src/components/daemon/__tests__/turn-live-marquee.test.tsx | frontend/src/components/daemon/__tests__/turn-segment-views.test.tsx | frontend/src/components/daemon/__tests__/turn-timeline-token-speed.test.tsx
  reason: spec
  state: active
  discovery: machine
  confirmed_by: agent
  confirmed_at: a5d11efcfb4cffd6f810b3f3f542685ab8fa5c57
  source_change: 2026-10-26-mobile-four-page-layout-fix
  status: active
- row: 2026-10-26-mobile-four-page-layout-fix:task-03:acc-2-a6faaaa7
  tests: frontend/src/components/daemon/__tests__/session-panel-variant.test.tsx | frontend/src/components/daemon/__tests__/turn-live-marquee.test.tsx | frontend/src/components/daemon/__tests__/turn-segment-views.test.tsx | frontend/src/components/daemon/__tests__/turn-timeline-token-speed.test.tsx
  reason: spec
  state: active
  discovery: machine
  confirmed_by: agent
  confirmed_at: a5d11efcfb4cffd6f810b3f3f542685ab8fa5c57
  source_change: 2026-10-26-mobile-four-page-layout-fix
  status: active
- row: 2026-10-26-mobile-four-page-layout-fix:task-05:acc-0-284325e1
  tests: frontend/src/components/daemon/__tests__/session-panel-variant.test.tsx | frontend/src/components/daemon/__tests__/turn-segment-views.test.tsx | frontend/src/components/daemon/__tests__/turn-timeline-token-speed.test.tsx
  reason: spec
  state: active
  discovery: machine
  confirmed_by: agent
  confirmed_at: a5d11efcfb4cffd6f810b3f3f542685ab8fa5c57
  source_change: 2026-10-26-mobile-four-page-layout-fix
  status: active
- row: 2026-10-26-mobile-four-page-layout-fix:task-05:acc-1-1b9964ee
  tests: frontend/src/components/daemon/__tests__/session-panel-variant.test.tsx | frontend/src/components/daemon/__tests__/turn-segment-views.test.tsx | frontend/src/components/daemon/__tests__/turn-timeline-token-speed.test.tsx
  reason: spec
  state: active
  discovery: machine
  confirmed_by: agent
  confirmed_at: a5d11efcfb4cffd6f810b3f3f542685ab8fa5c57
  source_change: 2026-10-26-mobile-four-page-layout-fix
  status: active

## FR-components-mobile-002 轮次信息胶囊不再溢出（RoundDivider mobile 分支）
变更：2026-10-26-mobile-four-page-layout-fix
状态：active
摘要：mobile 长数字
全文：.sillyspec/changes/archive/2026-10-26-mobile-four-page-layout-fix/requirements.md#FR-02
最近确认：8efd55201

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-26-mobile-four-page-layout-fix:task-04:acc-0-4fef5775
  tests: frontend/src/components/chat/__tests__/round-divider.test.tsx | frontend/src/components/daemon/__tests__/session-panel-variant.test.tsx | frontend/src/components/daemon/__tests__/turn-segment-views.test.tsx | frontend/src/components/daemon/__tests__/turn-timeline-token-speed.test.tsx
  reason: spec
  state: active
  discovery: machine
  confirmed_by: agent
  confirmed_at: a5d11efcfb4cffd6f810b3f3f542685ab8fa5c57
  source_change: 2026-10-26-mobile-four-page-layout-fix
  status: active
- row: 2026-10-26-mobile-four-page-layout-fix:task-04:acc-1-b7064ad3
  tests: frontend/src/components/chat/__tests__/round-divider.test.tsx | frontend/src/components/daemon/__tests__/session-panel-variant.test.tsx | frontend/src/components/daemon/__tests__/turn-segment-views.test.tsx | frontend/src/components/daemon/__tests__/turn-timeline-token-speed.test.tsx
  reason: spec
  state: active
  discovery: machine
  confirmed_by: agent
  confirmed_at: a5d11efcfb4cffd6f810b3f3f542685ab8fa5c57
  source_change: 2026-10-26-mobile-four-page-layout-fix
  status: active

## FR-components-mobile-003 输入占位排队态短句
变更：2026-10-26-mobile-four-page-layout-fix
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-10-26-mobile-four-page-layout-fix/requirements.md#FR-03
最近确认：8efd55201

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-26-mobile-four-page-layout-fix:task-07:acc-0-722c2346
  tests: frontend/src/app/(dashboard)/sessions/__tests__/page.test.tsx
  reason: spec
  state: active
  discovery: machine
  confirmed_by: agent
  confirmed_at: a5d11efcfb4cffd6f810b3f3f542685ab8fa5c57
  source_change: 2026-10-26-mobile-four-page-layout-fix
  status: active
- row: 2026-10-26-mobile-four-page-layout-fix:task-07:acc-1-9d34895f
  tests: frontend/src/app/(dashboard)/sessions/__tests__/page.test.tsx
  reason: spec
  state: active
  discovery: machine
  confirmed_by: agent
  confirmed_at: a5d11efcfb4cffd6f810b3f3f542685ab8fa5c57
  source_change: 2026-10-26-mobile-four-page-layout-fix
  status: active

## FR-components-mobile-004 底部供应商/模型行不再拥挤截断
变更：2026-10-26-mobile-four-page-layout-fix
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-10-26-mobile-four-page-layout-fix/requirements.md#FR-04
最近确认：8efd55201

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-26-mobile-four-page-layout-fix:task-06:acc-0-b7cb864b
  tests: frontend/src/components/sessions/__tests__/session-config-bar.test.tsx
  reason: spec
  state: active
  discovery: machine
  confirmed_by: agent
  confirmed_at: a5d11efcfb4cffd6f810b3f3f542685ab8fa5c57
  source_change: 2026-10-26-mobile-four-page-layout-fix
  status: active
- row: 2026-10-26-mobile-four-page-layout-fix:task-06:acc-1-34708287
  tests: frontend/src/components/sessions/__tests__/session-config-bar.test.tsx
  reason: spec
  state: active
  discovery: machine
  confirmed_by: agent
  confirmed_at: a5d11efcfb4cffd6f810b3f3f542685ab8fa5c57
  source_change: 2026-10-26-mobile-four-page-layout-fix
  status: active

## FR-components-mobile-005 「平台同步」卡标题禁竖排（PlatformSyncSection mobile 分支）
变更：2026-10-26-mobile-four-page-layout-fix
状态：active
摘要：mobile 窄视口
全文：.sillyspec/changes/archive/2026-10-26-mobile-four-page-layout-fix/requirements.md#FR-05
最近确认：8efd55201

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-26-mobile-four-page-layout-fix:task-08:acc-0-b1da385a
  tests: frontend/src/app/m/workspaces/[id]/changes/__tests__/page.test.tsx | frontend/src/components/changes/__tests__/platform-sync-section.test.tsx
  reason: spec
  state: active
  discovery: machine
  confirmed_by: agent
  confirmed_at: a5d11efcfb4cffd6f810b3f3f542685ab8fa5c57
  source_change: 2026-10-26-mobile-four-page-layout-fix
  status: active
- row: 2026-10-26-mobile-four-page-layout-fix:task-08:acc-1-cdf01e31
  tests: frontend/src/app/m/workspaces/[id]/changes/__tests__/page.test.tsx | frontend/src/components/changes/__tests__/platform-sync-section.test.tsx
  reason: spec
  state: active
  discovery: machine
  confirmed_by: agent
  confirmed_at: a5d11efcfb4cffd6f810b3f3f542685ab8fa5c57
  source_change: 2026-10-26-mobile-four-page-layout-fix
  status: active

## FR-components-mobile-006 变更中心搜索行两行化
变更：2026-10-26-mobile-four-page-layout-fix
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-10-26-mobile-four-page-layout-fix/requirements.md#FR-06
最近确认：8efd55201

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-26-mobile-four-page-layout-fix:task-09:acc-0-167a75ec
  tests: frontend/src/app/m/workspaces/[id]/changes/__tests__/page.test.tsx
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-26-mobile-four-page-layout-fix
  status: active
- row: 2026-10-26-mobile-four-page-layout-fix:task-09:acc-1-167ef197
  tests: frontend/src/app/m/workspaces/[id]/changes/__tests__/page.test.tsx
  reason: spec
  state: active
  discovery: machine
  confirmed_by: agent
  confirmed_at: a5d11efcfb4cffd6f810b3f3f542685ab8fa5c57
  source_change: 2026-10-26-mobile-four-page-layout-fix
  status: active

## FR-components-mobile-007 底部悬浮元素不再遮挡列表内容
变更：2026-10-26-mobile-four-page-layout-fix
状态：active
摘要：列表滚到底
全文：.sillyspec/changes/archive/2026-10-26-mobile-four-page-layout-fix/requirements.md#FR-07
最近确认：8efd55201

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-26-mobile-four-page-layout-fix:task-01:acc-0-3e013cf2
  tests: frontend/src/components/mobile/mobile-tab-bar.test.tsx
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-26-mobile-four-page-layout-fix
  status: active
- row: 2026-10-26-mobile-four-page-layout-fix:task-01:acc-1-04c78547
  tests: frontend/src/components/mobile/mobile-tab-bar.test.tsx
  reason: spec
  state: active
  discovery: machine
  confirmed_by: agent
  confirmed_at: a5d11efcfb4cffd6f810b3f3f542685ab8fa5c57
  source_change: 2026-10-26-mobile-four-page-layout-fix
  status: active
- row: 2026-10-26-mobile-four-page-layout-fix:task-01:acc-2-c2cd04fe
  tests: frontend/src/components/mobile/mobile-tab-bar.test.tsx
  reason: spec
  state: active
  discovery: machine
  confirmed_by: agent
  confirmed_at: a5d11efcfb4cffd6f810b3f3f542685ab8fa5c57
  source_change: 2026-10-26-mobile-four-page-layout-fix
  status: active

## FR-components-mobile-008 工作区选择页密度收敛
变更：2026-10-26-mobile-four-page-layout-fix
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-10-26-mobile-four-page-layout-fix/requirements.md#FR-08
最近确认：8efd55201

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-26-mobile-four-page-layout-fix:task-02:acc-0-4b397416
  tests: frontend/src/app/m/workspaces/[id]/sessions/__tests__/page.m-sessions.test.tsx | frontend/src/app/m/workspaces/__tests__/page.m-workspaces.test.tsx | frontend/src/components/mobile/mobile-workspace-header.test.tsx
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-26-mobile-four-page-layout-fix
  status: active
- row: 2026-10-26-mobile-four-page-layout-fix:task-02:acc-1-bf696da3
  tests: frontend/src/app/m/workspaces/[id]/sessions/__tests__/page.m-sessions.test.tsx | frontend/src/app/m/workspaces/__tests__/page.m-workspaces.test.tsx | frontend/src/components/mobile/mobile-workspace-header.test.tsx
  reason: spec
  state: active
  discovery: machine
  confirmed_by: agent
  confirmed_at: a5d11efcfb4cffd6f810b3f3f542685ab8fa5c57
  source_change: 2026-10-26-mobile-four-page-layout-fix
  status: active
- row: 2026-10-26-mobile-four-page-layout-fix:task-10:acc-0-5852a071
  tests: frontend/src/app/m/workspaces/__tests__/page.m-workspaces.test.tsx
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-26-mobile-four-page-layout-fix
  status: active
- row: 2026-10-26-mobile-four-page-layout-fix:task-10:acc-1-25f61ab0
  tests: frontend/src/app/m/workspaces/__tests__/page.m-workspaces.test.tsx
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-26-mobile-four-page-layout-fix
  status: active
- row: 2026-10-26-mobile-four-page-layout-fix:task-10:acc-2-b335b8d0
  tests: frontend/src/app/m/workspaces/__tests__/page.m-workspaces.test.tsx
  reason: spec
  state: active
  discovery: machine
  confirmed_by: agent
  confirmed_at: a5d11efcfb4cffd6f810b3f3f542685ab8fa5c57
  source_change: 2026-10-26-mobile-four-page-layout-fix
  status: active

## FR-components-mobile-009 会话列表页头部与 FAB 收敛
变更：2026-10-26-mobile-four-page-layout-fix
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-10-26-mobile-four-page-layout-fix/requirements.md#FR-09
最近确认：8efd55201

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-26-mobile-four-page-layout-fix:task-11:acc-0-8d8a86b7
  tests: frontend/src/app/m/workspaces/[id]/sessions/__tests__/page.m-sessions.test.tsx | frontend/src/components/mobile/mobile-workspace-header.test.tsx
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-26-mobile-four-page-layout-fix
  status: active
- row: 2026-10-26-mobile-four-page-layout-fix:task-11:acc-1-ce198647
  tests: frontend/src/app/m/workspaces/[id]/sessions/__tests__/page.m-sessions.test.tsx | frontend/src/components/mobile/mobile-workspace-header.test.tsx
  reason: spec
  state: active
  discovery: machine
  confirmed_by: agent
  confirmed_at: a5d11efcfb4cffd6f810b3f3f542685ab8fa5c57
  source_change: 2026-10-26-mobile-four-page-layout-fix
  status: active
- row: 2026-10-26-mobile-four-page-layout-fix:task-11:acc-2-b335b8d0
  tests: frontend/src/app/m/workspaces/[id]/sessions/__tests__/page.m-sessions.test.tsx | frontend/src/components/mobile/mobile-workspace-header.test.tsx
  reason: spec
  state: active
  discovery: machine
  confirmed_by: agent
  confirmed_at: a5d11efcfb4cffd6f810b3f3f542685ab8fa5c57
  source_change: 2026-10-26-mobile-four-page-layout-fix
  status: active

## FR-components-mobile-010 PC 端零回归（硬验收）
变更：2026-10-26-mobile-four-page-layout-fix
状态：active
摘要：desktop 宿主全链
全文：.sillyspec/changes/archive/2026-10-26-mobile-four-page-layout-fix/requirements.md#FR-10
最近确认：8efd55201
