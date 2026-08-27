"use client";

/**
 * task-07（2026-08-19-session-stream-ux / FR-02 / D-001@v1 / D-003@v1）：轮级状态条。
 *
 * 两部分（design §5 Phase3 / §7）：
 *   - deriveTurnActivity：纯函数（无 React 依赖，亦供 task-08 子代理目录消费），从
 *     TurnSegment[] 派生 toolCount / subagents 清单 / currentActivity；
 *   - TurnStatusBar：运行中轮次头部状态条（spinner + 计时 mm:ss + 工具计数 + 运行中
 *     子代理计数 + 右侧当前活动摘要 typing 三点脉冲，task-13 起 .sh-typing-dots），视觉对齐原型
 *     prototype-session-stream.html 的 .turn-status-bar（蓝底 6% / 边框 18% /
 *     8px 圆角 / px-3 py-1.5 / text-xs；本项目 tailwind 把 rounded-lg 映射 12px，
 *     原型 8px 对应 rounded-md，以原型为准）。
 *
 * 计时锚点策略（Grill X-01：backend 无 turn_started 事件）：本组件只消费 props 传入的
 * turnStartedAt 数值，锚点来源（live = 本地发送占位 / attach = run 快照 started_at /
 * 缺则首条 log timestamp）由消费方 task-09 接线；null 容错不显示计时。attach 从中断
 * 处恢复不归零（锚点是服务端时刻，非组件挂载时刻）。
 *
 * 渲染经济性（FR-06）：每秒 tick 是本组件局部 state（setInterval + 卸载清理），不外溢
 * 触发整轮 / 兄弟段重渲染；组件 React.memo + segments 引用未变时派生统计走 useMemo
 * 缓存。子代理运行中时长（task-08 目录消费）同锚点策略：deriveTurnActivity 暴露
 * startedAt，展示侧用 (now - startedAt) 每秒 tick 补足（deepseek subagentTiming 模式）。
 *
 * task-13（2026-08-27-background-subagent-progress / FR-07 / D-005@v1）：collectSubagents
 * 对带 [TASK_*] 元数据（task-11 装配到 tool 段）的 async 后台子代理，状态改由元数据
 * 驱动——taskStatus 有值即权威（终态即终；不再因 result 配对判 done，async 启动回执
 * 0.1s 配对不是完成信号），并把 taskElapsedMs / taskAsync / taskSummary / taskToolName
 * 透传给 task-08 目录与会话块消费（终态时长 = 服务端权威 taskElapsedMs，运行中走秒
 * 由消费方本地 tick）；无元数据段走原推导（前台阻塞式子代理零回归）。
 */

import { memo, useEffect, useMemo, useState } from "react";

import type { ToolTurnSegment, TurnSegment } from "./session-log-assembler";

/* ───────────── 派生统计（纯函数，design §7 TurnActivitySummary） ───────────── */

/** 子代理清单项（TurnActivitySummary.subagents 元素形状）。 */
export interface SubagentActivity {
  /** 归属容器段 id（tool 段 = tool_use_id；stub = parent_tool_use_id）。 */
  segmentId: string;
  /** 展示名：tool.primary ?? toolName ?? subagentType ?? 「子代理」（stub 无前两者）。 */
  name: string;
  subagentType: string | null;
  /**
   * 容器 result 未配对 = running（stub 恒 running）；配对后按 deny 判定 done/deny。
   * task-13（2026-08-27-background-subagent-progress / FR-07）：段带 [TASK_*] 元数据
   * （async 后台派发）时由 taskStatus 映射——completed→done / failed→deny（红）/
   * stopped→stopped（灰）/ running→running，终态即终，不再看 result 配对。
   */
  status: "running" | "done" | "deny" | "stopped";
  startedAt: number | null;
  endedAt: number | null;
  /** 内部（children）最新 running 段摘要；内部无 running / streaming 段为 null。 */
  latestActivity: string | null;
  /**
   * task-13：[TASK_*] 任务元数据透传（task-11 装配到 tool 段；无元数据段恒缺省
   * ——前台阻塞式子代理零影响，消费方见字段存在即切元数据驱动）：
   *   - taskStatus：STARTED→running；NOTIFICATION→completed/failed/stopped（终态覆盖）；
   *   - taskElapsedMs：服务端权威时长（终态展示用它；PROGRESS 覆盖式刷新）；
   *   - taskAsync：异步派发标记（STARTED 行 JSON async）；
   *   - taskSummary / taskToolName：最近一条 [TASK_*] 行的摘要 / 最近工具名
   *     （截断展示归渲染层）。
   */
  taskStatus?: "running" | "completed" | "failed" | "stopped";
  taskElapsedMs?: number;
  taskAsync?: boolean;
  taskSummary?: string;
  taskToolName?: string;
}

