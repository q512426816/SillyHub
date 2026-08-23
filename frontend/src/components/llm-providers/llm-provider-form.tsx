"use client";

import { useMemo, useState, type FormEvent } from "react";
import { Download, Loader2, Package, Sparkles } from "lucide-react";

import { Button } from "@/components/ui/button";
import { JsonEditor } from "@/components/ui/json-editor";
import {
  fetchProviderModels,
  type FetchProviderModelsRequest,
  type LlmProviderAuthField,
  type LlmProviderAgentKind,
  type LlmProviderApiFormat,
  type LlmProviderFormValues,
  type LlmProviderRead,
  type LlmProviderRoleMapping,
} from "@/lib/api/llm-providers";
import { errMessage } from "@/lib/errors";
import { PRESETS_BY_CATEGORY, type LlmProviderPreset } from "@/config/llmProviderPresets";
import { cn } from "@/lib/utils";
import { ModelInputWithFetch, type FetchedModel } from "./model-input-with-fetch";

/**
 * 供应商新建/编辑表单（task-11）。
 *
 * 字段对齐 cc-switch 核心可用集（D-010），无预设选择器（D-003 纯自定义）：
 *   名称 / agent 种类（固定 Claude Code，codex/gemini/pi disabled 占位，D-006）/
 *   备注 / 官网链接 / base_url / api_key 密码框（编辑时不填=保持原密钥）。
 *
 * 高级项默认折叠：<details> 承载：
 *   认证字段下拉 / 4 行模型角色映射（sonnet/opus/fable/haiku × display/model/one_m）/
 *   默认兜底模型 / 自定义 env 键值编辑器（增删行 → extra_env）。
 *
 * api_key 全程不明文回显：编辑模式密码框留空占位 "保持原密钥不变"。
 *
 * 字段 ↔ 配置 JSON 联动（ql-20260823-007）：base_url / 兜底模型 / 角色模型 /
 * 认证字段变更时同步 settings_config.env 同名键（仅键已存在时跟随），避免 JSON 里
 * 的过期值静默覆盖结构化字段（曾致真实 api_key 被空占位盖掉 → 会话 Not logged in）。
 * 提交链路另经 lib 层 cleanSettingsConfig 剔除 env 空串占位。
 */

const inputCls =
  "h-8 w-full rounded border border-input bg-background px-2.5 text-sm focus:border-ring focus:outline-none";
const lblCls = "text-[11px] text-muted-foreground";
const hintCls = "mt-1 text-[11px] text-muted-foreground/80";

/** 4 个固定角色（D-011），顺序即表格渲染顺序。 */
const ROLE_ROWS: { key: string; label: string; placeholder: string }[] = [
  { key: "sonnet", label: "Sonnet", placeholder: "如 kimi-k2 / claude-sonnet-5" },
  { key: "opus", label: "Opus", placeholder: "如 deepseek-v4-pro / claude-opus-4-8" },
  { key: "fable", label: "Fable", placeholder: "留空=该角色走默认兜底" },
  { key: "haiku", label: "Haiku", placeholder: "如 kimi-k2（后台子任务也走中转）" },
];

/** agent 种类下拉选项；非 claude 一律 disabled 占位（D-006 预留）。 */
const AGENT_KIND_OPTIONS: {
  value: LlmProviderAgentKind | string;
  label: string;
  disabled?: boolean;
}[] = [
  { value: "claude", label: "Claude Code" },
  { value: "codex", label: "Codex（即将支持）", disabled: true },
  { value: "gemini", label: "Gemini（即将支持）", disabled: true },
  { value: "pi", label: "Pi（即将支持）", disabled: true },
];

const AUTH_FIELD_OPTIONS: { value: LlmProviderAuthField; label: string }[] = [
  { value: "ANTHROPIC_AUTH_TOKEN", label: "ANTHROPIC_AUTH_TOKEN（默认，中转站常用）" },
  { value: "ANTHROPIC_API_KEY", label: "ANTHROPIC_API_KEY（官方 API key）" },
];

/** API 协议格式下拉选项（D-001@v1）。 */
const API_FORMAT_OPTIONS: { value: LlmProviderApiFormat; label: string }[] = [
  { value: "anthropic", label: "Anthropic（Claude API 兼容）" },
  { value: "openai_chat", label: "OpenAI Chat（/v1/chat/completions + Bearer）" },
];

/** 表单内部角色行状态（display/model 文本框 + one_m 勾选）。 */
interface RoleRowState {
  display: string;
  model: string;
  one_m: boolean;
}

/** 表单内部 env 行状态（数组便于增删，提交时折叠成 Record）。 */
interface EnvRowState {
  key: string;
  value: string;
}

function initRoleRows(
  initial?: LlmProviderRead | null,
): Record<string, RoleRowState> {
  const fromServer = initial?.model_role_mappings ?? {};
  const out: Record<string, RoleRowState> = {};
  for (const r of ROLE_ROWS) {
    const v: LlmProviderRoleMapping | undefined = fromServer[r.key];
    out[r.key] = {
      display: v?.display ?? "",
      model: v?.model ?? "",
      one_m: v?.one_m === true,
    };
  }
  return out;
}

