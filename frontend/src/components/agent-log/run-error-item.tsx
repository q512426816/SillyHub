"use client";

// task-09 / FR-03 / D-002@v1 / D-004@v1：模型调用失败「运行错误」展示组件。
//
// 在 agent-log 消息流中渲染醒目错误项：type→图标/颜色/文案映射（8 类 + unknown 兜底）
// + 「运行失败」标题 + message（原因）+ hint（针对性建议）+ actions（重新发送 / 切换供应商
// / 查看详情）。组件为纯展示 + 发事件：actions 仅回调父组件，**不直接调 inject / 路由**
// （集成留 task-10）。查看详情为内部折叠开关，展开 raw（原始错误文本）。
//
// 输入契约：item = task-08 normalize.ts 的 ErrorLogItem
//   （type: ModelErrorType / code / message / retryable / hint / raw）。
//
// 样式对齐 agent-log 模块既有约定（lucide-react + tailwind 语义边框）：
//   - 映射范式参照 tool-kind-meta.ts（Record<Type, { label, Icon, badgeClass }>）。
//   - 配色参照 prototype-model-error-visibility.html：
//     quota 橙 / auth 红 / timeout 紫 / network 青（原型已定），其余按语义补。
//   - 中性灰底 + 左侧强调色边（border-l-4）对应原型 .err 的 border-left + bg。

import type { LucideIcon } from "lucide-react";
import {
  AlertOctagon,
  AlertTriangle,
  ArrowRightLeft,
  ChevronDown,
  ChevronRight,
  Gauge,
  Lock,
  PackageSearch,
  RotateCw,
  Timer,
  Wallet,
  WifiOff,
} from "lucide-react";
import { useState } from "react";

import { cn } from "@/lib/utils";
import type { ErrorLogItem, ModelErrorType } from "./normalize";

/* ------------------------------------------------------------------ */
/*  type → 图标 / 颜色 / 文案 映射表（8 类 + unknown 兜底）             */
/* ------------------------------------------------------------------ */

export interface ModelErrorMeta {
  /** 中文标签（type 徽标，面向用户）。 */
  label: string;
  /** lucide-react 图标组件。 */
  Icon: LucideIcon;
  /** 外框样式：左侧强调色边框 + 浅底（border-l-4 + bg-{c}-50）。 */
  containerClass: string;
  /** 标题行图标 / 文字色（text-{c}-700）。 */
  titleClass: string;
  /** type 徽标样式（border-{c}-200 bg-card text-{c}-700，参照 tool-kind-meta badgeClass）。 */
  badgeClass: string;
  /** 后端未给 hint 时的兜底建议（R-01：classifier 漏判仍给可操作建议）。 */
  defaultHint: string;
}

/**
 * 8 类 ModelErrorType → 元数据。配色参照 prototype-model-error-visibility.html：
 *   quota_exceeded 橙 / auth_failed 红 / timeout 紫 / network 青（原型已定），
 *   其余按语义补：rate_limited 琥珀（警示）/ model_not_found 玫瑰（缺失）/
 *   provider_error 红（服务端故障，图标 AlertOctagon 与 auth Lock 区分）/ unknown 锌（中性兜底）。
 *
 * auth_failed 与 provider_error 同用红色族（均属严重故障），靠图标 + label 双重区分。
 */
