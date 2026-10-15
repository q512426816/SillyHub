/**
 * 统一过程时间线 —— 步骤与留痕两源合并的纯函数（2026-10-15-change-detail-redesign / D-005@v1 / D-014@v1 / D-016@v1）。
 *
 * 取代原「步骤时间线卡 + 真实留痕时间线卡」两张重叠卡：一条时间线，每个源内动作只出现一次。
 * 三层口径（逐条落实现，禁止近似匹配）：
 *   ① 源内严格去重——步骤键 `step:${stage}:${ordering}`（`StepTimelineEntry.stage`/`ordering`
 *      为稳定字段，无 id；后端 `_merge_owner_events` 重编 ordering 保证唯一）、事件键
 *      `event:${ts}:${kind}:${label}`、诞生锚键 `born`；
 *   ② task-done 折叠——`kind="task-done"` 且 detail 命中 tasks 域（`checked N→M` 的 stage
 *      前缀为 `tasks` 或缺省）不产出时间线行（其信息由「任务进度」清单承载，清单的勾选时刻
 *      本就由这些事件推断而来 = 同源确定重合，见 backend/app/modules/change/timeline.py:96-122）；
 *      非 tasks 域（如 `design · checked 0→6`）保留为普通事件行；
 *   ③ 排序——有可解析时间者按时间升序，无时间/不可解析者置末尾并按阶段序稳定排序。
 *
 * 三输入类取舍（D-016，均入单测）：非 ISO `completed_at` 残留原串先做可解析判定，不可解析者
 * 与无时间戳者同置末尾（MUST NOT 混入时间序比较）；事件同键碰撞保留去重（同秒同类型同文本
 * 视为同一观测的重复上报，MUST NOT 用序号后缀绕过）；task-done 推断断裂由
 * `inferTaskTimeStatus` 标注「时刻不可推断（观测断链）」而非裸问号。
 *
 * 边界：本模块**零取数零副作用**（MUST NOT import react/fetch/react-query），可在 node 环境
 * 直接单测；步骤行与任务行 MUST NOT 跨源合并（粒度不同、映射非确定）。
 */
import type { components } from "@/lib/api-types";

export type StepTimelineEntry = components["schemas"]["StepTimelineEntry"];
export type TimelineEvent = components["schemas"]["TimelineEvent"];
export type TimelineTask = components["schemas"]["TimelineTask"];

/** 合并输入：三源（steps 步骤 / events 事件轴 / bornAt 诞生锚）。 */
export interface MergeInput {
  steps: StepTimelineEntry[] | null;
  events: TimelineEvent[];
  bornAt: string | null;
}

export type UnifiedSource = "born" | "step" | "event";
export type UnifiedTone = "success" | "current" | "default" | "warning";

/** 合并后统一行（组件渲染的唯一输入形态）。 */
export interface UnifiedRow {
  /** 源内稳定键（去重键，勿作为 React key 之外用途）。 */
  key: string;
  /** 原始时间串（ISO 或原串；无时间戳为 null）。 */
  at: string | null;
  source: UnifiedSource;
  /** 阶段归属：步骤侧直取 stage；事件侧按 kind 映射（verify/gate-run→验证，archived→归档），其余 null。 */
  stage: string | null;
  tone: UnifiedTone;
  title: string;
  /** 次要说明（步骤状态中文 / 事件类型中文）。 */
  meta: string | null;
  /** 步骤 output 全文（事件侧 null）。 */
  detail: string | null;
  waitReason: string | null;
  /** 事件 kind=commit 的短哈希（步骤侧 null）。 */
  commitSha: string | null;
  commitTitle: string | null;
}

/** 任务勾选时刻状态（区分「未勾选」与「勾选时刻不可推断」，D-016）。 */
export interface TaskTimeStatus {
  status: "checked" | "unchecked" | "broken";
  /** ISO 时刻（`broken`/`unchecked` 为 null）。 */
  at: string | null;
}

/** 阶段展示序（与 change-stage-header 的 WORKFLOW_STAGES 同序，另含 thin/quick 兜底）。 */
const STAGE_ORDER = [
  "brainstorm",
  "plan",
  "execute",
  "verify",
  "archive",
  "thin",
  "quick",
] as const;

