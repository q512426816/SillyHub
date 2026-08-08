/**
 * LLM 供应商预设模版（task-05 / D-001）。
 *
 * 纯前端常量，后端 / DB / migration 零改动（D-001 不存预设数据）。点预设一键预填
 * 表单（name / base_url / auth_field / default_model / 角色映射 / website_url /
 * settings_config），api_key 始终留空给用户手填。
 *
 * env 块逐字抄 cc-switch `claudeProviderPresets.ts`（ANTHROPIC_BASE_URL + 留空的
 * ANTHROPIC_AUTH_TOKEN + ANTHROPIC_DEFAULT_{HAIKU,SONNET,OPUS}_MODEL + 厂商特有键），
 * 不臆造模型名 / URL（R-05）。affiliate 参数（?aff= / ?ic=）已剔除（属 cc-switch 不属本平台）。
 *
 * 「能否查用量」（usage 字段）以后端 `detect_provider(base_url)` 为准（D-004）——只标
 * 后端真实可查的 6 家：balance（DeepSeek / 硅基 / OpenRouter）+ token_plan
 * （Kimi For Coding / 智谱 / MiniMax）。注意：cc-switch 的 "Kimi" 预设 base 是
 * api.moonshot.cn（通用 Moonspot API），后端 coding_plan detect 不到（无套餐用量端点），
 * 故**不标 usage**（标了会是假 💰）。Anthropic 官方 / 百炼 / Bailian For Coding 属
 * 非目标（D-008 官方订阅 / 百炼需 AK/SK 签名），亦不标。
 */

import type { LlmProviderUsageType } from "@/lib/api/llm-providers";

// 用量类型（balance / token_plan）的单一源在数据层 `lib/api/llm-providers`（task-06），
// 本文件仅复用，避免重复定义（config → api 单向依赖，无环）。

/** 预设分类（与 cc-switch category 对齐，决定选择器分组顺序）。 */
export type LlmProviderPresetCategory = "official" | "cn_official" | "aggregator";

export interface LlmProviderPreset {
  /** 稳定 snake key（anthropic_official / kimi / kimi_for_coding / ...）。 */
  key: string;
  name: string;
  category: LlmProviderPresetCategory;
  base_url: string;
  auth_field: "ANTHROPIC_AUTH_TOKEN" | "ANTHROPIC_API_KEY";
  /** 默认模型（取 cc-switch ANTHROPIC_DEFAULT_SONNET_MODEL；无则 undefined）。 */
  default_model?: string;
  website_url: string;
  /** 获取 API Key 的控制台链接（无则 undefined）。 */
  api_key_url?: string;
  /** 存在 = 该家支持用量查询（前端标 💰）。 */
  usage?: { type: LlmProviderUsageType };
  /** 头像背景色（hex，取 cc-switch iconColor）。 */
  icon_color?: string;
  /**
   * 预填 settings_config（env 块）。api_key 对应的 ANTHROPIC_AUTH_TOKEN 留空 ""，
   * 由用户手填（永不预填明文 token）。
   */
  settings_config_partial?: Record<string, unknown>;
}

