"use client";

import { Fragment, memo } from "react";

import { WORKFLOW_STAGE_LABELS } from "@/components/changes/detail/change-stage-header";
import type { components } from "@/lib/api-types";

/**
 * 步骤时间线明细项（components.schemas.StepTimelineEntry，2026-08-15-change-step-visibility）。
 *
 * 类型来自 pnpm gen:types 生成的 api-types（禁止手写字段）。数据源
 * latest_progress.steps 经后端 _extract_step_progress 归一化：
 *   - stage 分组按 STAGE_ORDER 定序（quick 及未知 stage 追加在后）+ 组内按
 *     ordering——entries 顺序即展示顺序，本组件不再排序（design §5 Phase 2.2）；
 *   - completed_at 已归一 ISO 8601 UTC，展示经 formatStepTime 安全解析为本地
 *     时间（Grill #18 精神保留：先正则归一到 spec 合法格式再 new Date，解析
 *     失败回退原串，见该函数注释）；
 *   - output 全量透传（2026-08-16-change-owner-from-token D-004@v1 修订
 *     step-visibility R-02：截断仅保留列表摘要层），前端自然换行 + max-h
 *     滚动兜底（R-07 超长不撑爆布局）；
 *   - kind 标条目类别（D-003@v1）：缺省/undefined/"step" 走 step 渲染（旧
 *     数据兼容 design §9）；"event" 为 owner_change 等履历事件条目（后端按
 *     时间序合成进序列并统一重编 ordering，key 唯一性由此保证，本组件不改
 *     key 机制）。
 */
export type StepTimelineEntry = components["schemas"]["StepTimelineEntry"];

// ── 七值状态色映射（design §7：CLI 原值透传，前端白名单色映射） ──────────
// 对齐后端 model.StepStatus 7 值 + progress.js 实证常见 3 值；未知值按
// pending 灰渲染（兜底，不炸）。
const DOT_CLASS: Record<string, string> = {
  completed: "bg-emerald-500",
  "in-progress": "bg-brand-500 animate-pulse",
  pending: "bg-gray-300",
  waiting: "bg-amber-500",
  failed: "bg-red-500",
  blocked: "bg-orange-500",
  stale: "bg-orange-500",
};

const NAME_CLASS: Record<string, string> = {
  completed: "text-foreground",
  "in-progress": "text-brand-600 font-medium",
  pending: "text-muted-foreground",
  waiting: "text-amber-600 font-medium",
  failed: "text-red-600",
  blocked: "text-orange-600",
  stale: "text-orange-600",
};

/** 步骤名右侧状态文案；completed 显示完成时间（见 TimelineItem），pending/未知不显示（原型未来步灰收起） */
const STATUS_LABEL: Record<string, string> = {
  "in-progress": "进行中",
  waiting: "等待中",
  failed: "失败",
  blocked: "已阻塞",
  stale: "已过期",
};

function dotClass(status: string): string {
  return DOT_CLASS[status] ?? "bg-gray-300";
}

function nameClass(status: string): string {
  return NAME_CLASS[status] ?? "text-muted-foreground";
}

// ── 时间格式化（ql-20260821-017）──────────────────────────────────────────
// 后端归一为 ISO 8601 UTC（_normalize_completed_at → isoformat），但形如
// 2026-08-15T15:44:08.123456+00:00 直读体验差。此处先正则校验 + 重写成
// ECMAScript 保证兼容的格式（T 分隔 / 补秒 / 微秒截到毫秒 / 偏移规范化），
// 再 new Date 转本地时间按系统惯例 zh-CN 2-digit 输出（对齐 changes 列表
// updated_at 与任务详情 formatDate 先例）；任何不匹配/解析失败回退原串，
// 不炸不猜（Grill #18 的「不裸解析」精神保留在正则白名单这一层）。
const ISO_LIKE_RE =
  /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?(?:\.(\d+))?(Z|[+-]\d{2}:?\d{2})?$/;

/** 步骤时间展示格式（系统惯例：zh-CN 2-digit 年月日时分，如 2026/08/15 23:44） */
const TIME_FORMAT_OPTS: Intl.DateTimeFormatOptions = {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
};

/** ISO 串 → 本地时间紧凑文案；非 ISO 形状 / Invalid Date 一律回退原串 */
export function formatStepTime(iso: string): string {
  const m = ISO_LIKE_RE.exec(iso.trim());
  if (!m) return iso;
  const [, y, mo, d, h, mi, s = "00", frac, tz] = m;
  const ms = frac ? `.${frac.slice(0, 3).padEnd(3, "0")}` : "";
  const offset =
    !tz || tz === "Z"
      ? "Z"
      : tz.length === 6
        ? tz
        : `${tz.slice(0, 3)}:${tz.slice(3)}`;
  const dt = new Date(`${y}-${mo}-${d}T${h}:${mi}:${s}${ms}${offset}`);
  if (Number.isNaN(dt.getTime())) return iso;
  return dt.toLocaleString("zh-CN", TIME_FORMAT_OPTS);
}