/** 步骤状态 → 行色调（7 值枚举，未知按 pending）。 */
const STEP_TONE: Record<string, UnifiedTone> = {
  completed: "success",
  "in-progress": "current",
  waiting: "warning",
  failed: "warning",
  blocked: "warning",
  stale: "warning",
  pending: "default",
};

/** 步骤状态 → 中文（与 change-step-timeline 的 STATUS_LABEL 同口径，另补 completed/pending 兜底）。 */
const STEP_STATUS_LABEL: Record<string, string> = {
  completed: "已完成",
  "in-progress": "进行中",
  waiting: "等待中",
  failed: "失败",
  blocked: "已阻塞",
  stale: "已过期",
  pending: "待执行",
};

/** 事件 kind → 中文（与 change-timeline-card 的 KIND_ICON 同键集，供 meta 展示）。 */
const EVENT_KIND_LABEL: Record<string, string> = {
  "file-update": "文件变更",
  "task-done": "任务勾选",
  warning: "警告",
  commit: "提交",
  archived: "已归档",
  "gate-run": "门禁执行",
  "config-change": "配置变更",
  "fake-check-cleared": "误报澄清",
  verify: "验证",
  born: "变更诞生",
  "owner-change": "负责人变更",
};

/** 事件 kind → 阶段归属（仅可确定映射的少数类型；其余 null）。 */
const EVENT_STAGE: Record<string, string> = {
  verify: "verify",
  "gate-run": "verify",
  archived: "archive",
};

/** 事件 kind → 行色调。 */
const EVENT_TONE: Record<string, UnifiedTone> = {
  warning: "warning",
  "task-done": "success",
  commit: "current",
  archived: "success",
  verify: "success",
  "gate-run": "success",
  born: "success",
};

/** tasks 域 task-done 的 detail 形态（照抄后端 `_TASK_DONE_RE`）。 */
const TASK_DONE_RE = /^(?:(\S+) · )?checked (\d+)→(\d+)/;

/** 时间可解析判定：可解析返回毫秒数，否则 null（非 ISO 原串走 null → 置尾）。 */
function atMs(at: string | null | undefined): number | null {
  if (!at) return null;
  const ms = Date.parse(at);
  return Number.isNaN(ms) ? null : ms;
}

/** 阶段排序权重（未知阶段排在已列阶段之后，保持稳定）。 */
function stageRank(stage: string | null): number {
  if (!stage) return STAGE_ORDER.length + 1;
  const idx = (STAGE_ORDER as readonly string[]).indexOf(stage);
  return idx >= 0 ? idx : STAGE_ORDER.length;
}

/** 该事件是否属 tasks 域 task-done（命中则折叠，不产出时间线行）。 */
function isTasksDomainTaskDone(ev: TimelineEvent): boolean {
  if (ev.kind !== "task-done") return false;
  const m = TASK_DONE_RE.exec(ev.label ?? "");
  if (!m) return false;
  const domain = m[1];
  return domain === undefined || domain === "tasks";
}

/**
 * 任务勾选时刻的观测链是否断裂（勾选游标 `checked N→M` 不连续 = 观测盲窗丢拍，
 * 此后时刻不可信）。语义照抄后端 `_infer_task_times`：非 tasks 域前缀跳过；
 * `start !== cursor` 即断裂。
 */
export function isTaskTimeChainBroken(events: TimelineEvent[]): boolean {
  return unreliableFrom(events) !== null;
}

/**
 * 观测链的**首个不可信任务下标**（0-based）：链连续则返回 null（全部可信）；
 * 首个 `start !== cursor` 处返回该 start（此下标起的任务时刻不可信）。
 * 语义与后端 `_infer_task_times` 的 break 点同源核算。
 */
