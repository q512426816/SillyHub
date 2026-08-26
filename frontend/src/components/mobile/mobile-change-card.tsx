"use client";

/**
 * MobileChangeCard — 移动变更卡片（2026-08-26-mobile-workspace-page task-05 /
 * design §5.3 / §7 / FR-03）。
 *
 * 纯展示组件（零数据请求，数据由移动列表页 useQuery 提供）：变更名（truncate）+
 * 阶段徽标 + 待办徽标 + 最近活动相对时间，整卡可点进入详情钻取页。
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

export interface MobileChangeCardProps {
  /** 变更摘要（api-types 生成类型，经 @/lib/changes re-export）。 */
  change: ChangeSummary;
  /** 整卡点击（列表页 → 变更详情钻取路由）。 */
  onClick: () => void;
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

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`打开变更 ${displayName}`}
      data-testid="mobile-change-card"
      className="flex min-h-[44px] w-full flex-col gap-2 rounded-[var(--radius-lg)] border border-border bg-card p-3 text-left shadow-[var(--shadow-sm)] transition-colors active:border-primary/40 active:bg-muted/50"
    >
      {/* 变更名（truncate）+ 最近活动相对时间 */}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
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
        </div>
        <span className="shrink-0 whitespace-nowrap text-xs text-muted-foreground">
          {formatRelativeTime(change.updated_at)}
        </span>
      </div>
      {/* 阶段徽标（ChangeStepBadge：stage 主行 + step 摘要副行）+ 待办徽标 */}
      <div className="flex flex-wrap items-center gap-2">
        <ChangeStepBadge
          stage={change.current_stage ?? "scan"}
          stepProgress={change.step_progress ?? null}
        />
        {renderTodoBadge(change)}
      </div>
    </button>
  );
}
