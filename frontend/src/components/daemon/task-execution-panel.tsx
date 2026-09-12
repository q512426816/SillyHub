"use client";

/**
 * TaskExecutionPanel —— 会话任务执行面板（折叠摘要行 + 三页签）
 * （2026-09-04-session-task-execution-panel task-07 / FR-01~04 / FR-07 /
 * D-001@v1 / D-003@v1 / D-004@v1）。形态对照原型
 * prototype-task-execution-panel.html（.tep 系列样式语义，形态对照非像素照抄）。
 *
 * 结构（方案 B / D-004@v1；挂载于会话头部横幅之下、会话主体之上，接线归 task-08）：
 *   - 折叠态：有数据才渲染的一行摘要「任务执行 · 运行中 N · 任务 M（成功 X /
 *     失败 Y）· 轮次 K」（ql-20260909-003-8a54 FR-01 决策演进：全零空数据返回 null，
 *     对齐 AgentLogCard 空态先例；原 task-07「折叠条常驻，空数据显示 0 计数」
 *     废弃），点击整行展开 / 收起；
 *   - 展开态三页签 + 内容区 max-h-[300px] 内部滚动（R-04：dialog 模式不挤压
 *     会话主体）：
 *     ① 任务清单：useSessionTasks(sessionId)（快照 + 实时合并，task-06）渲染
 *        紧凑任务行（状态圆标 / 任务名 / 正在做什么摘要 / 耗时 / tokens /
 *        工具数 / 终态定格 pill），新→旧；
 *     ② 运行中：runningTasks / bashProgress / teamMissions props 等值注入
 *        纯展示，原样复用 AgentTaskCard / BashProgressCard / TeamTaskBlock
 *        三类卡（编排对照 activity-catalog.tsx，数据与「后台 ▾」ActivityCatalog
 *        同源一致，不新建数据链路）；
 *     ③ 轮次历史：组件内 useEffect 自取数 listSessionRuns（零 react-query，
 *        SessionUsageBar refreshSignal 先例），runsRefreshSignal prop 递增重拉。
 *        轮次行 tokens 展示 quick ql-20260912-003-4506 改版：原 input+output
 *        合并单列拆为四维独立标签行（输入/输出/缓存读取/缓存写入，见
 *        RunListRow 头注释）。
 *
 * ── R-07 降级裁定（勿当 bug 修）───────────────────────────────────────
 * 计划总纲条（planObjective / planTasks props）仅活跃轮实时显示：streamSession
 * 的 resync / 首连缺口同步 syncGapFromDb（lib/daemon.ts）只回放 log 事件 +
 * 合成 turn_started / turn_completed，**不回放 plan_mode_entered**（onPlanMode
 * Entered 只在实时 SSE 分发触发）——刷新 / 重连后挂载方不再注入，总纲不显示、
 * 不报错是既定行为（design R-07），不是丢数据，请勿按 bug 修。plan 事件数据由
 * 挂载方从 session-panel 既有 onPlanModeEntered / planPending 内存态链路经
 * props 注入（task-08 接线），本组件不自建 plan 事件链路、不持久化。
 *
 * 数据边界：
 *   - 组件不建 SSE 连接（禁 EventSource / 二条流）：实时 agent_task_status
 *     事件经 ref handle 的 applyEvent 由 session-panel SSE 分发处注入
 *     （useSessionTasks 内按 session_id 守卫 + task_id upsert 归并，缺字段保
 *     旧值 / 终态定格不回退）；
 *   - 运行中区 props 等值注入纯展示，不重复请求；
 *   - 不感知 page / dialog / mobile 挂载模式，自适应容器宽度（摘要行 flex-wrap，
 *     禁 md:/lg: 视口断点前缀做容器内布局——知识库铁律，窄容器自然换行）。
 *
 * 主题（CLAUDE.md 规则 20 双主题铁律）：brand-* 语义阶（随 html data-theme
 * 换肤）；状态色走语义阶（运行 = brand / 成功 = success / 失败 = error /
 * 停止 = muted），无 blue-* 硬编码（blue-* 仅限真信息蓝）；阴影 shadow-* token。
 */

import {
  forwardRef,
  useEffect,
  useId,
  useImperativeHandle,
  useMemo,
  useState,
} from "react";
import { ChevronRight, Cog } from "lucide-react";

