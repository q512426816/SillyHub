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

## FR-llm_provider-001 对 /api/llm-providers/{非UUID}/shares 传畸形 UUID 时返回 422 JSON 错误体(不再 500),合法 UUID 路径零回归
变更：2026-11-01-provider-share-audit-fixes
状态：active
摘要：畸形 UUID 主路径
全文：.sillyspec/changes/archive/2026-11-01-provider-share-audit-fixes/requirements.md#FR-01
最近确认：2d6a3eb56576a5fdb2fc3d4886ea86ac977d6d60

## FR-llm_provider-002 共享弹窗 DialogDescription 与产品文档明示:共享后解密密钥会下发到会话实际运行的守护进程(包括对方自己的机器),仅共享给可信用户
变更：2026-11-01-provider-share-audit-fixes
状态：active
摘要：属主打开共享弹窗
全文：.sillyspec/changes/archive/2026-11-01-provider-share-audit-fixes/requirements.md#FR-02
最近确认：2d6a3eb56576a5fdb2fc3d4886ea86ac977d6d60

## FR-llm_provider-003 迁移 20261030160000 的 docstring/注释如实描述降级实际删除范围,不再声称「只撤销本迁移授予的」
变更：2026-11-01-provider-share-audit-fixes
状态：active
摘要：读者核对迁移
全文：.sillyspec/changes/archive/2026-11-01-provider-share-audit-fixes/requirements.md#FR-03
最近确认：2d6a3eb56576a5fdb2fc3d4886ea86ac977d6d60

## FR-llm_provider-004 新增 HTTP 层用例覆盖 GET /usable(路由不被 /{provider_id} 遮蔽/共享行脱敏)与 shares CRUD(201/204/404 语义),全绿
变更：2026-11-01-provider-share-audit-fixes
状态：active
摘要：HTTP 层守护
全文：.sillyspec/changes/archive/2026-11-01-provider-share-audit-fixes/requirements.md#FR-04
最近确认：2d6a3eb56576a5fdb2fc3d4886ea86ac977d6d60

## FR-llm_provider-005 新增 claim 注入链用例:runtime 属主≠会话属主时共享供应商经 _inject_provider_config 注入 payload.provider_config,且 session 缺行回落 fallback_user_id,全绿
变更：2026-11-01-provider-share-audit-fixes
状态：active
摘要：共享守护进程 claim（两条）
全文：.sillyspec/changes/archive/2026-11-01-provider-share-audit-fixes/requirements.md#FR-05
最近确认：2d6a3eb56576a5fdb2fc3d4886ea86ac977d6d60

## FR-llm_provider-006 相关 backend/frontend 测试全绿,lint 零新增
变更：2026-11-01-provider-share-audit-fixes
状态：active
摘要：收口实测
全文：.sillyspec/changes/archive/2026-11-01-provider-share-audit-fixes/requirements.md#FR-06
最近确认：2d6a3eb56576a5fdb2fc3d4886ea86ac977d6d60
