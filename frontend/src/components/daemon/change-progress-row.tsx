"use client";

/**
 * 会话悬浮变更面板·下拉项进度行（2026-10-26-session-change-progress-hover
 * task-08 / FR-01~FR-04）。双分支单源规则（FR-04）：
 *   is_thin && !upgraded && change_type!=='quick' → 轻量 ①②③ 相位行；
 *   否则（含升厚 D-007——忽略 thin_flow 残留相位值；change_type==='quick' 存量
 *   出身独立判 thin 场景，backend _is_thin_lineage 分支②）→ 全量 5 圈行。
 * 降级（FR-07）：分支数据缺失（轻量无 thin_flow / 全量无 stage_progress）→
 * 返回 null 不渲染（现状保底不报错）；归档项挂载由消费方控制（D-009）。
 * 色阶铁律（FRONTEND_PAGE_STYLE §0.5 / R-05）：全走主题 CSS 变量，无裸 hex；
 * 圈为 conic-gradient 占比填充的 h-2.5 w-2.5 紧凑小圈。
 */

import {
  WORKFLOW_STAGES,
  WORKFLOW_STAGE_LABELS,
} from "@/components/changes/detail/change-stage-header";
import type { components } from "@/lib/api-types";
import type { ChangeSummary } from "@/lib/changes";

// ── 类型（task-11 gen:types 落地后）：三 DTO 切生成物（components["schemas"]，
// 与 backend schema.py 逐字对齐，生成物 15088-15090 行 ChangeSummary 已含三新
// 字段）；导出名保留手写期形态，既有消费方（hover/ring/测试）import 面零变化。──

/** 主线单阶段进度项（生成物 StageProgressEntry）。status 为 CLI 原值透传不归一。 */
export type StageProgressEntry = components["schemas"]["StageProgressEntry"];

/** execute 阶段任务进度（生成物 TaskProgressSummary；Task 表口径 D-005@v1）。 */
export type TaskProgressSummary = components["schemas"]["TaskProgressSummary"];

/** 轻量变更相位进度（生成物 ThinFlowProgress；phase 归一四枚举）。 */
export type ThinFlowProgress = components["schemas"]["ThinFlowProgress"];

/** ChangeSummary + 三新字段（生成版已含三字段；别名保住既有 import 面）。 */
export type ChangeSummaryWithProgress = ChangeSummary;

export interface ChangeProgressRowProps {
  change: ChangeSummaryWithProgress;
  /** 轻量总时长起点（FR-03 created_at→updated_at）。ChangeSummary 后端 DTO
   * 不返回 created_at，消费方无来源时省略 → 总时长段不渲染（fail-open）。 */
  createdAt?: string | null;
}