import type {
  ActivityBashProgress,
  AgentTaskEntry,
} from "@/components/daemon/activity-catalog";
import { AgentTaskCard } from "@/components/daemon/agent-task-card";
import { BashProgressCard } from "@/components/daemon/bash-progress-card";
import {
  TeamTaskBlock,
  isActiveTeamMission,
} from "@/components/daemon/team-task-block";
import { formatTokens } from "@/components/daemon/runtime-card-helpers";
import { useSessionTasks } from "@/hooks/use-session-tasks";
import type { AgentSessionTaskView } from "@/hooks/use-session-tasks";
import type {
  AgentTaskStatusEvent,
  SessionRunRead,
  TeamMissionSummary,
} from "@/lib/daemon";
import { listSessionRuns } from "@/lib/daemon";
import { cn } from "@/lib/utils";

/* ───────────────────────── props 契约（task-08 消费） ───────────────────────── */

export interface TaskExecutionPanelProps {
  /**
   * 会话 id（必填）。任务清单快照与轮次历史的自取数键；空串（预会话态）两处
   * 自取数跳过、计数显示 0（折叠条仍常驻，FR-01）。
   */
  sessionId: string;
  /**
   * 运行中页签注入：后台 Agent 任务列表（session-panel agentTasks 内存态，
   * ActivityCatalog 同源；建议传 running 语义子集，含终态卡亦可渲染——与
   * 「后台 ▾」下拉所见一致）。缺省 []。
   */
  runningTasks?: AgentTaskEntry[];
  /**
   * 运行中页签注入：bash 命令进度（session-panel bashProgress 内存态，
   * BashProgressCard 展示形状）。缺省 null（不渲染 bash 卡）。
   */
  bashProgress?: ActivityBashProgress | null;
  /**
   * 运行中页签注入：会话团队任务列表（session-panel missions 内存态；活跃
   * 在前由本组件排序后喂 TeamTaskBlock）。缺省 []。
   */
  teamMissions?: TeamMissionSummary[];
  /** TeamTaskBlock 分身日志 / 产物查询鉴权透传（会话绑定工作区 ID）。 */
  workspaceId?: string | null;
  /** TeamTaskBlock 取消等操作成功后的重拉回调（透传 session-panel 既有 missions 重拉）。 */
  onRefreshMissions?: () => void;
  /** 分身行点击打开分身子会话（透传 session-panel 既有浮层入口）。 */
  onOpenWorkerSession?: (_subSessionId: string) => void;
  /**
   * 计划总纲（R-07 降级，仅活跃轮实时显示）：活跃轮 plan_mode_entered 事件
   * summary.objective，由挂载方从既有 planPending 内存态链路注入。null / 空串
   * 不渲染总纲条；刷新 / 重连后不注入 → 不显示不报错（既定行为非 bug，见文件头
   * R-07 裁定）。
   */
  planObjective?: string | null;
  /** 计划步骤清单（plan_mode_entered summary.tasks 透传，仅计数展示）；缺省不显示步骤计数。 */
  planTasks?: readonly string[] | null;
  /**
   * 轮次历史重拉信号（SessionUsageBar refreshSignal 同款模式）：每次递增触发
   * 一次 listSessionRuns 重拉。接线点（task-08）：轮次终态（turn_completed）
   * 后递增。缺省仅 mount / sessionId 变化拉取。
   */
  runsRefreshSignal?: number;
  /**
   * 任务清单快照重拉信号：每次递增触发一次 useSessionTasks 快照重拉（对账
   * 断线期间落库的任务行，task-06 hook 的 refreshSignal 透传）。接线点
   * （task-08）：SSE 会话流重连恢复后递增。缺省仅 mount / sessionId 变化拉取。
   */
  tasksRefreshSignal?: number;
}

/**
 * ref handle：实时事件注入口（task-08 接线）。session-panel SSE 分发处经
 * `panelRef.current?.applyEvent(event)` 注入 agent_task_status 实时事件——
 * 组件内 useSessionTasks 归并（session_id 守卫 + task_id upsert），不建
 * 第二条 SSE 连接。
 */
export interface TaskExecutionPanelHandle {
  applyEvent(_event: AgentTaskStatusEvent): void;
}

/* ───────────────────────── 展示辅助（纯函数） ───────────────────────── */

type TaskStatus4 = AgentTaskEntry["status"];