export const MODEL_ERROR_META: Record<ModelErrorType, ModelErrorMeta> = {
  auth_failed: {
    label: "凭证失效",
    Icon: Lock,
    containerClass: "border-l-red-400 bg-red-50",
    titleClass: "text-red-700",
    badgeClass: "border-red-200 bg-card text-red-700",
    defaultHint: "前往供应商设置检查并更新 API Key 凭证。",
  },
  quota_exceeded: {
    label: "额度耗尽",
    Icon: Wallet,
    containerClass: "border-l-orange-400 bg-orange-50",
    titleClass: "text-orange-700",
    badgeClass: "border-orange-200 bg-card text-orange-700",
    defaultHint: "切换到有额度的供应商，或等待额度重置后重试。",
  },
  rate_limited: {
    label: "触发限流",
    Icon: Gauge,
    containerClass: "border-l-amber-400 bg-amber-50",
    titleClass: "text-amber-700",
    badgeClass: "border-amber-200 bg-card text-amber-700",
    defaultHint: "请求过于频繁，请稍候片刻再重试。",
  },
  timeout: {
    label: "响应超时",
    Icon: Timer,
    containerClass: "border-l-purple-400 bg-purple-50",
    titleClass: "text-purple-700",
    badgeClass: "border-purple-200 bg-card text-purple-700",
    defaultHint: "模型响应超时，请稍后重试；若持续超时，请检查网络或更换供应商。",
  },
  model_not_found: {
    label: "模型不存在",
    Icon: PackageSearch,
    containerClass: "border-l-rose-400 bg-rose-50",
    titleClass: "text-rose-700",
    badgeClass: "border-rose-200 bg-card text-rose-700",
    defaultHint: "当前供应商不支持该模型，请在设置中选择可用模型或切换供应商。",
  },
  network: {
    label: "网络异常",
    Icon: WifiOff,
    containerClass: "border-l-cyan-400 bg-cyan-50",
    titleClass: "text-cyan-700",
    badgeClass: "border-cyan-200 bg-card text-cyan-700",
    defaultHint: "请检查网络连接与供应商服务地址（BASE_URL）是否可达。",
  },
  provider_error: {
    label: "供应商异常",
    Icon: AlertOctagon,
    containerClass: "border-l-red-400 bg-red-50",
    titleClass: "text-red-700",
    badgeClass: "border-red-200 bg-card text-red-700",
    defaultHint: "供应商服务异常，请稍后重试；若持续报错，请切换供应商。",
  },
  unknown: {
    label: "运行失败",
    Icon: AlertTriangle,
    containerClass: "border-l-zinc-400 bg-zinc-50",
    titleClass: "text-zinc-700",
    badgeClass: "border-zinc-200 bg-card text-zinc-700",
    defaultHint: "请查看下方详情或稍后重试；若持续失败，请联系管理员。",
  },
};

const MODEL_ERROR_FALLBACK = MODEL_ERROR_META.unknown;

/**
 * 取错误类型元数据。非法 / 空 type → unknown 兜底
 * （与 normalize.buildErrorLogItem 的兜底语义一致，brownfield 不崩）。
 */
