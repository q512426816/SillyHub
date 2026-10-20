---
author: sillyspec-fr-index
created_at: 2026-10-20T05:33:13.480Z
---

# FR 索引 — llm_provider

> fr-index 从归档变更 requirements.md 幂等提炼（「最近确认」= 归档时 HEAD）。条目字段行为机械解析契约，勿手改。
> superseded 条目保留供取代链回溯；brainstorm 注入默认只给 active。
> 模块卡：modules/llm_provider.md（域=模块 id 同构；行为条目↔模块契约互跳）

## FR-llm_provider-001 api_format=anthropic 且 base_url 以版本段结尾（如 /api/v1）的供应商，「获取模型列表」能拉到模型列表（候选含 base+/models）
变更：2026-10-20-codex-models-fetch-candidates
状态：active
摘要：智谱 coding-plan 范式
全文：.sillyspec/changes/archive/2026-10-20-codex-models-fetch-candidates/requirements.md#FR-01
最近确认：aa64d06245f0473307dc8ea88dfc9dd46c871e9a

## FR-llm_provider-002 base_url 尾部含 /openai/v1 的 OpenCode 范式供应商能拉到（候选含剥 /openai/v1 后拼 /v1/models）
变更：2026-10-20-codex-models-fetch-candidates
状态：active
摘要：OpenCode Go Codex 范式
全文：.sillyspec/changes/archive/2026-10-20-codex-models-fetch-candidates/requirements.md#FR-02
最近确认：aa64d06245f0473307dc8ea88dfc9dd46c871e9a

## FR-llm_provider-003 既有候选行为零回归（claude 条目 /api/anthropic 等既有命中路径不变）
变更：2026-10-20-codex-models-fetch-candidates
状态：active
摘要：既有用例零回归
全文：.sillyspec/changes/archive/2026-10-20-codex-models-fetch-candidates/requirements.md#FR-03
最近确认：aa64d06245f0473307dc8ea88dfc9dd46c871e9a

## FR-llm_provider-004 候选返回 200 但响应非 models 结构时必须继续尝试下一候选（智谱网关 200 兜底形态）
变更：2026-10-20-codex-models-fetch-candidates
状态：active
摘要：智谱 coding 真实链路
全文：.sillyspec/changes/archive/2026-10-20-codex-models-fetch-candidates/requirements.md#FR-04
最近确认：aa64d06245f0473307dc8ea88dfc9dd46c871e9a

## FR-llm_provider-005 解析必须兼容智谱 coding 端点 `{models: [{slug, ...}]}` 形态
变更：2026-10-20-codex-models-fetch-candidates
状态：active
摘要：智谱 models 形态解析
全文：.sillyspec/changes/archive/2026-10-20-codex-models-fetch-candidates/requirements.md#FR-05
最近确认：aa64d06245f0473307dc8ea88dfc9dd46c871e9a
