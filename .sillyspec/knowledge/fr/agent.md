---
author: sillyspec-fr-index
created_at: 2026-10-14T02:51:35.432Z
---

# FR 索引 — agent

> fr-index 从归档变更 requirements.md 幂等提炼（「最近确认」= 归档时 HEAD）。条目字段行为机械解析契约，勿手改。
> superseded 条目保留供取代链回溯；brainstorm 注入默认只给 active。
> 模块卡：modules/agent.md（域=模块 id 同构；行为条目↔模块契约互跳）

## FR-auto-backend-219 平台预置「SillySpec 极速变更」档案定义
变更：2026-10-14-agent-profile-express-preset
状态：active
摘要：主路径
全文：.sillyspec/changes/archive/2026-10-14-agent-profile-express-preset/requirements.md#FR-01
最近确认：534cef161623ee81046dd08d697300c005071294

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-14-agent-profile-express-preset:flow:测试绑定FR-01
  tests: backend/app/modules/agent/tests/test_profile_seed.py「test_express_preset_plants_platform_profile_with_identity_fields」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-14-agent-profile-express-preset
  status: active

## FR-auto-backend-220 幂等补种
变更：2026-10-14-agent-profile-express-preset
状态：active
摘要：主路径
全文：.sillyspec/changes/archive/2026-10-14-agent-profile-express-preset/requirements.md#FR-02
最近确认：534cef161623ee81046dd08d697300c005071294

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-14-agent-profile-express-preset:flow:测试绑定FR-02
  tests: backend/app/modules/agent/tests/test_profile_seed.py「test_express_preset_idempotent_on_repeat_calls」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-14-agent-profile-express-preset
  status: active

## FR-auto-backend-221 不覆盖用户改动
变更：2026-10-14-agent-profile-express-preset
状态：active
摘要：主路径
全文：.sillyspec/changes/archive/2026-10-14-agent-profile-express-preset/requirements.md#FR-03
最近确认：534cef161623ee81046dd08d697300c005071294

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-14-agent-profile-express-preset:flow:测试绑定FR-03
  tests: backend/app/modules/agent/tests/test_profile_seed.py「test_express_preset_does_not_overwrite_user_edits」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-14-agent-profile-express-preset
  status: active

## FR-auto-backend-222 启动序列挂载
变更：2026-10-14-agent-profile-express-preset
状态：active
摘要：主路径
全文：.sillyspec/changes/archive/2026-10-14-agent-profile-express-preset/requirements.md#FR-04
最近确认：534cef161623ee81046dd08d697300c005071294

## FR-auto-backend-223 测试契约
变更：2026-10-14-agent-profile-express-preset
状态：active
摘要：主路径
全文：.sillyspec/changes/archive/2026-10-14-agent-profile-express-preset/requirements.md#FR-05
最近确认：534cef161623ee81046dd08d697300c005071294

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-14-agent-profile-express-preset:flow:测试绑定FR-05
  tests: backend/app/modules/agent/tests/test_profile_seed.py「test_express_preset_coexists_with_system_defaults」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-14-agent-profile-express-preset
  status: active
