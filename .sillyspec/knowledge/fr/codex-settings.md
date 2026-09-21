## FR-codex-settings-001 codex 凭证注入（per-session CODEX_HOME）
变更：2026-09-10-multi-provider-injection
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 用户配置了 codex 供应商（anthropic 形态 api_key/base_url，或 openai_chat 形态 litellm_base_url/；When codex 会话/任务 spawn 前 provider_config 整体 absent per-form 必需字段缺失；Then `<root>/codex/<session_id>/` 写 auth.json+config.toml（per-form 映射：anthropic=api_k
全文：.sillyspec/changes/archive/2026-09-10-multi-provider-injection/requirements.md#FR-01
最近确认：efad0edb5

## FR-codex-settings-002 pi 自定义端点文件层（per-session PI_CODING_AGENT_DIR）
变更：2026-09-10-multi-provider-injection
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given pi 供应商为 anthropic 形态且 base_url 非空 base_url 为空（官方端点）；When pi 会话/任务 spawn 前；Then `<root>/pi/<session_id>/` 写三文件：auth.json 官方形状 `{"sillyhub":{"type":"api_key","ke
全文：.sillyspec/changes/archive/2026-09-10-multi-provider-injection/requirements.md#FR-02
最近确认：efad0edb5

## FR-codex-settings-003 热切换尽力语义
变更：2026-09-10-multi-provider-injection
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — When 默认供应商切换（既有 PROVIDER_CONFIG_CHANGED 推送）；Then daemon 对活跃 codex/pi 会话按 session_id 重写其 per-session 目录（尽力——CLI 是否进程内重读不保证）；新会话必生效
全文：.sillyspec/changes/archive/2026-09-10-multi-provider-injection/requirements.md#FR-03
最近确认：efad0edb5

## FR-codex-settings-004 backend 词表与禁配
变更：2026-09-10-multi-provider-injection
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given llm_provider schema（pi 由并行变更放开的词表基础上）；Then agent_kind Literal 增 "codex"（仅 Create 一处）；pi × openai_chat 组合 Create 422 + Updat
全文：.sillyspec/changes/archive/2026-09-10-multi-provider-injection/requirements.md#FR-04
最近确认：efad0edb5

## FR-codex-settings-005 前端表单
变更：2026-09-10-multi-provider-injection
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 供应商表单；Then codex 选项启用；pi 时自定义端点字段（baseUrl/models）显示且 openai_chat 禁选；DTO 走 gen:types
全文：.sillyspec/changes/archive/2026-09-10-multi-provider-injection/requirements.md#FR-05
最近确认：efad0edb5

## FR-codex-settings-006 真实 CLI 冒烟（W5）
变更：2026-09-10-multi-provider-injection
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — 
全文：.sillyspec/changes/archive/2026-09-10-multi-provider-injection/requirements.md#FR-06
最近确认：efad0edb5
