"use client";

// task-15（2026-08-14-sessions-portal / FR-08 / D-009@v1 / D-014@v1）：
// 输入框上方一行组件 = CtxUsageRing（上下文用量环）+ QuotaPill（供应商额度胶囊）。
//
// 依据：
//   - tasks/task-15.md（allowed_paths 本文件 + __tests__/ctx-usage-bar.test.tsx + lib/api/llm-providers.ts）
//   - design.md §2 FR-08、§5 Wave3 CtxUsageBar 段、§7.1、D-009/D-014、R-05/R-06
//   - plan.md 附录 spike-01：1M 标记在 LlmProvider.model_role_mappings.<role>.one_m（boolean）
//   - prototype-sessions-portal.html（.ctx-bar/.ctx-ring/.quota-pill 视觉基准）
//   - FRONTEND_PAGE_STYLE.md §10/§11（颜色走 tailwind 语义 token，不硬编码 hex）
//
// 组件自治约定（constraints）：本组件只收 props / 只调额度接口，不做 usage 组装
// （SSE ctx_tokens 实时值 + runsMeta 历史回填由父层组装 usedTokens 后传入——
// 2026-08-27-session-token-usage-fix task-08 起为逆序最新非 null ctxTokens，
// 不再求和 inputTokens）；页面组装归 task-10。
//
// ql-20260831-002：分母解析链加第 0 级「会话级覆盖」（AgentSession.ctx_window_
// tokens，环浮层可编辑，onWindowOverrideChange 存在即渲染编辑器）+ 末级兜底
// 1M（原 null「无分母」态废除——本地模型/本机默认读不到窗口大小，不为空）。

import { Popover, InputNumber, Button } from "antd";
import { useEffect, useState } from "react";

import {
  getProviderQuota,
  type LlmProviderQuotaData,
  type LlmProviderRoleMapping,
} from "@/lib/api/llm-providers";
import { formatTokenCount } from "@/lib/format-token";

// ── 分母解析链（D-014@v1 / spike-01 + ql-20260831-002 覆盖层）──────────────

/** 供应商 role mapping 勾选 1M（one_m=true，injector 模型名后缀 [1m]）→ 1000k。 */
export const ONE_M_CTX_WINDOW_TOKENS = 1_000_000;

/** 模型默认常量表兜底（design FR-08：未派生时一律 200k）。 */
export const DEFAULT_CTX_WINDOW_TOKENS = 200_000;

/**
 * 无任何派生来源时的兜底分母（ql-20260831-002）：本地模型/本机默认（未绑
 * 平台供应商）拿不到 provider 记录、本地端点协议也不暴露窗口大小，读不到
 * 不允许为空——兜底 1M，且会话页环浮层可显式覆盖。
 */
export const FALLBACK_CTX_WINDOW_TOKENS = 1_000_000;

/**
 * 模型 → 上下文窗口常量表（子串匹配，键小写）。
 * 一期仅按 design 给出的统一默认 200k；后续模型分化时在此补具体条目，
 * 命中与否最终都被 DEFAULT_CTX_WINDOW_TOKENS 兜底。
 */
export const MODEL_CTX_WINDOW_TABLE: Readonly<Record<string, number>> = {
  "glm-4": DEFAULT_CTX_WINDOW_TOKENS,
  claude: DEFAULT_CTX_WINDOW_TOKENS,
};

/**
 * 解析上下文窗口分母（ql-20260831-002 四级链）：
 *   0. 会话级用户覆盖（ctx_window_tokens，环浮层可编辑）→ 用户显式指定最优先；
 *   1. 供应商当前 role 的 one_m=true → 1000k（供应商配置派生）；
 *   2. 有模型名（role mapping.model → fallbackModel）→ 常量表（命中取表值，
 *      默认 200k）；
 *   3. 无任何派生来源 → 兜底 1M（不再返回 null——本地模型读不到窗口大小，
 *      显示"—"无信息量，用户要求默认 1M 且可改）。
 */
