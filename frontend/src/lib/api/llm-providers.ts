/**
 * LLM 供应商管理客户端（变更 2026-07-25-llm-provider-management / Wave4 task-12）。
 *
 * 封装 /api/llm-providers 的 list/create/update/delete/set_default 调用，复用
 * `apiFetch`（@/lib/api），范式对齐 `lib/api-keys.ts`。
 *
 * 类型来源：后端 `backend/app/modules/llm_provider/schema.py`（LlmProviderRead/
 * Create/Update）。OpenAPI 生成类型尚未包含本模块（gen-api-types.mjs 未重跑），
 * 故手写并对齐 schema；待生成后可切到 `components["schemas"]["LlmProvider*"]`，
 * 届时删本文件内的手写类型即可（frontend-type-migration 坑）。
 *
 * 安全：api_key 明文仅出现在 POST/PATCH 请求 body，绝不落日志/本地存储；
 * Read 仅含 `api_key_masked`（后端 _to_read 算，首4...尾4 / 短键 ****）。
 */

import { apiFetch } from "@/lib/api";
import type { components } from "@/lib/api-types";

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
  model_role_mappings: Record<string, LlmProviderRoleMapping> | null;
  default_fallback_model: string | null;
  extra_env: Record<string, string> | null;
  /**
   * 高级配置片段（design §4 / D-004）：下发链路透传，daemon toEnv/settings.json
   * 合并（D-007/D-009）。null=未配置；消费方走 `?? null` 归一（frontend-type-migration 坑）。
   */
  settings_config?: Record<string, unknown> | null;
  is_default: boolean;
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
  model_role_mappings?: Record<string, LlmProviderRoleMapping> | null;
  default_fallback_model?: string | null;
  extra_env?: Record<string, string> | null;
  /** 高级配置片段（design §4 / D-004）；null=清空/未配置。 */
  settings_config?: Record<string, unknown> | null;
  is_default: boolean;
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
  model_role_mappings?: Record<string, LlmProviderRoleMapping> | null;
  default_fallback_model?: string | null;
  extra_env?: Record<string, string> | null;
  /** 高级配置片段（design §4 / D-004）；null=清空/未配置。 */
  settings_config?: Record<string, unknown> | null;
  is_default?: boolean;
}

export interface LlmProviderList {
  items: LlmProviderRead[];
  total: number;
}

/**
 * set/unset-default 统一响应（task-09 / FR-07）。
 *
 * 直接引用 OpenAPI 生成类型（`pnpm gen:types` 产出，规则20 禁止手写同名）：
 * - `switched`：本次 set/unset 是否成功变更 is_default（set 凭证探测失败回滚时为 false；
 *   unset 恒为 true）；
 * - `affected_sessions`：notify 成功投递的 active interactive session 计数（D-001）；
 *   0=无运行中会话或 notify 异常 → 立即生效 / 无会话受影响；
 * - `error`：set 凭证探测失败原因（仅 switched=false 时有值）；成功 / unset 为 null。
 *
 * 前端据此区分 toast：立即生效 / 等 turn 边界 / 凭证失败（task-09）。
 */
export type SetDefaultResult = components["schemas"]["SetDefaultResult"];

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
  is_default: boolean;
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

/**
 * 设为默认/「启动」（同 user×agent_kind 互斥，后端事务内先清兄弟行）。
 *
 * task-09：返回 `SetDefaultResult`（switched/affected_sessions/error），供调用方
 * 区分立即生效（switched=true + sessions=0）/ 等 turn 边界（switched=true +
 * sessions>0）/ 凭证失败（switched=false + error）三种状态，对应不同 toast。
 */
export async function setDefaultProvider(
  id: string,
): Promise<SetDefaultResult> {
  return apiFetch<SetDefaultResult>(
    `/api/llm-providers/${encodeURIComponent(id)}/set-default`,
    { method: "POST" },
  );
}

/**
 * 取消默认/「停止」（对称 setDefaultProvider）。取消本行默认，不清兄弟。
 * 若取消后该用户×agent_kind 无任何默认 → lease 不再下发 provider_config
 * → daemon 回归本机凭证管理（design §9 D-007）。
 *
 * task-09：返回 `SetDefaultResult`（unset 不探测，恒 switched=true + error=null），
 * `affected_sessions` 表示将回退本机凭证的运行中会话数。
 */
export async function unsetDefaultProvider(
  id: string,
): Promise<SetDefaultResult> {
  return apiFetch<SetDefaultResult>(
    `/api/llm-providers/${encodeURIComponent(id)}/unset-default`,
    { method: "POST" },
  );
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
  | { base_url: string; api_key: string; auth_field?: LlmProviderAuthField };

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
    base_url: clean(v.base_url) ?? null,
    api_key: clean(v.api_key) ?? null,
    notes: clean(v.notes) ?? null,
    website_url: clean(v.website_url) ?? null,
    auth_field: v.auth_field,
    model_role_mappings: cleanRoleMappings(v.model_role_mappings),
    default_fallback_model: clean(v.default_fallback_model) ?? null,
    extra_env: cleanExtraEnv(v.extra_env),
    settings_config: v.settings_config ?? null,
    is_default: v.is_default,
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
    base_url: clean(v.base_url) ?? null,
    notes: clean(v.notes) ?? null,
    website_url: clean(v.website_url) ?? null,
    auth_field: v.auth_field,
    model_role_mappings: cleanRoleMappings(v.model_role_mappings),
    default_fallback_model: clean(v.default_fallback_model) ?? null,
    extra_env: cleanExtraEnv(v.extra_env),
    settings_config: v.settings_config ?? null,
    is_default: v.is_default,
  };
  const apiKey = clean(v.api_key);
  if (apiKey) update.api_key = apiKey;
  return update;
}