function initEnvRows(initial?: LlmProviderRead | null): EnvRowState[] {
  const env = initial?.extra_env ?? {};
  const rows = Object.entries(env).map(([key, value]) => ({ key, value }));
  // 至少留一行空位方便新增
  if (rows.length === 0) rows.push({ key: "", value: "" });
  return rows;
}

/** 4 角色模型 env 键名（联动结构化字段 ↔ settings_config.env，ql-20260823-007）。 */
const ROLE_ENV_NAME: Record<string, string> = {
  sonnet: "ANTHROPIC_DEFAULT_SONNET_MODEL",
  opus: "ANTHROPIC_DEFAULT_OPUS_MODEL",
  fable: "ANTHROPIC_DEFAULT_FABLE_MODEL",
  haiku: "ANTHROPIC_DEFAULT_HAIKU_MODEL",
};

/**
 * 联动（ql-20260823-007）：结构化字段 → settings_config.env 同名键同步。
 *
 * 仅当 env 中已存在该键时跟随字段值更新（不凭空创建，尊重手写 JSON）；字段清空 →
 * 删除该键（结构化字段是真相源）。JSON 非法 / env 非对象 → 原样返回（照
 * handleConfigToggle 静默不崩惯例）。
 */
function syncSettingsEnvKey(json: string, key: string, value: string): string {
  try {
    const parsed = JSON.parse(json || "{}");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return json;
    }
    const cfg = parsed as Record<string, unknown>;
    const env = cfg.env;
    if (!env || typeof env !== "object" || Array.isArray(env)) return json;
    const envObj = env as Record<string, unknown>;
    if (!(key in envObj)) return json;
    if (value.trim() === "") delete envObj[key];
    else envObj[key] = value.trim();
    if (Object.keys(envObj).length === 0) delete cfg.env;
    return JSON.stringify(cfg, null, 2);
  } catch {
    return json;
  }
}

/**
 * 联动（ql-20260823-007）：认证字段切换 → settings_config.env 认证键改名。
 * 旧键为空（历史预设空占位）→ 直接删除；旧键有值（用户在 env 里手填过令牌）→
 * 迁移到新键名。JSON 非法 → 原样返回。
 */
function renameSettingsEnvAuthKey(
  json: string,
  from: string,
  to: string,
): string {
  if (from === to) return json;
  try {
    const parsed = JSON.parse(json || "{}");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return json;
    }
    const cfg = parsed as Record<string, unknown>;
    const env = cfg.env;
    if (!env || typeof env !== "object" || Array.isArray(env)) return json;
    const envObj = env as Record<string, unknown>;
    if (!(from in envObj)) return json;
    const value = envObj[from];
    delete envObj[from];
    if (typeof value === "string" && value.trim() !== "") {
      envObj[to] = value;
    }
    if (Object.keys(envObj).length === 0) delete cfg.env;
    return JSON.stringify(cfg, null, 2);
  } catch {
    return json;
  }
}

export interface LlmProviderFormProps {
  mode: "create" | "edit";
  /** 编辑模式传入当前供应商；新建模式不传。 */
  initial?: LlmProviderRead | null;
  /** 提交时回调，拿到已清洗前的表单原始值（清洗在 formToCreate/formToUpdate 内做）。 */
  onSubmit: (values: LlmProviderFormValues) => void | Promise<void>;
  onCancel: () => void;
  submitting?: boolean;
}

