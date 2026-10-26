"use client";

/**
 * 入口总进度圈（2026-10-26-session-change-progress-hover task-09 / FR-05 /
 * D-003@v1 / D-013@v1）：悬浮框「变更」按钮旁仅露单个总进度圆环 + 中心百分比，
 * 展示最新进行中（updated_at 最新非归档）变更的总完成度。
 *
 * - 双口径单源（design「接口定义·入口总进度圈口径」，两纯函数导出不散落）：
 *   全量 = step_progress.steps_completed / step_total；
 *   轻量 = 相位加权 spec=0.1 / awaiting_approval=0.15 /
 *          executing=0.33 + 0.34×tasks_done/max(tasks_total,1) /
 *          closing=0.67 + 0.33×substeps_done/8；
 *   数据缺失（口径数据源缺失）→ null → 环不渲染（FR-07 降级，按钮区不受影响）。
 * - 选取：pickLatestActive（纯函数导出，task-10 悬浮框侧调用）对 active 显式
 *   updated_at 重排取最新——禁用后端列表序直接取首（后端序=未归档优先+
 *   created_at desc，session-change-files-hover.tsx:63 注释，active[0] ≠
 *   updated_at 最新，D-013@v1）；并列 updated_at 回退 change_key 码点序，
 *   结果与输入顺序无关（盲区#6）。
 * - 类型：task-01 契约已落 backend（backend/app/modules/change/schema.py
 *   ThinFlowProgress / StepProgressSummary），api-types.ts 待 task-11
 *   gen:types 再生成——生成前本组件手写最小结构视图（TotalProgressChange），
 *   task-10 接线时传生成版 ChangeSummary 结构子类型兼容，task-11 落盘后
 *   可切换为生成类型并删除本段手写视图。
 * - 主题：色阶走语义 token 类（stroke-brand-500 / text-brand-600 / stroke-border
 *   随 html data-theme 换肤），无裸 hex（FRONTEND_PAGE_STYLE §0.5 多主题铁律）。
 */

/**
 * 轻量变更相位进度（task-11 gen:types 落地后切生成物——与 task-08 进度行
 * 的 ThinFlowProgress 同源（生成物 components["schemas"]）；最小视图时期的
 * 导出名保留，既有消费方 import 面零变化）。
 */
export type ThinFlowProgressLike = import("../daemon/change-progress-row").ThinFlowProgress;

/**
 * 总进度圈消费的变更最小结构视图（api-types 生成版 ChangeSummary 的结构
 * 子类型；task-11 gen:types 落盘后调用方可直接传生成版类型）。
 */
export interface TotalProgressChange {
  change_key: string;
  updated_at: string;
  is_thin: boolean;
  /** 全量口径数据源（StepProgressSummary 消费子集） */
  step_progress?: { step_total: number; steps_completed: number } | null;
  /** 轻量口径数据源（旧 daemon 无该键 → null，环不渲染） */
  thin_flow?: ThinFlowProgressLike | null;
}

/** 比值钳制 [0,1]——异常计数（completed>total / done>total）不出 >100% 或负值。 */
function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v));
}

/**
 * 总进度口径函数（单源导出，design FR-05）：
 *
 * - 分支优先级单源（FR-04 同款规则）：is_thin && thin_flow 存在且未升厚 →
 *   轻量相位加权；否则（含升厚 upgraded）→ 全量步数比；
 * - 全量：step_progress.steps_completed / step_total（缺失或 step_total=0 → null）；
 * - 轻量：spec=0.1 / awaiting_approval=0.15 /
 *   executing=0.33 + 0.34×tasks_done/max(tasks_total,1) /
 *   closing=0.67 + 0.33×substeps_done/8（substeps_total 恒 8 定长）；
 *   thin_flow 缺失（旧 daemon）或 phase 在归一枚举外 → null。
 */
export function computeTotalRatio(change: TotalProgressChange): number | null {
  const thin = change.thin_flow ?? null;
  // 轻量支：is_thin 且有 thin_flow 数据且未升厚（升厚走全量流程，D-007@v1）
  if (change.is_thin && thin && !thin.upgraded) {
    switch (thin.phase) {
      case "spec":
        return 0.1;
      case "awaiting_approval":
        return 0.15;
      case "executing": {
        // tasks_total=0 不除零：分母 max(,1) 兜底（0 勾选 → 0.33 相位基线）
        const denom = Math.max(thin.tasks_total, 1);
        return clamp01(0.33 + 0.34 * (thin.tasks_done / denom));
      }
      case "closing":
        // SUBSTEPS 定长 8（sillyspec flow 收口子步），按契约公式字面分母
        return clamp01(0.67 + 0.33 * (thin.substeps_done / 8));
      default:
        // backend 归一枚举外的透传值（fail-open）：无口径可算 → 不渲染
        return null;
    }
  }
  // 全量支（非 thin / thin 但缺数据 / 已升厚）
  const sp = change.step_progress ?? null;
  if (!sp || sp.step_total <= 0) return null;
  return clamp01(sp.steps_completed / sp.step_total);
}