/** 轮级派生统计（TurnStatusBar 与 task-08 subagent-catalog 消费）。 */
export interface TurnActivitySummary {
  /** tool 段总数（DFS 递归，含 subagent_stub 内部工具）。 */
  toolCount: number;
  subagents: SubagentActivity[];
  /** 全 turn 最新 running 段摘要；无 running 工具段回退 streaming 段派生文案；空轮 null。 */
  currentActivity: string | null;
}

/** 段时间戳（最新 running 段检索用）：tool/text 用 startedAt、thinking/stderr 用 ts；缺失视为最早。 */
function segmentTs(seg: TurnSegment): number {
  switch (seg.kind) {
    case "text":
      return seg.startedAt ?? Number.NEGATIVE_INFINITY;
    case "thinking":
      return seg.ts ?? Number.NEGATIVE_INFINITY;
    case "tool":
      return seg.startedAt ?? Number.NEGATIVE_INFINITY;
    case "stderr":
      return seg.ts ?? Number.NEGATIVE_INFINITY;
    // 2026-08-25-unified-floating-session task-11：前导段非 running 候选，取捕获 ts。
    case "preamble":
      return seg.ts ?? Number.NEGATIVE_INFINITY;
    case "subagent_stub":
      return Number.NEGATIVE_INFINITY;
    // task-08（agent-file-upload-mcp）：file 段非 running 候选，时间戳取 log ts。
    case "file":
      return seg.ts ?? Number.NEGATIVE_INFINITY;
  }
}

/** 单行摘要归一：折叠空白（多行命令/长 JSON 不撑破单行）+ 截断（同装配器 raw 120 字符惯例）。 */
function summarizeText(text: string | null | undefined): string | null {
  const t = (text ?? "")
    .replace(/\s+/g, " ")
    .trim();
  return t ? t.slice(0, 120) : null;
}

/** 运行中工具段的单行摘要：「工具名 主参数」；解析失败（primary null）退 raw，再退工具名。 */
function toolSummary(tool: ToolTurnSegment): string {
  const name = tool.toolName ?? "工具";
  const primary = summarizeText(tool.primary ?? tool.raw);
  return primary ? `${name} ${primary}` : name;
}

/** 子代理展示名（task-07 契约：primary ?? toolName ?? subagentType ?? 「子代理」）。 */
function subagentDisplayName(tool: ToolTurnSegment): string {
  return summarizeText(tool.primary) ?? tool.toolName ?? tool.subagentType ?? "子代理";
}

/**
 * 树内最新 running 工具段（DFS，ts 最大；同 ts 取 DFS 后到者 = 文档序更晚）。
 * 容器（tool / subagent_stub）的 children 一并搜索——嵌套子代理内部工具同样候选。
 */
function findLatestRunningTool(segments: TurnSegment[]): ToolTurnSegment | null {
  let best: ToolTurnSegment | null = null;
  let bestTs = Number.NEGATIVE_INFINITY;
  const walk = (list: TurnSegment[]) => {
    for (const s of list) {
      if (s.kind === "tool") {
        const ts = segmentTs(s);
        if (s.status === "running" && ts >= bestTs) {
          best = s;
          bestTs = ts;
        }
        walk(s.children);
      } else if (s.kind === "subagent_stub") {
        walk(s.children);
      }
    }
  };
  walk(segments);
  return best;
}

/** 树内最新 streaming 段派生的回退文案：text → 「正在输出文本」、thinking → 「正在思考」。 */
function latestStreamingSummary(segments: TurnSegment[]): string | null {
  let best: "text" | "thinking" | null = null;
  let bestTs = Number.NEGATIVE_INFINITY;
  const walk = (list: TurnSegment[]) => {
    for (const s of list) {
      if (s.kind === "text" || s.kind === "thinking") {
        const ts = segmentTs(s);
        if (s.streaming && ts >= bestTs) {
          best = s.kind;
          bestTs = ts;
        }
      } else if (s.kind === "tool" || s.kind === "subagent_stub") {
        walk(s.children);
      }
    }
  };
  walk(segments);
  return best === "text" ? "正在输出文本" : best === "thinking" ? "正在思考" : null;
}

