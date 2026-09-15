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
// 组件自治约定（constraints）：CtxUsageRing 只收 props；QuotaPill 自治查询
// （供应商列表 + 各额度接口，见下方 quick-e4d0551f 注释），都不做 usage 组装
// （SSE ctx_tokens 实时值 + runsMeta 历史回填由父层组装 usedTokens 后传入——
// 2026-08-27-session-token-usage-fix task-08 起为逆序最新非 null ctxTokens，
// 不再求和 inputTokens）；页面组装归 task-10。
//
// ql-20260831-002：分母解析链加第 0 级「会话级覆盖」（AgentSession.ctx_window_
// tokens，环浮层可编辑，onWindowOverrideChange 存在即渲染编辑器）+ 末级兜底
// 1M（原 null「无分母」态废除——本地模型/本机默认读不到窗口大小，不为空）。
//
// 2026-09-14-session-ctx-compact task-06（FR-06 / FR-07 / D-002@v1 / D-004@v1）：
// 环浮层加「压缩上下文」按钮行（编辑器行后）——onCompact 提供且 provider 具备
// compact 能力（caps 门控同源下方 ctxSupported）才渲染；通知分型/请求发送归
// 父层（session-panel-page handleSessionCompact），本组件只上抛回调。

import { Popover, InputNumber, Button } from "antd";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";