export function resolveCtxWindowTokens(
  windowOverride: number | null | undefined,
  roleMapping: LlmProviderRoleMapping | null | undefined,
  fallbackModel: string | null | undefined,
): number {
  if (typeof windowOverride === "number" && Number.isFinite(windowOverride) && windowOverride > 0) {
    return windowOverride;
  }
  if (roleMapping?.one_m === true) return ONE_M_CTX_WINDOW_TOKENS;
  const model =
    roleMapping?.model?.trim() || fallbackModel?.trim() || "";
  if (!model) return FALLBACK_CTX_WINDOW_TOKENS;
  const key = model.toLowerCase();
  for (const [pattern, tokens] of Object.entries(MODEL_CTX_WINDOW_TABLE)) {
    if (key.includes(pattern)) return tokens;
  }
  return DEFAULT_CTX_WINDOW_TOKENS;
}

// ── 阈值（FR-08：50% 黄 / 80% 红）────────────────────────────────────────

export const CTX_WARN_THRESHOLD_PCT = 50;
export const CTX_CRIT_THRESHOLD_PCT = 80;

function ctxToneClass(pct: number): string {
  if (pct >= CTX_CRIT_THRESHOLD_PCT) return "text-error";
  if (pct >= CTX_WARN_THRESHOLD_PCT) return "text-warning";
  return "text-primary";
}

// ── CtxUsageRing：上下文用量环形进度 ─────────────────────────────────────

export interface CtxUsageRingProps {
  /**
   * 环分子：最近一次模型调用的提示词大小（ctx_tokens = input+cache_read+
   * cache_creation，父层按 displayTurns 逆序取最新非 null 值传入）。
   * null = 未知（历史会话 / 旧 daemon 不上报 ctx），渲染未知态「—」不算百分比
   * （2026-08-27-session-token-usage-fix task-08 / FR-01 / D-003）。
   */
  usedTokens: number | null;
  /** 会话供应商当前 role 的映射（含 model / one_m；本机默认供应商传 null）。 */
  roleMapping?: LlmProviderRoleMapping | null;
  /** 供应商 default_fallback_model（role mapping 无 model 时的二级模型来源）。 */
  fallbackModel?: string | null;
  /**
   * 会话级窗口分母覆盖（ql-20260831-002，AgentSession.ctx_window_tokens）。
   * null/undefined = 未覆盖（走 one_m → 常量表 → 1M 兜底自动链）。
   */
  windowOverride?: number | null;
  /**
   * 覆盖变更回调（ql-20260831-002）：提供即在浮层渲染编辑控件；不提供只读。
   * 入参 null = 清除覆盖回自动链（「恢复默认」）。
   */
  onWindowOverrideChange?: (tokens: number | null) => void;
}

/**
 * 浮层内窗口总量编辑器（ql-20260831-002）：InputNumber + 保存 + 恢复默认。
 * 受控展示派生值（override ?? 自动链结果），保存时上抛显式值或 null。
 */
function CtxWindowEditor({
  override,
  derived,
  onChange,
}: {
  override: number | null;
  derived: number;
  onChange: (tokens: number | null) => void;
}) {
  const [draft, setDraft] = useState<number | null>(override ?? derived);

  // override/derived 外部变化（会话切换/保存成功）同步草稿；本地编辑中不覆盖。
  useEffect(() => {
    setDraft(override ?? derived);
  }, [override, derived]);

  const dirty = draft !== (override ?? derived);

  return (
    <div className="flex items-center gap-1.5" data-testid="ctx-window-editor">
      <InputNumber
        size="small"
        min={1_000}
        max={100_000_000}
        step={10_000}
        value={draft}
        onChange={(v) => setDraft(typeof v === "number" ? v : null)}
        className="w-28"
        aria-label="上下文窗口总量"
      />
      <Button
        size="small"
        type="primary"
        disabled={!dirty || draft == null}
        onClick={() => onChange(draft)}
        data-testid="ctx-window-save"
      >
        保存
      </Button>
      {override != null ? (
        <Button
          size="small"
          onClick={() => onChange(null)}
          data-testid="ctx-window-reset"
        >
          恢复默认
        </Button>
      ) : null}
    </div>
  );
}