/**
 * 树内当前活动摘要（递归）：
 *   - 有 running 工具段：普通工具 → 「工具名 主参数」；子代理容器（有 children）→
 *     「子代理『名』内部活动」，内部活动递归 children（嵌套子代理继续前缀），内部
 *     无任何 running / streaming 段时退「执行中」；
 *   - 无 running 工具段：最新 streaming 段 → 「正在输出文本 / 正在思考」；
 *   - 都无 → null。
 */
function latestActivityWithin(segments: TurnSegment[]): string | null {
  const tool = findLatestRunningTool(segments);
  if (tool) {
    if (tool.children.length > 0) {
      const inner = latestActivityWithin(tool.children);
      return `子代理「${subagentDisplayName(tool)}」${inner ?? "执行中"}`;
    }
    return toolSummary(tool);
  }
  return latestStreamingSummary(segments);
}

/**
 * task-13（FR-07 / D-005@v1）：[TASK_*] 任务状态 → 目录/状态条活动状态映射。
 * failed 并入红（deny 同色系）；stopped 独立灰态（后台任务被停止，原型「变灰」）；
 * running 即运行中。终态即终——不看 result 配对（async 启动回执不是完成信号）。
 */
function taskStatusToActivity(
  taskStatus: "running" | "completed" | "failed" | "stopped",
): SubagentActivity["status"] {
  switch (taskStatus) {
    case "running":
      return "running";
    case "completed":
      return "done";
    case "failed":
      return "deny";
    case "stopped":
      return "stopped";
  }
}

/** DFS 收集子代理清单：有 children 归属的 tool 段 + subagent_stub 兜底段（嵌套递归收集）。 */
function collectSubagents(segments: TurnSegment[], out: SubagentActivity[]): void {
  for (const s of segments) {
    if (s.kind === "subagent_stub") {
      out.push({
        segmentId: s.id,
        name: s.subagentType ?? "子代理",
        subagentType: s.subagentType,
        status: "running",
        startedAt: null,
        endedAt: null,
        latestActivity: latestActivityWithin(s.children),
      });
      collectSubagents(s.children, out);
    } else if (s.kind === "tool") {
      if (s.children.length > 0) {
        // task-13：段带 [TASK_*] 元数据（taskStatus 或 taskAsync 存在 = async 后台
        // 派发）时状态由元数据驱动——taskStatus 有值即权威（终态即终），仅 taskAsync
        // 时按 running 防御；同时透传五字段供目录/会话块消费（终态时长用服务端
        // taskElapsedMs，运行中走秒由消费方 tick）。无元数据段走原 result 配对推导
        //（前台阻塞式子代理零回归）。
        const metaDriven = s.taskStatus !== undefined || s.taskAsync !== undefined;
        out.push({
          segmentId: s.id,
          name: subagentDisplayName(s),
          subagentType: s.subagentType,
          status: metaDriven
            ? taskStatusToActivity(s.taskStatus ?? "running")
            : s.result === undefined
              ? "running"
              : s.status === "deny"
                ? "deny"
                : "done",
          startedAt: s.startedAt,
          endedAt: s.endedAt,
          latestActivity: latestActivityWithin(s.children),
          ...(s.taskStatus !== undefined ? { taskStatus: s.taskStatus } : {}),
          ...(s.taskElapsedMs !== undefined ? { taskElapsedMs: s.taskElapsedMs } : {}),
          ...(s.taskAsync !== undefined ? { taskAsync: s.taskAsync } : {}),
          ...(s.taskSummary !== undefined ? { taskSummary: s.taskSummary } : {}),
          ...(s.taskToolName !== undefined ? { taskToolName: s.taskToolName } : {}),
        });
      }
      collectSubagents(s.children, out);
    }
  }
}

/** tool 段计数（DFS 递归，subagent_stub 不是工具但其 children 内的工具计入）。 */
function countTools(segments: TurnSegment[]): number {
  let n = 0;
  const walk = (list: TurnSegment[]) => {
    for (const s of list) {
      if (s.kind === "tool") {
        n += 1;
        walk(s.children);
      } else if (s.kind === "subagent_stub") {
        walk(s.children);
      }
    }
  };
  walk(segments);
  return n;
}

/**
 * 从段序列派生轮级统计（design §7，纯函数无 React 依赖）。
 * currentActivity 终级回退链：running 工具段摘要 → streaming 段「正在输出文本/正在思考」
 * → 「思考中」；仅空轮（无任何段）返回 null。
 */
