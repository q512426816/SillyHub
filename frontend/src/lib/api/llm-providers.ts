/**
 * LLM 供应商管理客户端（变更 2026-07-25-llm-provider-management / Wave4 task-12）。
 *
 * 封装 /api/llm-providers 的 list/create/update/delete 调用，复用
 * `apiFetch`（@/lib/api），范式对齐 `lib/api-keys.ts`。
 *
 * 类型来源：后端 `backend/app/modules/llm_provider/schema.py`（LlmProviderRead/
 * Create/Update）。**本模块 LlmProvider* 仍手写**：gen:types 已产出 `components["schemas"]`
 * 下的 LlmProvider* 生成类型（含 api_format），但整体迁移到生成类型是独立的
 * frontend-type-migration 坑，本变更（2026-08-08-llm-provider-openai-format）仅在
 * 手写类型上补 api_format 字段（design §6 文件清单显式登记该债），不顺带整体迁移。
 *
 * 安全：api_key 明文仅出现在 POST/PATCH 请求 body，绝不落日志/本地存储；
 * Read 仅含 `api_key_masked`（后端 _to_read 算，首4...尾4 / 短键 ****）。
 */

import { apiFetch } from "@/lib/api";

// ── 嵌套结构 ────────────────────────────────────────────────────────────

/**
 * 单个角色的映射（model_role_mappings 的 value）。
 * - display：仅 UI 展示名，不影响实际请求。
 * - model：实际请求模型名；留空=该角色不注入（走默认兜底）。
 * - one_m：1M 上下文标记（injector 在模型名后追加 `[1m]`）。
 */
export interface LlmProviderRoleMapping {
  display?: string;
  model?: string;
  one_m?: boolean;
}

/** 认证环境变量名（D-010）；决定 api_key 写入 ANTHROPIC_AUTH_TOKEN 还是 ANTHROPIC_API_KEY。 */
export type LlmProviderAuthField = "ANTHROPIC_AUTH_TOKEN" | "ANTHROPIC_API_KEY";

/** 第一版固定 claude（D-006 预留 codex/gemini/pi）。 */
export type LlmProviderAgentKind = "claude";

/**
 * API 协议格式（2026-08-08-llm-provider-openai-format / D-001@v1）。
 * - anthropic：现有 ANTHROPIC_* 鉴权 + /v1/models；
 * - openai_chat：Bearer 鉴权 + /v1/chat/completions，经服务器 LiteLLM 网关让 Claude Code 消费（Wave2）。
 * 后端按格式产鉴权头 + 候选 URL（service._build_auth_headers / _candidate_urls）。
 */
export type LlmProviderApiFormat = "anthropic" | "openai_chat";

// ── 后端 DTO（对齐 schema.py）────────────────────────────────────────────

/** GET/PATCH/POST/set-default 返回；api_key 仅 masked，明文永不暴露。 */
export interface LlmProviderRead {
  id: string;
  user_id: string;
  name: string;
  agent_kind: string;
  base_url: string | null;
  /** 兼容字段（= default_fallback_model 简写）；表单不直接编辑，仅展示/透传。 */
  model: string | null;
  notes: string | null;
  website_url: string | null;
  auth_field: string;
  /** API 协议格式（D-001@v1）；老行迁移回填 "anthropic"。 */
  api_format: LlmProviderApiFormat;
  model_role_mappings: Record<string, LlmProviderRoleMapping> | null;
  default_fallback_model: string | null;
  extra_env: Record<string, string> | null;
  /**
   * 高级配置片段（design §4 / D-004）：下发链路透传，daemon toEnv/settings.json
   * 合并（D-007/D-009）。null=未配置；消费方走 `?? null` 归一（frontend-type-migration 坑）。
   */
  settings_config?: Record<string, unknown> | null;
  is_default: boolean;
  /**
   * 2026-08-20-session-multimodal-attachments task-11（D-9）：多模态能力三态
   * （auto=按模型名启发式 / true/false=手动覆盖）。前端附件区降级提示消费。
   */
  multimodal: "auto" | "true" | "false";
  /** 如 "sk-1...abcd"（首4...尾4），空 key → null，短 key → "****"。 */
  api_key_masked: string | null;
  created_at: string;
  updated_at: string;
}