/** 原型 .ctx-ring：28px 环、r=10、stroke 3、rotate(-90deg) 从顶部起量。 */
export function CtxUsageRing({
  usedTokens,
  roleMapping,
  fallbackModel,
  windowOverride,
  onWindowOverrideChange,
}: CtxUsageRingProps) {
  const windowTokens = resolveCtxWindowTokens(
    windowOverride,
    roleMapping,
    fallbackModel,
  );
  // task-08（FR-01 / D-003）：分子未知（null，历史会话 / 旧 daemon）→ pct=null，
  // 不算百分比（不再显示 0.0%）；已知且有分母才计算占比。
  const pct =
    usedTokens != null && windowTokens > 0
      ? Math.min(100, (usedTokens / windowTokens) * 100)
      : null;
  const tone = pct == null ? "text-muted-foreground" : ctxToneClass(pct);

  const R = 10;
  const C = 2 * Math.PI * R;
  const dash = pct == null ? 0 : (pct / 100) * C;

  const content = (
    <div style={{ width: 264 }}>
      <div className="text-xs font-medium text-foreground">上下文窗口用量</div>
      <div className="mt-1.5 flex flex-col gap-1 text-xs text-muted-foreground">
        <div className="flex items-center justify-between">
          <span>用量占比</span>
          <b className={`font-semibold ${tone}`}>
            {pct == null ? "未知" : `${pct.toFixed(1)}%`}
          </b>
        </div>
        <div className="flex items-center justify-between">
          <span>已用 / 总量</span>
          <b className="font-semibold text-foreground">
            {/* 分子 null（未知态）formatTokenCount 输出「—」，与分母缺省口径一致。 */}
            {formatTokenCount(usedTokens)} / {formatTokenCount(windowTokens)}
            {windowOverride != null ? "（手动）" : ""}
          </b>
        </div>
        {onWindowOverrideChange ? (
          <div className="flex items-center justify-between gap-2">
            <span className="shrink-0">窗口总量</span>
            <CtxWindowEditor
              override={windowOverride ?? null}
              derived={windowTokens}
              onChange={onWindowOverrideChange}
            />
          </div>
        ) : null}
        <div className="mt-1 text-[11px] leading-4 text-muted-foreground">
          最近一次模型调用的提示词大小（含缓存命中部分）。窗口分母口径：会话手动
          指定 → 供应商 1M 勾选 → 模型默认常量 200k → 兜底 1M（本地模型读不到
          窗口大小时可在此手动指定）。
        </div>
      </div>
    </div>
  );

  return (
    <Popover trigger="click" content={content} placement="topLeft">
      <span
        data-testid="ctx-ring"
        title={
          usedTokens == null
            ? "上下文用量未知（暂无本次调用量数据）"
            : `上下文用量 ${Math.round(pct ?? 0)}%`
        }
        className={`relative inline-flex h-7 w-7 shrink-0 cursor-pointer select-none items-center justify-center ${tone}`}
        aria-label={
          usedTokens == null
            ? "上下文用量未知（暂无本次调用量数据）"
            : `上下文用量 ${Math.round(pct ?? 0)}%`
        }
      >
        <svg width="28" height="28" style={{ transform: "rotate(-90deg)" }}>
          <circle
            cx="14"
            cy="14"
            r={R}
            fill="none"
            strokeWidth="3"
            className="stroke-border"
          />
          <circle
            cx="14"
            cy="14"
            r={R}
            fill="none"
            strokeWidth="3"
            strokeLinecap="round"
            stroke="currentColor"
            strokeDasharray={`${dash.toFixed(2)} ${C.toFixed(2)}`}
          />
        </svg>
        <span
          className={`absolute inset-0 flex items-center justify-center font-bold ${
            pct == null ? "text-[7px]" : "text-[8.5px]"
          } ${tone}`}
        >
          {/* 未知态（usedTokens=null）中心显示「—」（formatTokenCount 口径）；
              已知按窗口占比显示（分母恒有值——兜底 1M，不再无分母）。 */}
          {pct == null ? formatTokenCount(usedTokens) : `${Math.round(pct)}%`}
        </span>
      </span>
    </Popover>
  );
}

// ── QuotaPill：供应商额度胶囊（D-009@v1，弱依赖 R-05）────────────────────

