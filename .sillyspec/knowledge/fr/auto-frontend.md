---
author: sillyspec-fr-index
created_at: 2026-10-08T03:33:17.438Z
---

# FR 索引 — auto-frontend

> fr-index 从归档变更 requirements.md 幂等提炼（「最近确认」= 归档时 HEAD）。条目字段行为机械解析契约，勿手改。
> superseded 条目保留供取代链回溯；brainstorm 注入默认只给 active。
> 伪域（auto- 前缀）：由文件路径段投票派生，无模块卡——为该域补模块卡后，新变更将自动落回真域

## FR-auto-frontend-123 悬停窄轨刻度展开浮层后，浮层内当前指向的轮次行有可见指向标记（与 activeTurnKey 当前轮高亮视觉区分）
变更：2026-10-08-turn-nav-hover-mark
状态：active
摘要：悬停刻度看浮层标记；指向行与当前轮同行
全文：.sillyspec/changes/archive/2026-10-08-turn-nav-hover-mark/requirements.md#FR-01
最近确认：001bcc6c693cc7947ce9318ca0c016410ed8a916

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-08-turn-nav-hover-mark:flow:测试绑定FR-01
  tests: test/frontend/src/components/sessions/__tests__/turn-nav-list.test.tsx「悬停刻度展开浮层后浮层内指向行有可见指向标记（与 active 高亮区分）」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-08-turn-nav-hover-mark
  status: active

## FR-auto-frontend-124 指向标记随鼠标在刻度间/浮层行间移动实时跟随更新
变更：2026-10-08-turn-nav-hover-mark
状态：active
摘要：刻度滑动跟随；浮层行同步
全文：.sillyspec/changes/archive/2026-10-08-turn-nav-hover-mark/requirements.md#FR-02
最近确认：001bcc6c693cc7947ce9318ca0c016410ed8a916

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-08-turn-nav-hover-mark:flow:测试绑定FR-02
  tests: test/frontend/src/components/sessions/__tests__/turn-nav-list.test.tsx「指向标记随刻度滑动与浮层行 hover 实时跟随」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-08-turn-nav-hover-mark
  status: active

## FR-auto-frontend-125 浮层内指向行超出可视区时自动滚入（block:nearest，不抢既有 active 联动语义之外的新滚动）
变更：2026-10-08-turn-nav-hover-mark
状态：active
摘要：长会话指向滚入
全文：.sillyspec/changes/archive/2026-10-08-turn-nav-hover-mark/requirements.md#FR-03
最近确认：001bcc6c693cc7947ce9318ca0c016410ed8a916

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-08-turn-nav-hover-mark:flow:测试绑定FR-03
  tests: test/frontend/src/components/sessions/__tests__/turn-nav-list.test.tsx「指向行滚入可视区（scrollIntoView block:nearest，指向优先回落 active）」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-08-turn-nav-hover-mark
  status: active

## FR-auto-frontend-126 鼠标移开组件后指向标记清除，既有展开/收起/pin/跳转/aria 行为零回归
变更：2026-10-08-turn-nav-hover-mark
状态：active
摘要：移开清除
全文：.sillyspec/changes/archive/2026-10-08-turn-nav-hover-mark/requirements.md#FR-04
最近确认：001bcc6c693cc7947ce9318ca0c016410ed8a916

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-08-turn-nav-hover-mark:flow:测试绑定FR-04
  tests: test/frontend/src/components/sessions/__tests__/turn-nav-list.test.tsx「移开组件防抖到点清指向；收起点同步清除；既有行为零回归」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-08-turn-nav-hover-mark
  status: active

## FR-auto-frontend-127 turn-nav-list 组件单测覆盖上述新行为且既有用例全绿
变更：2026-10-08-turn-nav-hover-mark
状态：active
摘要：测试全绿
全文：.sillyspec/changes/archive/2026-10-08-turn-nav-hover-mark/requirements.md#FR-05
最近确认：001bcc6c693cc7947ce9318ca0c016410ed8a916

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-08-turn-nav-hover-mark:flow:测试绑定FR-05
  tests: test/frontend/src/components/sessions/__tests__/turn-nav-list.test.tsx「turn-nav-list 既有用例全绿（vitest run 全文件）」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-08-turn-nav-hover-mark
  status: active
