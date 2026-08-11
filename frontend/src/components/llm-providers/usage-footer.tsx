"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AlertCircle, Loader2, RefreshCw } from "lucide-react";

import {
  detectUsageProvider,
  queryUsage,
  type UsageData,
} from "@/lib/api/llm-providers";
import { errMessage } from "@/lib/errors";
import { cn } from "@/lib/utils";

/**
 * 供应商用量页脚（task-08 / D-002/D-005）。
 *
 * 挂在列表每行底部：支持余额/套餐查询的供应商展示多 tier 进度条（balance=金额 /
 * token_plan=百分比），并实现 keep-last-good——上游瞬时失败（网络/5xx/429/超时）时
 * 保留**上次成功值 10 分钟**（移植 cc-switch `resolveDisplayUsage`，queries.ts）。
 *
 * 两态错误模型（D-005，后端已分流，前端按 HTTP 状态判）：
 * - 200 success=true → 渲染 tiers（balance 绝对额 / token_plan 百分比）；
 * - 200 success=false + data[is_valid=false] → **翻红**（鉴权失效）；
 * - 200 success=false + error → 灰提示（暂不支持 / SSRF / 解析错 / HTTP）；
 * - 5xx / 网络错 / 超时 → apiFetch 抛 ApiError → 瞬时分支（保留上次值，超窗则报错）。
 *
 * 客户端 `detectUsageProvider(base_url)` 先判是否可查：null → 静态「暂不支持」不发请求
 * （与后端 detect=None 同义，省一次往返），可查才挂载查询 + 手动刷新。
 */

/** keep-last-good 窗口（对齐 cc-switch KEEP_LAST_GOOD_MS = 10min）。 */
const KEEP_LAST_GOOD_MS = 10 * 60 * 1000;

/** footer 渲染状态机（loading / ok（含 stale 缓存标记）/ invalid 翻红 / unsupported / error）。 */
type UsageView =
  | { kind: "loading" }
  | { kind: "ok"; tiers: UsageData[]; stale?: boolean }
  | { kind: "invalid"; message: string }
  | { kind: "unsupported"; message: string }
  | { kind: "error"; message: string };

export interface UsageFooterProps {
  providerId: string;
  baseUrl: string | null;
}

export function UsageFooter({ providerId, baseUrl }: UsageFooterProps) {
  // 客户端预判是否可查（null = 后端也会 detect=None，静态展示不发请求）。
  const detect = detectUsageProvider(baseUrl);

  const [view, setView] = useState<UsageView>(() =>
    detect
      ? { kind: "loading" }
      : { kind: "unsupported", message: "该供应商暂不支持余额查询" },
  );
  const [refreshing, setRefreshing] = useState(false);

  // keep-last-good：上次成功 tiers + 时间戳；瞬时失败时 10 分钟内复用（不入 state，避免重渲）。
  const lastGoodRef = useRef<{ tiers: UsageData[]; at: number } | null>(null);
  // 卸载 / id 切换守卫：异步回写前组件可能已卸载。
  const cancelledRef = useRef(false);

  const refresh = useCallback(async () => {
    if (!detect) return;
    setRefreshing(true);
    setView({ kind: "loading" });
    try {
      const result = await queryUsage(providerId);
      if (cancelledRef.current) return;
      if (result.success) {
        const tiers = result.data ?? [];
        lastGoodRef.current = { tiers, at: Date.now() };
        setView({ kind: "ok", tiers });
      } else {
        // 确定性失败 → 清空 last good（cc-switch 同义：不再复用旧值）。
        lastGoodRef.current = null;
        const inv = (result.data ?? []).find((d) => d.is_valid === false);
        if (inv) {
          setView({
            kind: "invalid",
            message: inv.invalid_message ?? "鉴权失败，请检查 API Key",
          });
        } else {
          setView({
            kind: "unsupported",
            message: result.error ?? "该供应商暂不支持余额查询",
          });
        }
      }
    } catch (err) {
      if (cancelledRef.current) return;
      // 瞬时失败（5xx / 429 / 网络 / 超时）→ keep-last-good 10 分钟窗口。
      const lg = lastGoodRef.current;
      if (lg && Date.now() - lg.at < KEEP_LAST_GOOD_MS) {
        setView({ kind: "ok", tiers: lg.tiers, stale: true });
      } else {
        setView({ kind: "error", message: errMessage(err, "查询失败，请稍后重试") });
      }
    } finally {
      if (!cancelledRef.current) setRefreshing(false);
    }
  }, [detect, providerId]);

  // 挂载即查（仅可查供应商）；卸载置 cancelled 防 stale setState。
  useEffect(() => {
    cancelledRef.current = false;
    if (detect) void refresh();
    return () => {
      cancelledRef.current = true;
    };
  }, [detect, refresh]);

  // ── 不可查：单行静态提示，无 header / 无刷新 ──────────────────────────
  if (!detect) {
    return (
      <div className="mt-1.5 text-[11px] text-muted-foreground/70">
        {view.kind === "unsupported" ? view.message : "该供应商暂不支持余额查询"}
      </div>
    );
  }

  return (
    <div className="mt-2 border-t border-dashed border-input/50 pt-1.5">
      <div className="flex items-center gap-1.5">
        <span className="text-[11px] font-medium text-muted-foreground">用量</span>
        <button
          type="button"
          onClick={() => void refresh()}
          disabled={refreshing}
          className="ml-auto inline-flex h-5 w-5 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50"
          title="刷新用量"
          aria-label="刷新用量"
        >
          <RefreshCw className={cn("h-3 w-3", refreshing && "animate-spin")} />
        </button>
      </div>

      <div className="mt-1 space-y-1.5">
        {view.kind === "loading" && (
          <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <Loader2 className="h-3 w-3 animate-spin" />
            查询用量中…
          </div>
        )}

        {view.kind === "ok" && (
          <>
            {view.stale && (
              <div className="text-[10px] text-amber-600">
                网络异常，暂用上次成功结果（10 分钟内有效）
              </div>
            )}
            {view.tiers.length === 0 ? (
              <div className="text-[11px] text-muted-foreground">暂无用量数据</div>
            ) : (
              view.tiers.map((t, idx) => (
                <TierRow key={idx} tier={t} />
              ))
            )}
          </>
        )}

        {view.kind === "invalid" && (
          <div className="flex items-center gap-1.5 text-[11px] text-destructive">
            <AlertCircle className="h-3 w-3 shrink-0" />
            {view.message}
          </div>
        )}

        {view.kind === "unsupported" && (
          <div className="text-[11px] text-muted-foreground">{view.message}</div>
        )}

        {view.kind === "error" && (
          <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <AlertCircle className="h-3 w-3 shrink-0" />
            {view.message}
          </div>
        )}
      </div>
    </div>
  );
}