/** 耗时人性化（m/h 自适应）：秒级显秒 / 分钟级显分 / 小时级一位小数。 */
export function formatDurationSeconds(
  seconds: number | null | undefined,
): string {
  if (seconds == null || !Number.isFinite(seconds) || seconds < 0) return "";
  if (seconds < 60) return `${Math.round(seconds)}秒`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}分`;
  return `${(seconds / 3600).toFixed(1)}时`;
}

// ── 全量支（FR-01/FR-02）────────────────────────────────────────────────────

/** 异常态映射（D-002@v1）：waiting/stale/revising=warning、blocked/failed=error；revising 带 revision 轮次。 */
const ABNORMAL_STATUSES: Record<
  string,
  { label: (_e: StageProgressEntry) => string; tone: "warning" | "error" }
> = {
  waiting: { label: () => "等待中", tone: "warning" },
  stale: { label: () => "过期", tone: "warning" },
  revising: {
    label: (e) => (e.revision != null ? `修订${e.revision}` : "修订中"),
    tone: "warning",
  },
  blocked: { label: () => "阻塞", tone: "error" },
  failed: { label: () => "失败", tone: "error" },
};

/** 单阶段小圈：completed=绿勾 / in-progress=conic 占比 / 异常态=warning·error
 *  实色 / pending=空圈 / 未知值（盲区#10）=灰态。 */
function StageDot({ entry, testid }: { entry: StageProgressEntry | undefined; testid: string }) {
  const status = entry?.status ?? "pending";
  const abnormal = ABNORMAL_STATUSES[status];
  if (status === "completed") {
    return (
      <span data-testid={testid} className="text-[11px] font-bold leading-none text-success">✓</span>
    );
  }
  if (abnormal) {
    return (
      <span data-testid={testid} aria-hidden className={`h-2.5 w-2.5 shrink-0 rounded-full ${
        abnormal.tone === "error" ? "bg-error" : "bg-warning"
      }`} />
    );
  }
  if (status === "in-progress") {
    // 盲区#1：steps 空（阶段未初始化）steps_total=0 → 0% 填充不除零
    const total = entry?.steps_total ?? 0;
    const done = entry?.steps_completed ?? 0;
    const deg = total > 0 ? Math.round((done / total) * 360) : 0;
    return (
      <span data-testid={testid} data-progress={total > 0 ? `${done}/${total}` : "0"} aria-hidden
        className="h-2.5 w-2.5 shrink-0 rounded-full"
        style={{ background: `conic-gradient(hsl(var(--primary)) ${deg}deg, hsl(var(--border)) 0deg)` }} />
    );
  }
  // pending=空圈；CLI 新枚举未知值（盲区#10）=灰态圈（原值文字由外层单元渲染）
  const isPending = status === "pending";
  return (
    <span data-testid={testid} data-unknown={isPending ? undefined : status} aria-hidden
      className={`h-2.5 w-2.5 shrink-0 rounded-full ${isPending ? "border-2 border-border" : "bg-muted-foreground"}`} />
  );
}

/** 全量 5 圈行。stage_progress 缺行按 pending 空圈补位（WORKFLOW_STAGES 序）。 */
function FullStageRow({ entries, taskProgress, upgraded }: {
  entries: StageProgressEntry[];
  taskProgress: TaskProgressSummary | null;
  upgraded: boolean;
}) {
  const byStage = new Map(entries.map((e) => [e.stage, e]));
  // 盲区#2：total=0（全 cancelled）显 —，不用 0/0
  const taskText = !taskProgress
    ? null
    : taskProgress.total > 0
      ? `${taskProgress.done}/${taskProgress.total} 任务`
      : "—";

  const ariaText = WORKFLOW_STAGES.map((s) => {
    const e = byStage.get(s);
    const status = e?.status ?? "pending";
    const label = WORKFLOW_STAGE_LABELS[s];
    const abnormal = ABNORMAL_STATUSES[status];
    if (status === "completed") return `${label}已完成`;
    if (status === "in-progress") {
      const stepInfo = e && e.steps_total > 0 ? `，${e.steps_completed}/${e.steps_total}步` : "";
      return `${label}进行中${stepInfo}`;
    }
    if (abnormal && e) return `${label}${abnormal.label(e)}`;
    if (status === "pending") return `${label}未开始`;
    return `${label}${status}`; // 盲区#10：未知值原样文本化
  }).join("，");

  return (
    <div data-testid="change-progress-row" data-variant="full"
      aria-label={`变更进度：${ariaText}${taskText ? `，任务${taskText}` : ""}`}
      className="mt-1 flex flex-wrap items-start gap-x-2 gap-y-0.5">
      {WORKFLOW_STAGES.map((stage) => {
        const e = byStage.get(stage);
        const abnormal = e ? ABNORMAL_STATUSES[e.status] : undefined;
        const isUnknown = !!e && !abnormal && !["completed", "in-progress", "pending"].includes(e.status);
        const sideText = abnormal && e ? abnormal.label(e) : isUnknown && e ? e.status : null;
        const sideClass = abnormal && abnormal.tone === "error" ? "text-error" : abnormal ? "text-warning" : "text-muted-foreground";
        return (
          <div key={stage} className="flex min-w-0 flex-col items-center gap-0.5">
            <div className="flex items-center gap-1">
              <StageDot entry={e} testid={`progress-circle-${stage}`} />
              {stage === "execute" && taskText && (
                <span data-testid="progress-task-count" className="text-[10px] leading-3 text-muted-foreground">{taskText}</span>
              )}
              {sideText && (
                <span data-testid={`progress-status-${stage}`} className={`text-[10px] leading-3 ${sideClass}`}>{sideText}</span>
              )}
            </div>
            <span data-testid={`progress-duration-${stage}`} className="text-[9px] leading-3 text-muted-foreground">
              {formatDurationSeconds(e?.duration_seconds) || " "}
            </span>
          </div>
        );
      })}
      {upgraded && (
        <span data-testid="progress-upgraded-tag" className="text-[10px] leading-3 text-warning">已升厚→走全量</span>
      )}
    </div>
  );
}

// ── 轻量支：①②③ 相位行（FR-03/FR-04）───────────────────────────────────────

const THIN_PHASE_STEPS = [
  { key: "spec", label: "①规格" },
  { key: "executing", label: "②执行" },
  { key: "closing", label: "③归档" },
] as const;

const THIN_PHASE_ARIA: Record<string, string> = {
  spec: "规格",
  awaiting_approval: "规格待批准",
  executing: "执行",
  closing: "收口",
};

function ThinPhaseRow({ thin, updatedAt, createdAt }: {
  thin: ThinFlowProgress;
  updatedAt: string;
  createdAt: string | null;
}) {
  // awaiting_approval 是 spec 位的待批准子态（design FR-03）
  const phasePos = thin.phase === "awaiting_approval" ? "spec" : thin.phase;
  const approvalText = thin.autopilot ? "autopilot 豁免" : thin.approved ? "已批准" : "未批准";
  const approvalClass = thin.autopilot ? "text-info" : thin.approved ? "text-success" : "text-muted-foreground";
  // 盲区#8：spec 阶段未建任务 tasks_total=0 → 不显「任务 0/0」
  const tasksText = thin.phase === "executing" && thin.tasks_total > 0
    ? `任务 ${thin.tasks_done}/${thin.tasks_total}` : null;
  const substepsText = thin.phase === "closing"
    ? `子步 ${thin.substeps_done}/${thin.substeps_total || 8}` : null;
  // 总时长（D-001@v1）：created→updated；缺 created / 畸形时间 → 不显
  let durationText = "";
  if (createdAt) {
    const ms = new Date(updatedAt).getTime() - new Date(createdAt).getTime();
    if (Number.isFinite(ms) && ms >= 0) durationText = formatDurationSeconds(ms / 1000);
  }
  const adoptedText = thin.adopted_from === "brainstorm" ? "自头脑风暴转入" : "";
  const chips: Array<[string, string, string]> = [
    ["progress-thin-approval", approvalText, approvalClass],
    ...(tasksText
      ? ([["progress-thin-tasks", tasksText, "text-muted-foreground"]] as Array<[string, string, string]>) : []),
    ...(substepsText
      ? ([["progress-thin-substeps", substepsText, "text-muted-foreground"]] as Array<[string, string, string]>) : []),
    ...(durationText
      ? ([["progress-thin-duration", `总时长 ${durationText}`, "text-muted-foreground"]] as Array<[string, string, string]>) : []),
    ...(adoptedText
      ? ([["progress-thin-adopted", adoptedText, "text-muted-foreground"]] as Array<[string, string, string]>) : []),
  ];
  const aria = `轻量进度：${THIN_PHASE_ARIA[thin.phase] ?? thin.phase}；${chips.map(([, text]) => text).join("；")}`;

  return (
    <div data-testid="change-progress-row" data-variant="thin" aria-label={aria}
      className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[10px] leading-4">
      {THIN_PHASE_STEPS.map((p, i) => {
        const active = phasePos === p.key;
        const pendingApproval = active && thin.phase === "awaiting_approval";
        return (
          <span key={p.key} className="flex items-center gap-1.5">
            <span data-testid={`progress-thin-phase-${p.key}`}
              className={pendingApproval ? "font-semibold text-warning" : active ? "font-semibold text-brand-600" : "text-muted-foreground"}>
              {p.label}{pendingApproval ? "·待批准" : ""}
            </span>
            {i < THIN_PHASE_STEPS.length - 1 && (
              <span aria-hidden className="text-muted-foreground">→</span>
            )}
          </span>
        );
      })}
      {chips.map(([testid, text, cls]) => (
        <span key={testid} data-testid={testid} className={cls}>{text}</span>
      ))}
    </div>
  );
}

/**
 * 进度行入口。归档变更不应挂载本组件（D-009 非目标，消费方 task-10 控制）；
 * 升厚变更走全量支并保留「已升厚」标注（thin_flow 残留相位值不展示，盲区#9）。
 */
export function ChangeProgressRow({ change, createdAt }: ChangeProgressRowProps) {
  const thin = change.thin_flow ?? null;
  const upgraded = thin?.upgraded ?? false;
  const useThinBranch = change.is_thin && !upgraded && change.change_type !== "quick";

  if (useThinBranch) {
    // 降级（FR-07/盲区#5）：旧 daemon 无 thin_flows 键 → 不渲染（现状保底）
    if (!thin) return null;
    return <ThinPhaseRow thin={thin} updatedAt={change.updated_at} createdAt={createdAt ?? null} />;
  }
  // 降级（FR-01 场景：畸形 latest_progress fail-open → null / 空数组）同样不渲染
  const stages = change.stage_progress;
  if (!stages || stages.length === 0) return null;
  return (
    <FullStageRow entries={stages} taskProgress={change.task_progress ?? null} upgraded={upgraded} />
  );
}