interface TimelineItemProps {
  entry: StepTimelineEntry;
  /** 父级派生的稳定 key（`${stage}-${ordering}`），用于 DOM data-key 便于测试/调试 */
  itemKey: string;
}

/** 完成时间 <time>：显示本地化文案，title/dateTime 保留原始 ISO（悬停可查精确值） */
function StepTime({ completedAt }: { completedAt: string }) {
  return (
    <time
      dateTime={completedAt}
      title={completedAt}
      className="ml-auto shrink-0 text-[11px] tabular-nums text-muted-foreground"
    >
      {formatStepTime(completedAt)}
    </time>
  );
}

/**
 * 履历事件条目（kind="event"，2026-08-16-change-owner-from-token D-003@v1）：
 * 👤 emoji 替代状态色点 + 紫色 chip，样式对齐原型 prototype-owner-events.html
 * .tl-item.owner-event / .owner-chip（bg #faf5ff≈purple-50 / 字 #7c3aed≈violet-600 /
 * 边 #e9d5ff≈purple-200 / 箭头 #a78bfa≈violet-400 加粗）。output（"A → B"）进
 * chip，底部不再重复渲染 <p>；completed_at 沿用 step 分支同款 StepTime。
 */
function OwnerEventItem({ entry, itemKey }: TimelineItemProps) {
  // output 形如 "admin → qinyi"（后端按时间序合成，task-04）；按首个 → 拆开
  // 渲染箭头样式；无箭头（未来事件类型兜底）整串渲染。
  const arrowIdx = entry.output?.indexOf("→") ?? -1;
  const names =
    entry.output && arrowIdx !== -1
      ? {
          from: entry.output.slice(0, arrowIdx).trim(),
          to: entry.output.slice(arrowIdx + 1).trim(),
        }
      : null;
  return (
    <div className="relative pt-2 pb-3.5" data-key={itemKey} data-kind="event">
      {/* 事件点：👤 emoji 替代状态色点（原型 .tl-dot::before content:"👤"，
          定位同 step dot 位，无 data-status 色映射） */}
      <span
        aria-hidden
        className="absolute -left-[28px] top-[7px] text-[13px] leading-none"
      >
        👤
      </span>
      <div className="flex flex-wrap items-center gap-2 text-[13px] leading-snug">
        <span className="min-w-0 break-words text-foreground">{entry.name}</span>
        {entry.output ? (
          <span className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-purple-200 bg-purple-50 px-2 py-px text-xs text-violet-600">
            <span aria-hidden>👤</span>
            {names ? (
              <>
                {names.from}{" "}
                <span className="font-bold text-violet-400">→</span>{" "}
                {names.to}
              </>
            ) : (
              entry.output
            )}
          </span>
        ) : null}
        {entry.completed_at ? <StepTime completedAt={entry.completed_at} /> : null}
      </div>
    </div>
  );
}

/**
 * 单条时间线节点。React.memo + react-query structuralSharing（引用相等跳过
 * re-render）实现 entry 级 diff：轮询刷新时仅状态变化的节点重渲染，未变化
 * 节点引用相等直接跳过，不整列重挂（R-04「不乱跳」）。
 */
const TimelineItem = memo(function TimelineItem({
  entry,
  itemKey,
}: TimelineItemProps) {
  // kind="event" 走事件专属渲染；缺省/undefined/"step" 走既有 step 渲染
  //（旧数据 kind 缺省兼容，design §9；step 分支 DOM 除 D-004 clamp 移除外零增改）。
  if (entry.kind === "event") {
    return <OwnerEventItem entry={entry} itemKey={itemKey} />;
  }
  const label = STATUS_LABEL[entry.status];
  return (
    <div className="relative pt-2 pb-3.5" data-key={itemKey}>
      {/* 状态点：绝对定位贴左侧时间线脊（原型 .tl-dot） */}
      <span
        aria-hidden
        data-status={entry.status}
        className={`absolute -left-[25px] top-[10px] h-3 w-3 shrink-0 rounded-full border-2 border-card ${dotClass(entry.status)}`}
      />
      <div className="flex items-center gap-2 text-[13px] leading-snug">
        <span className={`min-w-0 flex-1 break-words ${nameClass(entry.status)}`}>
          {entry.name}
        </span>
        {entry.status === "completed" && entry.completed_at ? (
          <StepTime completedAt={entry.completed_at} />
        ) : label ? (
          <span className="ml-auto shrink-0 text-[11px] text-muted-foreground">
            {label}
          </span>
        ) : null}
      </div>
      {entry.status === "waiting" && entry.wait_reason ? (
        <p className="mt-1 break-words text-xs text-amber-600">
          等待原因：{entry.wait_reason}
        </p>
      ) : null}
      {/* output 全量透传（D-004@v1）：无 clamp 自然换行 + max-h 滚动兜底（R-07） */}
      {entry.output ? (
        <p className="mt-1 max-h-48 max-w-[560px] overflow-y-auto break-words text-xs leading-relaxed text-muted-foreground">
          {entry.output}
        </p>
      ) : null}
    </div>
  );
});

