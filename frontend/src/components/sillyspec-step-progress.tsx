"use client";

// ── Types ──────────────────────────────────────────────────────────────

/** 单个步骤信息（对应后端 sync_stage_status 写入的 stages.steps） */
export interface StepInfo {
  /** 步骤序号（1-based） */
  index: number;
  /** 步骤名称 */
  name: string;
  /** 步骤状态 */
  status: "pending" | "running" | "completed" | "failed";
  /** 关联的 AgentRun ID */
  agent_run_id?: string;
}

export interface SillySpecStepProgressProps {
  /** 当前 stage 名称（如 "propose"、"plan"） */
  currentStage: string | null;
  /** stage 对应的步骤列表，来自 Change.stages.steps */
  steps: StepInfo[] | undefined;
  /** 是否有活跃的 AgentRun（来自 DispatchResponse.has_active_run） */
  hasActiveRun: boolean;
  /** Agent 配置是否启用（来自 DispatchResponse.config_enabled） */
  configEnabled: boolean;
  /** 最后一次 dispatch 的状态 */
  lastDispatchStatus?: "running" | "completed" | "failed" | null;
  /** 最后一次 dispatch 完成时间 */
  lastDispatchFinishedAt?: string | null;
  /** 最后一次 dispatch 输出摘要 */
  lastDispatchSummary?: string | null;
  /** 刷新回调 */
  onRefresh?: () => void;
  /** 正在刷新 */
  refreshing?: boolean;
  /** 手动触发 dispatch 回调 */
  onDispatch?: () => void;
  /** 正在触发 */
  dispatching?: boolean;
  /** stage 标签映射 */
  stageLabels?: Record<string, string>;
}

// ── Helpers ────────────────────────────────────────────────────────────

const STEP_STATUS_STYLES: Record<
  StepInfo["status"],
  { dot: string; icon: string; text: string }
> = {
  completed: {
    dot: "bg-emerald-500",
    icon: "✓",
    text: "text-emerald-600",
  },
  running: {
    dot: "bg-blue-500",
    icon: "",
    text: "text-blue-600 font-medium",
  },
  failed: {
    dot: "bg-red-500",
    icon: "✗",
    text: "text-red-600",
  },
  pending: {
    dot: "bg-gray-300",
    icon: "",
    text: "text-muted-foreground",
  },
};

// ── Component ──────────────────────────────────────────────────────────