/** POST body。 */
export interface LlmProviderCreate {
  name: string;
  agent_kind: LlmProviderAgentKind;
  base_url?: string | null;
  api_key?: string | null;
  model?: string | null;
  notes?: string | null;
  website_url?: string | null;
  auth_field: LlmProviderAuthField;
  /** API 协议格式（D-001@v1）；缺省后端默认 "anthropic"。 */
  api_format?: LlmProviderApiFormat;
  model_role_mappings?: Record<string, LlmProviderRoleMapping> | null;
  default_fallback_model?: string | null;
  extra_env?: Record<string, string> | null;
  /** 高级配置片段（design §4 / D-004）；null=清空/未配置。 */
  settings_config?: Record<string, unknown> | null;
  /** task-12（D-9）：多模态三态（可选，缺省 auto）。 */
  multimodal?: "auto" | "true" | "false";
}

/** PATCH body；全部可选。api_key undefined/null = 不动原密钥（后端 None 语义）。 */
export interface LlmProviderUpdate {
  name?: string;
  base_url?: string | null;
  /** 仅在用户输入新值时携带；留空=保持原密钥。 */
  api_key?: string | null;
  model?: string | null;
  notes?: string | null;
  website_url?: string | null;
  auth_field?: LlmProviderAuthField;
  /** API 协议格式（D-001@v1）；可选，不传=不动。 */
  api_format?: LlmProviderApiFormat;
  model_role_mappings?: Record<string, LlmProviderRoleMapping> | null;
  default_fallback_model?: string | null;
  extra_env?: Record<string, string> | null;
  /** 高级配置片段（design §4 / D-004）；null=清空/未配置。 */
  settings_config?: Record<string, unknown> | null;
  /** task-12（D-9）：多模态三态；不传=不动。 */
  multimodal?: "auto" | "true" | "false";
}

export interface LlmProviderList {
  items: LlmProviderRead[];
  total: number;
}

// ── 表单值契约（task-11 provides: LlmProviderFormValues）─────────────────

/**
 * 表单组件产出的中间形态；经 formToCreate / formToUpdate 映射为后端 body。
 * api_key：create 时必填、update 时空串=保持原密钥（不进 PATCH body）。
 * model_role_mappings：固定 4 行（sonnet/opus/fable/haiku），值含 display/model/one_m。
 * extra_env：KEY→VALUE 键值对（键重复后者覆盖）。
 */
export interface LlmProviderFormValues {
  name: string;
  agent_kind: LlmProviderAgentKind;
  /** API 协议格式（D-001@v1）；表单下拉产出，default "anthropic"（task-05）。 */
  api_format: LlmProviderApiFormat;
  base_url: string;
  api_key: string;
  auth_field: LlmProviderAuthField;
  notes: string;
  website_url: string;
  model_role_mappings: Record<string, LlmProviderRoleMapping>;
  default_fallback_model: string;
  extra_env: Record<string, string>;
  /**
   * 高级配置片段（design §4 / D-004；配置 JSON 面板 task-10 产出）。
   * 可选：表单初始构建/单测固件不带此字段，提交时 `?? null` 归一（design §6.1 Grill B5）。
   */
  settings_config?: Record<string, unknown> | null;
  /** task-12（D-9）：多模态三态；可选——旧固件不带时提交侧缺省 auto。 */
  multimodal?: "auto" | "true" | "false";
}

// ── API 调用 ────────────────────────────────────────────────────────────

/** 列出当前用户的全部供应商（按 created_at desc，api_key masked）。 */
export async function listProviders(): Promise<LlmProviderRead[]> {
  const resp = await apiFetch<LlmProviderList>("/api/llm-providers");
  return resp.items;
}