export function modelErrorMeta(
  type: ModelErrorType | string | null | undefined,
): ModelErrorMeta {
  if (!type) return MODEL_ERROR_FALLBACK;
  return MODEL_ERROR_META[type as ModelErrorType] ?? MODEL_ERROR_FALLBACK;
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export interface RunErrorItemProps {
  /** task-08 结构化错误载荷（type/code/message/retryable/hint/raw）。 */
  item: ErrorLogItem;
  /**
   * 重新发送回调；传入即渲染按钮。ql-20260904-010：不再按 item.retryable 门控
   * （原 D-006 的 quota/auth 隐藏逻辑废除——用户决策所有失败卡都提供重试入口，
   * 重试守卫由父级提交链路承担）；turn 无 prompt 时父级不传（无可重放内容）。
   * task-10 接 inject 链路。
   */
  onResend?: () => void;
  /** 切换供应商回调；传入即渲染按钮（父级定位供应商切换入口，如会话页底部配置条）。 */
  onSwitchProvider?: () => void;
  /**
   * 查看详情回调；无论是否传入，「查看详情」都作为内部折叠开关展开 raw（若 raw 存在）。
   * 传入时点击除折叠外额外触发该回调（task-10 可据需埋点 / 跳转）。
   */
  onViewDetail?: () => void;
}

/**
 * task-09 / FR-03 / D-002@v1 / D-004@v1：运行错误展示组件。
 *
 * 纯展示 + 发事件，不调 API / 路由（集成留 task-10）。
 */
export function RunErrorItem({
  item,
  onResend,
  onSwitchProvider,
  onViewDetail,
}: RunErrorItemProps) {
  const meta = modelErrorMeta(item.type);
  const { Icon } = meta;
  const hint = item.hint ?? meta.defaultHint;
  const hasRaw = item.raw != null && item.raw.trim().length > 0;
  const [showDetail, setShowDetail] = useState(false);

  // actions 可见性：
  // - 重新发送：父组件传入 onResend（ql-20260904-010：所有失败卡都可重试，
  //   不再按 item.retryable 门控）。
  // - 切换供应商：父组件传入 onSwitchProvider（由父级按场景决定是否提供）。
  // - 查看详情：有 raw 可展开，或父组件传入 onViewDetail。
  const showResend = Boolean(onResend);
  const showSwitch = Boolean(onSwitchProvider);
  const showDetailBtn = hasRaw || Boolean(onViewDetail);
  const hasActions = showResend || showSwitch || showDetailBtn;

  // 主操作按钮（primary 蓝底）：首个可用「修复」动作——重发优先，其次切换供应商
  // （无 prompt 可重放（onResend 缺席）时，切换供应商升为 primary）。
  const resendPrimary = showResend;
  const switchPrimary = !showResend && showSwitch;

  const toggleDetail = () => {
    setShowDetail((v) => !v);
    onViewDetail?.();
  };

  const primaryBtnClass = "bg-primary text-primary-foreground hover:opacity-90";
  const defaultBtnClass =
    "border border-zinc-300 bg-card text-zinc-700 hover:bg-zinc-100";

  return (
    <div
      data-testid="run-error-item"
      data-error-type={item.type}
      className={cn(
        "min-w-0 max-w-full rounded-md border border-zinc-200 border-l-4 px-3 py-2.5",
        meta.containerClass,
      )}
    >
      {/* 标题行：图标 + 「运行失败」+ type 徽标 + code 徽标 */}
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <span
          className={cn(
            "inline-flex items-center gap-1.5 text-sm font-semibold",
            meta.titleClass,
          )}
        >
          <Icon className="h-4 w-4 shrink-0" aria-hidden />
          运行失败
        </span>
        <span
          className={cn(
            "inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] font-medium",
            meta.badgeClass,
          )}
        >
          {meta.label} · {item.type}
        </span>
        {item.code && (
          <span className="inline-flex items-center rounded border border-zinc-200 bg-card px-1.5 py-0.5 font-mono text-[10px] text-zinc-600">
            code: {item.code}
          </span>
        )}
      </div>

      {/* 原因 message */}
      <p className="mt-1.5 min-w-0 break-words text-sm text-zinc-800 [overflow-wrap:anywhere]">
        {item.message}
      </p>

      {/* 针对性建议 hint */}
      {hint && (
        <p className="mt-1 min-w-0 break-words text-xs text-zinc-600 [overflow-wrap:anywhere]">
          <span className="mr-1" aria-hidden>
            💡
          </span>
          {hint}
        </p>
      )}

      {/* actions */}
      {hasActions && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {showResend && onResend && (
            <button
              type="button"
              onClick={onResend}
              className={cn(
                "inline-flex h-7 items-center gap-1 rounded px-2.5 text-xs font-medium transition-colors",
                resendPrimary ? primaryBtnClass : defaultBtnClass,
              )}
            >
              <RotateCw className="h-3.5 w-3.5" aria-hidden />
              重新发送
            </button>
          )}
          {showSwitch && onSwitchProvider && (
            <button
              type="button"
              onClick={onSwitchProvider}
              className={cn(
                "inline-flex h-7 items-center gap-1 rounded px-2.5 text-xs font-medium transition-colors",
                switchPrimary ? primaryBtnClass : defaultBtnClass,
              )}
            >
              <ArrowRightLeft className="h-3.5 w-3.5" aria-hidden />
              切换供应商
            </button>
          )}
          {showDetailBtn && (
            <button
              type="button"
              onClick={toggleDetail}
              aria-expanded={showDetail}
              className={cn(
                "inline-flex h-7 items-center gap-1 rounded px-2.5 text-xs font-medium transition-colors",
                defaultBtnClass,
              )}
            >
              {showDetail ? (
                <ChevronDown className="h-3.5 w-3.5" aria-hidden />
              ) : (
                <ChevronRight className="h-3.5 w-3.5" aria-hidden />
              )}
              {showDetail ? "收起详情" : "查看详情"}
            </button>
          )}
        </div>
      )}

      {/* 原始错误文本（折叠展开） */}
      {showDetail && hasRaw && (
        <pre className="mt-2 max-w-full whitespace-pre-wrap break-words rounded border border-zinc-200 bg-card px-2 py-1.5 font-mono text-[11px] leading-5 text-zinc-700 [overflow-wrap:anywhere]">
          {item.raw}
        </pre>
      )}
    </div>
  );
}

export default RunErrorItem;
