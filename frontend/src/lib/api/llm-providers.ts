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
  is_default?: boolean;
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
  base_url: string;
  api_key: string;
  auth_field: LlmProviderAuthField;
  notes: string;
  website_url: string;
  model_role_mappings: Record<string, LlmProviderRoleMapping>;
  default_fallback_model: string;
  extra_env: Record<string, string>;
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

/** 设为默认（同 user×agent_kind 互斥，后端事务内先清兄弟行）。 */
export async function setDefaultProvider(
  id: string,
): Promise<LlmProviderRead> {
  return apiFetch<LlmProviderRead>(
    `/api/llm-providers/${encodeURIComponent(id)}/set-default`,
    { method: "POST" },
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
    base_url: clean(v.base_url) ?? null,
    api_key: clean(v.api_key) ?? null,
    notes: clean(v.notes) ?? null,
    website_url: clean(v.website_url) ?? null,
    auth_field: v.auth_field,
    model_role_mappings: cleanRoleMappings(v.model_role_mappings),
    default_fallback_model: clean(v.default_fallback_model) ?? null,
    extra_env: cleanExtraEnv(v.extra_env),
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
    is_default: v.is_default,
  };
  const apiKey = clean(v.api_key);
  if (apiKey) update.api_key = apiKey;
  return update;
}
