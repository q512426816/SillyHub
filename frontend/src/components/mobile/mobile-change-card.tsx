"use client";

/**
 * MobileChangeCard — 移动变更卡片（2026-08-26-mobile-workspace-page task-05 /
 * design §5.3 / §7 / FR-03；quick-a4939946 视觉升级）。
 *
 * 纯展示组件（零数据请求，数据由移动列表页 useQuery 提供）：变更名（truncate）+
 * 阶段徽标 + 待办徽标 + 最近活动相对时间，整卡可点进入详情钻取页。
 *
 * quick-a4939946 视觉升级（对齐用户参考效果图：卡片左侧 40px 圆角图标容器承载
 * 状态语义色，标题/徽章右移形成两栏呼吸感；p-3 → p-3.5、图标容器与正文 gap-3）：
 * - blocked → AlertTriangle + destructive 色；命中待审 → Clock + warning 色；
 *   status=archived → CheckCircle2 + success 色；默认 → GitBranch + primary 色。
 *   status 为自由字符串（api-types ChangeSummary.status: string），宽松映射 +
 *   默认兜底，不穷举后端枚举。
 *
 * 复用约束（禁止复制第二份实现）：
 * - 待办徽标映射 PENDING_REVIEW_LABEL 从桌面 changes/page.tsx import（Grill C-10
 *   为其加 export），三态语义逐字对齐桌面 renderTodoBadge：
 *   blocked → 「阻塞中」error / pending_review 命中 → 映射文案 warning / 否则空占位 —。
 * - 阶段徽标复用 ChangeStepBadge（自带 STAGE_KIND/STAGE_LABELS 与 stepProgress 副行）；
 *   stage 缺省 "scan"、stepProgress 缺省 null 的降级口径与桌面列表阶段列一致。
 * - 相对时间复用 formatRelativeTime（runtime-card-helpers）。
 *
 * 移动约束（design §5.5）：整卡为 button（触摸热区 ≥44px，min-h-[44px]）；
 * 正文 ≥14px；语义 token（border / bg-card / text-foreground / primary 语义阶），
 * 无写死色值。
 */

import { PENDING_REVIEW_LABEL } from "@/app/(dashboard)/workspaces/[id]/changes/page";
import { ChangeStepBadge } from "@/components/changes/change-step-badge";
import { formatRelativeTime } from "@/components/daemon/runtime-card-helpers";
import { StatusBadge } from "@/components/ui/status-badge";
import type { ChangeSummary } from "@/lib/changes";
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  GitBranch,
  type LucideIcon,
} from "lucide-react";

export interface MobileChangeCardProps {
  /** 变更摘要（api-types 生成类型，经 @/lib/changes re-export）。 */
  change: ChangeSummary;
  /** 整卡点击（列表页 → 变更详情钻取路由）。 */
  onClick: () => void;
}

/** 状态图标容器语义（quick-a4939946）：图标 + 语义色阶（text-<语义> + bg/border 同源）。 */
const STATUS_ICON = {
  blocked: {
    icon: AlertTriangle,
    tone: "border-destructive/25 bg-destructive/10 text-destructive",
  },
  review: {
    icon: Clock,
    tone: "border-warning/30 bg-warning/10 text-warning",
  },
  archived: {
    icon: CheckCircle2,
    tone: "border-success/25 bg-success/10 text-success",
  },
  active: {
    icon: GitBranch,
    tone: "border-primary/25 bg-primary/10 text-primary",
  },
} satisfies Record<string, { icon: LucideIcon; tone: string }>;

/** 状态 → 图标容器语义：blocked 优先 → 待审命中 → archived → 默认 active（与 renderTodoBadge 同序）。 */
function pickStatusIcon(c: ChangeSummary) {
  if (c.status === "blocked") return STATUS_ICON.blocked;
  const hasReview = c.pending_review
    ? Boolean(PENDING_REVIEW_LABEL[c.pending_review])
    : false;
  if (hasReview) return STATUS_ICON.review;
  if (c.status === "archived") return STATUS_ICON.archived;
  return STATUS_ICON.active;
}

/** 待办徽标三态（语义对齐桌面 renderTodoBadge）：blocked 优先 → 映射命中 → 空占位。 */
function renderTodoBadge(c: ChangeSummary) {
  if (c.status === "blocked") {
    return <StatusBadge kind="error">阻塞中</StatusBadge>;
  }
  const label = c.pending_review
    ? PENDING_REVIEW_LABEL[c.pending_review]
    : undefined;
  if (label) {
    return <StatusBadge kind="warning">{label}</StatusBadge>;
  }
  return <span className="text-xs text-muted-foreground">—</span>;
}

export function MobileChangeCard({ change, onClick }: MobileChangeCardProps) {
  // 变更名：title 优先（人类可读），缺省降级 change_key；title 存在时 change_key
  // 作 mono 副行保留唯一标识（对齐桌面列表标题列 change_key/title 两行信息结构）。
  const displayName = change.title || change.change_key;
  const statusIcon = pickStatusIcon(change);
  const Icon = statusIcon.icon;

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`打开变更 ${displayName}`}
      data-testid="mobile-change-card"
      className="flex min-h-[44px] w-full items-start gap-3 rounded-[var(--radius-lg)] border border-border bg-card p-3.5 text-left shadow-[var(--shadow-sm)] transition-colors active:border-primary/40 active:bg-muted/50"
    >
      {/* 状态图标容器（quick-a4939946）：40px 圆角方 + 语义色，可扫读一眼定状态 */}
      <span
        aria-hidden
        className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-[12px] border ${statusIcon.tone}`}
      >
        <Icon className="h-5 w-5" />
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-1.5">
        {/* 变更名（truncate）+ 最近活动相对时间 */}
        <span className="flex items-start justify-between gap-2">
          <span className="min-w-0 flex-1">
            <span
              className="block truncate text-[14px] font-medium text-foreground"
              title={displayName}
            >
              {displayName}
            </span>
            {change.title && (
              <span
                className="mt-0.5 block truncate font-mono text-[11px] text-muted-foreground"
                title={change.change_key}
              >
                {change.change_key}
              </span>
            )}
          </span>
          <span className="shrink-0 whitespace-nowrap text-xs text-muted-foreground">
            {formatRelativeTime(change.updated_at)}
          </span>
        </span>
        {/* 阶段徽标（ChangeStepBadge：stage 主行 + step 摘要副行）+ 待办徽标 */}
        <span className="flex flex-wrap items-center gap-2">
          <ChangeStepBadge
            stage={change.current_stage ?? "scan"}
            stepProgress={change.step_progress ?? null}
          />
          {renderTodoBadge(change)}
        </span>
      </span>
    </button>
  );
}
