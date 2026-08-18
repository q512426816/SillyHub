---
schema_version: 1
doc_type: module-card
module_id: llm_provider
author: qinyi
created_at: 2026-08-18 01:45:00
---

# LLM 供应商管理（llm_provider）

## 定位
用户级 LLM 供应商凭证管理（prefix `/api/llm-providers`，共 10 个端点）。两种接入格式：`anthropic` 原生（base_url + ANTHROPIC_AUTH_TOKEN 直连）与 `openai_chat` 格式（经外部 LiteLLM 网关做 Anthropic↔OpenAI 协议转换）。核心价值在默认供应商切换：先探测、后置位、再热切换，保证运行中会话不中断（G4）。

## 契约摘要
- CRUD：
  - `GET /api/llm-providers` → `LlmProviderList`（api_key 掩码展示）。
  - `POST /api/llm-providers` 创建（api_key 经 CredentialCipher 加密落 `encrypted_api_key`）。
  - `GET|PATCH /api/llm-providers/{provider_id}`、`DELETE .../{provider_id}`（204）。
- 探测与查询：
  - `POST /api/llm-providers/fetch-models` → 列上游模型（`FetchModelsRequest`）；失败分类错误：`LlmProviderAuthFailed` / `ModelsUnsupported` / `ModelsAllFailed` / `ModelsTimeout` / `LlmProviderSsrfBlocked`。
  - `POST /api/llm-providers/{provider_id}/usage` → `UsageResult`（多窗口 tier；错误分两态：瞬时 `LlmProviderUsageTransient` / 上游错误）。
  - `GET /api/llm-providers/{provider_id}/quota` → `LlmProviderQuotaResponse`。
- 默认切换：
  - `POST /api/llm-providers/{provider_id}/set-default` / `unset-default` → `SetDefaultResult`（switched / affected_sessions / litellm_registered / error）。
- `LlmProvider` 关键列：`(user_id, agent_kind)` 维度 `is_default` 互斥（索引 `ix_llm_providers_user_agent_default`）；`base_url`（≤512）；`auth_field`（默认 `ANTHROPIC_AUTH_TOKEN`）；`api_format`（默认 `anthropic`，server_default 同步）；`model_role_mappings`（JSON，4 档位映射）；`default_fallback_model`。

## 关键逻辑
```
set_default 三步（2026-08-06-provider-switch-live-session D-001/D-003/D-006）:
 1. probe_provider 轻量探测（默认 GET <base_url>/v1/models，多候选 URL 逐个试）
    失败 → 不改 is_default、不推送，返回 DefaultSwitchResult(error=...)（原供应商继续服务）
 2. 事务内 _clear_sibling_defaults 清同 (user_id, agent_kind) 兄弟 + 置本行 True
    （R-05 并发互斥，原子 commit）
    api_format=openai_chat → litellm_client.register(model_name=usr-<uid>-<pid>) best-effort
    （失败仅 litellm_registered=False 前端 toast，不阻塞切换，R-09）
 3. resolve_default_provider_config（单一真相源 helper）→ notify_provider_switch
    向活跃 interactive session 推 PROVIDER_CONFIG_CHANGED（WS 热切换）
    notify best-effort：失败仅日志告警不回滚（新会话仍走 claim 注入新默认）
unset_default / delete(openai) 对应 unregister（GET /model/info 找 model_id → 逐个 delete）
```

## 注意事项
- **LiteLLM master key 永不出进程**（security-audit-remediation 收口）：`settings.litellm_master_key` 只在 backend 内调 LiteLLM admin API；下发给 daemon 的 provider_config 不含明文 key——openai 格式改发 `litellm_proxy` 标记 + `litellm_base_url`（= settings 值 + `/api/daemon/llm-proxy`，走 daemon 转发）。明文 api_key 只出现在 LiteLLM register 请求体，不进日志/响应/审计（R-02）。
- LiteLLM 实测坑（litellm 1.95.0，spike 全项验证）：`litellm_params.model` 必须 `openai/<model>` 前缀且**不带 provider 字段**（靠前缀路由）；必须显式 `model_info.mode=chat` 强制 Chat Completions，否则上游默认走 Responses API、openai adapter 解析失败；delete 按 model_id 非 model_name；重复注册返 200 创建多 deployment（simple-shuffle 轮询无害）。
- `model_name = usr-<uid>-<pid>`（UUID 含连字符）被 litellm_client 与 daemon lease context（claim 注入）两处逐字复用，改一处不改另一处 → LiteLLM 路由不命中、Claude Code 直接报错。
- SSRF 防线：probe / fetch_models 复用 `ToolPolicyService.assert_public_hostname`（对 tool_gateway 的复用点，llm_provider depends_on tool_gateway 的原因），拒绝私网目标。
- probe.py 与 service.py 互循环（probe 顶层 import service 的 helper），probe 在 service 内只能函数级 lazy import；测试 patch 打在 `app.modules.llm_provider.probe.probe_provider` 源模块。
- 分层纪律：usage_handlers.py 各家 handler 只做「请求 + 解析」（签名统一 `query_xxx(client, base_url, api_key) -> list[UsageData]`，base_url 只取 scheme://host 兼容 .cn/.com 变体），错误两态分类 / SSRF / 解密 / detect_provider 路由全在 service 层。
- daemon 侧 `lease.provider_switch` 是本模块反向依赖（延迟 import），改 notify 契约先看 daemon/ws_hub 消费点。

## 人工备注

<!-- MANUAL_NOTES_START -->

<!-- MANUAL_NOTES_END -->
