"use client";

import { useMemo, useState, type FormEvent } from "react";
import { Download, Loader2, Package, Sparkles } from "lucide-react";

import { message } from "antd";

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
 *   名称 / agent 种类（claude / codex / pi 可选，gemini disabled 占位；pi 于
 *   review-dispatch task-07 放开，D-002@v1 独立凭证池入口；codex 于
 *   multi-provider-injection task-06 放开——凭证经 daemon per-session
 *   CODEX_HOME 文件注入，无需 env auth_field，D-005/D-006）/
 *   备注 / 官网链接 / base_url / api_key 密码框（编辑时不填=保持原密钥）。
 *
 * 高级项默认折叠：<details> 承载：
 *   认证字段（claude 两选项下拉；pi 泛化为可输入 env 名 + pattern 即时校验，
 *   task-07 / D-002@v1）/ 4 行模型角色映射（sonnet/opus/fable/haiku × display/model/one_m）/
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

/**
 * agent 种类下拉选项；gemini disabled 占位（D-006），pi 已启用（task-07 /
 * D-002@v1），codex 已启用（task-06 / D-005/D-006）——凭证经 daemon
 * per-session CODEX_HOME 文件注入（config.toml/auth.json 落盘），不经 env
 * auth_field，故 codex 无需配置认证字段。
 */
const AGENT_KIND_OPTIONS: {
  value: string;
  label: string;
  disabled?: boolean;
}[] = [
  { value: "claude", label: "Claude Code" },
  { value: "codex", label: "Codex" },
  { value: "gemini", label: "Gemini（即将支持）", disabled: true },
  { value: "pi", label: "Pi" },
];

const AUTH_FIELD_OPTIONS: { value: LlmProviderAuthField; label: string }[] = [
  { value: "ANTHROPIC_AUTH_TOKEN", label: "ANTHROPIC_AUTH_TOKEN（默认，中转站常用）" },
  { value: "ANTHROPIC_API_KEY", label: "ANTHROPIC_API_KEY（官方 API key）" },
];

/**
 * pi 认证字段 env 名 pattern（task-07，与 backend schema task-04 同款）：
 * 大写字母开头，仅大写字母 / 数字 / 下划线。
 */
const AUTH_FIELD_ENV_PATTERN = /^[A-Z][A-Z0-9_]*$/;

/** pi 认证字段输入建议（datalist；design §5.2 示例）。 */
const PI_AUTH_FIELD_SUGGESTIONS = [
  "ZAI_API_KEY",
  "ANTHROPIC_API_KEY",
  "OPENROUTER_API_KEY",
];

/** API 协议格式下拉选项（D-001@v1）。 */
const API_FORMAT_OPTIONS: { value: LlmProviderApiFormat; label: string }[] = [
  { value: "anthropic", label: "Anthropic（Claude API 兼容）" },
  { value: "openai_chat", label: "OpenAI Chat（/v1/chat/completions + Bearer）" },
];

/** 表单内部模型行状态（D-001 列表条目：name/multimodal 三态/roles 多标/one_m）。 */
interface ModelRowState {
  name: string;
  multimodal: "auto" | "true" | "false";
  roles: string[];
  one_m: boolean;
}

/** 表单内部 env 行状态（数组便于增删，提交时折叠成 Record）。 */
interface EnvRowState {
  key: string;
  value: string;
}

