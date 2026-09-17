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
 * task-02（2026-09-16-mobile-changes-parity / FR-02，D-003 ②）补齐桌面列表同源信息：
 * - 徽标行追加活动徽标 ChangeActivityBadge（与桌面「待办状态」列同源：
 *   currentStepStatus=step_progress.current_step_status、lastPushedAt=last_pushed_at）；
 * - 元信息行：负责人三态（对齐桌面 renderOwner：owner_name → owner_id 前 8 位
 *   mono → 「—」）+ 影响组件（join(", ")，空数组整段省略 + truncate 单行）；
 * - 执行用量行（UsageExecCell 移动化）：usage undefined → 整行不渲染 / null →
 *   「—」/ 有值 → 耗时 + 进行中 pill（started_at 有且 finished_at 缺）+ token·次；
 *   起止时间不展示（移动无 hover，详情页用量卡兜底）。
 *
 * 复用约束（禁止复制第二份实现）：
 * - 待办徽标映射 PENDING_REVIEW_LABEL 从桌面 changes/page.tsx import（Grill C-10
 *   为其加 export），三态语义逐字对齐桌面 renderTodoBadge：
 *   blocked → 「阻塞中」error / pending_review 命中 → 映射文案 warning / 否则空占位 —。
 * - 用量格式化 formatTokensCompact / formatCount / formatDurationZh 同样从桌面
 *   changes/page.tsx import（task-01 导出，D-005 复用挂载路线），卡片内自绘移动
 *   用量行——不复制桌面 UsageExecCell 为独立组件。
 * - 阶段徽标复用 ChangeStepBadge（自带 STAGE_KIND/STAGE_LABELS 与 stepProgress 副行）；
 *   stage 缺省 "scan"、stepProgress 缺省 null 的降级口径与桌面列表阶段列一致。
 * - 相对时间复用 formatRelativeTime（runtime-card-helpers）。
 *
 * 移动约束（design §5.5）：整卡为 button（触摸热区 ≥44px，min-h-[44px]）；
 * 正文 ≥14px；语义 token（border / bg-card / text-foreground / primary 语义阶），
 * 无写死色值。
 */

import {
  formatCount,
  formatDurationZh,
  formatTokensCompact,
  PENDING_REVIEW_LABEL,
} from "@/app/(dashboard)/workspaces/[id]/changes/page";
import { ChangeActivityBadge } from "@/components/changes/change-activity-badge";
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

/**
 * 负责人三态（task-02 / FR-02，语义逐字对齐桌面 renderOwner）：owner_name 非空 →
 * 用户名（前景色，弱化行内可读）；owner_name 空且 owner_id 有值 → UUID 前 8 位
 * 短标识降级（mono）；双空 → 「—」（从未上行过 owner 的存量变更）。
 */
function renderOwner(c: ChangeSummary) {
  if (c.owner_name) {
    return <span className="text-foreground">{c.owner_name}</span>;
  }
  if (c.owner_id) {
    return (
      <span className="font-mono text-primary">{c.owner_id.slice(0, 8)}</span>
    );
  }
  return <span>—</span>;
}

/**
 * 执行用量行（task-02 / FR-02，桌面 UsageExecCell 移动化自绘，复用 task-01 导出
 * helper，不复制组件）。usage 判空两档（桌面先例，兼容策略基线）：
 * - undefined（字段整体缺失：旧后端响应 / mock 未带）→ 整行不渲染；
 * - null（后端显式无关联执行）→ 分隔行内「—」占位；
 * - 有值 → 耗时 formatDurationZh + 进行中 pill（started_at 有值且 finished_at 缺，
 *   R-05 时间三元组语义）+ token·次（四维 token 之和 + api_requests）。
 * 起止时间不展示——移动端无 hover，详情页 ChangeUsageCard 兜底。
 */
function renderUsageRow(usage: ChangeSummary["usage"]) {
  if (usage === undefined) return null;
  if (usage === null) {
    return (
      <span
        data-testid="mobile-change-usage-row"
        className="flex border-t border-dashed border-border pt-1.5 text-xs text-muted-foreground"
      >
        —
      </span>
    );
  }
  // 进行中 = started_at 有值且 finished_at 缺（与桌面 UsageExecCell 同源判定）
  const running = Boolean(usage.started_at) && !usage.finished_at;
  // token 总量 = totals 四维之和（input + output + cache_read + cache_creation）
  const tokenTotal =
    usage.totals.input_tokens +
    usage.totals.output_tokens +
    usage.totals.cache_read_tokens +
    usage.totals.cache_creation_tokens;
  return (
    <span
      data-testid="mobile-change-usage-row"
      className="flex flex-wrap items-center gap-x-2 gap-y-0.5 border-t border-dashed border-border pt-1.5 text-xs tabular-nums text-muted-foreground"
    >
      <span className="font-semibold text-foreground">
        {formatDurationZh(usage.duration_ms)}
      </span>
      {running && (
        <span className="rounded-full bg-brand-50 px-1.5 text-[10px] text-brand-700">
          进行中
        </span>
      )}
      <span>{`${formatTokensCompact(tokenTotal)} tok · ${formatCount(usage.totals.api_requests)} 次`}</span>
    </span>
  );
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
        {/* 阶段徽标（ChangeStepBadge：stage 主行 + step 摘要副行）+ 待办徽标 + 活动徽标 */}
        <span className="flex flex-wrap items-center gap-2">
          <ChangeStepBadge
            stage={change.current_stage ?? "scan"}
            stepProgress={change.step_progress ?? null}
          />
          {/* 待办徽标（testid 槽位便于与负责人/用量「—」占位区分断言） */}
          <span data-testid="mobile-change-todo-badge">
            {renderTodoBadge(change)}
          </span>
          {/* 活动徽标（task-02：真值表三态进行中/停滞/空闲，与桌面「待办状态」列同源） */}
          <ChangeActivityBadge
            currentStepStatus={
              change.step_progress?.current_step_status ?? null
            }
            lastPushedAt={change.last_pushed_at ?? null}
          />
        </span>
        {/* 元信息行（task-02）：负责人三态 + 影响组件（空数组整段省略） */}
        <span
          data-testid="mobile-change-meta-row"
          className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground"
        >
          <span className="whitespace-nowrap">
            负责人 {renderOwner(change)}
          </span>
          {change.affected_components.length > 0 && (
            <span
              className="min-w-0 max-w-full truncate"
              title={change.affected_components.join(", ")}
            >
              影响{" "}
              <span className="text-foreground">
                {change.affected_components.join(", ")}
              </span>
            </span>
          )}
        </span>
        {/* 执行用量行（task-02）：usage undefined 整行不渲染（renderUsageRow 内判空） */}
        {renderUsageRow(change.usage)}
      </span>
    </button>
  );
}