export function LlmProviderForm({
  mode,
  initial,
  onSubmit,
  onCancel,
  submitting = false,
}: LlmProviderFormProps) {
  const isEdit = mode === "edit";

  const [name, setName] = useState(initial?.name ?? "");
  const [agentKind] = useState<LlmProviderAgentKind>("claude");
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [websiteUrl, setWebsiteUrl] = useState(initial?.website_url ?? "");
  const [baseUrl, setBaseUrl] = useState(initial?.base_url ?? "");
  const [apiKey, setApiKey] = useState("");
  const [authField, setAuthField] = useState<LlmProviderAuthField>(
    (initial?.auth_field as LlmProviderAuthField) ?? "ANTHROPIC_AUTH_TOKEN",
  );
  const [apiFormat, setApiFormat] = useState<LlmProviderApiFormat>(
    initial?.api_format ?? "anthropic",
  );
  // 2026-08-20-session-multimodal-attachments task-12（D-9）：多模态三态
  // （auto=按模型名启发式 / true/false=手动覆盖——中转站别名权威来源）。
  const [multimodal, setMultimodal] = useState<"auto" | "true" | "false">(
    (initial?.multimodal as "auto" | "true" | "false") ?? "auto",
  );
  const [defaultFallbackModel, setDefaultFallbackModel] = useState(
    initial?.default_fallback_model ?? "",
  );
  const [roleRows, setRoleRows] = useState<Record<string, RoleRowState>>(() =>
    initRoleRows(initial),
  );
  const [envRows, setEnvRows] = useState<EnvRowState[]>(() =>
    initEnvRows(initial),
  );

  /**
   * 配置 JSON 面板的 raw 文本（task-10 / D-005）。
   * 初始化：编辑态把 initial.settings_config 序列化为美化 JSON；其余默认 "{}"。
   * 5 开关 / 应用预设 / JsonEditor 三处都读写同一份字符串（单一真相），
   * handleSubmit 时 parse 回对象写入 values.settings_config。
   */
  const [settingsConfigJson, setSettingsConfigJson] = useState<string>(() => {
    const cfg = initial?.settings_config;
    if (cfg && typeof cfg === "object" && !Array.isArray(cfg)) {
      try {
        return JSON.stringify(cfg, null, 2);
      } catch {
        return "{}";
      }
    }
    return "{}";
  });

  // 预设选择器：当前选中的预设 key（null=自定义/未选）；仅新建模式渲染（task-07 / D-001）。
  const [selectedPresetKey, setSelectedPresetKey] = useState<string | null>(null);

  // 4 角色共用的上游模型列表（D-003：全局一个获取按钮，一次请求供 4 角色复用）。
  const [fetchedModels, setFetchedModels] = useState<FetchedModel[]>([]);
  const [isFetching, setIsFetching] = useState(false);
  // 获取/一键设置的行内反馈（对齐 prototype fetchStatus；不用 antd toast 避免测试 AntApp 依赖）。
  const [notice, setNotice] = useState<{
    kind: "ok" | "err" | "loading";
    msg: string;
  } | null>(null);

  const setRole = (
    role: string,
    patch: Partial<RoleRowState>,
  ): void => {
    setRoleRows((prev) => {
      const cur: RoleRowState = prev[role] ?? {
        display: "",
        model: "",
        one_m: false,
      };
      return { ...prev, [role]: { ...cur, ...patch } };
    });
    // 联动（ql-20260823-007）：模型单元格变更 → env 同名角色键跟随（仅键已存在时）。
    const model = patch.model;
    if (model !== undefined) {
      const envName = ROLE_ENV_NAME[role];
      if (envName) {
        setSettingsConfigJson((prev) => syncSettingsEnvKey(prev, envName, model));
      }
    }
  };

  const setEnv = (idx: number, patch: Partial<EnvRowState>): void => {
    setEnvRows((prev) =>
      prev.map((r, i) => (i === idx ? { ...r, ...patch } : r)),
    );
  };
  const addEnv = (): void => {
    setEnvRows((prev) => [...prev, { key: "", value: "" }]);
  };
  const removeEnv = (idx: number): void => {
    setEnvRows((prev) =>
      prev.length === 1
        ? [{ key: "", value: "" }]
        : prev.filter((_, i) => i !== idx),
    );
  };

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    // 把 env 行数组折叠成 Record（键重复后者覆盖，对齐 D-010 / cleanExtraEnv）。
    const extraEnv: Record<string, string> = {};
    for (const r of envRows) {
      const k = r.key.trim();
      if (!k) continue;
      extraEnv[k] = r.value;
    }
    // 角色行 → mapping（保留 4 行原始值，清洗交给 cleanRoleMappings）。
    const mapping: Record<string, LlmProviderRoleMapping> = {};
    for (const r of ROLE_ROWS) {
      const s: RoleRowState = roleRows[r.key] ?? {
        display: "",
        model: "",
        one_m: false,
      };
      mapping[r.key] = {
        ...(s.display ? { display: s.display } : {}),
        ...(s.model ? { model: s.model } : {}),
        one_m: s.one_m,
      };
    }
    // 配置 JSON 面板 → settings_config 对象（task-10 / D-004）：
    // JSON 非法 / 非对象 / 空对象 一律归一为 null（schema 语义：null=未配置）。
    let settingsConfig: Record<string, unknown> | null = null;
    try {
      const parsed = JSON.parse(settingsConfigJson || "{}");
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        settingsConfig =
          Object.keys(parsed).length === 0
            ? null
            : (parsed as Record<string, unknown>);
      }
    } catch {
      settingsConfig = null;
    }

    const values: LlmProviderFormValues = {
      name,
      agent_kind: agentKind,
      api_format: apiFormat,
      base_url: baseUrl,
      api_key: apiKey,
      auth_field: authField,
      notes,
      website_url: websiteUrl,
      model_role_mappings: mapping,
      default_fallback_model: defaultFallbackModel,
      extra_env: extraEnv,
      settings_config: settingsConfig,
      // task-12：multimodal 三态随 values 透传（lib 层 PATCH/POST 组装见下）。
      multimodal,
    } as never;
    void onSubmit(values as never);
  };

  /**
   * 全局「获取模型列表」（D-003：4 角色共用一次请求）。
   * 双形态（D-001）：编辑态 {provider_id}（后端解密 key）/ 新建态 {base_url, api_key, auth_field}（用完即弃）。
   * isFetching 守卫防重复点击；结果存 fetchedModels 供 4 角色 ModelInputWithFetch 共用。
   */
  const handleFetch = async (): Promise<void> => {
    if (isFetching) return;
    let req: FetchProviderModelsRequest;
    if (isEdit) {
      if (!initial?.id) {
        setNotice({ kind: "err", msg: "缺少供应商 ID，无法获取模型列表。" });
        return;
      }
      req = { provider_id: initial.id };
    } else {
      const url = baseUrl.trim();
      const key = apiKey.trim();
      if (!url || !key) {
        setNotice({
          kind: "err",
          msg: "请先填写 base_url 和 API Key，再获取模型列表。",
        });
        return;
      }
      req = { base_url: url, api_key: key, auth_field: authField, api_format: apiFormat };
    }
    setIsFetching(true);
    setNotice({ kind: "loading", msg: "正在获取模型列表…" });
    try {
      const resp = await fetchProviderModels(req);
      const models = resp.models ?? [];
      setFetchedModels(models);
      if (models.length === 0) {
        setNotice({
          kind: "err",
          msg: "上游返回空模型列表，该中转站可能未开放 /v1/models。",
        });
      } else {
        setNotice({
          kind: "ok",
          msg: `✓ 已拉到 ${models.length} 个模型，可从右侧下拉选择。`,
        });
      }
    } catch (err) {
      setNotice({ kind: "err", msg: errMessage(err, "获取模型列表失败") });
    } finally {
      setIsFetching(false);
    }
  };

  /**
   * 「一键设置」（D-002）：取 sonnet||opus||fable||haiku 第一个 model 非空值，
   * 填全部 4 角色 model 单元格（display / one_m 不动）。全空时按钮禁用。
   */
  const handleAutoFill = (): void => {
    const firstNonEmpty = ROLE_ROWS.map(
      (r) => (roleRows[r.key]?.model ?? "").trim(),
    ).find((v) => v !== "");
    if (!firstNonEmpty) {
      setNotice({
        kind: "err",
        msg: "请先在任一角色填模型名，或先「获取模型列表」选一个。",
      });
      return;
    }
    const next: Record<string, RoleRowState> = {};
    for (const r of ROLE_ROWS) {
      const cur: RoleRowState = roleRows[r.key] ?? {
        display: "",
        model: "",
        one_m: false,
      };
      next[r.key] = { ...cur, model: firstNonEmpty };
    }
    setRoleRows(next);
    setNotice({
      kind: "ok",
      msg: `✓ 已把「${firstNonEmpty}」应用到全部 4 角色。`,
    });
  };

  // 一键设置可用性：4 角色 model 全空时禁用（D-002 全空提示以禁用承载）。
  const autoFillDisabled = ROLE_ROWS.every(
    (r) => (roleRows[r.key]?.model ?? "").trim() === "",
  );

  /**
   * 5 开关当前态（D-008）：从 settingsConfigJson parse 推导；JSON 非法时全 false
   * （照 cc-switch CommonConfigEditor:72-98 范式）。useMemo 避免每次按键重 parse。
   */
  const configToggles = useMemo<{
    hideAttribution: boolean;
    teammates: boolean;
    enableToolSearch: boolean;
    effortMax: boolean;
    disableAutoUpgrade: boolean;
  }>(() => {
    try {
      const cfg = JSON.parse(settingsConfigJson || "{}");
      const env =
        (cfg?.env as Record<string, unknown> | undefined) ?? undefined;
      return {
        hideAttribution:
          cfg?.attribution?.commit === "" && cfg?.attribution?.pr === "",
        teammates: env?.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS === "1",
        enableToolSearch: env?.ENABLE_TOOL_SEARCH === "true",
        effortMax: env?.CLAUDE_CODE_EFFORT_LEVEL === "max",
        disableAutoUpgrade: env?.DISABLE_AUTOUPDATER === "1",
      };
    } catch {
      return {
        hideAttribution: false,
        teammates: false,
        enableToolSearch: false,
        effortMax: false,
        disableAutoUpgrade: false,
      };
    }
  }, [settingsConfigJson]);

  /**
   * 5 开关 toggle（D-008）：parse settings_config → 增删对应键（env 空对象则 delete env）
   * → stringify 回写。JSON 非法静默不动（照 cc-switch catch，不崩不丢输入）。
   * 映射：
   *   隐藏 AI 署名 → attribution:{commit:"",pr:""}（顶层键）
   *   Teammates     → env.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS = "1"
   *   Tool Search   → env.ENABLE_TOOL_SEARCH = "true"
   *   最大强度思考  → env.CLAUDE_CODE_EFFORT_LEVEL = "max"
   *   禁用自动升级  → env.DISABLE_AUTOUPDATER = "1"
   */
  const handleConfigToggle = (
    key:
      | "hideAttribution"
      | "teammates"
      | "enableToolSearch"
      | "effortMax"
      | "disableAutoUpgrade",
    checked: boolean,
  ): void => {
    let cfg: Record<string, unknown>;
    try {
      const parsed = JSON.parse(settingsConfigJson || "{}");
      cfg =
        parsed && typeof parsed === "object" && !Array.isArray(parsed)
          ? (parsed as Record<string, unknown>)
          : {};
    } catch {
      return; // JSON 非法 → 静默不动
    }
    const env =
      (cfg.env as Record<string, string> | undefined) ?? {};
    switch (key) {
      case "hideAttribution":
        if (checked) cfg.attribution = { commit: "", pr: "" };
        else delete cfg.attribution;
        break;
      case "teammates":
        if (checked) env.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS = "1";
        else delete env.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS;
        break;
      case "enableToolSearch":
        if (checked) env.ENABLE_TOOL_SEARCH = "true";
        else delete env.ENABLE_TOOL_SEARCH;
        break;
      case "effortMax":
        if (checked) env.CLAUDE_CODE_EFFORT_LEVEL = "max";
        else delete env.CLAUDE_CODE_EFFORT_LEVEL;
        break;
      case "disableAutoUpgrade":
        if (checked) env.DISABLE_AUTOUPDATER = "1";
        else delete env.DISABLE_AUTOUPDATER;
        break;
    }
    if (key !== "hideAttribution") {
      // env 键增删后：空对象 delete env（保持 JSON 干净，对齐 cc-switch）。
      if (Object.keys(env).length === 0) delete cfg.env;
      else cfg.env = env;
    }
    setSettingsConfigJson(JSON.stringify(cfg, null, 2));
  };

  /**
   * 「应用通用配置」预设（D-005）：浅合并 env / enabledPlugins 到 settings_config。
   * 合并顺序 { ...preset, ...current }：用户已有键保留（同键用户值胜出），预设补齐缺失。
   * JSON 非法时回退为空对象再合并（不崩，不丢预设）。
   */
  const handleApplyCommon = (): void => {
    let cfg: Record<string, unknown>;
    try {
      const parsed = JSON.parse(settingsConfigJson || "{}");
      cfg =
        parsed && typeof parsed === "object" && !Array.isArray(parsed)
          ? (parsed as Record<string, unknown>)
          : {};
    } catch {
      cfg = {};
    }
    const presetEnv: Record<string, string> = {
      API_TIMEOUT_MS: "3000000",
      CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
      ENABLE_TOOL_SEARCH: "true",
    };
    const presetPlugins: Record<string, boolean> = {
      "frontend-design": true,
      playwright: true,
    };
    const curEnv =
      (cfg.env as Record<string, string> | undefined) ?? {};
    const curPlugins =
      (cfg.enabledPlugins as Record<string, boolean> | undefined) ?? {};
    cfg.env = { ...presetEnv, ...curEnv };
    cfg.enabledPlugins = { ...presetPlugins, ...curPlugins };
    setSettingsConfigJson(JSON.stringify(cfg, null, 2));
  };

  /**
   * 套用预设（task-07 / D-001）：一键预填 name / base_url / auth_field /
   * default_fallback_model / website_url / settings_config（settings_config_partial
   * 序列化为美化 JSON，复用既有单一真相）+ 角色映射（default_model 套用到全部 4 角色，
   * 照 handleAutoFill 范式）；**api_key 始终留空**给用户填（永不预填明文 token）。
   * 仅新建模式调用（编辑模式不渲染选择器，避免覆盖既有配置）。
   */
  const applyPreset = (preset: LlmProviderPreset): void => {
    setSelectedPresetKey(preset.key);
    setName(preset.name);
    setBaseUrl(preset.base_url);
    setAuthField(preset.auth_field);
    setApiFormat(preset.api_format);
    setDefaultFallbackModel(preset.default_model ?? "");
    setWebsiteUrl(preset.website_url);
    setApiKey("");
    try {
      setSettingsConfigJson(
        JSON.stringify(preset.settings_config_partial ?? {}, null, 2),
      );
    } catch {
      setSettingsConfigJson("{}");
    }
    // default_model 套用到全部 4 角色（照 handleAutoFill 范式；无 default_model 则清空）。
    const model = preset.default_model ?? "";
    const nextRoles: Record<string, RoleRowState> = {};
    for (const r of ROLE_ROWS) {
      const cur: RoleRowState = roleRows[r.key] ?? {
        display: "",
        model: "",
        one_m: false,
      };
      nextRoles[r.key] = { ...cur, model };
    }
    setRoleRows(nextRoles);
    setNotice({
      kind: "ok",
      msg: `✓ 已套用「${preset.name}」预设，请填写 API Key 后保存。`,
    });
  };

  /** 「＋自定义」重置为空表单（task-07 / D-001）。 */
  const resetToCustom = (): void => {
    setSelectedPresetKey(null);
    setName("");
    setBaseUrl("");
    setDefaultFallbackModel("");
    setWebsiteUrl("");
    setApiKey("");
    setAuthField("ANTHROPIC_AUTH_TOKEN");
    setApiFormat("anthropic");
    setRoleRows(initRoleRows(null));
    setEnvRows(initEnvRows(null));
    setSettingsConfigJson("{}");
    setNotice(null);
  };

  // 新建：必须填名称 + api_key；编辑：必须填名称，api_key 可空（保持原密钥）。
  const nameMissing = name.trim() === "";
  const apiKeyMissing = !isEdit && apiKey.trim() === "";
  const submitDisabled = submitting || nameMissing || apiKeyMissing;

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      {/* 预设选择器（task-07 / D-001）：仅新建模式；点预设一键预填，点「＋自定义」清空。
          💰 标记 = 该预设支持余额查询（后端 detect 可路由），不带的（Anthropic 官方 /
          Kimi=moonshot / 百炼 / Bailian For Coding）查不了。 */}
      {!isEdit && (
        <div className="rounded-lg border border-dashed border-input/70 bg-muted/20 p-2.5">
          <div className={lblCls}>从预设快速开始（可选，点一下自动填好表单）</div>
          <div className="mt-1.5 space-y-1.5">
            {PRESETS_BY_CATEGORY.map((group) => (
              <div key={group.category}>
                <div className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground/70">
                  {group.label}
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {group.items.map((p) => {
                    const selected = selectedPresetKey === p.key;
                    return (
                      <button
                        key={p.key}
                        type="button"
                        onClick={() => applyPreset(p)}
                        title={p.usage ? "支持余额查询" : undefined}
                        aria-pressed={selected}
                        className={cn(
                          "inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs transition-colors",
                          selected
                            ? "border-primary bg-primary/10 text-primary"
                            : "border-input bg-background hover:bg-muted",
                        )}
                      >
                        <span>{p.name}</span>
                        {p.usage && <span aria-label="支持余额查询">💰</span>}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
            <div>
              <div className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground/70">
                其它
              </div>
              <button
                type="button"
                onClick={resetToCustom}
                aria-pressed={selectedPresetKey === null}
                className={cn(
                  "inline-flex items-center gap-1 rounded-md border border-dashed border-input bg-background px-2 py-1 text-xs transition-colors hover:bg-muted",
                  selectedPresetKey === null && "border-primary text-primary",
                )}
              >
                ＋自定义
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <div>
          <label className={lblCls}>
            供应商名称 <span className="text-destructive">*</span>
          </label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className={`mt-0.5 ${inputCls}`}
            placeholder="例如：Kimi 中转 / 公司专用账号"
            required
          />
        </div>
        <div>
          <label className={lblCls}>
            Agent 种类 <span className="text-destructive">*</span>
          </label>
          <select
            value={agentKind}
            onChange={() => {
              /* 第一版固定 claude，下拉预留其他 agent（D-006）。 */
            }}
            className={`mt-0.5 ${inputCls}`}
          >
            {AGENT_KIND_OPTIONS.map((o) => (
              <option key={o.value} value={o.value} disabled={o.disabled}>
                {o.label}
              </option>
            ))}
          </select>
          <p className={hintCls}>第一版固定 Claude Code；下拉预留其他 agent。</p>
        </div>
      </div>

      <div>
        <label className={lblCls}>备注</label>
        <input
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          className={`mt-0.5 ${inputCls}`}
          placeholder="例如：公司专用账号 / 个人测试 / 限额 $50/月"
        />
      </div>

      <div>
        <label className={lblCls}>官网链接（可选）</label>
        <input
          value={websiteUrl}
          onChange={(e) => setWebsiteUrl(e.target.value)}
          className={`mt-0.5 ${inputCls}`}
          placeholder="https://example.com（可选，方便日后查账）"
        />
      </div>

      <div>
        <label className={lblCls}>
          API Key{" "}
          {isEdit ? (
            <span className="text-muted-foreground/70">
              （留空=保持原密钥不变）
            </span>
          ) : (
            <span className="text-destructive">*</span>
          )}
        </label>
        <input
          type="password"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          className={`mt-0.5 ${inputCls}`}
          placeholder={isEdit ? "保持原密钥不变" : "sk-***"}
          autoComplete="new-password"
        />
        <p className={hintCls}>
          加密存储（libsodium），列表只显示打码。{isEdit && "编辑时不填则保持原密钥不变。"}
          {isEdit && initial?.api_key_masked && (
            <>当前密钥：<code className="text-xs">{initial.api_key_masked}</code></>
          )}
        </p>
      </div>

      <div>
        <label className={lblCls}>API 格式</label>
        <select
          value={apiFormat}
          onChange={(e) => setApiFormat(e.target.value as LlmProviderApiFormat)}
          className={`mt-0.5 ${inputCls}`}
        >
          {API_FORMAT_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <p className={hintCls}>
          {apiFormat === "openai_chat"
            ? "OpenAI 格式：Bearer 鉴权，可粘贴完整 .../v1/chat/completions 地址；经 LiteLLM 网关让 Claude Code 消费（端到端 Wave2 上线后可用）。"
            : "Anthropic 格式：ANTHROPIC_* 鉴权，兼容 Claude API 端点（官方/中转站）。"}
        </p>
      </div>

      <div>
        <label className={lblCls}>
          请求地址 base_url <span className="text-destructive">*</span>
        </label>
        <input
          value={baseUrl}
          onChange={(e) => {
            const v = e.target.value;
            setBaseUrl(v);
            // 联动（ql-20260823-007）：base_url 字段 → env.ANTHROPIC_BASE_URL 跟随。
            setSettingsConfigJson((prev) =>
              syncSettingsEnvKey(prev, "ANTHROPIC_BASE_URL", v),
            );
          }}
          className={`mt-0.5 ${inputCls}`}
          placeholder="https://api.anthropic.com 或中转站地址；OpenAI 格式可填完整 .../v1/chat/completions"
        />
        <p className={hintCls}>
          Anthropic 格式填 base（如 <code className="text-xs">https://api.anthropic.com</code>）；OpenAI 格式可粘完整地址（如 <code className="text-xs">https://opencode.ai/zen/v1/chat/completions</code>），后端自动剥 /chat/completions。
        </p>
      </div>

      <div>
        <label className={`inline-flex items-center gap-2 ${lblCls}`}>
          多模态能力
        </label>
        <select
          value={multimodal}
          onChange={(e) =>
            setMultimodal(e.target.value as "auto" | "true" | "false")
          }
          className={`mt-0.5 h-8 ${inputCls}`}
        >
          <option value="auto">自动（按模型名推断，未知按不支持）</option>
          <option value="true">支持（图片/PDF 直读）</option>
          <option value="false">不支持（图片转落盘给工具读）</option>
        </select>
        <p className={hintCls}>
          影响会话附件：自动挡按模型名猜（glm-4.6v/claude/gpt-4o 等判支持，别名猜不中请手动指定）。
        </p>
      </div>

      <details className="rounded border border-dashed border-input/70 p-3">
        <summary className="cursor-pointer text-xs font-medium text-muted-foreground">
          高级选项（模型映射 / 认证字段 / 自定义环境变量）
        </summary>

        <div className="mt-3 space-y-3">
          {apiFormat === "anthropic" && (
          <>
          <div>
            <label className={lblCls}>认证字段</label>
            <select
              value={authField}
              onChange={(e) => {
                const next = e.target.value as LlmProviderAuthField;
                setAuthField(next);
                // 联动（ql-20260823-007）：认证键改名——env 旧键空占位删除、有值迁移。
                setSettingsConfigJson((prev) =>
                  renameSettingsEnvAuthKey(prev, authField, next),
                );
              }}
              className={`mt-0.5 ${inputCls}`}
            >
              {AUTH_FIELD_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
            <p className={hintCls}>
              选择把 API Key 写入哪个环境变量。中转站一般用 AUTH_TOKEN，官方用 API_KEY。
            </p>
          </div>

          <div>
            <label className={lblCls}>模型角色映射</label>
            <p className={hintCls}>
              Claude Code 按角色（Sonnet/Opus/Fable/Haiku）请求模型。用中转站时把每个角色映射到中转站实际模型名；官方端点可全部留空。
            </p>
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-7 text-xs"
                onClick={handleFetch}
                disabled={isFetching}
              >
                {isFetching ? (
                  <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Download className="mr-1 h-3.5 w-3.5" />
                )}
                {isFetching ? "获取中…" : "获取模型列表"}
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-7 text-xs"
                onClick={handleAutoFill}
                disabled={autoFillDisabled || isFetching}
                title={
                  autoFillDisabled
                    ? "请先在任一角色填模型名，或先获取模型列表"
                    : "把当前第一个非空模型应用到全部 4 角色"
                }
              >
                <Sparkles className="mr-1 h-3.5 w-3.5" />
                一键设置
              </Button>
              {notice && (
                <span
                  role={notice.kind === "err" ? "alert" : "status"}
                  className={
                    notice.kind === "err"
                      ? "text-xs text-destructive"
                      : notice.kind === "ok"
                        ? "text-xs text-emerald-600"
                        : "text-xs text-muted-foreground"
                  }
                >
                  {notice.msg}
                </span>
              )}
            </div>
            <div className="mt-1.5 overflow-x-auto">
              <table className="w-full border-collapse text-xs">
                <thead>
                  <tr className="bg-muted/40 text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                    <th className="border-b px-2 py-1.5 font-semibold">角色</th>
                    <th className="border-b px-2 py-1.5 font-semibold">显示名称（仅 UI）</th>
                    <th className="border-b px-2 py-1.5 font-semibold">实际请求模型</th>
                    <th className="border-b px-2 py-1.5 font-semibold">1M 上下文</th>
                  </tr>
                </thead>
                <tbody>
                  {ROLE_ROWS.map((r) => {
                    const s: RoleRowState = roleRows[r.key] ?? {
                      display: "",
                      model: "",
                      one_m: false,
                    };
                    return (
                      <tr key={r.key} className="border-b last:border-0">
                        <td className="px-2 py-1.5 font-medium text-amber-700">
                          {r.label}
                        </td>
                        <td className="px-2 py-1.5">
                          <input
                            value={s.display}
                            onChange={(e) =>
                              setRole(r.key, { display: e.target.value })
                            }
                            className="h-7 w-full rounded border border-input bg-background px-1.5 text-xs focus:border-ring focus:outline-none"
                            placeholder={`如 ${r.label}`}
                          />
                        </td>
                        <td className="px-2 py-1.5">
                          <ModelInputWithFetch
                            value={s.model}
                            onChange={(v) => setRole(r.key, { model: v })}
                            fetchedModels={fetchedModels}
                            isLoading={isFetching}
                            onFetch={handleFetch}
                            placeholder={r.placeholder}
                          />
                        </td>
                        <td className="px-2 py-1.5 text-center">
                          <input
                            type="checkbox"
                            checked={s.one_m}
                            onChange={(e) =>
                              setRole(r.key, { one_m: e.target.checked })
                            }
                            className="h-3.5 w-3.5 rounded border border-input"
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p className={hintCls}>
              用中转站时建议至少填 Sonnet/Opus/Haiku，否则这些请求会以原始 Claude 模型名透传给上游，可能因上游无此模型而报错。
            </p>
          </div>

          <div>
            <label className={lblCls}>默认兜底模型（可选）</label>
            <input
              value={defaultFallbackModel}
              onChange={(e) => {
                const v = e.target.value;
                setDefaultFallbackModel(v);
                // 联动（ql-20260823-007）：兜底模型字段 → env.ANTHROPIC_MODEL 跟随。
                setSettingsConfigJson((prev) =>
                  syncSettingsEnvKey(prev, "ANTHROPIC_MODEL", v),
                );
              }}
              className={`mt-0.5 ${inputCls}`}
              placeholder="如 kimi-k2（未映射的角色都走这个模型）"
            />
            <p className={hintCls}>
              用中转站时建议填写：未明确映射的请求（含 Haiku 后台子任务）会以这个模型名发给上游，避免透传原始 Claude 模型名报错。
            </p>
          </div>
          </>
          )}

          <div>
            <label className={lblCls}>自定义环境变量（可选，高级）</label>
            <div className="mt-1 space-y-1.5">
              {envRows.map((row, idx) => (
                <div
                  key={idx}
                  className="grid grid-cols-[1fr_1.6fr_auto] gap-1.5"
                >
                  <input
                    value={row.key}
                    onChange={(e) => setEnv(idx, { key: e.target.value })}
                    className="h-7 rounded border border-input bg-background px-1.5 text-xs focus:border-ring focus:outline-none"
                    placeholder="变量名（如 API_TIMEOUT_MS）"
                  />
                  <input
                    value={row.value}
                    onChange={(e) => setEnv(idx, { value: e.target.value })}
                    className="h-7 rounded border border-input bg-background px-1.5 text-xs focus:border-ring focus:outline-none"
                    placeholder="值（如 3000000）"
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 text-xs text-destructive hover:bg-destructive/10"
                    onClick={() => removeEnv(idx)}
                  >
                    删除
                  </Button>
                </div>
              ))}
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="mt-1.5 h-7 text-xs"
              onClick={addEnv}
            >
              + 添加环境变量
            </Button>
            <p className={hintCls}>
              注入任意额外的 Claude Code 环境变量（超时、流量控制等），会和上面的配置一起下发给 daemon。
            </p>
          </div>
        </div>
      </details>

      <details className="rounded border border-dashed border-input/70 p-3">
        <summary className="cursor-pointer text-xs font-medium text-muted-foreground">
          配置 JSON（高级 env 覆盖上方结构化字段）
        </summary>

        <div className="mt-3 space-y-3">
          <p className={hintCls}>
            直接编辑下发 daemon 的 Claude Code settings 片段，存于{" "}
            <code className="text-xs">settings_config</code>{" "}
            字段（与基础字段合并下发）。开关快捷开关常用项；JSON 编辑器可格式化。{" "}
            <span className="text-amber-700">
              注意：这里的 <code className="text-xs">env</code>{" "}
              优先级最高，会覆盖上方「自定义环境变量」（D-007）；上方 base_url /
              模型 / 认证字段改动会自动同步 env 同名键（ql-20260823-007）。
            </span>
          </p>

          <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
            <label className="inline-flex cursor-pointer items-center gap-1.5 text-xs text-muted-foreground">
              <input
                type="checkbox"
                checked={configToggles.hideAttribution}
                onChange={(e) =>
                  handleConfigToggle("hideAttribution", e.target.checked)
                }
                className="h-3.5 w-3.5 rounded border border-input"
              />
              隐藏 AI 署名
            </label>
            <label className="inline-flex cursor-pointer items-center gap-1.5 text-xs text-muted-foreground">
              <input
                type="checkbox"
                checked={configToggles.teammates}
                onChange={(e) =>
                  handleConfigToggle("teammates", e.target.checked)
                }
                className="h-3.5 w-3.5 rounded border border-input"
              />
              Teammates 模式
            </label>
            <label className="inline-flex cursor-pointer items-center gap-1.5 text-xs text-muted-foreground">
              <input
                type="checkbox"
                checked={configToggles.enableToolSearch}
                onChange={(e) =>
                  handleConfigToggle("enableToolSearch", e.target.checked)
                }
                className="h-3.5 w-3.5 rounded border border-input"
              />
              启用 Tool Search
            </label>
            <label className="inline-flex cursor-pointer items-center gap-1.5 text-xs text-muted-foreground">
              <input
                type="checkbox"
                checked={configToggles.effortMax}
                onChange={(e) =>
                  handleConfigToggle("effortMax", e.target.checked)
                }
                className="h-3.5 w-3.5 rounded border border-input"
              />
              最大强度思考
            </label>
            <label className="inline-flex cursor-pointer items-center gap-1.5 text-xs text-muted-foreground">
              <input
                type="checkbox"
                checked={configToggles.disableAutoUpgrade}
                onChange={(e) =>
                  handleConfigToggle("disableAutoUpgrade", e.target.checked)
                }
                className="h-3.5 w-3.5 rounded border border-input"
              />
              禁用自动升级
            </label>
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7 text-xs"
              onClick={handleApplyCommon}
              title="把通用 env / 插件预设浅合并进配置 JSON"
            >
              <Package className="mr-1 h-3.5 w-3.5" />
              应用通用配置（预设）
            </Button>
          </div>

          <JsonEditor
            value={settingsConfigJson}
            onChange={setSettingsConfigJson}
            placeholder={`{\n  "env": { "API_TIMEOUT_MS": "3000000" },\n  "attribution": { "commit": "", "pr": "" }\n}`}
          />
        </div>
      </details>

      <div className="flex items-center gap-2 pt-1">
        <Button type="submit" size="sm" disabled={submitDisabled}>
          {submitting ? "保存中…" : isEdit ? "保存修改" : "创建供应商"}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onCancel}>
          取消
        </Button>
      </div>
    </form>
  );
}
