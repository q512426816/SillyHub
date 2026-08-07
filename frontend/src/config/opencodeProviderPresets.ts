/**
 * opencode 供应商预设模板（quick ql-20260807-004-e5bf，范围=只加前端预设数据）。
 *
 * 纯前端常量。opencode 的供应商配置形态与 claude 完全不同——claude 走 ANTHROPIC_* env，
 * opencode 读 JSON 配置文件（opencode.json / ~/.config/opencode/opencode.json）里的
 * `provider.<名字>` 块：
 *
 *   {
 *     "provider": {
 *       "<name>": {
 *         "npm": "@ai-sdk/openai-compatible",
 *         "name": "<name>",
 *         "options": { "baseURL": "https://...", "apiKey": "", "setCacheKey": true },
 *         "models": { "<modelId>": { "name": "..." } }
 *       }
 *     }
 *   }
 *
 * 故本文件不能复用 `llmProviderPresets.ts`（env 块结构）——它是 opencode 形态的独立数据。
 * 数据逐字抄 cc-switch `opencodeProviderPresets.ts`（R-05 不臆造模型名 / URL），affiliate
 * 参数（?aff= / ?ic= / ?from= / invitecode / utm_ / ref= / ac=）已剔除（属 cc-switch 不属
 * 本平台）。api_key 永不入预设（options.apiKey 恒空串，用户手填）。
 *
 * ⚠️ 范围说明：当前表单 / 后端仍 claude-only（agent_kind 固定 claude），本数据模块先把
 * opencode 供应商数据备好，等 opencode agent 全链路支持时再被表单消费。`name` 字段同时
 * 是 opencode config 的 provider key，故保持 cc-switch 的英文名，不做中文显示名。
 */

// ── 类型 ─────────────────────────────────────────────────────────────────────

/** 预设分类（与 llmProviderPresets 对齐，决定选择器分组顺序；当前 curated 集无 official）。 */
export type OpencodeProviderPresetCategory = "cn_official" | "aggregator";

/** opencode config models 的单条模型描述（options.models 值）。 */
export interface OpencodePresetModel {
  name?: string;
  options?: Record<string, unknown>;
  limit?: { context?: number; output?: number };
  modalities?: { input: string[]; output: string[] };
}

/** opencode 供应商预设（opencode.json `provider.<name>` 块的扁平化视图）。 */
export interface OpencodeProviderPreset {
  /** 稳定 snake key（kimi / deepseek / ...）。 */
  key: string;
  /** 供应商名（同时是 opencode config 的 provider key，保持 cc-switch 原文）。 */
  name: string;
  category: OpencodeProviderPresetCategory;
  /** opencode npm 包（@ai-sdk/openai-compatible / @ai-sdk/anthropic / ...）。 */
  npm: string;
  /** options.baseURL（opencode 请求端点，不带尾斜杠）。 */
  base_url: string;
  /** options.setCacheKey（cc-switch 全部 true）。 */
  set_cache_key?: boolean;
  /** options.models（modelId → 描述；bailian 在 cc-switch 即空，允许空）。 */
  models: Record<string, OpencodePresetModel>;
  website_url: string;
  /** 获取 API Key 的控制台链接（无则 undefined）。 */
  api_key_url?: string;
  /** 头像背景色（hex，取 cc-switch iconColor）。 */
  icon_color?: string;
}

// ── 预设数据（逐字抄 cc-switch opencodeProviderPresets.ts，仅剔 affiliate）────