/** 任务行状态圆标（running 脉动 / completed 绿 / failed 红 / stopped 灰，语义阶）。 */
const TASK_DOT_CLS: Record<TaskStatus4, string> = {
  running: "bg-brand-500 animate-pulse",
  completed: "bg-success",
  failed: "bg-error",
  stopped: "bg-muted-foreground/60",
};

/** 任务行终态 pill 配色（对齐 AgentTaskCard statusClasses，语义阶零漂移）。 */
const TASK_PILL_CLS: Record<TaskStatus4, string> = {
  running: "bg-brand-100 text-brand-700",
  completed: "bg-success/15 text-success",
  failed: "bg-error/15 text-error",
  stopped: "bg-muted text-muted-foreground",
};

/** 任务状态文案（对齐 AgentTaskCard statusLabel）。 */
const TASK_STATUS_LABEL: Record<TaskStatus4, string> = {
  running: "运行中",
  completed: "已完成",
  failed: "失败",
  stopped: "已停止",
};

/** 轮次行状态 pill（AgentRun.status 词表：pending/running/completed/failed/killed；未知值中性灰兜底）。 */
function runStatusView(status: string | null): { label: string; cls: string } {
  switch (status) {
    case "running":
      return { label: "运行中", cls: "bg-brand-100 text-brand-700" };
    case "completed":
      return { label: "成功", cls: "bg-success/15 text-success" };
    case "failed":
      return { label: "失败", cls: "bg-error/15 text-error" };
    case "killed":
      return { label: "已停止", cls: "bg-muted text-muted-foreground" };
    case "pending":
      return { label: "排队中", cls: "bg-muted text-muted-foreground" };
    default:
      return { label: "未知", cls: "bg-muted text-muted-foreground" };
  }
}

