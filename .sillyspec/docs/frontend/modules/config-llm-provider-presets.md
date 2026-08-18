---
schema_version: 1
doc_type: module-card
module_id: config-llm-provider-presets
author: qinyi
created_at: 2026-08-18 01:45:00
---

# LLM 供应商预设模板（config-llm-provider-presets）

## 定位
LLM 供应商预设模板（`src/config/llmProviderPresets.ts`，330 行，src/config 目录首个文件）。纯前端常量——后端/DB/migration 零改动；点预设一键预填供应商表单（name/base_url/auth_field/default_model/角色映射/settings_config），api_key 永远留空给用户手填。数据源逐字抄自 cc-switch 的 `claudeProviderPresets.ts`（剔 affiliate 参数），不臆造模型名/URL。被 components-llm-providers（供应商表单预设选择器）消费。

## 契约摘要
- `LlmProviderPresetCategory = "official" | "cn_official" | "aggregator"`：预设分类（与 cc-switch 对齐，决定选择器分组顺序）。
- `LlmProviderPreset`：`{ key（稳定 snake key，如 anthropic_official/kimi/kimi_for_coding）, name, category, base_url, auth_field: "ANTHROPIC_AUTH_TOKEN"|"ANTHROPIC_API_KEY", api_format: "anthropic"|"openai_chat", default_model?, website_url, api_key_url?, usage?: { type: LlmProviderUsageType }, icon_color?, settings_config_partial? }`。
  - `api_format`：预设显式声明协议格式；`openai_chat` 经 LiteLLM 网关让 Claude Code 消费。
  - `usage` 存在 = 该家支持用量查询（前端标 💰），type 只有后端 `detect_provider(base_url)` 真实可查的两种：balance（DeepSeek/硅基/OpenRouter）+ token_plan（Kimi For Coding/智谱/MiniMax）。
  - `settings_config_partial`：预填 env 块（ANTHROPIC_BASE_URL + 留空 AUTH_TOKEN + 默认模型键 + 厂商特有键）。
- `LLM_PROVIDER_PRESETS: LlmProviderPreset[]`：全量预设列表（含 Anthropic 官方、Kimi、Kimi For Coding 等）。
- `PRESETS_BY_CATEGORY`：按 category 分组的有序结构（选择器分组渲染用）。
- `PRESET_BY_KEY: Record<string, LlmProviderPreset>`：key→预设反查表。

## 关键逻辑
```
// 用量标注判据（D-004）——单一源在后端 detect_provider，前端只镜像结果:
api.moonshot.cn 通用 Kimi API   → 不标 usage（detect 不到，标了是假 💰）
balance 家    → usage: {type:"balance"}
token_plan 家 → usage: {type:"token_plan"}
官方订阅/百炼(需 AK/SK 签名)     → 非目标，不标
// 消费方: 组件点预设 → 展开表单初值(api_key="") → 用户手填 key
PRESET_BY_KEY[key] ?? PRESETS_BY_CATEGORY 顺序遍历
```

## 注意事项
- api_key 永不预填（settings_config_partial 里 AUTH_TOKEN 恒为 `""`），新增预设不得写入任何明文 token。
- `LlmProviderUsageType` 的单一源在 `lib/api/llm-providers`（数据层），本文件仅复用，config→api 单向依赖无环——勿在本文件重定义类型。
- usage 标注必须与后端 `detect_provider` 能力对齐：新增一家先确认后端真的可查，否则出现假 💰。
- env 键名逐字对齐 cc-switch（含厂商特有键），改键名等于换协议，会破坏既有供应商配置兼容。

## 人工备注

<!-- MANUAL_NOTES_START -->

<!-- MANUAL_NOTES_END -->
