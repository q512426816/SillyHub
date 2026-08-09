---
author: qinyi
created_at: 2026-08-09 01:22:00
---

# 需求（Requirements）— 供应商管理支持完整 URL + OpenAI API 格式

## 功能需求

### FR-01（数据模型）api_format 字段
`llm_providers` 表新增 `api_format` 列（`"anthropic"` 默认 / `"openai_chat"`），NOT NULL，迁移老行回填 `anthropic`。schema Create/Update/Read 透传该字段。

### FR-02（完整 URL）base_url 接受完整端点 URL
`base_url` 字段接受完整端点 URL（如 `.../v1/chat/completions`）或 base 两种形态；后端按 `api_format` 算法归一（OpenAI 剥尾部 `/chat/completions`）——不新增 `is_full_url` 列。

### FR-03（按格式鉴权）fetch-models/probe 鉴权头
- OpenAI 格式（openai_chat）：恒 `Authorization: Bearer <key>`。
- Anthropic 格式：沿用现有 `auth_field`（ANTHROPIC_AUTH_TOKEN→Bearer / ANTHROPIC_API_KEY→x-api-key+anthropic-version）。
- `auth_field` 列与枚举不变；OpenAI 格式下后端忽略 auth_field。

### FR-04（拉模型/探测候选 URL）按格式产候选
- OpenAI：剥 `/chat/completions` → 候选 `[base/models, base/v1/models]`（兼容 base 是否含 /v1）。
- Anthropic：现有 `_candidate_urls` 逻辑不变（`base+/v1/models` + 剥 `/anthropic`/`/compatibility`/`/api`）。
- `FetchModelsRequest` 内联形态加 `api_format`（编辑态从行读）。

### FR-05（LiteLLM 网关部署）服务器侧转换服务
docker-compose 新增 LiteLLM 服务（与 backend 同网络），master key 走环境变量。暴露 Anthropic `/v1/messages` 端点，转换为上游 OpenAI Chat Completions。

### FR-06（路由注册）set/unset/delete 联动 LiteLLM
- set-default（openai 格式）：探测上游 key 有效后，向 LiteLLM 注册 model 条目（`model_name=usr-<uid>-<pid>`、`api_base=<剥后 base>`、`api_key=<解密>`、`model=<provider.model>`）。
- unset-default / delete（openai 格式）：注销 LiteLLM 注册。
- 注册/注销 best-effort：失败不阻塞 is_default 变更，但 set-default 返回结构化标志供前端提示（R-09）。

### FR-07（provider_config openai 形态）不下发上游 key
openai 格式 provider_config = `{agent_kind, api_format, litellm_base_url, litellm_model_name, litellm_auth_token, model}`，**不含上游 api_key**。anthropic 形态不变（9 核心 + api_format 透传）。

### FR-08（daemon injector openai 分支）
ProviderConfig 类型加 `api_format` + openai 专属字段（litellm_base_url/model_name/auth_token）。credential-injector openai 分支：`ANTHROPIC_BASE_URL=litellm_base_url`、`ANTHROPIC_AUTH_TOKEN=litellm_auth_token`、`ANTHROPIC_MODEL=litellm_model_name`；不注入上游 key。anthropic 分支不变。

### FR-09（前端表单）API 格式下拉 + 条件字段
表单加「API 格式」下拉（Anthropic / OpenAI Chat）；选 OpenAI 时隐藏「认证字段」与「模型角色映射」（openai 单模型）；URL 框提示可贴完整 `.../v1/chat/completions`。

### FR-10（前端预设/列表/类型）
- 预设：新增 OpenAI 格式条目（OpenCode Zen OpenAI，base_url=`https://opencode.ai/zen/v1/chat/completions`）；现有 Anthropic 预设补 `api_format:"anthropic"`。
- 列表：openai 格式行加格式徽标。
- api-types：`pnpm gen:types` 重生成；lib/api/llm-providers.ts 手写类型补 api_format（债显式登记）。

### FR-11（过渡期守护）Wave1 openai set-default 提示
Wave1（Wave2 未合入）期间，openai 格式供应商 set-default 前端给守护提示「OpenAI 格式 Claude Code 支持即将上线」；Wave2 合入后移除。

## 非功能需求

### NFR-01（安全）OpenAI 上游 key 不下发
OpenAI 上游 api_key 仅注册在服务器 LiteLLM（网络隔离 + master key），不出现在 provider_config / daemon env / 日志 / 审计（R-02 脱敏铁律延续）。

### NFR-02（零回归）brownfield 兼容
未配 OpenAI 格式时全链路行为逐字不变：老行 anthropic 回填、daemon 忽略未知字段、前端字段可选 default。

### NFR-03（可用性）LiteLLM SPOF 应对
LiteLLM 容器 healthcheck + restart=always + 监控告警；LiteLLM 宕仅影响 openai 格式供应商，anthropic 链路独立不受影响（R-08）。

## 约束

- C-01：转换逻辑不得在平台代码内实现（D-012 维持，外包 LiteLLM）。
- C-02：Wave2 实现定稿前必须完成 spike-litellm-routing（R-01 P0），确认动态注册/流式/工具调用/角色模型名路由 4 项用例。
- C-03：兼容 Windows/Linux/macOS（CLAUDE.md 规则 13）；LiteLLM 走 Docker，跨平台一致。
- C-04：前端类型从后端 OpenAPI 生成（规则 20），gen:types 前确认 node_modules 健康。
