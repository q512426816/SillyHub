---
author: sillyspec-fr-index
created_at: 2026-10-05T17:37:00.596Z
---

# FR 索引 — config-llm-provider-presets

> fr-index 从归档变更 requirements.md 幂等提炼（「最近确认」= 归档时 HEAD）。条目字段行为机械解析契约，勿手改。
> superseded 条目保留供取代链回溯；brainstorm 注入默认只给 active。
> 模块卡：modules/config-llm-provider-presets.md（域=模块 id 同构；行为条目↔模块契约互跳）

## FR-config-llm-provider-presets-001 前端 opencode_go 预设 auth_field 修正为 ANTHROPIC_API_KEY（实测 opencode /zen/go/v1/messages 仅认 x-api-key，Bearer 恒 401）
变更：2026-10-06-opencode-go-direct-anthropic
状态：active
摘要：主路径
全文：.sillyspec/changes/archive/2026-10-06-opencode-go-direct-anthropic/requirements.md#FR-01
最近确认：135a0d3a6dcbac6ce10d8c38c6882af5401d6515

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-06-opencode-go-direct-anthropic:flow:测试绑定FR-01
  tests: test/frontend/src/components/llm-providers/__tests__/llmProviderPresets.test.ts「opencode_go auth_field 为 ANTHROPIC_API_KEY（/v1/messages 仅认 x-api-key）」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-06-opencode-go-direct-anthropic
  status: active

## FR-config-llm-provider-presets-002 预设默认模型更新为 deepseek-v4.1-flash 且 4 角色槽全填该模型
变更：2026-10-06-opencode-go-direct-anthropic
状态：active
摘要：主路径
全文：.sillyspec/changes/archive/2026-10-06-opencode-go-direct-anthropic/requirements.md#FR-02
最近确认：135a0d3a6dcbac6ce10d8c38c6882af5401d6515

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-06-opencode-go-direct-anthropic:flow:测试绑定FR-02
  tests: test/frontend/src/components/llm-providers/__tests__/llmProviderPresets.test.ts「opencode_go 4 角色槽与主模型全填 deepseek-v4.1-flash」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-06-opencode-go-direct-anthropic
  status: active

## FR-config-llm-provider-presets-003 阿里云服务器 OpenCode Go 供应商行已切 anthropic 直连，真实 Claude Code 端到端会话验证通过（纯文本 + 工具调用）
变更：2026-10-06-opencode-go-direct-anthropic
状态：active
摘要：主路径
全文：.sillyspec/changes/archive/2026-10-06-opencode-go-direct-anthropic/requirements.md#FR-03
最近确认：135a0d3a6dcbac6ce10d8c38c6882af5401d6515

## FR-config-llm-provider-presets-004 前端预设相关测试通过，未跑全量测试
变更：2026-10-06-opencode-go-direct-anthropic
状态：active
摘要：主路径
全文：.sillyspec/changes/archive/2026-10-06-opencode-go-direct-anthropic/requirements.md#FR-04
最近确认：135a0d3a6dcbac6ce10d8c38c6882af5401d6515

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-06-opencode-go-direct-anthropic:flow:测试绑定FR-04
  tests: test/frontend/src/components/llm-providers/__tests__/llmProviderPresets.test.ts「opencode_go 仍为 anthropic（与 opencode_zen_openai 区分）」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-06-opencode-go-direct-anthropic
  status: active