export function SillySpecStepProgress({
  currentStage,
  steps,
  hasActiveRun,
  configEnabled,
  lastDispatchStatus,
  lastDispatchFinishedAt,
  lastDispatchSummary,
  onRefresh,
  refreshing,
  onDispatch,
  dispatching,
  stageLabels,
}: SillySpecStepProgressProps) {
  const stageLabel =
    (currentStage && stageLabels?.[currentStage]) ?? currentStage ?? "—";

  const validSteps = Array.isArray(steps) ? steps : [];
  const completedCount = validSteps.filter(
    (s) => s.status === "completed"
  ).length;
  const hasPendingSteps = validSteps.some((s) => s.status === "pending");
  const allCompleted = validSteps.length > 0 && completedCount === validSteps.length;

  // Boundary: no config and no steps → show nothing
  if (!configEnabled && validSteps.length === 0) {
    return (
      <section className="rounded-md border bg-card">
        <div className="flex items-center justify-between border-b px-3 py-2">
          <h2 className="text-xs font-medium">🤖 Agent 运行状态</h2>
          {onRefresh && (
            <button
              onClick={onRefresh}
              disabled={refreshing}
              className="text-[11px] text-muted-foreground hover:text-foreground disabled:opacity-50"
            >
              {refreshing ? "刷新中…" : "↻ 刷新"}
            </button>
          )}
        </div>
        <div className="px-3 py-2.5">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span className="inline-block h-2 w-2 rounded-full bg-gray-300" />
            <span>当前阶段未配置 Agent</span>
          </div>
        </div>
      </section>
    );
  }

  // Boundary: config enabled but no steps data → fallback to simple agent status
  if (validSteps.length === 0) {
    return (
      <section className="rounded-md border bg-card">
        <div className="flex items-center justify-between border-b px-3 py-2">
          <h2 className="text-xs font-medium">🤖 Agent 运行状态</h2>
          {onRefresh && (
            <button
              onClick={onRefresh}
              disabled={refreshing}
              className="text-[11px] text-muted-foreground hover:text-foreground disabled:opacity-50"
            >
              {refreshing ? "刷新中…" : "↻ 刷新"}
            </button>
          )}
        </div>
        <div className="px-3 py-2.5 space-y-2">
          {/* Agent status without steps */}
          {hasActiveRun ? (
            <div className="flex items-center gap-2 text-xs text-emerald-600">
              <span className="relative flex h-2.5 w-2.5">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-500" />
              </span>
              <span className="font-medium">Agent 运行中…</span>
            </div>
          ) : lastDispatchStatus === "completed" ? (
            <div className="flex items-center gap-2 text-xs text-emerald-600">
              <span className="inline-block h-2 w-2 rounded-full bg-emerald-500" />
              <span className="font-medium">上次执行成功</span>
              {lastDispatchFinishedAt && (
                <span className="text-[11px] text-muted-foreground">
                  · {new Date(lastDispatchFinishedAt).toLocaleString()}
                </span>
              )}
            </div>
          ) : lastDispatchStatus === "failed" ? (
            <div className="flex items-center gap-2 text-xs text-destructive">
              <span className="inline-block h-2 w-2 rounded-full bg-red-500" />
              <span className="font-medium">上次执行失败</span>
              {lastDispatchFinishedAt && (
                <span className="text-[11px] text-muted-foreground">
                  · {new Date(lastDispatchFinishedAt).toLocaleString()}
                </span>
              )}
            </div>
          ) : (
            <div className="flex items-center gap-2 text-xs text-blue-600">
              <span className="inline-block h-2 w-2 rounded-full bg-blue-500" />
              <span>等待步骤数据同步</span>
            </div>
          )}

          {/* Manual trigger button */}
          {configEnabled && !hasActiveRun && onDispatch && (
            <button
              onClick={onDispatch}
              disabled={dispatching}
              className="inline-flex h-7 items-center rounded bg-primary px-3 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              {dispatching ? "触发中…" : "🤖 触发 Agent 执行"}
            </button>
          )}
        </div>
      </section>
    );
  }

  // ── Full step progress view ────────────────────────────────────────
  return (
    <section className="rounded-md border bg-card">
      {/* Header */}
      <div className="flex items-center justify-between border-b px-3 py-2">
        <div className="flex items-center gap-2">
          <h2 className="text-xs font-medium">
            🤖 {stageLabel}
          </h2>
          <span className="text-[11px] text-muted-foreground">
            {completedCount}/{validSteps.length} 步骤完成
          </span>
        </div>
        {onRefresh && (
          <button
            onClick={onRefresh}
            disabled={refreshing}
            className="text-[11px] text-muted-foreground hover:text-foreground disabled:opacity-50"
          >
            {refreshing ? "刷新中…" : "↻ 刷新"}
          </button>
        )}
      </div>

      {/* Step bar — horizontal on wide, vertical on narrow */}
      <div className="px-3 py-2.5">
        {/* Horizontal step bar (sm+) */}
        <div className="hidden sm:flex items-center gap-0 overflow-x-auto">
          {validSteps.map((step, i) => {
            const style = STEP_STATUS_STYLES[step.status];
            return (
              <div key={step.index} className="flex items-center">
                {/* Connector line */}
                {i > 0 && (
                  <div
                    className={`h-0.5 w-4 ${
                      step.status === "completed" || validSteps[i - 1]?.status === "completed"
                        ? "bg-emerald-300"
                        : "bg-gray-200"
                    }`}
                  />
                )}
                {/* Step dot + label */}
                <div className="flex flex-col items-center gap-0.5 min-w-[48px]">
                  <span
                    className={`inline-flex h-5 w-5 items-center justify-center rounded-full text-[10px] ${
                      step.status === "running"
                        ? `${style.dot} animate-pulse`
                        : style.dot
                    } text-white`}
                  >
                    {style.icon || step.index}
                  </span>
                  <span
                    className={`text-[10px] leading-tight text-center max-w-[64px] truncate ${style.text}`}
                    title={step.name}
                  >
                    {step.name}
                  </span>
                </div>
              </div>
            );
          })}
        </div>

        {/* Vertical step list (< sm) */}
        <div className="flex flex-col gap-1.5 sm:hidden">
          {validSteps.map((step) => {
            const style = STEP_STATUS_STYLES[step.status];
            return (
              <div key={step.index} className="flex items-center gap-2">
                <span
                  className={`inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[9px] ${
                    step.status === "running"
                      ? `${style.dot} animate-pulse`
                      : style.dot
                  } text-white`}
                >
                  {style.icon || step.index}
                </span>
                <span className={`text-xs ${style.text}`}>{step.name}</span>
              </div>
            );
          })}
        </div>
      </div>

      {/* AgentRun info area */}
      <div className="border-t px-3 py-2 space-y-2">
        {hasActiveRun ? (
          <div className="flex items-center gap-2 text-xs text-emerald-600">
            <span className="relative flex h-2.5 w-2.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-500" />
            </span>
            <span className="font-medium">Agent 运行中…</span>
          </div>
        ) : lastDispatchStatus === "completed" ? (
          <div className="flex items-center gap-2 text-xs text-emerald-600">
            <span className="inline-block h-2 w-2 rounded-full bg-emerald-500" />
            <span className="font-medium">上次执行成功</span>
            {lastDispatchFinishedAt && (
              <span className="text-[11px] text-muted-foreground">
                · {new Date(lastDispatchFinishedAt).toLocaleString()}
              </span>
            )}
          </div>
        ) : lastDispatchStatus === "failed" ? (
          <div className="flex items-center gap-2 text-xs text-destructive">
            <span className="inline-block h-2 w-2 rounded-full bg-red-500" />
            <span className="font-medium">上次执行失败</span>
            {lastDispatchFinishedAt && (
              <span className="text-[11px] text-muted-foreground">
                · {new Date(lastDispatchFinishedAt).toLocaleString()}
              </span>
            )}
          </div>
        ) : null}

        {/* Output summary (collapsible) */}
        {lastDispatchSummary && (
          <details className="group">
            <summary className="cursor-pointer text-[11px] text-muted-foreground hover:text-foreground">
              输出摘要 ▾
            </summary>
            <pre className="mt-1 max-h-32 overflow-auto whitespace-pre-wrap rounded bg-muted/60 px-2.5 py-1.5 font-mono text-[11px] text-muted-foreground">
              {lastDispatchSummary}
            </pre>
          </details>
        )}

        {/* Dispatch button */}
        {!allCompleted && hasPendingSteps && !hasActiveRun && onDispatch && (
          <button
            onClick={onDispatch}
            disabled={dispatching}
            className="inline-flex h-7 items-center rounded bg-primary px-3 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {dispatching ? "触发中…" : "▶ 执行下一步"}
          </button>
        )}
      </div>
    </section>
  );
}
