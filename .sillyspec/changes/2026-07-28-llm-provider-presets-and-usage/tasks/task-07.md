---
id: task-07
title: frontend/src/components/llm-providers/llm-provider-form.tsx 顶部（mode 判断后、表单 grid 前）加预设选择器（网格按钮 + 分类排序 官方/国内官方/聚合站 + ＋自定义 + 💰可查用量标记）；点预设 setState 填 name/base_url/auth_field/default_fallback_model/角色映射/website_url/settings_config（api_key 留空）；点自定义重置空表单。覆盖 FR-01/02, D-001。依赖 task-05。
title_zh: 表单顶部加预设选择器
author: qinyi
created_at: 2026-07-28 10:37:44
priority: P0
depends_on: [task-05]
blocks: []
requirement_ids: [FR-01, FR-02]
decision_ids: [D-001@v1]
allowed_paths:
  - frontend/src/components/llm-providers/llm-provider-form.tsx
provides: []
expects_from:
  task-05:
    - contract: LlmProviderPreset
      needs: [key, name, category, base_url, auth_field, default_model, website_url, usage, settings_config_partial]
    - contract: LLM_PROVIDER_PRESETS
      needs: [items]
goal: >
  在 llm-provider-form.tsx 表单顶部（mode 判断后、表单 grid 前）插入预设选择器网格，
  按 category 分组（官方 → 国内官方 → 聚合站）渲染按钮 + ＋自定义入口；点预设一键 setState
  预填 name/base_url/auth_field/default_fallback_model/角色映射/website_url/settings_config
  （api_key 留空给用户填），支持用量的预设按钮带 💰 标记；点「＋自定义」重置为空表单。
implementation:
  - 在 `<form onSubmit={handleSubmit}>`（llm-provider-form.tsx:475）之后、第一个 `<div className="grid grid-cols-1 gap-3 md:grid-cols-2">`（:476）之前插入预设选择器区块；编辑模式（isEdit）下隐藏（预设仅服务新建预填，避免覆盖既有供应商配置）。
  - 从 `@/config/llmProviderPresets` import `LLM_PROVIDER_PRESETS` 与 `LlmProviderPreset` 类型（task-05 产出）；按 category（official/cn_official/aggregator）分组后顺序渲染：官方 → 国内官方 → 聚合站，每组一个小标题 + 网格按钮。
  - 点预设按钮：setName(preset.name)、setBaseUrl(preset.base_url)、setAuthField(preset.auth_field)、setDefaultFallbackModel(preset.default_model ?? "")、setWebsiteUrl(preset.website_url)；把 settings_config_partial 序列化为美化 JSON 写 setSettingsConfigJson（复用既有 settingsConfigJson 单一真相）；roleRows 按 default_model 用 handleAutoFill 范式填到 sonnet 或全部 4 角色 model 单元格；apiKey 始终留空（setApiKey("")）。
  - 点「＋自定义」按钮：setName/setBaseUrl/setDefaultFallbackModel/setWebsiteUrl/setApiKey 全部置空、setAuthField 回 "ANTHROPIC_AUTH_TOKEN"、setRoleRows 重置为 initRoleRows(null)、setSettingsConfigJson("{}")。
  - 支持 `usage` 字段的预设（7 家：DeepSeek/硅基/OpenRouter/Kimi/Kimi For Coding/智谱/MiniMax）按钮右上角标 💰，title="支持余额查询"；不支持的不带标记。
  - 遵循前端设计系统样式（参考 archive 2026-06-21-frontend-style-system），复用既有 inputCls/lblCls/hintCls 与 Button 组件风格；不引入新 UI 库。
  - 不动现有表单提交逻辑（handleSubmit/handleFetch/handleAutoFill/handleConfigToggle）、不动 settingsConfigJson 作为配置 JSON 单一真相的契约。
acceptance:
  - 新建模式表单顶部出现预设选择器网格，按 官方/国内官方/聚合站 三类分组排序，末尾有「＋自定义」按钮；编辑模式不渲染该区块。
  - 点「Kimi For Coding」预设后表单自动填好 base_url / auth_field / default_fallback_model / website_url / 角色映射 / settings_config，仅 api_key 为空待用户填。
  - 点「＋自定义」重置为空表单（name/base_url/model/website_url/api_key 全空，auth_field 回默认，settings_config 回 "{}"）。
  - 💰 标记仅出现在支持用量的 7 家预设按钮上（DeepSeek/硅基/OpenRouter/Kimi/Kimi For Coding/智谱/MiniMax），其余 3 家（Anthropic 官方/百炼/Bailian For Coding）与「＋自定义」无标记。
  - 预填后既有表单提交链路（创建供应商 / 保存修改 / 获取模型列表 / 一键设置）行为不变；brownfield 零回归。
verify:
  - cd frontend && pnpm exec tsc --noEmit
  - cd frontend && pnpm test src/components/llm-providers
constraints:
  - 不预填 api_key（设计要求 api_key 始终留空给用户手填，预设只补其它字段）。
  - 遵循前端设计系统样式（参考 .sillyspec/changes/archive/2026-06-21-2026-06-21-frontend-style-system 的 prototype 与 design.md），复用既有样式常量与 Button，不引入新依赖。
  - brownfield 兼容：不改现有表单字段、handleSubmit、settingsConfigJson 单一真相契约、fetch-models / 一键设置 / 5 开关逻辑；预设选择器是新增可选入口，未选预设时表单行为完全不变（D-001）。
  - 编辑模式不渲染预设选择器（避免覆盖既有供应商配置；预设仅服务新建）。

---