export function deriveTurnActivity(segments: TurnSegment[]): TurnActivitySummary {
  const subagents: SubagentActivity[] = [];
  collectSubagents(segments, subagents);
  return {
    toolCount: countTools(segments),
    subagents,
    currentActivity:
      segments.length === 0 ? null : (latestActivityWithin(segments) ?? "思考中"),
  };
}

/* ───────────────────────── TurnStatusBar 组件 ───────────────────────── */

export interface TurnStatusBarProps {
  /**
   * 计时锚点（Grill X-01：backend 无 turn_started 事件，锚点三源由 task-09 接线）：
   * live = 本地发送占位时刻；attach = run 快照 started_at；均缺 = 首条 log timestamp。
   * null 容错：不显示计时（轮级文案照常）。
   */
  turnStartedAt: number | null;
  segments: TurnSegment[];
  /** 轮次状态（仅非终态渲染本组件，终态由消费方不挂载）。 */
  turnStatus: "pending" | "running" | "interrupting";
}

const STATUS_LABEL: Record<TurnStatusBarProps["turnStatus"], string> = {
  pending: "排队中",
  running: "执行中",
  interrupting: "打断中",
};

/** 具体秒数显示门槛（对齐 deepseek TurnStatus：前 15 秒保持简洁只显文案）。 */
export const TURN_STATUS_ELAPSED_MIN_MS = 15_000;

/** 计时格式化 mm:ss（分钟不封顶，跨小时继续累加，mono 等宽稳定）。task-08 目录时长共用。 */
export function formatElapsedMmss(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

/**
 * 轮级状态条（FR-02）：turn 级信号跨工具 / 子代理阶段不闪烁。
 * React.memo：segments / turnStartedAt / turnStatus 引用未变时拦截父层重渲染；
 * 每秒 tick 仅本组件局部 state，不外溢（FR-06）。
 */
export const TurnStatusBar = memo(function TurnStatusBar({
  turnStartedAt,
  segments,
  turnStatus,
}: TurnStatusBarProps) {
  // 每秒 tick：仅组件内部 state（卸载清理）；同一 tick 同时驱动轮计时与（task-08 消费
  // deriveTurnActivity.startedAt 时的）子代理运行时长，展示侧各自 (now - 锚点) 派生。
  const [now, setNow] = useState<number>(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  const activity = useMemo(() => deriveTurnActivity(segments), [segments]);
  const runningSubagents = useMemo(
    () => activity.subagents.filter((s) => s.status === "running").length,
    [activity],
  );

  const elapsedMs = turnStartedAt != null ? Math.max(0, now - turnStartedAt) : null;
  // 前 15 秒不显具体秒数（deepseek TurnStatus 对齐），≥15s 才显示 mm:ss。
  const showElapsed = elapsedMs != null && elapsedMs >= TURN_STATUS_ELAPSED_MIN_MS;

  return (
    <div className="flex items-center gap-2.5 rounded-md border border-primary/[0.18] bg-primary/[0.06] px-3 py-1.5 text-xs">
      <span
        aria-hidden
        className="h-3 w-3 shrink-0 animate-spin rounded-full border-2 border-primary/25 border-t-primary"
      />
      <span className="shrink-0 text-muted-foreground">{STATUS_LABEL[turnStatus]}</span>
      {showElapsed && elapsedMs != null && (
        <span className="shrink-0 font-mono font-medium text-brand-600">
          {formatElapsedMmss(elapsedMs)}
        </span>
      )}
      {activity.toolCount > 0 && (
        <>
          <span aria-hidden className="text-border">
            |
          </span>
          <span className="shrink-0 text-muted-foreground">
            工具 <span className="font-medium text-foreground">{activity.toolCount}</span>
          </span>
        </>
      )}
      {runningSubagents > 0 && (
        <>
          <span aria-hidden className="text-border">
            |
          </span>
          <span className="shrink-0 text-muted-foreground">
            子代理 <span className="font-medium text-foreground">{runningSubagents}</span> 运行中
          </span>
        </>
      )}
      {activity.currentActivity && (
        <span className="ml-auto flex min-w-0 max-w-[46%] items-center gap-1.5 text-[11.5px] text-foreground">
          {/* task-13（FR-05 / D-004@v1）：live-dot 单点脉冲换 .sh-typing-dots 三点
              typing 指示（utility/降级统一在 globals.css）；deriveTurnActivity
              派生与 memo 结构零改动。 */}
          <span aria-hidden className="sh-typing-dots">
            <span />
            <span />
            <span />
          </span>
          <span className="min-w-0 truncate" title={activity.currentActivity}>
            {activity.currentActivity}
          </span>
        </span>
      )}
    </div>
  );
});
