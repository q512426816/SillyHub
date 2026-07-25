"use client";

import { useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import {
  type LlmProviderAuthField,
  type LlmProviderAgentKind,
  type LlmProviderFormValues,
  type LlmProviderRead,
  type LlmProviderRoleMapping,
} from "@/lib/api/llm-providers";

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
  const [defaultFallbackModel, setDefaultFallbackModel] = useState(
    initial?.default_fallback_model ?? "",
  );
  const [isDefault, setIsDefault] = useState<boolean>(
    isEdit ? initial?.is_default === true : false,
  );
  const [roleRows, setRoleRows] = useState<Record<string, RoleRowState>>(() =>
    initRoleRows(initial),
  );
  const [envRows, setEnvRows] = useState<EnvRowState[]>(() =>
    initEnvRows(initial),
  );

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
    const values: LlmProviderFormValues = {
      name,
      agent_kind: agentKind,
      base_url: baseUrl,
      api_key: apiKey,
      auth_field: authField,
      notes,
      website_url: websiteUrl,
      model_role_mappings: mapping,
      default_fallback_model: defaultFallbackModel,
      extra_env: extraEnv,
      is_default: isDefault,
    };
    void onSubmit(values);
  };

  // 新建：必须填名称 + api_key；编辑：必须填名称，api_key 可空（保持原密钥）。
  const nameMissing = name.trim() === "";
  const apiKeyMissing = !isEdit && apiKey.trim() === "";
  const submitDisabled = submitting || nameMissing || apiKeyMissing;

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
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
        <label className={lblCls}>
          请求地址 base_url <span className="text-destructive">*</span>
        </label>
        <input
          value={baseUrl}
          onChange={(e) => setBaseUrl(e.target.value)}
          className={`mt-0.5 ${inputCls}`}
          placeholder="https://api.anthropic.com（官方）或中转站完整地址，不要以斜杠结尾"
        />
        <p className={hintCls}>
          兼容 Claude API 的服务端点。官方填 <code className="text-xs">https://api.anthropic.com</code>；中转站填中转地址。
        </p>
      </div>

      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={isDefault}
          onChange={(e) => setIsDefault(e.target.checked)}
          className="h-3.5 w-3.5 rounded border border-input"
        />
        <span className="text-xs">设为默认供应商（同 agent 种类仅一个默认）</span>
      </label>

      <details className="rounded border border-dashed border-input/70 p-3">
        <summary className="cursor-pointer text-xs font-medium text-muted-foreground">
          高级选项（模型映射 / 认证字段 / 自定义环境变量）
        </summary>

        <div className="mt-3 space-y-3">
          <div>
            <label className={lblCls}>认证字段</label>
            <select
              value={authField}
              onChange={(e) =>
                setAuthField(e.target.value as LlmProviderAuthField)
              }
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
                          <input
                            value={s.model}
                            onChange={(e) =>
                              setRole(r.key, { model: e.target.value })
                            }
                            className="h-7 w-full rounded border border-input bg-background px-1.5 text-xs focus:border-ring focus:outline-none"
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
              onChange={(e) => setDefaultFallbackModel(e.target.value)}
              className={`mt-0.5 ${inputCls}`}
              placeholder="如 kimi-k2（未映射的角色都走这个模型）"
            />
            <p className={hintCls}>
              用中转站时建议填写：未明确映射的请求（含 Haiku 后台子任务）会以这个模型名发给上游，避免透传原始 Claude 模型名报错。
            </p>
          </div>

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