export const LLM_PROVIDER_PRESETS: LlmProviderPreset[] = [
  {
    key: "anthropic_official",
    name: "Anthropic 官方",
    category: "official",
    base_url: "https://api.anthropic.com",
    auth_field: "ANTHROPIC_AUTH_TOKEN",
    website_url: "https://www.anthropic.com/claude-code",
    icon_color: "#D4915D",
    settings_config_partial: { env: {} },
  },
  {
    key: "kimi",
    name: "Kimi",
    category: "cn_official",
    base_url: "https://api.moonshot.cn/anthropic",
    auth_field: "ANTHROPIC_AUTH_TOKEN",
    default_model: "kimi-k2.7-code",
    website_url: "https://platform.kimi.com",
    icon_color: "#6366F1",
    // 不标 usage：api.moonshot.cn 通用 API，后端 detect 不到（无套餐用量端点）。
    settings_config_partial: {
      env: {
        ANTHROPIC_BASE_URL: "https://api.moonshot.cn/anthropic",
        ANTHROPIC_AUTH_TOKEN: "",
        ANTHROPIC_MODEL: "kimi-k2.7-code",
        ANTHROPIC_DEFAULT_HAIKU_MODEL: "kimi-k2.7-code",
        ANTHROPIC_DEFAULT_SONNET_MODEL: "kimi-k2.7-code",
        ANTHROPIC_DEFAULT_OPUS_MODEL: "kimi-k2.7-code",
      },
    },
  },
  {
    key: "kimi_for_coding",
    name: "Kimi For Coding",
    category: "cn_official",
    base_url: "https://api.kimi.com/coding/",
    auth_field: "ANTHROPIC_AUTH_TOKEN",
    default_model: "kimi-for-coding",
    website_url: "https://www.kimi.com/code/",
    usage: { type: "token_plan" },
    icon_color: "#6366F1",
    settings_config_partial: {
      env: {
        ANTHROPIC_BASE_URL: "https://api.kimi.com/coding/",
        ANTHROPIC_AUTH_TOKEN: "",
        ANTHROPIC_MODEL: "kimi-for-coding",
        ANTHROPIC_DEFAULT_HAIKU_MODEL: "kimi-for-coding",
        ANTHROPIC_DEFAULT_SONNET_MODEL: "kimi-for-coding",
        ANTHROPIC_DEFAULT_OPUS_MODEL: "kimi-for-coding",
        CLAUDE_CODE_MAX_CONTEXT_TOKENS: "262144",
        CLAUDE_CODE_AUTO_COMPACT_WINDOW: "262144",
      },
    },
  },
  {
    key: "zhipu_glm",
    name: "智谱 GLM",
    category: "cn_official",
    base_url: "https://open.bigmodel.cn/api/anthropic",
    auth_field: "ANTHROPIC_AUTH_TOKEN",
    default_model: "glm-5.1",
    website_url: "https://open.bigmodel.cn",
    api_key_url: "https://www.bigmodel.cn/claude-code",
    usage: { type: "token_plan" },
    icon_color: "#0F62FE",
    settings_config_partial: {
      env: {
        ANTHROPIC_BASE_URL: "https://open.bigmodel.cn/api/anthropic",
        ANTHROPIC_AUTH_TOKEN: "",
        ANTHROPIC_MODEL: "glm-5.1",
        ANTHROPIC_DEFAULT_HAIKU_MODEL: "glm-5.1",
        ANTHROPIC_DEFAULT_SONNET_MODEL: "glm-5.1",
        ANTHROPIC_DEFAULT_OPUS_MODEL: "glm-5.1",
      },
    },
  },
  {
    key: "deepseek",
    name: "DeepSeek",
    category: "cn_official",
    base_url: "https://api.deepseek.com/anthropic",
    auth_field: "ANTHROPIC_AUTH_TOKEN",
    default_model: "deepseek-v4-pro",
    website_url: "https://platform.deepseek.com",
    usage: { type: "balance" },
    icon_color: "#1E88E5",
    settings_config_partial: {
      env: {
        ANTHROPIC_BASE_URL: "https://api.deepseek.com/anthropic",
        ANTHROPIC_AUTH_TOKEN: "",
        ANTHROPIC_MODEL: "deepseek-v4-pro",
        ANTHROPIC_DEFAULT_HAIKU_MODEL: "deepseek-v4-flash",
        ANTHROPIC_DEFAULT_SONNET_MODEL: "deepseek-v4-pro",
        ANTHROPIC_DEFAULT_OPUS_MODEL: "deepseek-v4-pro",
      },
    },
  },
  {
    key: "siliconflow",
    name: "硅基流动",
    category: "aggregator",
    base_url: "https://api.siliconflow.cn",
    auth_field: "ANTHROPIC_AUTH_TOKEN",
    default_model: "Pro/MiniMaxAI/MiniMax-M2.7",
    website_url: "https://siliconflow.cn",
    api_key_url: "https://cloud.siliconflow.cn",
    usage: { type: "balance" },
    icon_color: "#6E29F6",
    settings_config_partial: {
      env: {
        ANTHROPIC_BASE_URL: "https://api.siliconflow.cn",
        ANTHROPIC_AUTH_TOKEN: "",
        ANTHROPIC_MODEL: "Pro/MiniMaxAI/MiniMax-M2.7",
        ANTHROPIC_DEFAULT_HAIKU_MODEL: "Pro/MiniMaxAI/MiniMax-M2.7",
        ANTHROPIC_DEFAULT_SONNET_MODEL: "Pro/MiniMaxAI/MiniMax-M2.7",
        ANTHROPIC_DEFAULT_OPUS_MODEL: "Pro/MiniMaxAI/MiniMax-M2.7",
      },
    },
  },
  {
    key: "openrouter",
    name: "OpenRouter",
    category: "aggregator",
    base_url: "https://openrouter.ai/api",
    auth_field: "ANTHROPIC_AUTH_TOKEN",
    default_model: "anthropic/claude-sonnet-5",
    website_url: "https://openrouter.ai",
    api_key_url: "https://openrouter.ai/keys",
    usage: { type: "balance" },
    icon_color: "#6566F1",
    settings_config_partial: {
      env: {
        ANTHROPIC_BASE_URL: "https://openrouter.ai/api",
        ANTHROPIC_AUTH_TOKEN: "",
        ANTHROPIC_MODEL: "anthropic/claude-sonnet-5",
        ANTHROPIC_DEFAULT_HAIKU_MODEL: "anthropic/claude-haiku-4.5",
        ANTHROPIC_DEFAULT_SONNET_MODEL: "anthropic/claude-sonnet-5",
        ANTHROPIC_DEFAULT_OPUS_MODEL: "anthropic/claude-opus-4.8",
      },
    },
  },
  {
    // OpenCode Go：opencode.ai 官方自营 API（cc-switch claudeProviderPresets 同名条目，
    // 端点 https://opencode.ai/zen/go，OpenAI 兼容格式 cc-switch 标 openai_chat）。
    // 数据逐字抄 cc-switch（R-05），affiliate（?ref=）已剔除。模型 4 槽全填 deepseek-v4-flash。
    key: "opencode_go",
    name: "OpenCode Go",
    category: "aggregator",
    base_url: "https://opencode.ai/zen/go",
    auth_field: "ANTHROPIC_AUTH_TOKEN",
    default_model: "deepseek-v4-flash",
    website_url: "https://opencode.ai/go",
    api_key_url: "https://opencode.ai/go",
    icon_color: "#211E1E",
    settings_config_partial: {
      env: {
        ANTHROPIC_BASE_URL: "https://opencode.ai/zen/go",
        ANTHROPIC_AUTH_TOKEN: "",
        ANTHROPIC_MODEL: "deepseek-v4-flash",
        ANTHROPIC_DEFAULT_HAIKU_MODEL: "deepseek-v4-flash",
        ANTHROPIC_DEFAULT_SONNET_MODEL: "deepseek-v4-flash",
        ANTHROPIC_DEFAULT_OPUS_MODEL: "deepseek-v4-flash",
      },
    },
  },
  {
    key: "minimax",
    name: "MiniMax",
    category: "cn_official",
    base_url: "https://api.minimaxi.com/anthropic",
    auth_field: "ANTHROPIC_AUTH_TOKEN",
    default_model: "MiniMax-M2.7",
    website_url: "https://platform.minimaxi.com",
    api_key_url: "https://platform.minimaxi.com/subscribe/coding-plan",
    usage: { type: "token_plan" },
    icon_color: "#FF6B6B",
    settings_config_partial: {
      env: {
        ANTHROPIC_BASE_URL: "https://api.minimaxi.com/anthropic",
        ANTHROPIC_AUTH_TOKEN: "",
        API_TIMEOUT_MS: "3000000",
        CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: 1,
        ANTHROPIC_MODEL: "MiniMax-M2.7",
        ANTHROPIC_DEFAULT_HAIKU_MODEL: "MiniMax-M2.7",
        ANTHROPIC_DEFAULT_SONNET_MODEL: "MiniMax-M2.7",
        ANTHROPIC_DEFAULT_OPUS_MODEL: "MiniMax-M2.7",
      },
    },
  },
  {
    key: "bailian",
    name: "百炼",
    category: "cn_official",
    base_url: "https://dashscope.aliyuncs.com/apps/anthropic",
    auth_field: "ANTHROPIC_AUTH_TOKEN",
    website_url: "https://bailian.console.aliyun.com",
    icon_color: "#624AFF",
    // 不标 usage：DashScope 余额查询需账号 AK/SK HMAC 签名（控制面 API），非目标（D-008）。
    settings_config_partial: {
      env: {
        ANTHROPIC_BASE_URL: "https://dashscope.aliyuncs.com/apps/anthropic",
        ANTHROPIC_AUTH_TOKEN: "",
      },
    },
  },
  {
    key: "bailian_for_coding",
    name: "Bailian For Coding",
    category: "cn_official",
    base_url: "https://coding.dashscope.aliyuncs.com/apps/anthropic",
    auth_field: "ANTHROPIC_AUTH_TOKEN",
    website_url: "https://bailian.console.aliyun.com",
    icon_color: "#624AFF",
    // 不标 usage：同百炼，需 AK/SK 签名，非目标（D-008）。
    settings_config_partial: {
      env: {
        ANTHROPIC_BASE_URL: "https://coding.dashscope.aliyuncs.com/apps/anthropic",
        ANTHROPIC_AUTH_TOKEN: "",
      },
    },
  },
];

/** 分类展示顺序（官方 → 国内官方 → 聚合站）。 */
const CATEGORY_ORDER: LlmProviderPresetCategory[] = [
  "official",
  "cn_official",
  "aggregator",
];

const CATEGORY_LABEL: Record<LlmProviderPresetCategory, string> = {
  official: "官方",
  cn_official: "国内官方",
  aggregator: "聚合站",
};

/** 按 category 分组（保持组内预设顺序），供选择器分组渲染。 */
export const PRESETS_BY_CATEGORY: {
  category: LlmProviderPresetCategory;
  label: string;
  items: LlmProviderPreset[];
}[] = CATEGORY_ORDER.map((category) => ({
  category,
  label: CATEGORY_LABEL[category],
  items: LLM_PROVIDER_PRESETS.filter((p) => p.category === category),
}));

/** 按 key 索引（O(1) 查找）。 */
export const PRESET_BY_KEY: Record<string, LlmProviderPreset> = Object.fromEntries(
  LLM_PROVIDER_PRESETS.map((p) => [p.key, p]),
);