function unreliableFrom(events: TimelineEvent[]): number | null {
  let cursor = 0;
  for (const ev of events) {
    if (ev.kind !== "task-done") continue;
    const m = TASK_DONE_RE.exec(ev.label ?? "");
    if (!m) continue;
    const domain = m[1];
    if (domain !== undefined && domain !== "tasks") continue;
    const start = Number(m[2]);
    if (start !== cursor) return start;
    cursor = Number(m[3]);
  }
  return null;
}

/**
 * 任务面时刻三态（供「任务进度」清单消费）：
 * - `unchecked`：未勾选（无时刻属正常）；
 * - `checked`：已勾选且有推断时刻（后端 `TimelineTask.time`）；
 * - `broken`：已勾选但无时刻（观测断链或游标未覆盖）——UI MUST 显示
 *   「时刻不可推断（观测断链）」，MUST NOT 显示裸问号（D-016）。
 */
export function inferTaskTimeStatus(
  tasks: TimelineTask[],
  events: TimelineEvent[],
): TaskTimeStatus[] {
  const broken = unreliableFrom(events);
  return tasks.map((t, i) => {
    if (!t.checked) return { status: "unchecked", at: null };
    if (t.time && (broken === null || i < broken)) {
      return { status: "checked", at: t.time };
    }
    return { status: "broken", at: null };
  });
}

/** 合并入口（纯函数，无取数、无副作用）。 */
export function mergeChangeTimeline(input: MergeInput): UnifiedRow[] {
  const rows: Array<UnifiedRow & { _ms: number | null; _idx: number }> = [];
  let idx = 0;

  if (input.bornAt) {
    rows.push({
      key: "born",
      at: input.bornAt,
      source: "born",
      stage: null,
      tone: "success",
      title: "变更诞生",
      meta: "requirements.md created_at",
      detail: null,
      waitReason: null,
      commitSha: null,
      commitTitle: null,
      _ms: atMs(input.bornAt),
      _idx: idx++,
    });
  }

  const seen = new Set<string>();
  for (const step of input.steps ?? []) {
    const key = `step:${step.stage}:${step.ordering}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const isEvent = step.kind === "event";
    rows.push({
      key,
      at: step.completed_at ?? null,
      source: "step",
      stage: step.stage ?? null,
      tone: isEvent
        ? "default"
        : (STEP_TONE[step.status] ?? "default"),
      title: step.name,
      meta: isEvent
        ? "履历事件"
        : (STEP_STATUS_LABEL[step.status] ?? step.status),
      detail: step.output ?? null,
      waitReason: step.wait_reason ?? null,
      commitSha: null,
      commitTitle: null,
      _ms: atMs(step.completed_at),
      _idx: idx++,
    });
  }

  for (const ev of input.events) {
    if (isTasksDomainTaskDone(ev)) continue; // 折叠：由任务清单承载
    const key = `event:${ev.ts}:${ev.kind}:${ev.label}`;
    if (seen.has(key)) continue; // 同键碰撞：同秒同类型同文本视为同一观测的重复上报
    seen.add(key);
    rows.push({
      key,
      at: ev.ts ?? null,
      source: "event",
      stage: EVENT_STAGE[ev.kind] ?? null,
      tone: EVENT_TONE[ev.kind] ?? "default",
      title: ev.label || ev.kind,
      meta: EVENT_KIND_LABEL[ev.kind] ?? ev.kind,
      detail: null,
      waitReason: null,
      commitSha: ev.kind === "commit" ? (ev.label || null) : null,
      commitTitle: ev.kind === "commit" ? (ev.commit_title ?? null) : null,
      _ms: atMs(ev.ts),
      _idx: idx++,
    });
  }

  rows.sort((a, b) => {
    const aHas = a._ms !== null;
    const bHas = b._ms !== null;
    if (aHas && bHas && a._ms !== b._ms) return a._ms! - b._ms!;
    if (aHas !== bHas) return aHas ? -1 : 1; // 无时间/不可解析者置末尾
    if (!aHas && !bHas) {
      const ra = stageRank(a.stage);
      const rb = stageRank(b.stage);
      if (ra !== rb) return ra - rb;
    }
    return a._idx - b._idx; // 稳定序
  });

  return rows.map(({ _ms: _dropMs, _idx: _dropIdx, ...row }) => row);
}
