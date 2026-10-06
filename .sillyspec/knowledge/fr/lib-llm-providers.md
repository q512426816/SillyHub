---
author: sillyspec-fr-index
created_at: 2026-10-06T23:57:46.393Z
---

# FR 索引 — lib-llm-providers

> fr-index 从归档变更 requirements.md 幂等提炼（「最近确认」= 归档时 HEAD）。条目字段行为机械解析契约，勿手改。
> superseded 条目保留供取代链回溯；brainstorm 注入默认只给 active。
> 模块卡：modules/lib-llm-providers.md（域=模块 id 同构；行为条目↔模块契约互跳）

## FR-lib-llm-providers-001 前端 formToUpdate 产出的 PATCH body 携带 agent_kinds（编辑引擎复选集合真正提交），frontend/src/lib/api/__tests__/llm-providers.test.ts formToUpdate 用例补断言覆盖
变更：2026-10-07-provider-agent-kinds-followup
状态：active
摘要：主路径
全文：.sillyspec/changes/archive/2026-10-07-provider-agent-kinds-followup/requirements.md#FR-01
最近确认：fcefa0890fbce6927826cf9e1fff813f0ed642e9

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-07-provider-agent-kinds-followup:flow:测试绑定FR-01
  tests: frontend/src/lib/api/__tests__/llm-providers.test.ts「formToUpdate — agent_kinds 透传到 PATCH body（编辑引擎集合真正提交）」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-07-provider-agent-kinds-followup
  status: active

## FR-lib-llm-providers-002 后端 LlmProviderUpdate 显式 agent_kinds=null 等同「不动」：openai_chat 行传 null 不抛 TypeError、不写 NULL、集合不变，backend/app/modules/llm_provider/tests/test_agent_kinds_multi.py 补用例覆盖
变更：2026-10-07-provider-agent-kinds-followup
状态：active
摘要：主路径
全文：.sillyspec/changes/archive/2026-10-07-provider-agent-kinds-followup/requirements.md#FR-02
最近确认：fcefa0890fbce6927826cf9e1fff813f0ed642e9

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-07-provider-agent-kinds-followup:flow:测试绑定FR-02
  tests: backend/app/modules/llm_provider/tests/test_agent_kinds_multi.py「update 显式 agent_kinds=null 等同不动（openai_chat 行不抛 TypeError/不写 NULL）」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-07-provider-agent-kinds-followup
  status: active

## FR-lib-llm-providers-003 定向测试绿：后端 llm_provider 域相关测试 + 前端 llm-providers 表单/api 域测试，tsc 与 eslint（改动文件）0 error
变更：2026-10-07-provider-agent-kinds-followup
状态：active
摘要：主路径
全文：.sillyspec/changes/archive/2026-10-07-provider-agent-kinds-followup/requirements.md#FR-03
最近确认：fcefa0890fbce6927826cf9e1fff813f0ed642e9
