---
author: qinyi
created_at: 2026-08-09 01:22:00
---

# 提案书（Proposal）— 供应商管理支持完整 URL + OpenAI API 格式（经 LiteLLM 网关）

## 动机

供应商管理（`llm_provider`）目前只支持 Anthropic 格式供应商：`agent_kind` 固定 `claude`、`auth_field` 只有 `ANTHROPIC_*`、`base_url` 只接受 base、fetch-models/probe 固定 `GET <base>/v1/models`。用户（参考 cc-switch）需要：

1. 能粘贴**完整 URL**（如 `https://opencode.ai/zen/v1/chat/completions`）而非只能填 base；
2. 支持 **OpenAI API 格式**（`Authorization: Bearer sk-***` + `/v1/chat/completions` + `/v1/models`）；
3. OpenAI 格式供应商要让 **Claude Code 真正可用**——需要 Anthropic Messages ↔ OpenAI Chat Completions 转换。

已实测 opencode.ai 端点（用户提供测试 token）：`/v1/models` + Bearer 返回标准 OpenAI 模型列表；完整 chat URL 剥 `/chat/completions` 即得 base。

## 关键问题

1. **格式单一**：只能配 Anthropic 兼容端点；越来越多供应商（opencode.ai zen、各种 OpenAI 兼容中转）只给 OpenAI 格式端点，平台配不了。
2. **URL 不灵活**：base_url 只接受 base，用户拿到的是完整 chat completions URL，粘贴后 fetch-models 拼 `/v1/models` 会拼错路径拉不到模型。
3. **Claude Code 消费断链**：就算能存 OpenAI 格式供应商，Claude Code 只认 Anthropic Messages API，没有转换层就用不了——而平台 D-012 明确不自研格式转换。需要一个不破坏 D-012 的转换方案。

## 变更范围

- **数据模型**：`llm_providers` 加 `api_format`（anthropic/openai_chat）列；完整 URL 后端按格式算法归一（不加 is_full_url 列）。
- **后端逻辑**：fetch-models/probe 按 api_format 产鉴权头（OpenAI=纯 Bearer）+ 候选 URL；schema 透传 api_format。
- **LiteLLM 网关（服务器侧新服务）**：复用开源 LiteLLM 做 Anthropic Messages ↔ OpenAI Chat Completions 转换；OpenAI 上游 key 注册在 LiteLLM、**不下发 daemon**；daemon 仅把 ANTHROPIC_BASE_URL 指向平台 LiteLLM + 模型名路由。
- **daemon**：ProviderConfig 加 api_format + openai 专属字段；credential-injector 加 openai 分支。
- **前端**：表单加 API 格式下拉（openai 时隐藏认证字段/角色映射）、预设加 OpenAI 格式条目、列表加格式徽标、api-types 重新生成。

分两 Wave 交付：Wave1（供应商管理数据模型+拉模型+前端，可独立验收）、Wave2（LiteLLM 集成+daemon，前置 spike）。

## 不在范围内（Non-Goals）

- 不自研 Anthropic↔OpenAI 格式转换逻辑（交 LiteLLM；D-012 维持，仅外包绕过）。
- 不放开 agent_kind 下拉（codex/gemini/pi 仍 disabled 占位）；OpenAI 格式挂在 claude 下经 LiteLLM 消费。
- OpenAI 格式不做模型角色映射（sonnet/opus/fable/haiku），单模型即可。
- 不引入 openai_responses / gemini_native 等其它格式（本期只要 openai_chat）。
- 不做 LiteLLM 用量统计/成本追踪/failover 高级特性。
- daemon 不起本地代理子进程（代理是服务器常驻服务）。

## 成功标准（可验证）

- 旧 Anthropic 供应商全链路行为逐字不变（brownfield 零回归）：迁移后老行 api_format=anthropic，fetch-models/probe/set-default/injector 走原分支。
- 新增 OpenAI 格式供应商可保存、可编辑、可删除；对 opencode.ai 真实「获取模型列表」返回模型（Wave1 验收）。
- OpenAI 格式鉴权用 Bearer，Anthropic 沿用 ANTHROPIC_*，不混用。
- OpenAI 格式供应商 set-default 后，Claude Code 会话经 LiteLLM 能正常对话（Wave2 端到端验收，spike 通过后）。
- OpenAI 上游 api_key 不出现在 provider_config / daemon env / 日志（只在 LiteLLM 注册）。
- Wave1→Wave2 过渡期：openai 供应商 set-default 有明确前端守护提示。