/** reset（ISO8601）→ 「MM-DD HH:mm」本地时间；无法解析原样返回（不编造）。 */
export function formatQuotaResetTime(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** 剩余百分比低量变色（design task-15：≤20% 红 / ≤50% 黄）。 */
function quotaLeftToneClass(left: number): string {
  if (left <= 20) return "text-error font-semibold";
  if (left <= 50) return "text-warning font-semibold";
  return "";
}

export interface QuotaPillProps {
  /** 当前会话供应商 id；null/undefined=本机默认 → 整体不渲染。 */
  providerId: string | null | undefined;
}

export function QuotaPill({ providerId }: QuotaPillProps) {
  // undefined=未取到（加载中/失败静默）；null=后端明确无额度；对象=有额度。
  const [quota, setQuota] = useState<LlmProviderQuotaData | null | undefined>(
    undefined,
  );

  useEffect(() => {
    if (!providerId) {
      setQuota(undefined);
      return;
    }
    let cancelled = false;
    // 低频调用：挂载 / 供应商变化时查一次，不加轮询（design §5 Wave3）；
    // 失败静默降级不渲染胶囊不报错（constraints / R-05）。
    getProviderQuota(providerId)
      .then((resp) => {
        if (!cancelled) setQuota(resp.quota ?? null);
      })
      .catch(() => {
        if (!cancelled) setQuota(null);
      });
    return () => {
      cancelled = true;
    };
  }, [providerId]);

  if (!providerId) return null;

  if (quota == null) {
    // 原型口径：供应商存在但无额度数据 → 灰字提示（胶囊本体不渲染）。
    return (
      <span
        data-testid="quota-empty-hint"
        className="shrink-0 text-[10.5px] text-muted-foreground"
      >
        该供应商未提供额度信息
      </span>
    );
  }

  const windows = quota.windows ?? [];
  const firstReset = windows.find((w) => w.reset)?.reset;

  const detail = (
    <div style={{ width: 240 }}>
      <div className="text-xs font-medium text-foreground">
        模型剩余额度{quota.model ? ` · ${quota.model}` : ""}
      </div>
      <div className="mt-1.5 flex flex-col gap-1 text-xs text-muted-foreground">
        {windows.map((w, i) => (
          <div key={i}>
            <div className="flex items-center justify-between">
              <span>{w.label ?? "窗口"} 剩余</span>
              <b
                className={`font-semibold ${
                  w.left == null ? "" : quotaLeftToneClass(w.left)
                }`}
              >
                {w.left == null ? "—" : `${w.left}%`}
              </b>
            </div>
            {w.reset ? (
              <div className="text-[11px] text-muted-foreground">
                {formatQuotaResetTime(w.reset)} 重置
              </div>
            ) : null}
          </div>
        ))}
        <div className="mt-1 text-[11px] leading-4 text-muted-foreground">
          数据来自当前供应商额度接口（一期仅 GLM：5 小时窗 / 周限额）。
        </div>
      </div>
    </div>
  );

  return (
    <Popover trigger="click" content={detail} placement="topLeft">
      <span
        data-testid="quota-pill"
        className="inline-flex shrink-0 cursor-pointer select-none items-center gap-[5px] whitespace-nowrap rounded-full bg-muted px-2.5 py-[3px] text-[11px] text-muted-foreground hover:text-foreground"
      >
        {quota.model ? (
          <b className="font-semibold text-foreground">{quota.model}</b>
        ) : null}
        {windows.map((w, i) =>
          w.left == null ? null : (
            <span key={i}>
              · {w.label ?? "窗口"}剩{" "}
              <span className={quotaLeftToneClass(w.left)}>{w.left}%</span>
            </span>
          ),
        )}
        {firstReset ? (
          <span className="text-[10px] text-muted-foreground">
            ⏱ {formatQuotaResetTime(firstReset)} 重置
          </span>
        ) : null}
      </span>
    </Popover>
  );
}

// ── CtxUsageBar：组装（输入框上方一行，原型 .ctx-bar）────────────────────

export interface CtxUsageBarProps extends CtxUsageRingProps {
  /** 传给 QuotaPill 的当前供应商 id（null=本机默认，胶囊不渲染）。 */
  providerId?: string | null;
}

export function CtxUsageBar({
  providerId,
  ...ringProps
}: CtxUsageBarProps) {
  return (
    <div className="mb-1.5 flex min-h-7 items-center gap-2.5">
      <CtxUsageRing {...ringProps} />
      <QuotaPill providerId={providerId} />
    </div>
  );
}