/** 新建供应商（api_key 加密入库）。 */
export async function createProvider(
  req: LlmProviderCreate,
): Promise<LlmProviderRead> {
  return apiFetch<LlmProviderRead>("/api/llm-providers", {
    method: "POST",
    json: req,
  });
}

/** 编辑供应商（api_key 可选，不传则不动）。 */
export async function updateProvider(
  id: string,
  req: LlmProviderUpdate,
): Promise<LlmProviderRead> {
  return apiFetch<LlmProviderRead>(
    `/api/llm-providers/${encodeURIComponent(id)}`,
    { method: "PATCH", json: req },
  );
}

/** 删除供应商（204）。 */
export async function deleteProvider(id: string): Promise<void> {
  await apiFetch<void>(`/api/llm-providers/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
}

// ── fetch-models（task-11 / D-001/D-006）──────────────────────────────────

/**
 * fetch-models 请求体（双形态联合，D-001）。
 * - 编辑态 `{provider_id}`：后端查行 + 解密 api_key 取明文，前端只传 id。
 * - 新建态 `{base_url, api_key, auth_field?}`：直传上游凭证，用完即弃，
 *   前端永不落本地存储/日志（NFR-02；design §8 安全）。
 */
export type FetchProviderModelsRequest =
  | { provider_id: string }
  | {
      base_url: string;
      api_key: string;
      auth_field?: LlmProviderAuthField;
      /** API 协议格式（D-001@v1）；新建态 openai_chat 走 Bearer + 剥 /chat/completions；缺省 anthropic。 */
      api_format?: LlmProviderApiFormat;
    };

/** fetch-models 单条模型（OpenAI 兼容字段；owned_by 上游缺失则 null）。 */
export interface FetchedProviderModel {
  id: string;
  owned_by: string | null;
}

/** fetch-models 响应（对齐后端 FetchModelsResponse；明文 key 永不回传）。 */
export interface FetchProviderModelsResponse {
  models: FetchedProviderModel[];
}

/**
 * 拉取上游 `/v1/models`（`POST /api/llm-providers/fetch-models`）。
 * 双形态：编辑态 `provider_id`（后端解密）/ 新建态 `base_url+api_key`（+可选
 * `auth_field`，用完即弃，不落本地存储/日志）。响应仅含 `models`，明文 key 不回传。
 */
export async function fetchProviderModels(
  req: FetchProviderModelsRequest,
): Promise<FetchProviderModelsResponse> {
  return apiFetch<FetchProviderModelsResponse>(
    "/api/llm-providers/fetch-models",
    { method: "POST", json: req },
  );
}

// ── usage 查询（task-06 / D-002/D-005）──────────────────────────────────────

/** 用量查询类型（balance=账户余额绝对额 / token_plan=套餐额度百分比）。 */
export type LlmProviderUsageType = "balance" | "token_plan";

/**
 * 单条用量 tier（一个套餐窗口一条；对齐后端 `UsageData`）。
 * - balance：total/used/remaining = 金额，unit="CNY"/"USD"；
 * - token_plan：total=100，remaining=剩余百分比，used=已用百分比，unit="%"；
 * - is_valid=false → 凭据失效，前端翻红（invalid_message 为原因）；
 * - plan_name：套餐名 / 币种 / 窗口名；extra：重置时间等附加信息。
 */
export interface UsageData {
  plan_name?: string | null;
  extra?: string | null;
  is_valid?: boolean | null;
  invalid_message?: string | null;
  total?: number | null;
  used?: number | null;
  remaining?: number | null;
  unit?: string | null;
}

/**
 * 用量查询统一返回（D-005 两态）。
 * - success=true + data：多 tier 余额/额度；
 * - success=false + data=[{is_valid:false}]：确定性鉴权失效（前端翻红）；
 * - success=false + error：暂不支持 / SSRF / 解析错 / HTTP（前端灰提示）；
 * - 瞬时（网络 / 5xx / 429 / 超时）：后端 raise 5xx → `apiFetch` 抛 `ApiError`，
 *   调用方（UsageFooter）保留上次成功值 10 分钟（keep-last-good）。
 */
export interface UsageResult {
  success: boolean;
  data?: UsageData[] | null;
  error?: string | null;
}

/**
 * 查供应商用量（`POST /api/llm-providers/{id}/usage`）。
 * - 200 success=true → 返回 tiers；
 * - 200 success=false → 鉴权失效（data[0].is_valid=false）/ 暂不支持（error）等确定性失败；
 * - 5xx / 网络 / 超时 → 抛 `ApiError`（调用方保留上次值）。
 * 请求不带明文 key（后端按 id 解密）；响应无 api_key 字段（NFR-02）。
 */
export async function queryUsage(providerId: string): Promise<UsageResult> {
  return apiFetch<UsageResult>(
    `/api/llm-providers/${encodeURIComponent(providerId)}/usage`,
    { method: "POST" },
  );
}

/**
 * 客户端 base_url → 用量类型探测（镜像后端 `_detect_usage_provider`，D-004 不加 DB 字段）。
 * **纯 UX 用途**：决定行级 💰 徽标 / 是否渲染用量条 / 是否发起查询；后端 detect 才是安全
 * 真相（本函数错判只会多/少发一次查询，后端兜底 success=false「暂不支持」）。
 * 子串规则与后端逐字一致：DeepSeek / 硅基(.cn/.com) / OpenRouter → balance；
 * Kimi(api.kimi.com) / 智谱(bigmodel.cn|api.z.ai) / MiniMax(.cn/.io) → token_plan。
 */
export function detectUsageProvider(
  baseUrl: string | null | undefined,
): LlmProviderUsageType | null {
  const u = (baseUrl ?? "").toLowerCase();
  if (!u) return null;
  if (u.includes("api.deepseek.com")) return "balance";
  if (u.includes("siliconflow.cn") || u.includes("siliconflow.com")) return "balance";
  if (u.includes("openrouter.ai")) return "balance";
  if (u.includes("api.kimi.com")) return "token_plan";
  if (u.includes("bigmodel.cn") || u.includes("api.z.ai")) return "token_plan";
  if (u.includes("api.minimaxi.com") || u.includes("api.minimax.io")) return "token_plan";
  return null;
}

// ── quota 查询（2026-08-14-sessions-portal task-15 / FR-08 / D-009@v1）─────

/**
 * 单个额度窗口（对齐后端 `LlmProviderQuotaWindow`，schema.py:177）。
 * - label：窗口名（沿用智谱 tier plan_name，如「Max·5小时窗」）；
 * - left：剩余百分比（0-100，口径同 UsageData.remaining）；
 * - reset：重置时间 ISO8601（上游缺失则 null）。
 */
export interface LlmProviderQuotaWindow {
  label: string | null;
  left: number | null;
  reset: string | null;
}

/** quota 非 null 载荷（design §7.1）：`{model, windows[]}`。 */
export interface LlmProviderQuotaData {
  model: string | null;
  windows: LlmProviderQuotaWindow[];
}

/**
 * `GET /api/llm-providers/{id}/quota` 响应（task-07 provides 契约）。
 * 一期仅 GLM 返回窗口数据；非 GLM / 上游失败 / 无数据一律 `quota=null`
 * （HTTP 200 绝不 5xx，弱依赖 R-05），前端 null 不显示胶囊。
 */
export interface LlmProviderQuotaResponse {
  quota: LlmProviderQuotaData | null;
}

/**
 * 查供应商额度（`GET /api/llm-providers/{id}/quota`，task-07 端点）。
 * 弱依赖：后端任何降级场景都回 200 + quota=null；本函数抛错仅可能来自
 * 网络/鉴权层，调用方（QuotaPill）catch 后静默不渲染胶囊（R-05）。
 */
export async function getProviderQuota(
  providerId: string,
): Promise<LlmProviderQuotaResponse> {
  return apiFetch<LlmProviderQuotaResponse>(
    `/api/llm-providers/${encodeURIComponent(providerId)}/quota`,
  );
}

// ── 表单值 → 请求 body 映射（单一真实源，表单 + 单测共用）──────────────────

/** 去前后空白；空串 → undefined。 */
function clean(v: string | undefined | null): string | undefined {
  if (v === undefined || v === null) return undefined;
  const t = v.trim();
  return t === "" ? undefined : t;
}

/**
 * 清洗角色映射：丢弃 model 与 display 均空的行；one_m 仅在 model 有值时携带
 * （one_m 修饰模型名后缀，无 model 无意义）。结果为空 → null。
 */
export function cleanRoleMappings(
  m: Record<string, LlmProviderRoleMapping> | undefined | null,
): Record<string, LlmProviderRoleMapping> | null {
  if (!m) return null;
  const out: Record<string, LlmProviderRoleMapping> = {};
  for (const [role, val] of Object.entries(m)) {
    const display = clean(val?.display);
    const model = clean(val?.model);
    if (!display && !model) continue;
    const entry: LlmProviderRoleMapping = {};
    if (display) entry.display = display;
    if (model) {
      entry.model = model;
      entry.one_m = val?.one_m === true;
    }
    out[role] = entry;
  }
  return Object.keys(out).length === 0 ? null : out;
}

/**
 * 清洗 extra_env：丢弃键空的行（值允许空串=合法 env）；键重复后者覆盖。
 * 结果为空 → null。
 */
export function cleanExtraEnv(
  e: Record<string, string> | undefined | null,
): Record<string, string> | null {
  if (!e) return null;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(e)) {
    const key = k.trim();
    if (!key) continue;
    out[key] = typeof v === "string" ? v.trim() : String(v ?? "").trim();
  }
  return Object.keys(out).length === 0 ? null : out;
}

/** 表单值 → POST body。 */
export function formToCreate(v: LlmProviderFormValues): LlmProviderCreate {
  return {
    name: v.name.trim(),
    agent_kind: "claude",
    api_format: v.api_format,
    base_url: clean(v.base_url) ?? null,
    api_key: clean(v.api_key) ?? null,
    notes: clean(v.notes) ?? null,
    website_url: clean(v.website_url) ?? null,
    auth_field: v.auth_field,
    model_role_mappings: cleanRoleMappings(v.model_role_mappings),
    default_fallback_model: clean(v.default_fallback_model) ?? null,
    extra_env: cleanExtraEnv(v.extra_env),
    settings_config: v.settings_config ?? null,
    multimodal: v.multimodal ?? "auto",
  };
}

/**
 * 表单值 → PATCH body。
 * 铁律：api_key 留空（空串/全空白）时 **不出现在 body**（后端 exclude_unset +
 * None = 不动原密钥，见 service.update）。仅当用户输入新值才携带。
 */
export function formToUpdate(v: LlmProviderFormValues): LlmProviderUpdate {
  const update: LlmProviderUpdate = {
    name: v.name.trim(),
    api_format: v.api_format,
    base_url: clean(v.base_url) ?? null,
    notes: clean(v.notes) ?? null,
    website_url: clean(v.website_url) ?? null,
    auth_field: v.auth_field,
    model_role_mappings: cleanRoleMappings(v.model_role_mappings),
    default_fallback_model: clean(v.default_fallback_model) ?? null,
    extra_env: cleanExtraEnv(v.extra_env),
    settings_config: v.settings_config ?? null,
    ...(v.multimodal ? { multimodal: v.multimodal } : {}),
  };
  const apiKey = clean(v.api_key);
  if (apiKey) update.api_key = apiKey;
  return update;
}
