---
author: sillyspec-fr-index
created_at: 2026-10-27T02:56:31.315Z
---

# FR 索引 — app-mobile-pages

> fr-index 从归档变更 requirements.md 幂等提炼（「最近确认」= 归档时 HEAD）。条目字段行为机械解析契约，勿手改。
> superseded 条目保留供取代链回溯；brainstorm 注入默认只给 active。
> 模块卡：modules/app-mobile-pages.md（域=模块 id 同构；行为条目↔模块契约互跳）

## FR-app-mobile-pages-001 RoundDivider mobile 单行不折行：mobile 分支不渲染 detail(开始时刻/历时,最次要)且胶囊 nowrap+truncate 超长省略,desktop 形态不变
变更：2026-10-27-mobile-chat-visual-round3
状态：active
摘要：主路径
全文：.sillyspec/changes/archive/2026-10-27-mobile-chat-visual-round3/requirements.md#FR-01
最近确认：3266725e5f931c7b00101b1d1bff2c36ceaf6fa1

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-27-mobile-chat-visual-round3:flow:测试绑定FR-01
  tests: frontend/src/components/chat/__tests__/round-divider.test.tsx「mobile=true：单行不折行（nowrap+truncate）+ detail 不渲染」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-27-mobile-chat-visual-round3
  status: active

## FR-app-mobile-pages-002 SessionPanel mobile 头部标题左侧加返回按钮(ChevronLeft)：有 workspace_id 跳 /m/workspaces/{wid}/sessions,无则 /m/workspaces;desktop/dialog/悬浮宿主零变化
变更：2026-10-27-mobile-chat-visual-round3
状态：active
摘要：主路径
全文：.sillyspec/changes/archive/2026-10-27-mobile-chat-visual-round3/requirements.md#FR-02
最近确认：3266725e5f931c7b00101b1d1bff2c36ceaf6fa1

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-27-mobile-chat-visual-round3:flow:测试绑定FR-02
  tests: frontend/src/app/m/workspaces/[id]/sessions/[sid]/__tests__/page.m-session-chat.test.tsx
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-27-mobile-chat-visual-round3
  status: active

## FR-app-mobile-pages-003 mobile 会话列表卡行首加 PC 同款状态标：消费 session-list-panel 导出纯函数 sessionStatusIndicator(status,liveness null,completedUnread false,runStatus undefined,pendingDialogKind=pending_requests[0].kind)——红点失败/绿点完成/问号待答/其余留白,与 PC 单一源同款
变更：2026-10-27-mobile-chat-visual-round3
状态：active
摘要：主路径
全文：.sillyspec/changes/archive/2026-10-27-mobile-chat-visual-round3/requirements.md#FR-03
最近确认：3266725e5f931c7b00101b1d1bff2c36ceaf6fa1

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-27-mobile-chat-visual-round3:flow:测试绑定FR-03
  tests: frontend/src/components/mobile/mobile-session-list.test.tsx
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-27-mobile-chat-visual-round3
  status: active

## FR-app-mobile-pages-004 相关测试面全绿(round-divider/session-panel-variant/page.m-sessions/mobile-session-list 零回归)
变更：2026-10-27-mobile-chat-visual-round3
状态：active
摘要：主路径
全文：.sillyspec/changes/archive/2026-10-27-mobile-chat-visual-round3/requirements.md#FR-04
最近确认：3266725e5f931c7b00101b1d1bff2c36ceaf6fa1