/** 单 tier 进度条 + 数值（balance=金额 / token_plan=百分比）。 */
function TierRow({ tier }: { tier: UsageData }) {
  const isPct = tier.unit === "%";
  const total = tier.total ?? 0;
  const remaining = tier.remaining ?? 0;
  const used = tier.used ?? (total > 0 ? total - remaining : 0);
  // 剩余占比（0-100）：bar 宽度 + 配色都按它。
  const pct =
    total > 0 ? Math.max(0, Math.min(100, (remaining / total) * 100)) : 0;
  const tone: "ok" | "warn" | "bad" =
    pct >= 50 ? "ok" : pct >= 20 ? "warn" : "bad";
  const barColor =
    tone === "bad"
      ? "bg-destructive"
      : tone === "warn"
        ? "bg-amber-500"
        : "bg-emerald-500";
  const label = tier.plan_name ?? (isPct ? "套餐额度" : "余额");

  return (
    <div className="space-y-0.5">
      <div className="flex items-center justify-between gap-2 text-[11px]">
        <span className="truncate text-muted-foreground">{label}</span>
        <span className="shrink-0 font-mono">
          {isPct
            ? `剩余 ${fmtNum(remaining)}%（已用 ${fmtNum(used)}%）`
            : `剩余 ${fmtAmt(tier.unit, remaining)} / 共 ${fmtAmt(tier.unit, total)}`}
        </span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
        <div
          className={cn("h-full rounded-full transition-all", barColor)}
          style={{ width: `${pct}%` }}
        />
      </div>
      {tier.extra && (
        <div className="text-[10px] text-muted-foreground/70">
          重置：{fmtReset(tier.extra)}
        </div>
      )}
    </div>
  );
}

/** 金额格式化（unit=CNY→¥ / USD→$ / 其它→「值 单位」）。 */
function fmtAmt(unit: string | null | undefined, v: number): string {
  const s = fmtNum(v);
  if (unit === "CNY") return `¥${s}`;
  if (unit === "USD") return `$${s}`;
  return unit ? `${s} ${unit}` : s;
}

/** 数字格式化：整数去尾零；非有限值回退 "—"。 */
function fmtNum(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "—";
  return Number.isInteger(v) ? String(v) : String(Math.round(v * 100) / 100);
}

/** 重置时间（ISO8601）→ 本地可读串；解析失败原样回显。 */
function fmtReset(extra: string): string {
  const d = new Date(extra);
  if (!Number.isNaN(d.getTime())) return d.toLocaleString("zh-CN");
  return extra;
}
