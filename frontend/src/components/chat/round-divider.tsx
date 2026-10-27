"use client";

/**
 * RoundDivider — 轮次分隔胶囊（2026-09-09-sessions-visual-refresh task-04 /
 * FR-04 / D-010@v1）。
 *
 * 对话视图轮尾分隔：两侧渐变细线 + 居中胶囊（玻璃底 + 柔描边），替代原角落
 * 弱小字——轮次边界一眼可辨（v4 原型 .round-divider）。status 覆盖轮尾
 * TurnUiStatus 实际六态（D-010@v1），文案与 turn-timeline TurnStatusLabel
 * 单口径（排队中/运行中/打断中/已完成/失败/已中止）；「全部/进度」视图的
 * turn-status-bar 不消费本构件（Grill G-03）。
 */
import { memo, type ReactNode } from "react";

import { cn } from "@/lib/utils";

/** 轮次状态六态（对齐 turn-timeline TurnUiStatus，D-010@v1）。 */
export type RoundDividerStatus =
  | "pending"
  | "running"
  | "interrupting"
  | "completed"
  | "failed"
  | "killed";

const STATUS_TEXT: Record<RoundDividerStatus, string> = {
  pending: "排队中",
  running: "运行中",
  interrupting: "打断中",
  completed: "已完成",
  failed: "失败",
  killed: "已中止",
};

/** 着色映射（design 接口定义）：completed=success / failed+killed=error /
 * running=info / pending+interrupting=neutral。 */
const STATUS_CLS: Record<RoundDividerStatus, string> = {
  pending: "text-muted-foreground",
  running: "text-info font-medium",
  interrupting: "text-muted-foreground",
  completed: "text-success font-semibold",
  failed: "text-error font-semibold",
  killed: "text-error font-semibold",
};

const STATUS_PREFIX: Record<RoundDividerStatus, string> = {
  pending: "•",
  running: "•",
  interrupting: "•",
  completed: "✓",
  failed: "✗",
  killed: "✗",
};

/**
 * 大数缩写（2026-10-26-mobile-four-page-layout-fix / FR-02）：≥10000 的整数
 * 缩写为 k 单位一位小数（78,489→78.5k，99,999→100.0k 可接受）；<10000 原样
 * 返回千分位串。口径全局统一（plan 盲区③），desktop 永不缩写。
 */
export function abbreviateCount(n: number): string {
  if (!Number.isFinite(n) || Math.abs(n) < 10000) {
    return n.toLocaleString("en-US");
  }
  return `${(n / 1000).toFixed(1)}k`;
}

/** meta 串中的 ↑/↓ 计数段缩写（mobile 分支用）：仅命中 ↑/↓ 后的千分位数字段。 */
function abbreviateMeta(meta: string): string {
  return meta.replace(/([↑↓])\s?([\d,]+)/g, (_m, arrow: string, digits: string) => {
    const n = Number.parseInt(digits.replace(/,/g, ""), 10);
    return Number.isNaN(n) ? `${arrow}${digits}` : `${arrow}${abbreviateCount(n)}`;
  });
}

export interface RoundDividerProps {
  /** 主标签，如「第 2 轮」 */
  label: string;
  /** 轮次状态六态；缺省不渲染状态段 */
  status?: RoundDividerStatus;
  /** 右侧 meta（token/时间等自由文本，等宽数字） */
  meta?: string;
  /**
   * 手机端窄视口分支（2026-10-26-mobile-four-page-layout-fix / FR-02，默认 false）：
   * true 时胶囊允许收缩折行 + meta 中 ↑/↓ 大数缩写；缺省 desktop 零变化
   * （shrink-0 + whitespace-nowrap 原样）。
   */
  mobile?: boolean;
  /**
   * 2026-10-20-session-page-dsh-alignment（FR-01 / D-016① / D-015@v2）：轮元信息
   * 合并成**一行**——原「开始 · 结束 · 历时」独立行与轮尾状态胶囊重复，本 prop
   * 把那串时间细节折进本行**最右端**（等宽数字 10.5px / muted）。
   * 缺省 undefined ＝ 原样零视觉变化（胶囊仍居中等分两条渐变细线）；传值时右线
   * 让位给细节文本，左右两条 flex-1 仍等宽，胶囊视觉居中不动。
   *
   * 2026-10-23-live-turn-meta-time / FR-01：类型由 string 放宽为 ReactNode——
   * 进行中轮的「历时」是每秒 tick 的 TurnLiveElapsedText 元素（tick 不外溢父级），
   * string ⊂ ReactNode，既有字符串传参零迁移。
   */
  detail?: ReactNode;
}

export const RoundDivider = memo(function RoundDivider({
  label,
  status,
  meta,
  detail,
  mobile = false,
}: RoundDividerProps) {
  return (
    <div
      data-testid="round-divider"
      aria-label={status ? `${label} ${STATUS_TEXT[status]}` : label}
      className="my-1 flex items-center gap-3.5"
    >
      <span
        aria-hidden
        className="h-px flex-1 bg-gradient-to-r from-transparent via-border to-border"
      />
      <span
        className={cn(
          "inline-flex items-center gap-1.5 rounded-full border border-border/60 bg-card/80 px-3 py-0.5 text-[10.5px] text-muted-foreground shadow-sm backdrop-blur-sm",
          // mobile（FR-02 + visual-round2）：去胶囊框纯文字（边框/底色/阴影/内距
          // 全去——手机上轮次分隔要轻不抢正文视觉）；允许收缩折行（长 meta 在
          // 430pt 视口内换行不溢出）。desktop 缺省保持胶囊+shrink-0 单行（零变化）。
          mobile
            ? "min-w-0 shrink whitespace-normal border-none bg-transparent px-0 py-0 shadow-none backdrop-blur-none"
            : "shrink-0 whitespace-nowrap",
        )}
      >
        <span className="tracking-wide">{label}</span>
        {status && (
          <>
            <span aria-hidden>·</span>
            <span className={STATUS_CLS[status]}>
              <span aria-hidden className="mr-0.5">{STATUS_PREFIX[status]}</span>
              {STATUS_TEXT[status]}
            </span>
          </>
        )}
        {meta && (
          <>
            <span aria-hidden>·</span>
            <span className="font-mono tabular-nums opacity-80">
              {mobile ? abbreviateMeta(meta) : meta}
            </span>
          </>
        )}
      </span>
      {/* 2026-10-20-session-page-dsh-alignment（FR-01 / D-016①）：右半区——右侧
          渐变细线 + 可选的轮时间细节（detail）。细线外包一层 flex-1 容器，两侧
          flex-1 仍等分剩余空间，所以 detail 是否出现都不改变胶囊的居中位置；
          detail 缺省时该容器只剩一条细线，与原结构视觉等价。 */}
      <span className="flex min-w-0 flex-1 items-center gap-3.5">
        <span
          aria-hidden
          className="h-px flex-1 bg-gradient-to-l from-transparent via-border to-border"
        />
        {detail && (
          <span
            data-testid="round-divider-detail"
            className="shrink-0 whitespace-nowrap font-mono text-[10.5px] tabular-nums text-muted-foreground"
          >
            {detail}
          </span>
        )}
      </span>
    </div>
  );
});