export const OPENCODE_PROVIDER_PRESETS: OpencodeProviderPreset[] = [
  {
    key: "kimi",
    name: "Kimi",
    category: "cn_official",
    npm: "@ai-sdk/openai-compatible",
    base_url: "https://api.moonshot.cn/v1",
    set_cache_key: true,
    website_url: "https://platform.kimi.com",
    api_key_url: "https://platform.kimi.com/console/api-keys",
    icon_color: "#6366F1",
    models: {
      "kimi-k2.7-code": { name: "Kimi K2.7 Code" },
      "kimi-k3": { name: "Kimi K3" },
    },
  },
  {
    key: "kimi_for_coding",
    name: "Kimi For Coding",
    category: "cn_official",
    npm: "@ai-sdk/anthropic",
    base_url: "https://api.kimi.com/coding/v1",
    set_cache_key: true,
    website_url: "https://www.kimi.com/code/",
    api_key_url: "https://platform.kimi.com/console/api-keys",
    icon_color: "#6366F1",
    models: {
      "kimi-for-coding": { name: "Kimi For Coding" },
    },
  },
  {
    key: "zhipu_glm",
    name: "Zhipu GLM",
    category: "cn_official",
    npm: "@ai-sdk/openai-compatible",
    base_url: "https://open.bigmodel.cn/api/coding/paas/v4",
    set_cache_key: true,
    website_url: "https://open.bigmodel.cn",
    api_key_url: "https://www.bigmodel.cn/claude-code",
    icon_color: "#0F62FE",
    models: {
      "glm-5.1": { name: "GLM-5.1" },
    },
  },
  {
    key: "deepseek",
    name: "DeepSeek",
    category: "cn_official",
    npm: "@ai-sdk/openai-compatible",
    base_url: "https://api.deepseek.com/v1",
    set_cache_key: true,
    website_url: "https://platform.deepseek.com",
    api_key_url: "https://platform.deepseek.com/api_keys",
    icon_color: "#1E88E5",
    models: {
      "deepseek-v4-pro": { name: "DeepSeek V4 Pro" },
      "deepseek-v4-flash": { name: "DeepSeek V4 Flash" },
    },
  },
  {
    key: "minimax",
    name: "MiniMax",
    category: "cn_official",
    npm: "@ai-sdk/openai-compatible",
    base_url: "https://api.minimaxi.com/v1",
    set_cache_key: true,
    website_url: "https://platform.minimaxi.com",
    api_key_url: "https://platform.minimaxi.com/subscribe/coding-plan",
    icon_color: "#FF6B6B",
    models: {
      "MiniMax-M2.7": { name: "MiniMax M2.7" },
    },
  },
  {
    key: "bailian",
    name: "Bailian",
    category: "cn_official",
    npm: "@ai-sdk/openai-compatible",
    base_url: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    set_cache_key: true,
    website_url: "https://bailian.console.aliyun.com",
    api_key_url: "https://bailian.console.aliyun.com/#/api-key",
    icon_color: "#624AFF",
    // cc-switch 原文即空 models（通用兼容端点），故允许空。
    models: {},
  },
  {
    key: "stepfun",
    name: "StepFun",
    category: "cn_official",
    npm: "@ai-sdk/openai-compatible",
    base_url: "https://api.stepfun.com/step_plan/v1",
    set_cache_key: true,
    website_url: "https://platform.stepfun.com/step-plan",
    api_key_url: "https://platform.stepfun.com/interface-key",
    icon_color: "#16D6D2",
    models: {
      "step-3.5-flash-2603": { name: "Step 3.5 Flash 2603" },
      "step-3.5-flash": { name: "Step 3.5 Flash" },
    },
  },
  {
    key: "openrouter",
    name: "OpenRouter",
    category: "aggregator",
    npm: "@ai-sdk/anthropic",
    base_url: "https://openrouter.ai/api/v1",
    set_cache_key: true,
    website_url: "https://openrouter.ai",
    api_key_url: "https://openrouter.ai/keys",
    icon_color: "#6566F1",
    models: {
      "anthropic/claude-sonnet-5": { name: "Claude Sonnet 5" },
      "anthropic/claude-opus-4.8": { name: "Claude Opus 4.8" },
    },
  },
];

// ── 派生索引（供未来表单消费，与 llmProviderPresets 同构）────────────────────

/** 分类展示顺序（国内官方 → 聚合站）。 */
const CATEGORY_ORDER: OpencodeProviderPresetCategory[] = [
  "cn_official",
  "aggregator",
];

const CATEGORY_LABEL: Record<OpencodeProviderPresetCategory, string> = {
  cn_official: "国内官方",
  aggregator: "聚合站",
};

/** 按 category 分组（保持组内预设顺序），供选择器分组渲染。 */
export const OPENCODE_PRESETS_BY_CATEGORY: {
  category: OpencodeProviderPresetCategory;
  label: string;
  items: OpencodeProviderPreset[];
}[] = CATEGORY_ORDER.map((category) => ({
  category,
  label: CATEGORY_LABEL[category],
  items: OPENCODE_PROVIDER_PRESETS.filter((p) => p.category === category),
}));

/** 按 key 索引（O(1) 查找）。 */
export const OPENCODE_PRESET_BY_KEY: Record<string, OpencodeProviderPreset> =
  Object.fromEntries(OPENCODE_PROVIDER_PRESETS.map((p) => [p.key, p]));