interface StageGroupHeaderProps {
  stage: string;
  /** 该组已完成步数 / 总步数 */
  done: number;
  total: number;
}

/** stage 组头：组名 + 引导线 + 完成数徽标（ql-20260821-017 对齐系统弱分隔风格） */
function StageGroupHeader({ stage, done, total }: StageGroupHeaderProps) {
  const label = WORKFLOW_STAGE_LABELS[stage] ?? stage;
  const allDone = done === total;
  return (
    <div
      data-stage={stage}
      className="mb-1.5 mt-4 flex items-center gap-2 first:mt-0"
    >
      <span
        className={`shrink-0 text-[11px] font-medium ${
          allDone ? "text-muted-foreground" : "text-foreground/80"
        }`}
      >
        {label}
      </span>
      <span aria-hidden className="h-px flex-1 bg-border" />
      <span className="shrink-0 rounded-full bg-muted px-1.5 py-px text-[10px] tabular-nums text-muted-foreground">
        {done}/{total} 步
      </span>
    </div>
  );
}

export interface ChangeStepTimelineProps {
  /** step 级时间线明细（ChangeRead.steps）；null/undefined/空数组不渲染（降级，D-003@v1） */
  steps: StepTimelineEntry[] | null;
  /**
   * 阶段筛选（ql-20260821-017 阶段-步骤联动）：null/undefined = 全部阶段；
   * 指定 stage 时仅渲染该组（与 ChangeStageHeader 节点点击联动）。筛选命中
   * 空组时渲染弱提示行，不抛错。
   */
  focusStage?: string | null;
}

/**
 * 变更详情步骤时间线（2026-08-15-change-step-visibility / FR-02 / D-005@v1）。
 *
 * 按 stage 分组的垂直时间线，替代已删除的 SillySpecStepProgress（旧组件数据源
 * 是 change.stages dispatch 快照，与新 latest_progress 数据源并存会同屏不一致，
 * design Grill #17）。样式对齐原型 prototype-change-step-visibility.html 第②段
 * （timeline / tl-item / tl-dot / stage-group）。
 */
export function ChangeStepTimeline({ steps, focusStage = null }: ChangeStepTimelineProps) {
  // 空态：无明细数据时不渲染任何节点（调用方布局不受影响，不抛错）
  if (!steps || steps.length === 0) return null;

  // 阶段筛选（联动）：focusStage 只保留同 stage 条目，其余组整体隐藏
  const visible =
    focusStage !== null ? steps.filter((e) => e.stage === focusStage) : steps;
  if (visible.length === 0) {
    return (
      <p className="py-2 text-xs text-muted-foreground">该阶段暂无步骤记录。</p>
    );
  }

  // 连续同 stage 归组——后端已保证 entries 按 STAGE_ORDER 分组定序 + 组内
  // ordering 排序（service._extract_step_progress），此处纯分组遍历不排序。
  const groups: { stage: string; entries: StepTimelineEntry[] }[] = [];
  for (const entry of visible) {
    const last = groups[groups.length - 1];
    if (last && last.stage === entry.stage) {
      last.entries.push(entry);
    } else {
      groups.push({ stage: entry.stage, entries: [entry] });
    }
  }

  return (
    <div
      data-testid="change-step-timeline"
      className="relative pl-[26px] before:absolute before:left-2 before:top-1.5 before:bottom-1.5 before:w-0.5 before:bg-border"
    >
      {groups.map((group) => (
        <Fragment key={group.stage}>
          <StageGroupHeader
            stage={group.stage}
            done={group.entries.filter((e) => e.status === "completed").length}
            total={group.entries.length}
          />
          {group.entries.map((entry) => {
            // 稳定 key：stage + ordering 组合（CLI 表列 ordering NOT NULL
            // DEFAULT 0，真实数据组内唯一），diff 只动变化节点不整列重挂。
            const itemKey = `${entry.stage}-${entry.ordering}`;
            return (
              <TimelineItem key={itemKey} entry={entry} itemKey={itemKey} />
            );
          })}
        </Fragment>
      ))}
    </div>
  );
}