import {
  detectUsageProvider,
  getProviderQuota,
  listProviders,
  queryUsage,
  type LlmProviderRead,
  type LlmProviderRoleMapping,
  type UsageData,
} from "@/lib/api/llm-providers";
import { getProviderCaps } from "@/lib/provider-caps";
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
  /**
   * 会话引擎名（INTERACTIVE_PROVIDERS 键）。两级消费（caps 同源
   * getProviderCaps，task-01 产物）：
   *   - CtxUsageBar 组装层：ctx_usage=false 不渲染环（2026-09-13-ctx-usage-
   *     all-providers task-07 / FR-06，null/未传旁路门控照常渲染）；
   *   - 环浮层压缩按钮：provider 明确且 compact=false（cursor / 未知引擎回退
   *     全 false）不渲染按钮——与 ctx_usage 门控不同，压缩按钮无降级态可兜底，
   *     一律默认拒绝（D-002@v1），null/未传也不渲染（本机默认供应商引擎未知）。
   */
  provider?: string | null;
  /**
   * 压缩回调（2026-09-14-session-ctx-compact task-06 / FR-06）：提供且 provider
   * 具备 compact 能力才在浮层渲染「压缩上下文」按钮；预会话态（无 sessionId）
   * 父层不传即不渲染。请求发送与三分型通知归父层，本组件只上抛。
   */
  onCompact?: () => void;
  /** true = 轮运行中禁用压缩（父层 running 派生，避免与进行中轮并发）。 */
  compactDisabled?: boolean;
  /** true = 压缩请求在途（父层 async 态），按钮显示「压缩中…」+禁用+loading 图标。 */
  compactLoading?: boolean;
  /** 禁用态悬浮说明文案；缺省「轮运行中，暂不能压缩」。 */
  compactTooltip?: string;
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
  provider,
  onCompact,
  compactDisabled,
  compactLoading,
  compactTooltip,
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

  // task-06（FR-06 / D-002@v1）：压缩按钮门控——onCompact 提供且 provider 明确
  // 具备 compact 能力（claude/pi/codex）才渲染；cursor / 未知引擎 / null（本机
  // 默认，引擎未知）默认拒绝（与下方 ctxSupported 的 null 旁路不同——压缩无
  // 降级态可兜底，点了必失败不如不渲染）。
  const compactSupported =
    onCompact != null && provider != null && getProviderCaps(provider).compact;

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
        {compactSupported && onCompact ? (
          <div className="flex items-center justify-between gap-2">
            <span className="shrink-0">上下文压缩</span>
            <Button
              size="small"
              data-testid="ctx-compact-btn"
              disabled={compactDisabled || compactLoading === true}
              loading={compactLoading === true}
              title={
                compactLoading === true
                  ? "压缩请求已发送，等待引擎完成（最长约 15 秒）"
                  : compactDisabled
                    ? (compactTooltip ?? "轮运行中，暂不能压缩")
                    : undefined
              }
              onClick={onCompact}
            >
              {compactLoading === true ? "压缩中…" : "压缩上下文"}
            </Button>
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

// ── QuotaPill：供应商额度聚合胶囊（D-009@v1，弱依赖 R-05）──────────────────
//
// quick-e4d0551f（2026-09-15 用户要求）：范围从「仅当前会话供应商、实际仅 GLM
// 有数据」扩为「全部可查用量供应商聚合 + 30 秒定时刷新」。
//   - 可查判定：detectUsageProvider(base_url) 非空（Kimi / 智谱 / MiniMax =
//     token_plan 百分比；DeepSeek / 硅基 / OpenRouter = balance 金额）。
//   - 数据链：智谱（bigmodel.cn / api.z.ai）走 quota 端点（5 小时窗 / 周限额，
//     弱依赖永不 5xx）；其余可查供应商走 usage 端点（两态错误模型，瞬时失败
//     抛 ApiError → keep-last-good 保留上次数据，鉴权失效 is_valid=false 为
//     确定性失败 → 清除该家条目，不留陈旧假数据）。
//   - 刷新：挂载 / 供应商列表变化立即查一次 + setInterval 轮询 + 悬浮立即刷新
//     （quick-e4d0551f 首版 30s 固定轮询；quick-7fd9ce7f 用户二次反馈改默认
//     5 分钟，胶囊上悬浮满 2 秒再立刻刷一次——低频轮询下主动查看拿新数据，
//     mouseLeave 即取消，单次悬浮最多触发一次，refresh 自带 in-flight 防重入）。
//   - providerId 语义变更：从「门控渲染（null 不渲染）」弱化为「展示排序优先
//     提示」，本机默认会话也照常聚合展示全部可查供应商额度。

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

/** 额度自动刷新间隔（quick-7fd9ce7f 用户二次反馈：默认 5 分钟；导出供单测）。 */
export const QUOTA_REFRESH_INTERVAL_MS = 5 * 60_000;

/** 悬浮立即刷新延时（悬浮满 2 秒触发一次；导出供单测驱动 fake timers）。 */
export const QUOTA_HOVER_REFRESH_DELAY_MS = 2_000;

/** 统一额度窗口视图（quota 窗口 / usage tier 归一后的渲染形态）。 */
export interface QuotaTierView {
  /** 窗口 / tier 名（如「Max·5小时窗」「CNY」）。 */
  label: string;
  /** 剩余百分比 0-100（balance 金额类为 null）。 */
  leftPct: number | null;
  /** 余额金额（balance 类；百分比类为 null）。 */
  balance: { remaining: number; total: number | null; unit: string | null } | null;
  /** 重置时间 ISO8601（上游缺失 null）。 */
  reset: string | null;
}

/** 单家供应商的聚合额度条目。 */
export interface ProviderQuotaEntry {
  providerId: string;
  providerName: string;
  model: string | null;
  tiers: QuotaTierView[];
}

/** 鉴权失效标记（usage 两态之确定性失败，refresh 据此清除该家条目）。 */
class QuotaAuthInvalidError extends Error {}

/** 智谱判定（镜像后端 quota 路由 GLM 分支：bigmodel.cn / api.z.ai）。 */
function isZhipuBaseUrl(baseUrl: string | null | undefined): boolean {
  const u = (baseUrl ?? "").toLowerCase();
  return u.includes("bigmodel.cn") || u.includes("api.z.ai");
}

/** usage tier → 统一视图（token_plan → 百分比；balance → 金额；纯函数便单测）。 */
export function mapUsageTiersToViews(tiers: UsageData[]): QuotaTierView[] {
  return tiers.map((t) => {
    const isPct = t.unit === "%";
    return {
      label: t.plan_name ?? (isPct ? "套餐额度" : "余额"),
      leftPct: isPct ? (t.remaining ?? null) : null,
      balance: isPct
        ? null
        : {
            remaining: t.remaining ?? 0,
            total: t.total ?? null,
            unit: t.unit ?? null,
          },
      reset: t.extra ?? null,
    };
  });
}

/** 金额格式化：unit=CNY→¥ / USD→$ / 其它→「值 单位」（对齐 usage-footer 口径）。 */
function formatQuotaBalance(
  b: { remaining: number; total: number | null; unit: string | null } | null,
): string {
  if (!b) return "—";
  const n = (v: number) =>
    Number.isInteger(v) ? String(v) : String(Math.round(v * 100) / 100);
  const sym = b.unit === "CNY" ? "¥" : b.unit === "USD" ? "$" : "";
  const tail = b.unit && !sym ? ` ${b.unit}` : "";
  if (b.total == null) return `${sym}${n(b.remaining)}${tail}`;
  return `${sym}${n(b.remaining)}${tail} / 共 ${sym}${n(b.total)}${tail}`;
}

/**
 * 查单家供应商额度：智谱 → quota 端点；其余可查 → usage 端点。
 * 返回 null = 本次未取到数据（弱依赖降级 / 暂不支持）；抛 QuotaAuthInvalidError =
 * 鉴权失效（确定性，清除条目）；抛其它错 = 瞬时失败（保留上次数据）。
 */
async function fetchProviderEntry(
  p: LlmProviderRead,
): Promise<ProviderQuotaEntry | null> {
  if (isZhipuBaseUrl(p.base_url)) {
    const { quota } = await getProviderQuota(p.id);
    if (!quota) return null;
    return {
      providerId: p.id,
      providerName: p.name,
      model: quota.model,
      tiers: (quota.windows ?? []).map((w) => ({
        label: w.label ?? "窗口",
        leftPct: w.left,
        balance: null,
        reset: w.reset,
      })),
    };
  }
  const result = await queryUsage(p.id);
  if (!result.success) {
    if ((result.data ?? []).some((d) => d.is_valid === false)) {
      throw new QuotaAuthInvalidError("鉴权失效");
    }
    return null;
  }
  return {
    providerId: p.id,
    providerName: p.name,
    model: p.model ?? null,
    tiers: mapUsageTiersToViews(result.data ?? []),
  };
}

export interface QuotaPillProps {
  /**
   * 当前会话供应商 id（quick-e4d0551f 起仅作展示排序优先提示，不再门控渲染；
   * null/undefined=本机默认 → 胶囊照常聚合展示全部可查供应商额度）。
   */
  providerId: string | null | undefined;
  /**
   * ql-20260915-013 手机端一行化：compact 只显剩余百分比数字（模型名/「X 剩」
   * 标签/重置时间/「等 N 家」全收进点击浮层——浮层本来就是权威明细入口），
   * 防 verbose 胶囊占满手机配置行；desktop 缺省零变化。
   */
  mobile?: boolean;
}

export function QuotaPill({ providerId, mobile = false }: QuotaPillProps) {
  // 全量供应商列表：聚合展示的基础（列表查询轻，5 分钟慢刷新兜新增供应商）。
  const providersQ = useQuery({
    queryKey: ["llmProviders", "quota-pill"],
    queryFn: listProviders,
    staleTime: 5 * 60_000,
    refetchInterval: 5 * 60_000,
  });
  // 可查用量供应商（detectUsageProvider 非空才发查询，同 UsageFooter 预判，
  // 省得对不可查供应商白跑一趟——后端也会兜底 success=false）。data 未就绪时
  // 兜底空数组须内联进 useMemo，避免每次渲染生成新引用破坏 memo（eslint 506）。
  const detectable = useMemo(
    () =>
      (providersQ.data ?? []).filter(
        (p) => detectUsageProvider(p.base_url) != null,
      ),
    [providersQ.data],
  );

  // 每供应商最近成功条目：瞬时失败 / 弱依赖降级保留上次数据（keep-last-good，
  // 轮询时上游一抖不清空面板）；鉴权失效清除；供应商被删 / 不可查则丢陈旧条目。
  const [entries, setEntries] = useState<ReadonlyMap<string, ProviderQuotaEntry>>(
    new Map(),
  );
  const cancelledRef = useRef(false);
  const inflightRef = useRef(false);

  const refresh = useCallback(async () => {
    if (detectable.length === 0 || inflightRef.current) return;
    inflightRef.current = true;
    try {
      const results = await Promise.allSettled(detectable.map(fetchProviderEntry));
      if (cancelledRef.current) return;
      setEntries((prev) => {
        const alive = new Set(detectable.map((p) => p.id));
        const next = new Map<string, ProviderQuotaEntry>();
        for (const [id, entry] of prev) {
          if (alive.has(id)) next.set(id, entry);
        }
        detectable.forEach((p, i) => {
          const r = results[i]!;
          if (r.status === "fulfilled" && r.value) {
            next.set(p.id, r.value);
          } else if (r.status === "rejected" && r.reason instanceof QuotaAuthInvalidError) {
            next.delete(p.id);
          }
          // 其余 rejected（瞬时失败）与 fulfilled null（弱依赖降级）→ 保留 prev。
        });
        return next;
      });
    } finally {
      inflightRef.current = false;
    }
  }, [detectable]);

  // 挂载 / 可查列表变化立即查一次 + 定时轮询（默认 5 分钟）；卸载清理
  // （cancelled 防异步回写）。
  useEffect(() => {
    cancelledRef.current = false;
    void refresh();
    const timer = setInterval(() => void refresh(), QUOTA_REFRESH_INTERVAL_MS);
    return () => {
      cancelledRef.current = true;
      clearInterval(timer);
    };
  }, [refresh]);

  // 悬浮满 2 秒立即刷新（quick-7fd9ce7f）：onMouseEnter 起延时器，2 秒仍在
  // 胶囊上 → 立刻 refresh 一次（in-flight 防重入，悬浮再久也不重复触发）；
  // mouseLeave 即取消；卸载兜底清理。
  const hoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearHoverTimer = useCallback(() => {
    if (hoverTimerRef.current != null) {
      clearTimeout(hoverTimerRef.current);
      hoverTimerRef.current = null;
    }
  }, []);
  const handlePillMouseEnter = useCallback(() => {
    clearHoverTimer();
    hoverTimerRef.current = setTimeout(() => {
      hoverTimerRef.current = null;
      void refresh();
    }, QUOTA_HOVER_REFRESH_DELAY_MS);
  }, [clearHoverTimer, refresh]);
  useEffect(() => () => clearHoverTimer(), [clearHoverTimer]);

  // 展示排序：当前会话供应商优先，其余按名称稳定序。
  const sortedEntries = useMemo(() => {
    const list = [...entries.values()];
    list.sort((a, b) => {
      if (a.providerId === providerId) return -1;
      if (b.providerId === providerId) return 1;
      return a.providerName.localeCompare(b.providerName, "zh-CN");
    });
    return list;
  }, [entries, providerId]);

  // 列表加载中 / 拉取失败 → 静默不渲染（弱依赖 R-05，不闪错误态）。
  if (providersQ.isPending || providersQ.isError) return null;
  // 没有任何可查用量供应商 → 无信息可展示。
  if (detectable.length === 0) return null;

  if (sortedEntries.length === 0) {
    // 有可查供应商但暂时一家都没取到数据 → 灰字提示（胶囊本体不渲染）。
    return (
      <span
        data-testid="quota-empty-hint"
        className="shrink-0 text-[10.5px] text-muted-foreground"
      >
        暂无供应商额度信息
      </span>
    );
  }

  const face = sortedEntries[0]!;
  const restCount = sortedEntries.length - 1;
  const faceReset = face.tiers.find((t) => t.reset)?.reset;
  // 胶囊单行只带百分比窗口（同旧口径）；余额类 supplier 的明细见浮层。
  const facePctTiers = face.tiers.filter((t) => t.leftPct != null);

  const detail = (
    <div style={{ width: 264 }}>
      <div className="text-xs font-medium text-foreground">模型剩余额度</div>
      <div className="mt-1.5 flex flex-col gap-2 text-xs text-muted-foreground">
        {sortedEntries.map((e) => (
          <div key={e.providerId}>
            <div className="font-medium text-foreground">
              {e.providerName}
              {e.model ? (
                <span className="text-muted-foreground"> · {e.model}</span>
              ) : null}
            </div>
            <div className="mt-0.5 flex flex-col gap-1">
              {e.tiers.map((t, i) => (
                <div key={i}>
                  <div className="flex items-center justify-between">
                    <span>{t.label} 剩余</span>
                    <b
                      className={`font-semibold ${
                        t.leftPct == null ? "" : quotaLeftToneClass(t.leftPct)
                      }`}
                    >
                      {t.leftPct != null
                        ? `${t.leftPct}%`
                        : formatQuotaBalance(t.balance)}
                    </b>
                  </div>
                  {t.reset ? (
                    <div className="text-[11px] text-muted-foreground">
                      {formatQuotaResetTime(t.reset)} 重置
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          </div>
        ))}
        <div className="mt-1 text-[11px] leading-4 text-muted-foreground">
          数据来自各供应商额度接口，每 5 分钟自动刷新；胶囊上悬浮 2 秒立即刷新。
        </div>
      </div>
    </div>
  );

  return (
    <Popover trigger="click" content={detail} placement="topLeft">
      <span
        data-testid="quota-pill"
        className="inline-flex shrink-0 cursor-pointer select-none items-center gap-[5px] whitespace-nowrap rounded-full bg-muted px-2.5 py-[3px] text-[11px] text-muted-foreground hover:text-foreground"
        onMouseEnter={handlePillMouseEnter}
        onMouseLeave={clearHoverTimer}
      >
        {mobile ? (
          // compact：仅百分比（多窗斜杠分隔），明细点击浮层看。
          facePctTiers.map((t, i) => (
            <span key={i} className={quotaLeftToneClass(t.leftPct!)}>
              {i > 0 ? "/" : ""}
              {t.leftPct}%
            </span>
          ))
        ) : (
          <>
            {face.model ? (
              <b className="font-semibold text-foreground">{face.model}</b>
            ) : (
              <b className="font-semibold text-foreground">{face.providerName}</b>
            )}
            {facePctTiers.map((t, i) => (
              <span key={i}>
                · {t.label}剩{" "}
                <span className={quotaLeftToneClass(t.leftPct!)}>{t.leftPct}%</span>
              </span>
            ))}
            {faceReset ? (
              <span className="text-[10px] text-muted-foreground">
                ⏱ {formatQuotaResetTime(faceReset)} 重置
              </span>
            ) : null}
            {restCount > 0 ? (
              <span className="text-[10px] text-muted-foreground">
                等{restCount}家
              </span>
            ) : null}
          </>
        )}
      </span>
    </Popover>
  );
}

// ── CtxUsageBar：组装（ql-20260909-006：自输入框上方独占行收进配置条行最右侧
// trailing 插槽——圆环+额度胶囊与会话配置行语义同属状态信息，独占行突兀）────

export interface CtxUsageBarProps extends CtxUsageRingProps {
  /**
   * 当前会话供应商 id（传 QuotaPill 作展示排序优先提示；null=本机默认，
   * 胶囊照常聚合展示全部可查供应商额度——quick-e4d0551f 语义变更）。
   */
  providerId?: string | null;
  /** ql-20260915-013：mobile 紧凑形态——额度胶囊只显百分比（明细点击浮层）。 */
  mobile?: boolean;
}

export function CtxUsageBar({
  providerId,
  mobile = false,
  ...ringProps
}: CtxUsageBarProps) {
  // FR-06 caps 门控：provider 明确且 getProviderCaps(provider).ctx_usage=false
  // （未知引擎名命中回退 false）→ 只渲染 QuotaPill 不渲染 CtxUsageRing；
  // null/未传旁路门控照常渲染环（不因门控丢现有功能，环仍有未知态「—」兜底）。
  // providerId 语义与 QuotaPill 行为不动（额度查询照旧）。
  // 2026-09-14-session-ctx-compact task-06：provider 经 ...ringProps 透传给环
  // （压缩按钮 caps 门控消费，见 CtxUsageRingProps.provider 注释）。
  const ctxSupported =
    ringProps.provider == null || getProviderCaps(ringProps.provider).ctx_usage;
  return (
    <div className="flex items-center gap-2.5">
      {ctxSupported ? <CtxUsageRing {...ringProps} /> : null}
      <QuotaPill providerId={providerId} mobile={mobile} />
    </div>
  );
}