/** updated_at 解析（非法/缺失串 → 0 排最后，数据异常不崩排序）。 */
function parseUpdatedTs(iso: string | null | undefined): number {
  if (!iso) return 0;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? 0 : t;
}

/**
 * 目标变更选取函数（纯函数导出，D-013@v1）：active（非归档）中 updated_at
 * 最新一个。显式 [...active].sort 重排，不信任后端返回序（未归档优先+
 * created_at desc ≠ updated_at 最新）；并列 updated_at 次序键回退 change_key
 * 码点升序（不用 localeCompare——避免 ICU/locale 差异引入平台不确定性），
 * 保证选取结果与输入顺序无关（盲区#6）。空数组 → null。
 */
export function pickLatestActive<T extends TotalProgressChange>(
  active: readonly T[],
): T | null {
  if (active.length === 0) return null;
  const sorted = [...active].sort((a, b) => {
    const ta = parseUpdatedTs(a.updated_at);
    const tb = parseUpdatedTs(b.updated_at);
    if (ta !== tb) return tb - ta; // updated_at desc（最新在前）
    if (a.change_key !== b.change_key) {
      // 并列回退：change_key 码点升序（确定性，与输入顺序无关）
      return a.change_key < b.change_key ? -1 : 1;
    }
    return 0;
  });
  return sorted[0] ?? null;
}

/** 圆环几何常量：viewBox 24×24、r=10、strokeWidth=3（紧凑 h-6 w-6 级）。 */
const RING_RADIUS = 10;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

export interface ChangeTotalProgressRingProps {
  /** 目标变更（task-10 悬浮框侧经 pickLatestActive 选取后传入） */
  change: TotalProgressChange;
}

/**
 * 单个总进度圆环 + 中心百分比（紧凑尺寸，挂悬浮按钮旁）。
 * ratio 经 computeTotalRatio 得 null（数据缺失）→ 返回 null 不渲染（FR-05
 * 降级：入口按钮与计数徽标照常，环位不占空间）。进度文本化进 aria-label
 * （R-05 无障碍），中心文字对读屏隐藏避免重复播报。
 */
export function ChangeTotalProgressRing({ change }: ChangeTotalProgressRingProps) {
  const ratio = computeTotalRatio(change);
  if (ratio === null) return null;

  const pct = Math.round(ratio * 100);
  const dash = RING_CIRCUMFERENCE * ratio;

  return (
    <span
      data-testid="change-total-progress-ring"
      role="img"
      aria-label={`变更总进度 ${pct}%`}
      title={`${change.change_key} 总进度 ${pct}%`}
      className="relative inline-flex h-6 w-6 shrink-0 items-center justify-center"
    >
      {/* -rotate-90：dasharray 默认 3 点方向起笔，转 12 点方向顺时针填充 */}
      <svg viewBox="0 0 24 24" className="h-6 w-6 -rotate-90" aria-hidden="true">
        {/* 轨道底环（border 语义 token，随主题换肤） */}
        <circle
          cx="12"
          cy="12"
          r={RING_RADIUS}
          fill="none"
          strokeWidth="3"
          className="stroke-border"
        />
        {/* 进度弧（brand 语义阶主色环，随主题换肤） */}
        <circle
          data-testid="change-total-progress-ring-arc"
          cx="12"
          cy="12"
          r={RING_RADIUS}
          fill="none"
          strokeWidth="3"
          strokeLinecap="round"
          strokeDasharray={`${dash} ${RING_CIRCUMFERENCE}`}
          className="stroke-brand-500"
        />
      </svg>
      {/* 中心百分比文字（叠环中心；tabular-nums 防跳宽；读屏由容器 aria-label 承担） */}
      <span
        data-testid="change-total-progress-ring-percent"
        aria-hidden="true"
        className="absolute inset-0 flex items-center justify-center text-[8px] font-bold leading-none tabular-nums text-brand-600 dark:text-brand-300"
      >
        {pct}%
      </span>
    </span>
  );
}
