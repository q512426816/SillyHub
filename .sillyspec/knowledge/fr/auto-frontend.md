---
author: sillyspec-fr-index
created_at: 2026-10-07T12:51:14.286Z
---

# FR 索引 — auto-frontend

> fr-index 从归档变更 requirements.md 幂等提炼（「最近确认」= 归档时 HEAD）。条目字段行为机械解析契约，勿手改。
> superseded 条目保留供取代链回溯；brainstorm 注入默认只给 active。
> 伪域（auto- 前缀）：由文件路径段投票派生，无模块卡——为该域补模块卡后，新变更将自动落回真域

## FR-auto-frontend-119 桌面端与移动端变更中心 tab 栏不再渲染「快速修复」tab
变更：2026-10-07-hide-quicklog-tab
状态：active
摘要：主路径
全文：.sillyspec/changes/archive/2026-10-07-hide-quicklog-tab/requirements.md#FR-01
最近确认：e62d98bcb7bddf9bc5c3313df3c47ee8ab04ab7d

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-07-hide-quicklog-tab:flow:测试绑定FR-01
  tests: changes/__tests__/page.test.tsx「Tab 计数缓存含 quicklog，tab 栏徽标仅 active/archive 且 quicklog tab 缺席」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-07-hide-quicklog-tab
  status: active

## FR-auto-frontend-120 ?tab=quicklog 深链仍进入存量快速修复视图（工作区概览统计卡 / 变更详情关联快速任务卡 / 移动端详情重绘入口不失效）
变更：2026-10-07-hide-quicklog-tab
状态：active
摘要：深链进入
全文：.sillyspec/changes/archive/2026-10-07-hide-quicklog-tab/requirements.md#FR-02
最近确认：e62d98bcb7bddf9bc5c3313df3c47ee8ab04ab7d

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-07-hide-quicklog-tab:flow:测试绑定FR-02
  tests: changes/__tests__/page.test.tsx「FR-03 URL ?tab=quicklog：初始 tab 为快速修复（tab 缺席 + 不发主列表请求）」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-07-hide-quicklog-tab
  status: active

## FR-auto-frontend-121 深链存量视图内副标题计数、quicklog 搜索/筛选/详情抽屉/会话页等既有行为不变
变更：2026-10-07-hide-quicklog-tab
状态：active
摘要：副标题计数
全文：.sillyspec/changes/archive/2026-10-07-hide-quicklog-tab/requirements.md#FR-03
最近确认：e62d98bcb7bddf9bc5c3313df3c47ee8ab04ab7d

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-07-hide-quicklog-tab:flow:测试绑定FR-03
  tests: changes/__tests__/page.test.tsx「quicklog 视图搜索/筛选抽屉/详情 Sheet（既有用例改深链进入后原断言保持）」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-07-hide-quicklog-tab
  status: active

## FR-auto-frontend-122 受影响的前端测试改为深链进入并全部通过（仅跑受影响测试文件）
变更：2026-10-07-hide-quicklog-tab
状态：active
摘要：主路径
全文：.sillyspec/changes/archive/2026-10-07-hide-quicklog-tab/requirements.md#FR-04
最近确认：e62d98bcb7bddf9bc5c3313df3c47ee8ab04ab7d

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-07-hide-quicklog-tab:flow:测试绑定FR-04
  tests: changes/__tests__/page.test.tsx | changes/__tests__/page.test.tsx「两文件全量用例通过（仅跑此两文件）」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-07-hide-quicklog-tab
  status: active
