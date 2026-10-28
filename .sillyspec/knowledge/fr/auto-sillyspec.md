---
author: sillyspec-fr-index
created_at: 2026-10-28T06:17:36.386Z
---

# FR 索引 — auto-sillyspec

> fr-index 从归档变更 requirements.md 幂等提炼（「最近确认」= 归档时 HEAD）。条目字段行为机械解析契约，勿手改。
> superseded 条目保留供取代链回溯；brainstorm 注入默认只给 active。
> 伪域（auto- 前缀）：由文件路径段投票派生，无模块卡——为该域补模块卡后，新变更将自动落回真域

## FR-auto-sillyspec-089 linked 分支只认领 started_at 晚于该 (change, session) link 行 created_at 的 run，绑定前历史轮不再摊入
变更：2026-10-28-change-usage-attribution-window
状态：active
摘要：绑定前历史轮排除
全文：.sillyspec/changes/archive/2026-10-28-change-usage-attribution-window/requirements.md#FR-01
最近确认：81f085761e318561a5a30b27a6df62f588daee61

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-28-change-usage-attribution-window:flow:测试绑定FR-01
  tests: test/backend/app/modules/change/tests/test_usage_stats.py「TestAttributionWindow::test_history_runs_before_link_excluded」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-28-change-usage-attribution-window
  status: active

## FR-auto-sillyspec-090 linked 分支窗口上界=变更 archived_at 与同会话下一变更 link 时刻的较小者，归档后/切下一变更后的无锚 run 不再计入
变更：2026-10-28-change-usage-attribution-window
状态：active
摘要：归档后无锚轮排除
全文：.sillyspec/changes/archive/2026-10-28-change-usage-attribution-window/requirements.md#FR-02
最近确认：81f085761e318561a5a30b27a6df62f588daee61

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-28-change-usage-attribution-window:flow:测试绑定FR-02
  tests: test/backend/app/modules/change/tests/test_usage_stats.py「TestAttributionWindow::test_archived_upper_bound_linked」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-28-change-usage-attribution-window
  status: active

## FR-auto-sillyspec-091 单会话先后绑定多变更时无锚 run 只归「轮时刻最近绑定的变更」，不双计
变更：2026-10-28-change-usage-attribution-window
状态：active
摘要：X 后切 Y 的无锚轮归属
全文：.sillyspec/changes/archive/2026-10-28-change-usage-attribution-window/requirements.md#FR-03
最近确认：81f085761e318561a5a30b27a6df62f588daee61

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-28-change-usage-attribution-window:flow:测试绑定FR-03
  tests: test/backend/app/modules/change/tests/test_usage_stats.py「TestAttributionWindow::test_recent_binding_wins_no_double_count」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-28-change-usage-attribution-window
  status: active

## FR-auto-sillyspec-092 同一变更绑定多会话时按各 link 行 created_at 独立开窗统计
变更：2026-10-28-change-usage-attribution-window
状态：active
摘要：两会话错峰绑定
全文：.sillyspec/changes/archive/2026-10-28-change-usage-attribution-window/requirements.md#FR-04
最近确认：81f085761e318561a5a30b27a6df62f588daee61

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-28-change-usage-attribution-window:flow:测试绑定FR-04
  tests: test/backend/app/modules/change/tests/test_usage_stats.py「TestAttributionWindow::test_multi_session_independent_windows」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-28-change-usage-attribution-window
  status: active

## FR-auto-sillyspec-093 dispatched 分支对已归档变更只统计 started_at 早于等于 archived_at 的 run
变更：2026-10-28-change-usage-attribution-window
状态：active
摘要：归档后打锚轮排除 + backfill 保留
全文：.sillyspec/changes/archive/2026-10-28-change-usage-attribution-window/requirements.md#FR-05
最近确认：81f085761e318561a5a30b27a6df62f588daee61

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-28-change-usage-attribution-window:flow:测试绑定FR-05
  tests: test/backend/app/modules/change/tests/test_usage_stats.py「TestAttributionWindow::test_archived_upper_bound_dispatched」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-28-change-usage-attribution-window
  status: active

## FR-auto-sillyspec-094 轻量族命令 flow done 与全量族命令 run archive 触发终态时清除会话 current_change_id（识别需覆盖两族命令解析通道），后续轮不再打锚已终态变更
变更：2026-10-28-change-usage-attribution-window
状态：active
摘要：两族终态命令解析与清锚
全文：.sillyspec/changes/archive/2026-10-28-change-usage-attribution-window/requirements.md#FR-06
最近确认：81f085761e318561a5a30b27a6df62f588daee61

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-28-change-usage-attribution-window:flow:测试绑定FR-06
  tests: test/backend/app/modules/change/tests/test_spec_binding.py「test_extract_spec_bindings_terminal_flag」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-28-change-usage-attribution-window
  status: active

## FR-auto-sillyspec-095 存量虚高统计（如 2026-10-28-session-list-loadmore-fetch）部署后无需数据修正自动回落至真实值
变更：2026-10-28-change-usage-attribution-window
状态：active
摘要：存量自愈
全文：.sillyspec/changes/archive/2026-10-28-change-usage-attribution-window/requirements.md#FR-07
最近确认：81f085761e318561a5a30b27a6df62f588daee61

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-28-change-usage-attribution-window:flow:测试绑定FR-07
  tests: test/backend/app/modules/change/tests/test_usage_stats.py「TestAttributionWindow::test_summary_anchor_same_window_as_detail」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-28-change-usage-attribution-window
  status: active

## FR-auto-sillyspec-096 后端单测覆盖上述全部场景并通过，既有 usage_stats 测试回归不破
变更：2026-10-28-change-usage-attribution-window
状态：active
摘要：全量相关面回归
全文：.sillyspec/changes/archive/2026-10-28-change-usage-attribution-window/requirements.md#FR-08
最近确认：81f085761e318561a5a30b27a6df62f588daee61

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-28-change-usage-attribution-window:flow:测试绑定FR-08
  tests: test/backend/app/modules/change/tests/test_usage_stats.py「TestAttributionWindow（全类 7 用例）」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-28-change-usage-attribution-window
  status: active
