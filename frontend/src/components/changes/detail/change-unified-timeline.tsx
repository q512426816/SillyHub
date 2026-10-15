"use client";

/**
 * 统一过程时间线（2026-10-15-change-detail-redesign / FR-09 / D-005@v1 / D-014@v1）。
 *
 * 一条时间线取代原「步骤时间线 + 真实留痕时间线」两卡；行数据来自
 * `mergeChangeTimeline`（纯函数，见同目录 merge-change-timeline.ts）——本组件只渲染，
 * 不合并、不去重、不取数（数据由页面/面板注入）。
 *
 * 结构：阶段筛选 chips（受控，与页面上方阶段条联动由调用方接线）+ primer `Timeline`
 * 行（来源胶囊 + 阶段胶囊 + 提交短哈希与标题 + 时间）+ 展开详情（步骤 output 全文，
 * `TimelineItem` 自带折叠）+ 卡下方合并口径说明（含同键去重取舍声明，D-016/G-1）。
 */
import { WORKFLOW_STAGE_LABELS } from "@/components/changes/detail/change-stage-header";
import { Counter, StateIcon, Timeline, TimelineItem } from "@/components/primer";
import type { StateIconName } from "@/components/primer";
import type { UnifiedRow, UnifiedTone } from "@/components/changes/detail/merge-change-timeline";

const TONE_ICON: Record<UnifiedTone, StateIconName> = {
  success: "check",
  current: "openCircle",
  warning: "zap",
  default: "clock",
};

/** 行内来源标签（两源 + 诞生锚；让读者一眼分辨动作来自哪条数据面）。 */
const SOURCE_LABEL: Record<UnifiedRow["source"], string> = {
  born: "锚点",
  step: "步骤",
  event: "事件",
};

/** 时间展示：可解析 → 本地 MM-DD HH:mm；不可解析 → 原文（MUST NOT 丢信息）；缺 → —。 */
export function formatRowTime(at: string | null): string {
  if (!at) return "—";
  const ms = Date.parse(at);
  if (Number.isNaN(ms)) return at;
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function Chip({ children }: { children: React.ReactNode }) {
  return (
    <span
      className="shrink-0 rounded-full border px-2 py-px text-[11px] text-muted-foreground"
      style={{ borderColor: "hsl(var(--border))" }}
    >
      {children}
    </span>
  );
}

export interface ChangeUnifiedTimelineProps {
  /** 合并后的行（`mergeChangeTimeline` 输出，升序 + 无时间者置尾）。 */
  rows: UnifiedRow[];
  /** 受控阶段筛选（null = 全部）；与页面上方阶段条联动由调用方接线。 */
  activeStage: string | null;
  onStageChange(_stage: string | null): void;
}

export function ChangeUnifiedTimeline({
  rows,
  activeStage,
  onStageChange,
}: ChangeUnifiedTimelineProps) {
  const stageCounts = new Map<string, number>();
  for (const row of rows) {
    if (!row.stage) continue;
    stageCounts.set(row.stage, (stageCounts.get(row.stage) ?? 0) + 1);
  }
  const visible = activeStage ? rows.filter((r) => r.stage === activeStage) : rows;

  const chipClass = (active: boolean) =>
    `inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-px text-[11px] transition-colors ${
      active
        ? "border-brand-300 bg-brand-500/10 text-brand-600"
        : "text-muted-foreground hover:bg-muted"
    }`;

  return (
    <div className="flex flex-col gap-3" data-testid="change-unified-timeline">
      <div className="flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          aria-pressed={activeStage === null}
          onClick={() => onStageChange(null)}
          className={chipClass(activeStage === null)}
          style={activeStage === null ? undefined : { borderColor: "hsl(var(--border))" }}
        >
          全部 <Counter count={rows.length} active={activeStage === null} />
        </button>
        {[...stageCounts.entries()].map(([stage, count]) => (
          <button
            key={stage}
            type="button"
            aria-pressed={activeStage === stage}
            onClick={() => onStageChange(activeStage === stage ? null : stage)}
            className={chipClass(activeStage === stage)}
            style={activeStage === stage ? undefined : { borderColor: "hsl(var(--border))" }}
          >
            {WORKFLOW_STAGE_LABELS[stage] ?? stage}
            <Counter count={count} active={activeStage === stage} />
          </button>
        ))}
        <span className="ml-auto text-[11px] text-muted-foreground">
          点击阶段可筛选；与上方阶段条联动
        </span>
      </div>

      {visible.length === 0 ? (
        <p className="py-4 text-center text-xs text-muted-foreground">
          {activeStage ? "该阶段暂无过程记录。" : "暂无过程记录。"}
        </p>
      ) : (
        <Timeline>
          {visible.map((row) => (
            <TimelineItem
              key={row.key}
              icon={<StateIcon name={TONE_ICON[row.tone]} size={14} />}
              tone={row.tone === "warning" ? "default" : row.tone}
              title={
                <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span>{row.title}</span>
                  {row.stage ? <Chip>{WORKFLOW_STAGE_LABELS[row.stage] ?? row.stage}</Chip> : null}
                  <Chip>{SOURCE_LABEL[row.source]}</Chip>
                  {row.commitSha ? (
                    <span className="font-mono text-[11px] text-brand-600">
                      {row.commitSha}
                      {row.commitTitle ? ` ${row.commitTitle}` : ""}
                    </span>
                  ) : null}
                </span>
              }
              time={
                <span className="flex flex-col items-end gap-0.5">
                  <span>{formatRowTime(row.at)}</span>
                  {row.meta ? <span className="text-[10px]">{row.meta}</span> : null}
                </span>
              }
            >
              {row.detail || row.waitReason
                ? [row.waitReason ? `等待原因：${row.waitReason}` : null, row.detail]
                    .filter(Boolean)
                    .join("\n")
                : undefined}
            </TimelineItem>
          ))}
        </Timeline>
      )}

      <p className="text-[11px] leading-5 text-muted-foreground">
        合并口径：源内按稳定键去重（步骤 = 阶段 + 序位，事件 = 时间 + 类型 + 文本）。
        task-done 事件不单独成行——任务行的勾选时刻本就由该事件推断而来（同一份数据），任务面统一由「任务进度」清单承载；
        步骤行与任务行不做跨源合并（粒度不同，合并需名称/时间近似匹配，属脆弱启发式）。
        同一秒、同一类型、同一文本的事件视为**同一观测的重复上报**，只保留一条（去重取舍声明）。
        两源独有字段全保留：步骤侧含阶段归属、等待原因与输出全文；事件侧含提交短哈希与标题、文件与配置变更事件。
      </p>
    </div>
  );
}
