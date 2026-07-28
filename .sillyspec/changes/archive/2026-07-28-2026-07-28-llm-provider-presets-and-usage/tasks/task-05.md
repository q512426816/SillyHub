---
id: task-05
title: 新建 frontend/src/config/llmProviderPresets.ts 导出 10 家 claude 风格预设常量 + LlmProviderPreset 类型
title_zh: 新建 10 家供应商预设常量文件
author: qinyi
created_at: 2026-07-28 10:37:44
priority: P0
depends_on: []
blocks: [task-07]
requirement_ids: [FR-01, FR-02]
decision_ids: [D-001@v1]
allowed_paths:
  - frontend/src/config/llmProviderPresets.ts
provides:
  - contract: LlmProviderPreset
    fields: [key, name, category, base_url, auth_field, default_model, website_url, api_key_url, usage, icon, icon_color, settings_config_partial]
  - contract: LLM_PROVIDER_PRESETS
    fields: [items]
expects_from: []
goal: |
  定义 10 家 claude 风格供应商预设纯前端常量（Anthropic官方/Kimi/Kimi For Coding/智谱GLM/
  DeepSeek/硅基流动/OpenRouter/MiniMax/百炼/Bailian For Coding），点预设一键预填表单
  （name/base_url/auth_field/default_model/角色映射/website_url，api_key 留空给用户填），
  支持用量的 7 家标 usage.type=balance|token_plan 供前端展示「💰可查用量」。
implementation:
  - 定义 LlmProviderPreset 类型（design §7.3）：key/name/category/base_url/auth_field/default_model?/website_url/api_key_url?/usage?:{type:"balance"|"token_plan"}/icon?/icon_color?/settings_config_partial?；key 用稳定 snake（anthropic_official/kimi/kimi_for_coding/zhipu_glm/deepseek/siliconflow/openrouter/minimax/bailian/bailian_for_coding）
  - 10 家常量的 settings_config_partial.env 块逐字抄 cc-switch claudeProviderPresets.ts（ANTHROPIC_BASE_URL + ANTHROPIC_AUTH_TOKEN/ANTHROPIC_API_KEY 留空 + ANTHROPIC_DEFAULT_{HAIKU,SONNET,OPUS}_MODEL + 厂商特有键如 CLAUDE_CODE_MAX_CONTEXT_TOKENS/API_TIMEOUT_MS），不臆造
  - category 分三类：official（Anthropic官方）/ cn_official（Kimi×2/智谱/DeepSeek/MiniMax/百炼×2）/ aggregator（硅基/OpenRouter），与 cc-switch category 对齐
  - 7 家带 usage 标记：balance（DeepSeek/硅基流动/OpenRouter）+ token_plan（Kimi/Kimi For Coding/智谱GLM/MiniMax）；3 家不带（Anthropic官方/百炼/Bailian For Coding）
  - auth_field 取 cc-switch apiKeyField（默认 ANTHROPIC_AUTH_TOKEN，本批 10 家全用 AUTH_TOKEN）；base_url 从 settingsConfig.env.ANTHROPIC_BASE_URL 提取；default_model 取 ANTHROPIC_DEFAULT_SONNET_MODEL
  - api_key 一律不预填（env 块里 token 留空字符串，不进 settings_config_partial 或留空，由 task-07 表单 setState 时清空 apiKey 字段）
  - 导出 LLM_PROVIDER_PRESETS 常量数组 + 按 category 分组导出（PRESETS_BY_CATEGORY）+ 按 key 索引导出（PRESET_BY_KEY），供 task-07 选择器渲染
acceptance:
  - 10 家预设常量齐全（key 唯一，name/base_url 非空）
  - 7 家带 usage.type 且取值仅 balance|token_plan（DeepSeek/硅基/OpenRouter=balance；Kimi/Kimi For Coding/智谱/MiniMax=token_plan）
  - 3 家无 usage 字段（Anthropic官方/百炼/Bailian For Coding）
  - category 三类齐全（official/cn_official/aggregator），无 fourth 类
  - settings_config_partial.env 块与 cc-switch 逐字一致（ANTHROPIC_BASE_URL/角色模型/特有键），base_url 字段 = env.ANTHROPIC_BASE_URL
  - 不预填任何 api_key 明文（env 里 AUTH_TOKEN 留空 ""，无 sk- 真值）
  - tsc --noEmit 通过（无 any 漏类型，LlmProviderPreset 类型导出）
verify:
  - cd frontend && pnpm exec tsc --noEmit
  - cd frontend && pnpm test src/config 2>/dev/null || echo "no config test yet"
constraints:
  - 纯前端常量，后端/DB/migration 零改动（D-001 不存预设数据）
  - 不预填 api_key，明文 token 永不进常量（用户手填）
  - env 块抄准 cc-switch claudeProviderPresets.ts，不臆造模型名/URL（R-05）
  - 百炼 / Bailian For Coding / Anthropic 官方 仅预设无 usage（D-008 非目标），不标 usage
  - brownfield 兼容：本文件新建，不改既有表单逻辑（task-07 才接线），既有供应商不受影响
  - 字段对齐既有表单（name/base_url/auth_field:ANTHROPIC_AUTH_TOKEN|ANTHROPIC_API_KEY/default_fallback_model/website_url/settings_config + 4 角色映射 sonnet/opus/fable/haiku）
---