/** 时长中文格式化（原型 .turn-row / .tk-meta 口径：「58 秒」「4 分 12 秒」「1 时 05 分」）。 */
function formatElapsedZh(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h} 时 ${String(m).padStart(2, "0")} 分`;
  if (m > 0) return `${m} 分 ${String(s).padStart(2, "0")} 秒`;
  return `${s} 秒`;
}

/** ISO 时间安全解析（null / 非法 → null，不显示不伪造）。 */
function parseTs(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? null : t;
}

/** 多行文本取第一个非空行（对齐 AgentTaskCard 终态 summary 首行口径）。 */
function firstNonEmptyLine(text: string | null | undefined): string | null {
  if (!text) return null;
  return (
    text
      .split("\n")
      .map((line) => line.trim())
      .find((line) => line.length > 0) ?? null
  );
}

/**
 * 任务行「正在做什么」摘要：summary 首行 → 终态 message 首行 → running 兜底
 * （工具名 / 「后台任务运行中」）；全缺失 → null 不渲染该行（D-03 引擎差异降级）。
 */
function taskWhatText(task: AgentSessionTaskView): string | null {
  const summaryFirst = firstNonEmptyLine(task.summary);
  if (summaryFirst) return summaryFirst;
  const messageFirst = firstNonEmptyLine(task.message);
  if (messageFirst) return messageFirst;
  if (task.status === "running") {
    return task.lastToolName ? `正在调用 ${task.lastToolName}` : "后台任务运行中";
  }
  return null;
}

/**
 * 任务行耗时：running = 服务端 elapsed_ms + 校准锚点以来本地增量（锚点缺失且
 * 无服务端值 → null）；终态 = elapsed_ms → startedAt~terminalAt 本地区间兜底
 * （口径对齐 AgentTaskCard，不伪造时长）。
 */
function taskElapsedText(task: AgentSessionTaskView, now: number): string | null {
  if (task.status === "running") {
    const anchor = task.elapsedSyncedAt ?? task.startedAt ?? null;
    if (anchor == null && task.elapsedMs == null) return null;
    const elapsed =
      (task.elapsedMs ?? 0) + (anchor != null ? Math.max(0, now - anchor) : 0);
    return `已运行 ${formatElapsedZh(elapsed)}`;
  }
  const terminal =
    task.elapsedMs != null
      ? task.elapsedMs
      : task.startedAt != null && task.terminalAt != null
        ? task.terminalAt - task.startedAt
        : null;
  return terminal != null ? `用时 ${formatElapsedZh(terminal)}` : null;
}

/** 轮次行耗时（running 活走秒 / 终态 finished-started；时间缺失 → null 显示「—」）。 */
function runElapsedText(run: SessionRunRead, now: number): string | null {
  const start = parseTs(run.started_at);
  if (start == null) return null;
  if (run.status === "running") return formatElapsedZh(Math.max(0, now - start));
  const end = parseTs(run.finished_at);
  if (end == null) return null;
  return formatElapsedZh(Math.max(0, end - start));
}

/**
 * 轮次行 grid 列（轮次号 / 状态 / 耗时 / 发送者；发送者列弹性截断）。四维用量
 * （输入/输出/缓存读取/缓存写入）不走列——8 列固定网格在 page / dialog / mobile
 * 三宿主的窄容器会横向溢出，改主行下方带标签 meta 行（对齐 TaskListRow meta 行
 * 设计语言，flex-wrap 窄容器自然换行）。
 */
const RUN_ROW_GRID_CLS =
  "grid grid-cols-[2.75rem_4rem_minmax(0,5rem)_minmax(0,1fr)] items-center gap-2";

/** 页签空态轻文案（D-03：不报错、不阻塞对话流）。 */
function EmptyPane({ text }: { text: string }) {
  return (
    <p
      data-testid="task-execution-empty"
      className="py-6 text-center text-xs text-muted-foreground"
    >
      {text}
    </p>
  );
}

/* ───────────────────────── 行级子组件（文件内私有） ───────────────────────── */

/** 任务清单页签：紧凑任务行（状态圆标 + 任务名 + 摘要 + 耗时/tokens/工具数 + 终态 pill）。 */
function TaskListRow({ task, now }: { task: AgentSessionTaskView; now: number }) {
  const what = taskWhatText(task);
  const elapsed = taskElapsedText(task, now);
  const meta: string[] = [];
  if (elapsed) meta.push(elapsed);
  if (task.totalTokens != null) meta.push(`${formatTokens(task.totalTokens)} tokens`);
  if (task.toolUses != null) meta.push(`工具 ${task.toolUses} 次`);
  return (
    <div
      data-testid="task-execution-task-row"
      data-status={task.status}
      className="flex items-start gap-2.5 rounded-md px-2 py-1.5 hover:bg-muted/50"
    >
      <span
        aria-hidden
        className={cn(
          "mt-1.5 h-2 w-2 shrink-0 rounded-full",
          TASK_DOT_CLS[task.status],
        )}
      />
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs font-medium text-foreground" title={task.taskName}>
          {task.taskName || "后台任务"}
        </p>
        {what && (
          <p
            className="mt-0.5 truncate text-[11px] text-muted-foreground"
            title={what}
          >
            {what}
          </p>
        )}
        {meta.length > 0 && (
          <p className="mt-0.5 text-[10.5px] tabular-nums text-muted-foreground/80">
            {meta.join(" · ")}
          </p>
        )}
      </div>
      <span
        className={cn(
          "mt-0.5 shrink-0 rounded-full px-2 py-0 text-[10px] font-semibold",
          TASK_PILL_CLS[task.status],
        )}
      >
        {TASK_STATUS_LABEL[task.status]}
      </span>
    </div>
  );
}

/**
 * 轮次历史页签：紧凑轮次行（主行：轮次号 / 状态 pill / 耗时 / 发送者 + 下方
 * 四维用量 meta 行）。quick ql-20260912-003-4506：原「tokens」合并单列
 * （input+output）改为独立的 输入/输出/缓存读取/缓存写入 四维——各维 null
 * （无缓存引擎 / 老 run 行）不渲染该维（对齐 TaskListRow meta 条件 push 先例，
 * 不编造 0）；四维全 null 不渲染 meta 行（原「—」占位同语义）。
 */
function RunListRow({
  run,
  no,
  now,
}: {
  run: SessionRunRead;
  /** 展示轮次号（服务端 started_at 倒序返回，队首最新 → 序号 = 总数 - 下标）。 */
  no: number;
  now: number;
}) {
  const view = runStatusView(run.status);
  const elapsed = runElapsedText(run, now);
  const usageDims: string[] = [];
  if (run.input_tokens != null) usageDims.push(`输入 ${formatTokens(run.input_tokens)}`);
  if (run.output_tokens != null) usageDims.push(`输出 ${formatTokens(run.output_tokens)}`);
  if (run.cache_read_tokens != null) {
    usageDims.push(`缓存读取 ${formatTokens(run.cache_read_tokens)}`);
  }
  if (run.cache_creation_tokens != null) {
    usageDims.push(`缓存写入 ${formatTokens(run.cache_creation_tokens)}`);
  }
  return (
    <div
      data-testid="task-execution-run-row"
      className="rounded-md px-2 py-1.5 hover:bg-muted/50"
    >
      <div className={cn(RUN_ROW_GRID_CLS, "text-xs")}>
        <span className="font-mono text-[11px] text-muted-foreground">#{no}</span>
        <span
          className={cn(
            "justify-self-start whitespace-nowrap rounded-full px-2 py-0 text-[10px] font-semibold",
            view.cls,
          )}
        >
          {view.label}
        </span>
        <span className="truncate tabular-nums text-muted-foreground">
          {elapsed ?? "—"}
        </span>
        <span
          className="min-w-0 truncate text-muted-foreground"
          title={run.sender_name ?? undefined}
        >
          {run.sender_name || "—"}
        </span>
      </div>
      {usageDims.length > 0 && (
        <p className="mt-0.5 flex flex-wrap gap-x-2.5 pl-[3.25rem] text-[10.5px] tabular-nums text-muted-foreground/80">
          {usageDims.map((dim) => (
            <span key={dim.split(" ")[0]}>{dim}</span>
          ))}
        </p>
      )}
    </div>
  );
}

/* ───────────────────────── 主组件 ───────────────────────── */

type TabKey = "tasks" | "running" | "runs";

export const TaskExecutionPanel = forwardRef<
  TaskExecutionPanelHandle,
  TaskExecutionPanelProps
>(function TaskExecutionPanel(
  {
    sessionId,
    runningTasks,
    bashProgress,
    teamMissions,
    workspaceId,
    onRefreshMissions,
    onOpenWorkerSession,
    planObjective,
    planTasks,
    runsRefreshSignal,
    tasksRefreshSignal,
  },
  ref,
) {
  const bodyId = useId();
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<TabKey>("tasks");

  // ── 页签①任务清单：useSessionTasks 快照 + 实时合并（组件内自取数，task-06）──
  const { tasks, applyEvent, loading: tasksLoading } = useSessionTasks(sessionId, {
    refreshSignal: tasksRefreshSignal,
  });
  // ref handle：SSE 分发处（task-08）经 ref 注入实时事件（不建第二条 SSE 连接）。
  useImperativeHandle(ref, () => ({ applyEvent }), [applyEvent]);

  // ── 页签③轮次历史：useEffect 自取数（SessionUsageBar refreshSignal 先例，零 react-query）──
  const [runs, setRuns] = useState<SessionRunRead[] | null>(null);
  const [runsLoading, setRunsLoading] = useState(false);
  const [runsError, setRunsError] = useState(false);
  // 会话切换先清旧列表（新数据到达前不显示上个会话的轮次）。
  useEffect(() => {
    setRuns([]);
  }, [sessionId]);
  useEffect(() => {
    if (!sessionId) {
      // 预会话态：无数据可拉，计数收敛 0（不报错）。
      setRunsLoading(false);
      setRunsError(false);
      return;
    }
    let cancelled = false;
    setRunsLoading(true);
    setRunsError(false);
    listSessionRuns(sessionId)
      .then((rows) => {
        if (cancelled) return;
        setRuns(rows);
        setRunsLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        // 辅助信息不阻断会话主流：失败保留旧值，首载置错误态（页签内轻文案）。
        setRunsError(true);
        setRunsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [sessionId, runsRefreshSignal]);

  // ── 摘要行计数（FR-01）──
  const activeMissions = useMemo(
    () => (teamMissions ?? []).filter((m) => isActiveTeamMission(m.status)),
    [teamMissions],
  );
  const sortedMissions = useMemo(
    () =>
      [...(teamMissions ?? [])].sort(
        (a, b) =>
          Number(isActiveTeamMission(b.status)) - Number(isActiveTeamMission(a.status)),
      ),
    [teamMissions],
  );
  const bashRunning = bashProgress?.status === "running";
  const runningCount =
    (runningTasks?.length ?? 0) + (bashRunning ? 1 : 0) + activeMissions.length;
  const okCount = tasks.filter((t) => t.status === "completed").length;
  const failCount = tasks.filter((t) => t.status === "failed").length;
  const runsCount = runs?.length ?? 0;

  // ── 走秒 tick（FR-06 经济性：仅展开且确有 running 内容时启动，1s 局部 state）──
  const hasRunningTasks = tasks.some((t) => t.status === "running");
  const hasRunningRuns = (runs ?? []).some((r) => r.status === "running");
  const needsTick = open && (hasRunningTasks || hasRunningRuns);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!needsTick) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [needsTick]);

  const tabs: { key: TabKey; label: string }[] = [
    { key: "tasks", label: "任务清单" },
    { key: "running", label: `运行中 ${runningCount}` },
    { key: "runs", label: "轮次历史" },
  ];

  const runningTotal =
    (runningTasks?.length ?? 0) + sortedMissions.length + (bashProgress ? 1 : 0);

  // ql-20260909-003-8a54（quick，FR-01 决策演进）：全零空数据不再常驻折叠条——返回
  // null 对齐 AgentLogCard 空态先例（原「常驻 0 计数」是 task-07 FR-01 决策，
  // 用户反馈右栏信息条挤：SessionUsageBar+AgentLogCard+本面板三叠，全零条是
  // 纯噪音）。「有数据」口径 = 运行中 / 任务快照 / 轮次历史 / 团队任务（含终态）
  // / 计划总纲 任一非空。取数进行中（tasksLoading/runsLoading）不视为有数据：
  // 真有数据的会话条随数据到达弹入（一次性布局下移，与 AgentLogCard 同款）；
  // 真空的会话恒隐藏。首载请求失败（runsError）保守显示（fail-closed 防误隐）。
  const hasAnyData =
    runningTotal > 0 ||
    tasks.length > 0 ||
    runsCount > 0 ||
    (planObjective ?? "").trim().length > 0 ||
    (planTasks ?? []).length > 0 ||
    runsError;
  if (!hasAnyData && !open) return null;

  return (
    <div
      data-testid="task-execution-panel"
      className="shrink-0 border-b border-border bg-card"
    >
      {/* ===== 折叠条（有数据才渲染——点击整行切换展开/收起） ===== */}
      <button
        type="button"
        data-testid="task-execution-bar"
        aria-expanded={open}
        aria-controls={bodyId}
        title="任务执行面板，点击展开 / 收起"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-3.5 py-2 text-left transition-colors hover:bg-muted/50"
      >
        <Cog aria-hidden className="h-3.5 w-3.5 shrink-0 text-brand-600" />
        <span className="shrink-0 text-xs font-semibold text-foreground">任务执行</span>
        <span
          data-testid="task-execution-summary"
          className="flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-0.5 text-[11px] text-muted-foreground"
        >
          {runningCount > 0 ? (
            <span className="inline-flex items-center gap-1 font-semibold text-brand-600">
              <span
                aria-hidden
                className="h-1.5 w-1.5 animate-pulse rounded-full bg-brand-500"
              />
              运行中 {runningCount}
            </span>
          ) : (
            <span>运行中 0</span>
          )}
          <span>
            任务 {tasks.length}（
            <span className={okCount > 0 ? "text-success" : undefined}>
              成功 {okCount}
            </span>
            {" / "}
            <span className={failCount > 0 ? "text-error" : undefined}>
              失败 {failCount}
            </span>
            ）
          </span>
          <span>轮次 {runsCount}</span>
        </span>
        <ChevronRight
          aria-hidden
          className={cn(
            "ml-auto h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform duration-200",
            open && "rotate-90",
          )}
        />
      </button>

      {/* ===== 展开态：三页签 + 内部滚动内容区（max-height 防挤压，R-04） ===== */}
      {open && (
        <div id={bodyId} className="border-t border-dashed border-border">
          <div role="tablist" aria-label="任务执行" className="flex gap-0.5 px-3.5 pt-2">
            {tabs.map((t) => (
              <button
                key={t.key}
                type="button"
                role="tab"
                aria-selected={tab === t.key}
                data-testid={`task-execution-tab-${t.key}`}
                onClick={() => setTab(t.key)}
                className={cn(
                  "rounded-t-md border px-3 py-1 text-[11.5px] transition-colors",
                  tab === t.key
                    ? "border-brand-200 bg-brand-50 font-semibold text-brand-700"
                    : "border-transparent text-muted-foreground hover:bg-muted/50 hover:text-foreground",
                )}
              >
                {t.label}
              </button>
            ))}
          </div>

          <div className="max-h-[300px] overflow-y-auto px-3.5 pb-3 pt-2.5">
            {/* ── 页签①任务清单：持久化 + 实时合并列表 ── */}
            {tab === "tasks" && (
              <div data-testid="task-execution-pane-tasks">
                {/* R-07 降级：计划总纲仅活跃轮实时显示（props 注入内存态，刷新后不显示不报错）。 */}
                {planObjective ? (
                  <div
                    data-testid="task-execution-plan"
                    className="mb-2 rounded-md border border-brand-200 bg-brand-50 px-2.5 py-2 text-[11.5px] text-brand-700"
                  >
                    <p className="break-words font-semibold">计划：{planObjective}</p>
                    {planTasks && planTasks.length > 0 && (
                      <p className="mt-0.5 opacity-80">
                        进入计划模式时确认的 {planTasks.length} 个步骤（仅活跃轮显示）
                      </p>
                    )}
                  </div>
                ) : null}
                {tasksLoading && tasks.length === 0 ? (
                  <EmptyPane text="任务清单加载中…" />
                ) : tasks.length === 0 ? (
                  <EmptyPane text="暂无任务记录（当前引擎未上报任务事件）" />
                ) : (
                  tasks.map((task) => (
                    <TaskListRow key={task.taskId} task={task} now={now} />
                  ))
                )}
              </div>
            )}

            {/* ── 页签②运行中：三类卡 props 纯展示（编排对照 activity-catalog.tsx） ── */}
            {tab === "running" && (
              <div
                data-testid="task-execution-pane-running"
                className="flex flex-col gap-2"
              >
                {runningTotal === 0 ? (
                  <EmptyPane text="当前无运行中任务" />
                ) : (
                  <>
                    {bashProgress && (
                      <section aria-label="bash 命令进度">
                        <BashProgressCard
                          command={bashProgress.command}
                          status={bashProgress.status}
                          exitCode={bashProgress.exitCode}
                          elapsedMs={bashProgress.elapsedMs}
                          chunks={bashProgress.chunks}
                        />
                      </section>
                    )}
                    {runningTasks && runningTasks.length > 0 && (
                      <section aria-label="后台任务列表" className="flex flex-col gap-2">
                        {runningTasks.map((task) => (
                          <AgentTaskCard
                            key={task.taskId}
                            taskId={task.taskId}
                            taskName={task.taskName}
                            status={task.status}
                            progress={task.progress}
                            message={task.message}
                            lastToolName={task.lastToolName}
                            summary={task.summary}
                            elapsedMs={task.elapsedMs}
                            elapsedSyncedAt={task.elapsedSyncedAt}
                            startedAt={task.startedAt}
                            lastActivityAt={task.lastActivityAt}
                            terminalAt={task.terminalAt}
                            totalTokens={task.totalTokens}
                            toolUses={task.toolUses}
                          />
                        ))}
                      </section>
                    )}
                    {sortedMissions.length > 0 && (
                      <section
                        aria-label="会话团队任务列表"
                        className="flex flex-col gap-1.5"
                      >
                        {sortedMissions.map((m) => (
                          <TeamTaskBlock
                            key={m.mission_id}
                            summary={m}
                            workspaceId={workspaceId}
                            onRefresh={onRefreshMissions}
                            onOpenWorkerSession={onOpenWorkerSession}
                          />
                        ))}
                      </section>
                    )}
                  </>
                )}
              </div>
            )}

            {/* ── 页签③轮次历史：listSessionRuns 紧凑列表（服务端已 started_at 倒序） ── */}
            {tab === "runs" && (
              <div data-testid="task-execution-pane-runs">
                {runs == null || runs.length === 0 ? (
                  runsLoading ? (
                    <EmptyPane text="轮次记录加载中…" />
                  ) : runsError ? (
                    <EmptyPane text="轮次记录加载失败" />
                  ) : (
                    <EmptyPane text="暂无轮次记录" />
                  )
                ) : (
                  <div>
                    <div
                      aria-hidden
                      className={cn(
                        RUN_ROW_GRID_CLS,
                        "px-2 py-1 text-[10px] text-muted-foreground",
                      )}
                    >
                      <span>轮次</span>
                      <span>状态</span>
                      <span>耗时</span>
                      <span>发送者</span>
                    </div>
                    {runs.map((run, idx) => (
                      <RunListRow
                        key={run.id}
                        run={run}
                        no={runs.length - idx}
                        now={now}
                      />
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
});