function initModelRows(initial?: LlmProviderRead | null): ModelRowState[] {
  const fromServer = initial?.models ?? [];
  return fromServer.map((m) => ({
    name: m.name ?? "",
    multimodal: (m.multimodal ?? "auto") as ModelRowState["multimodal"],
    roles: [...(m.roles ?? [])],
    one_m: m.one_m === true,
  }));
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
  // change 2026-10-06-provider-multi-agent-kind（D-004）：单选改引擎集合——编辑态
  // 初值取 initial.agent_kinds（去重兜底），新建缺省 ["claude"]；至少勾一个（提交侧拦）。
  const [agentKinds, setAgentKinds] = useState<LlmProviderAgentKind[]>(
    initial?.agent_kinds?.length
      ? (Array.from(new Set(initial.agent_kinds)) as LlmProviderAgentKind[])
      : ["claude"],
  );
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [websiteUrl, setWebsiteUrl] = useState(initial?.website_url ?? "");
  const [baseUrl, setBaseUrl] = useState(initial?.base_url ?? "");
  const [apiKey, setApiKey] = useState("");
  // task-07（D-002@v1）：claude 为两选项下拉值，pi 为自由输入 env 名 → state 放宽为 string。
  const [authField, setAuthField] = useState<string>(
    initial?.auth_field ?? "ANTHROPIC_AUTH_TOKEN",
  );
  const [apiFormat, setApiFormat] = useState<LlmProviderApiFormat>(
    initial?.api_format ?? "anthropic",
  );

  const [modelRows, setModelRows] = useState<ModelRowState[]>(() => initModelRows(initial));
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

  const setModelRow = (idx: number, patch: Partial<ModelRowState>): void => {
    setModelRows((prev) => prev.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
    // 联动（ql-20260823-007 退役）：模型列表不再逐角色联动 env（角色在行内标记）。
  };
  const addModelRow = (): void => {
    setModelRows((prev) => [...prev, { name: "", multimodal: "auto", roles: [], one_m: false }]);
  };
  const removeModelRow = (idx: number): void => {
    setModelRows((prev) => prev.filter((_, i) => i !== idx));
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
    // 模型行 → models 条目（空名行丢弃；multimodal/roles/one_m 原样）。
    const models = modelRows
      .filter((r) => r.name.trim() !== "")
      .map((r) => ({
        name: r.name.trim(),
        multimodal: r.multimodal,
        roles: r.roles,
        one_m: r.one_m,
      }));
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

    // R-05（task-08）：编辑默认供应商时收缩引擎集合 → 被移除引擎的默认位空缺
    //（不自动转移，D-003）。提交即提示（保存语义=用户确认收缩）。
    if (isEdit && initial?.is_default) {
      const removed = (initial.agent_kinds ?? []).filter(
        (k: string) => !agentKinds.includes(k as LlmProviderAgentKind),
      );
      if (removed.length > 0) {
        void message.warning(
          `已移除引擎 ${removed.join("、")}：该引擎的默认供应商位已空缺（不会自动转移给其它供应商）`,
        );
      }
    }
    const values: LlmProviderFormValues = {
      name,
      agent_kinds: agentKinds,
      api_format: apiFormat,
      base_url: baseUrl,
      api_key: apiKey,
      auth_field: authField,
      notes,
      website_url: websiteUrl,
      models,
      extra_env: extraEnv,
      settings_config: settingsConfig,
    };
    void onSubmit(values);
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
      // auth_field 为 env 名 string（lib 别名已随 backend task-04 放宽），运行时
      // 原样透传（pi 时如 ZAI_API_KEY）。
      req = {
        base_url: url,
        api_key: key,
        auth_field: authField,
        api_format: apiFormat,
      };
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
  // D-002：一键填充退役——模型列表行内自含角色标记，无「应用到全部角色」语义。
  const autoFillDisabled = modelRows.every((r) => r.name.trim() === "");

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
   * ql-20260920-007（2026-09-20-claude-autocompact-config / FR-02）：引擎自动压缩
   * 三键派生态（agentKinds 含 claude 条件区渲染用）。JSON 非法时全空（跟随引擎默认）。
   *   - autoCompactWindow：number | undefined（压缩窗口 token 数）
   *   - autoCompactEnabled：boolean | undefined（三态：undefined=跟随引擎/true=开/false=关）
   *   - precomputeCompactionEnabled：boolean | undefined（勾选=开启后台预计算）
   */
  const autoCompactCfg = useMemo<{
    window: number | undefined;
    enabled: boolean | undefined;
    precompute: boolean | undefined;
  }>(() => {
    try {
      const cfg = JSON.parse(settingsConfigJson || "{}");
      return {
        window:
          typeof cfg?.autoCompactWindow === "number"
            ? cfg.autoCompactWindow
            : undefined,
        enabled:
          typeof cfg?.autoCompactEnabled === "boolean"
            ? cfg.autoCompactEnabled
            : undefined,
        precompute:
          typeof cfg?.precomputeCompactionEnabled === "boolean"
            ? cfg.precomputeCompactionEnabled
            : undefined,
      };
    } catch {
      return { window: undefined, enabled: undefined, precompute: undefined };
    }
  }, [settingsConfigJson]);

  /**
   * ql-20260920-007：autocompact 三键写入（value=null 删键=跟随引擎默认）。
   * parse settings_config → set/delete → stringify 回写（照 handleConfigToggle
   * 范式：JSON 非法静默不动）。window 输入非法（非正整数）不写入。
   */
  const setAutoCompactField = (
    key: "autoCompactWindow" | "autoCompactEnabled" | "precomputeCompactionEnabled",
    value: number | boolean | null,
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
    if (value === null) delete cfg[key];
    else if (key === "autoCompactWindow") {
      if (Number.isInteger(value) && (value as number) > 0) {
        cfg[key] = value;
      } else {
        delete cfg[key]; // 非正整数视同未设置
      }
    } else cfg[key] = value;
    setSettingsConfigJson(JSON.stringify(cfg, null, 2));
  };

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
    setWebsiteUrl(preset.website_url);
    setApiKey("");
    try {
      setSettingsConfigJson(
        JSON.stringify(preset.settings_config_partial ?? {}, null, 2),
      );
    } catch {
      setSettingsConfigJson("{}");
    }
    // D-001：预设 default_model → 首行模型条目（带 sonnet 主标记；无则清空列表）。
    const model = preset.default_model ?? "";
    setModelRows(
      model
        ? [{ name: model, multimodal: "auto", roles: ["sonnet"], one_m: false }]
        : [],
    );
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
    setWebsiteUrl("");
    setApiKey("");
    setAuthField("ANTHROPIC_AUTH_TOKEN");
    setApiFormat("anthropic");
    setModelRows([]);
    setEnvRows(initEnvRows(null));
    setSettingsConfigJson("{}");
    setNotice(null);
  };

  // 新建：必须填名称 + api_key；编辑：必须填名称，api_key 可空（保持原密钥）。
  const nameMissing = name.trim() === "";
  const apiKeyMissing = !isEdit && apiKey.trim() === "";
  /**
   * pi 认证字段即时校验（task-07）：空 / 不匹配 env 名 pattern → 报错文案 + 拦提交。
   * 只报错不吞值（constraints：不静默改写用户输入），修复权交给用户；
   * claude 路径不受影响（两选项下拉值恒合法）。
   */
  const piAuthFieldError: string | null = (() => {
    if (!agentKinds.includes("pi")) return null;
    const v = authField.trim();
    if (v === "") {
      return "认证字段不能为空：pi 凭证需要一个 env 变量名（如 ZAI_API_KEY）。";
    }
    if (!AUTH_FIELD_ENV_PATTERN.test(v)) {
      return "认证字段须为合法 env 变量名（大写字母开头，仅含大写字母 / 数字 / 下划线），如 ZAI_API_KEY。";
    }
    return null;
  })();
  /**
   * pi × openai_chat 禁配兜底（task-06 / FR-05 / D-012 连带声明）：该组合两层
   * 注入均不生效（pi env 层不带端点、文件层仅 anthropic 形态直连），后端
   * Create/Update 均已 422。表单侧下拉对 pi 禁用 openai_chat 选项 + 切 pi 时
   * 归一 api_format（见引擎勾选 onChange/openai 选项禁用），此处提交前再拦一道，兜住绕过
   * 下拉的路径（如禁配上线前的存量 pi×openai_chat 行进编辑态）。文案与后端
   * 422 逐字对齐（schema._forbid_pi_openai_chat）。
   */
  const piOpenaiChatError: string | null =
    agentKinds.includes("pi") && apiFormat === "openai_chat"
      ? "pi 供应商不支持 openai_chat API 格式（两层注入均不生效），请改用 anthropic 格式或选择 codex/claude 供应商"
      : null;
  const submitDisabled =
    submitting ||
    nameMissing ||
    apiKeyMissing ||
    piAuthFieldError !== null ||
    piOpenaiChatError !== null;

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
            Agent 种类（可多选） <span className="text-destructive">*</span>
          </label>
          {/* D-004 多选：同一份凭证可服务多个引擎；至少勾一个（提交侧拦空集）。 */}
          <div
            role="group"
            aria-label="Agent 种类"
            className="mt-0.5 flex flex-wrap gap-x-4 gap-y-1.5"
          >
            {AGENT_KIND_OPTIONS.map((o) => {
              const checked = agentKinds.includes(o.value as LlmProviderAgentKind);
              // task-06（FR-05 / D-012；D-005 集合级）：openai_chat 格式下 pi 项
              // 前置禁用（后端 422 同口径，双端一致）；gemini 占位禁用照旧。
              const piLocked =
                o.value === "pi" && apiFormat === "openai_chat" && !checked;
              const disabled = Boolean(o.disabled) || piLocked;
              return (
                <label
                  key={o.value}
                  className={`flex items-center gap-1.5 text-sm ${
                    disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer"
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={disabled}
                    onChange={(e) => {
                      if (disabled) return; // 防编程式点击绕过禁用（如 fireEvent）
                      const v = o.value as LlmProviderAgentKind;
                      const next = e.target.checked
                        ? [...agentKinds, v]
                        : agentKinds.filter((k) => k !== v);
                      if (next.length === 0) return; // 至少保留一个（UI 层不产生空集）
                      setAgentKinds(next);
                      // 取消 pi 勾选后若 auth_field 是 pi 自由输入 env 名（不在两
                      // 选项内）→ 归一回缺省，避免下拉空值（单选时代同款归一）。
                      if (
                        !next.includes("pi") &&
                        !AUTH_FIELD_OPTIONS.some((opt) => opt.value === authField)
                      ) {
                        setAuthField("ANTHROPIC_AUTH_TOKEN");
                      }
                    }}
                    className="h-4 w-4 accent-[var(--brand)]"
                  />
                  {o.label}
                  {piLocked && (
                    <span className="text-xs text-muted-foreground">
                      （openai 格式不可用）
                    </span>
                  )}
                </label>
              );
            })}
          </div>
          <p className={hintCls}>
            一条凭证可同时服务多个引擎；Claude Code 走默认凭证链；Pi 使用独立凭证池
            （认证字段可配专属 env 名）；Codex 凭证由 daemon 在会话级 CODEX_HOME
            目录写入文件。gemini 预留。
          </p>
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
            <option
              key={o.value}
              value={o.value}
              disabled={agentKinds.includes("pi") && o.value === "openai_chat"}
            >
              {o.label}
            </option>
          ))}
        </select>
        <p className={hintCls}>
          {apiFormat === "openai_chat"
            ? "OpenAI 格式：Bearer 鉴权，可粘贴完整 .../v1/chat/completions 地址；经 LiteLLM 网关让 Claude Code 消费（端到端 Wave2 上线后可用）。"
            : "Anthropic 格式：ANTHROPIC_* 鉴权，兼容 Claude API 端点（官方/中转站）。"}
        </p>
        {agentKinds.includes("pi") && (
          <p className={hintCls}>
            pi 供应商不支持 openai_chat API 格式（两层注入均不生效），该选项已禁用——请保持
            Anthropic 格式，或改选 codex/claude 供应商。
          </p>
        )}
        {piOpenaiChatError !== null && (
          <p role="alert" className="text-xs text-destructive">
            {piOpenaiChatError}
          </p>
        )}
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
        {agentKinds.includes("pi") && (
          <p className={hintCls}>
            Pi 自定义端点语义（task-06 / D-008 分层）：填写=自定义端点——daemon 在会话级
            pi 目录写 auth.json / models.json / settings.json 三文件把请求路由到该端点；
            留空=官方端点——凭证仅经 env 层注入（daemon 不写文件）。
          </p>
        )}
      </div>

      <div>
        {/* D-003：多模态三态已下沉到模型条目（行内下拉）。 */}
      </div>

      <details className="rounded border border-dashed border-input/70 p-3">
        <summary className="cursor-pointer text-xs font-medium text-muted-foreground">
          高级选项（认证字段 / 自定义环境变量）
        </summary>

        <div className="mt-3 space-y-3">
          {/* 认证字段（task-07 / D-002@v1）：claude 保持两选项下拉与 env 改名联动
              （零回归）；pi 泛化为可输入 env 名（datalist 建议 + pattern 即时校验拦
              提交）。task-06 起 pi × openai_chat 禁配（pi 恒 anthropic），但 pi 分支
              不折叠进 `apiFormat === "anthropic"` 条件——pi 凭证走 env 层按
              auth_field 注 key 与格式无关，显式 `|| agentKinds.includes("pi")` 防将来
              词表/条件变动时 pi 认证字段凭空消失。 */}
          {(apiFormat === "anthropic" || agentKinds.includes("pi")) && (
          <div>
            <label className={lblCls}>认证字段</label>
            {agentKinds.includes("pi") ? (
              <>
                <input
                  list="pi-auth-field-suggestions"
                  value={authField}
                  onChange={(e) => setAuthField(e.target.value)}
                  className={cn(
                    "mt-0.5",
                    inputCls,
                    piAuthFieldError !== null &&
                      "border-destructive focus:border-destructive",
                  )}
                  placeholder="如 ZAI_API_KEY / ANTHROPIC_API_KEY / OPENROUTER_API_KEY"
                  aria-invalid={piAuthFieldError !== null}
                  autoComplete="off"
                  spellCheck={false}
                />
                <datalist id="pi-auth-field-suggestions">
                  {PI_AUTH_FIELD_SUGGESTIONS.map((s) => (
                    <option key={s} value={s} />
                  ))}
                </datalist>
                {piAuthFieldError !== null && (
                  <p role="alert" className="text-xs text-destructive">
                    {piAuthFieldError}
                  </p>
                )}
                <p className={hintCls}>
                  pi 凭证注入的 env 变量名（API Key 写进这个变量），须大写字母开头、仅含大写字母 / 数字 / 下划线。
                </p>
              </>
            ) : (
              <>
                <select
                  value={authField}
                  onChange={(e) => {
                    const next = e.target.value;
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
              </>
            )}
          </div>
          )}

          {apiFormat === "anthropic" && (
          <>
          <div>
            <label className={lblCls}>模型列表</label>
            <p className={hintCls}>
              一条供应商可定义多个模型（条数不限）；Claude 引擎在行内标记角色档位（可多标，
              sonnet=主模型），其它引擎只填模型名。
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
                onClick={() => {
                  if (modelRows.every((r) => r.name.trim() === "")) {
                    setNotice({ kind: "err", msg: "请先添加至少一个模型行。" });
                    return;
                  }
                  setNotice({ kind: "ok", msg: "模型行内可直接选拉取的模型。" });
                }}
                disabled={autoFillDisabled || isFetching}
                title="先添加模型行，再在行内下拉选择拉取的模型"
              >
                <Sparkles className="mr-1 h-3.5 w-3.5" />
                使用提示
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
            <div className="mt-1.5 space-y-1.5">
              {modelRows.map((row, idx) => (
                <div
                  key={idx}
                  className="grid grid-cols-[1.6fr_1fr_1.4fr_auto_auto] items-center gap-1.5"
                >
                  <ModelInputWithFetch
                    value={row.name}
                    onChange={(v) => setModelRow(idx, { name: v })}
                    fetchedModels={fetchedModels}
                    isLoading={isFetching}
                    onFetch={handleFetch}
                    placeholder="模型名（如 deepseek-v4.1-flash）"
                  />
                  <select
                    value={row.multimodal}
                    onChange={(e) =>
                      setModelRow(idx, {
                        multimodal: e.target.value as ModelRowState["multimodal"],
                      })
                    }
                    className="h-7 rounded border border-input bg-background px-1.5 text-xs"
                    title="多模态（图片/PDF 附件）能力"
                  >
                    <option value="auto">自动判断</option>
                    <option value="true">支持多模态</option>
                    <option value="false">仅文本</option>
                  </select>
                  <div className="flex flex-wrap items-center gap-1" role="group" aria-label="角色标记">
                    {agentKinds.includes("claude") &&
                      ROLE_ROWS.map((r) => {
                        const on = row.roles.includes(r.key);
                        return (
                          <button
                            key={r.key}
                            type="button"
                            aria-pressed={on}
                            onClick={() =>
                              setModelRow(idx, {
                                roles: on
                                  ? row.roles.filter((x) => x !== r.key)
                                  : [...row.roles, r.key],
                              })
                            }
                            className={`rounded border px-1.5 py-0.5 text-[11px] ${
                              on
                                ? "border-amber-400 bg-amber-100 text-amber-800"
                                : "border-input text-muted-foreground"
                            }`}
                          >
                            {r.label}
                          </button>
                        );
                      })}
                  </div>
                  <label className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                    <input
                      type="checkbox"
                      checked={row.one_m}
                      onChange={(e) => setModelRow(idx, { one_m: e.target.checked })}
                      className="h-3.5 w-3.5 rounded border border-input"
                    />
                    1M
                  </label>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 text-xs text-destructive hover:bg-destructive/10"
                    onClick={() => removeModelRow(idx)}
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
              onClick={addModelRow}
            >
              + 添加模型
            </Button>
            <p className={hintCls}>
              sonnet 标记的首条 = 主模型（会话未选模型时用它）；多模态「自动判断」按模型名启发式。
            </p>
          </div>

          {/* D-001：默认兜底模型输入退役——主模型派生（sonnet 首条）承担该语义。 */}
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

      {/* ql-20260920-007（2026-09-20-claude-autocompact-config / FR-02）：
          引擎自动压缩三键结构化区——仅 claude 引擎渲染（pi/codex 压缩机制各自独立，
          不走 settings.json）。三键直写 settings_config 顶层，随 spawn 前白名单
          （claude-settings.ts）落 $CLAUDE_CONFIG_DIR/settings.json。 */}
      {agentKinds.includes("claude") && (
        <details className="rounded border border-dashed border-input/70 p-3">
          <summary className="cursor-pointer text-xs font-medium text-muted-foreground">
            引擎自动压缩（claude）
          </summary>
          <div className="mt-3 space-y-2">
            <p className={hintCls}>
              引擎默认在约 80% 上下文窗口（如 200K 窗口 ≈ 160K tokens）自动压缩；
              留空全部跟随引擎默认。运行中的会话不热更新，下一次新会话生效。
            </p>
            <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
              <label className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                自动压缩
                <select
                  className="h-7 rounded border border-input bg-background px-1.5 text-xs"
                  value={
                    autoCompactCfg.enabled === undefined
                      ? ""
                      : autoCompactCfg.enabled
                        ? "true"
                        : "false"
                  }
                  onChange={(e) =>
                    setAutoCompactField(
                      "autoCompactEnabled",
                      e.target.value === ""
                        ? null
                        : e.target.value === "true",
                    )
                  }
                >
                  <option value="">跟随引擎（默认开）</option>
                  <option value="true">开启</option>
                  <option value="false">关闭</option>
                </select>
              </label>
              <label className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                压缩窗口（tokens）
                <input
                  type="number"
                  min={10000}
                  step={10000}
                  className="h-7 w-36 rounded border border-input bg-background px-1.5 text-xs"
                  placeholder="默认=模型窗口（如 200000）"
                  value={autoCompactCfg.window ?? ""}
                  onChange={(e) =>
                    setAutoCompactField(
                      "autoCompactWindow",
                      e.target.value === "" ? null : Number(e.target.value),
                    )
                  }
                />
              </label>
              <label className="inline-flex cursor-pointer items-center gap-1.5 text-xs text-muted-foreground">
                <input
                  type="checkbox"
                  checked={autoCompactCfg.precompute === true}
                  onChange={(e) =>
                    setAutoCompactField(
                      "precomputeCompactionEnabled",
                      e.target.checked ? true : null,
                    )
                  }
                  className="h-3.5 w-3.5 rounded border border-input"
                />
                后台预计算压缩摘要
              </label>
            </div>
            <p className="text-[11px] text-amber-700">
              ⚠️ 压缩窗口不要超过模型实际上下文窗口——超配会在触发压缩前直接撞
              模型硬限报错（引擎原生行为，平台不拦截）。
            </p>
          </div>
        </details>
      )}

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
