---
author: qinyi
created_at: 2026-09-10 23:05:00
---
# 需求规格（Requirements）

## 角色

| 角色 | 说明 |
|---|---|
| 普通用户 | 建 codex/pi 供应商凭证（平台加密存储），切换默认对自家会话生效 |
| daemon（服务组件） | spawn codex/pi 前 per-session 写盘注入；热切换按会话重写（尽力） |
| lease 协议 | ProviderConfig 既有中性载荷（零改动） |

## 功能需求

### FR-01: codex 凭证注入（per-session CODEX_HOME）
覆盖决策：D-003, D-005, D-011, D-012
Given 用户配置了 codex 供应商（anthropic 形态 api_key/base_url，或 openai_chat 形态 litellm_base_url/litellm_model_name）
When codex 会话/任务 spawn 前
Then `<root>/codex/<session_id>/` 写 auth.json+config.toml（per-form 映射：anthropic=api_key+base_url+裸 model；openai_chat=daemonApiKey+litellm_base_url+litellm_model_name）；config.toml wire_api="responses" 唯一值 + 非托管段保留；env 注入 CODEX_HOME
When provider_config 整体 absent
Then 不写盘不注入 env，行为与现状逐字一致（测试锁定）
When per-form 必需字段缺失
Then 记 warn 跳过写盘（含 env 注入一并跳过）仍 spawn

### FR-02: pi 自定义端点文件层（per-session PI_CODING_AGENT_DIR）
覆盖决策：D-004, D-005, D-008, D-011
Given pi 供应商为 anthropic 形态且 base_url 非空
When pi 会话/任务 spawn 前
Then `<root>/pi/<session_id>/` 写三文件：auth.json 官方形状 `{"sillyhub":{"type":"api_key","key":...}}`、models.json providers.sillyhub（api="openai-completions" golden、baseUrl、models）、settings.json defaultProvider/defaultModel（裸 id）；preserve unknown 全程
Given base_url 为空（官方端点）
Then 文件层不写（env 层负责）；两层共存时 auth.json > env 压制（spike Pi-3）

### FR-03: 热切换尽力语义
覆盖决策：D-009, D-011
When 默认供应商切换（既有 PROVIDER_CONFIG_CHANGED 推送）
Then daemon 对活跃 codex/pi 会话按 session_id 重写其 per-session 目录（尽力——CLI 是否进程内重读不保证）；新会话必生效；复用既有推送不新增消息类型

### FR-04: backend 词表与禁配
覆盖决策：D-008（词表衔接）, D-012（禁配）
Given llm_provider schema（pi 由并行变更放开的词表基础上）
Then agent_kind Literal 增 "codex"（仅 Create 一处）；pi × openai_chat 组合 Create 422 + Update 侧 service 层取行后判（LlmProviderUpdate 无 agent_kind）

### FR-05: 前端表单
Given 供应商表单
Then codex 选项启用；pi 时自定义端点字段（baseUrl/models）显示且 openai_chat 禁选；DTO 走 gen:types

### FR-06: 真实 CLI 冒烟（W5）
Then mock 端点照 spike 手法：codex（config.toml 路由至 mock /v1/responses 含 Bearer）与 pi（三文件路由至 mock /v1/chat/completions）各一条端到端；litellm_proxy 通道一条（R-02）

## 非功能需求

- 兼容：claude 路径零改动（applyClaudeSettings 加 kind 守卫属防御修正）；未配置/缺字段/写失败三态行为可预期可测试
- 安全：key 不入 argv/env（D-005）；daemonApiKey 经纯函数参数承接；per-session 目录不位于 %TEMP%
- 时序：execute 前置 review-dispatch-platform-fixes 已合并（D-008 硬约束）
- 可测试：spike 证据文件为 golden（a2b-config.toml/b1-models.json）；daemon typecheck + gen:types:check 零漂移门禁
