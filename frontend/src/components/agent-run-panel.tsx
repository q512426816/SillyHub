"use client";

import * as React from "react";
import { AlertTriangle, X } from "lucide-react";

import { AgentLogViewer } from "@/components/agent-log-viewer";
import type { AgentLogInputControls } from "@/components/agent-log/types";
import { Button } from "@/components/ui/button";
import { getAgentRun } from "@/lib/agent";
import { formatTokenCount } from "@/lib/format-token";
import { useAgentRunStream } from "@/lib/use-agent-run-stream";
import type { AgentRunInputStream } from "@/lib/use-agent-run-stream";
import type { GateStatusEvent } from "@/lib/agent-stream";

// ────────────────────────────────────────────────────────────────────────────
// AgentRunPanel — AgentRunStream 的统一面板组件
//
// 依据：
//   .sillyspec/changes/2026-06-22-unify-agent-run-sse-hook/design.md §7.2
//   .sillyspec/changes/2026-06-22-unify-agent-run-sse-hook/tasks/task-03.md
//
// 职责（D-002@v1：hook + 面板组件）：
//   1. 内部调 useAgentRunStream（task-01）拿 logs/perms/input/loading/error；
//   2. 把 AgentRunInputStream 字段映射到 AgentLogInputControls 契约（X-002）；
//   3. onPermissionResolved 仅本地 dismissPerm，不调 respondSessionPermission（D-003）；
//   4. 其余 AgentLogViewer 定制 prop 显式透传（D-002 显式列）。
//
// 不做（非目标）：
//   - 不改 AgentLogViewer / hook / 卡片；
//   - 不接管已完成 run 历史展开；
//   - 不调任何后端 API（hook / 卡片负责）。
// ────────────────────────────────────────────────────────────────────────────

export interface AgentRunPanelProps {
  /** 工作区 ID（hook + API 请求路径用） */
  workspaceId: string;
  /** agent run ID；null 表示未选定 run（hook 不连 SSE，展示 emptyText） */
  runId: string | null;
  /** run 状态 pending/running → 连 SSE；否则仅 prefetch 历史（D-001） */
  isActive: boolean;

  // —— AgentLogViewer 定制（显式列，D-002）——
  /** 日志面板标题（透传 viewer.title，必填） */
  title: string;
  /** 空态文案，默认 "暂无日志" */
  emptyText?: string;
  /** 头部右侧摘要节点（透传 viewer.summary） */
  summary?: React.ReactNode;
  /**
   * 头部右侧操作节点（透传 viewer.actions）。
   * 若同时传 onClose，panel 自动追加一个"关闭"按钮到 actions 末尾。
   */
  actions?: React.ReactNode;
  /** 紧凑模式（透传 viewer.compact） */
  compact?: boolean;
  /** 面板/嵌入样式（透传 viewer.variant），默认 "panel" */
  variant?: "panel" | "embedded";
  /** 日志区最大高度 class（透传 viewer.maxHeightClass） */
  maxHeightClass?: string;
  /** LIVE 徽标（透传 viewer.isLive），活跃 run 建议传 true */
  isLive?: boolean;

  // —— 生命周期回调 ——
  /** run 结束（done 事件）通知父组件（透传 hook onDone） */
  onDone?: (status: string) => void;
  /** 关闭面板回调；传入后 panel 自动在 actions 区追加关闭按钮 */
  onClose?: () => void;
  /**
   * task-12 / design §5.7：gate_status 变化通知父组件（透传 hook gateStatus）。
   * SSE gate_status_changed 触发，父组件据此更新 verify stage gate 徽标。
   */
  onGateStatusChanged?: (gateStatus: GateStatusEvent | null) => void;
}

/**
 * 把 hook 返回的 AgentRunInputStream 字段映射到 AgentLogViewer 期望的
 * AgentLogInputControls 契约（design §7.2 / §13 X-002）。
 *
 * 字段映射表：
 *   hook.values      → viewer.inputValues
 *   hook.submitting  → viewer.submittingInputs
 *   hook.errors      → viewer.inputErrors
 *   hook.replied     → viewer.repliedInputs
 *   hook.set         → viewer.onChange
 *   hook.submit      → viewer.onSubmit（Promise → void，吞返回值）
 *
 * 注：AgentLogInputControls.onSubmit 类型为 `(_logId) => void`（非 Promise），
 *     hook.submit 返回 Promise<void>，适配用 `void input.submit(logId)` 吞掉。
 */
function adaptInputControls(input: AgentRunInputStream): AgentLogInputControls {
  return {
    inputValues: input.values,
    submittingInputs: input.submitting,
    inputErrors: input.errors,
    repliedInputs: input.replied,
    onChange: (logId, value) => input.set(logId, value),
    onSubmit: (logId) => {
      void input.submit(logId);
    },
  };
}

// ────────────────────────────────────────────────────────────────────────────
// TokenUsageBadge — run 累计 input/output token 展示徽标
//
// task-16 / FR-11 / design.md §5.5。
// 显示规则：↓ {input} | ↑ {output}，数字走 formatTokenCount 格式化。
// null / undefined → "—"；0 → "0"（与 null 区分）。
// ────────────────────────────────────────────────────────────────────────────
function TokenUsageBadge({
  input,
  output,
  cacheRead,
  cacheCreation,
}: {
  input: number | null;
  output: number | null;
  cacheRead: number | null;
  cacheCreation: number | null;
}) {
  return (
    <span
      data-testid="token-usage-badge"
      className="inline-flex items-center gap-1 rounded border border-zinc-200 bg-white px-1.5 py-0.5 text-[10px] font-mono text-zinc-600"
    >
      <span title="输入词元">↓ {formatTokenCount(input)}</span>
      <span className="text-zinc-300">|</span>
      <span title="输出词元">↑ {formatTokenCount(output)}</span>
      <span className="text-zinc-300">|</span>
      <span title="缓存读取">⚡ {formatTokenCount(cacheRead)}</span>
      <span className="text-zinc-300">|</span>
      {/* task-09 / D-004@v2 B 分支：cache_creation 全表恒 0（task-01 实证前按 Claude
          不返回兜底），显示"—"而非误导性"0"。实证后若 A 分支有真值，formatTokenCount 正常。 */}
      <span title="缓存写入">✎ {cacheCreation && cacheCreation > 0 ? formatTokenCount(cacheCreation) : "—"}</span>
    </span>
  );
}

export function AgentRunPanel({
  workspaceId,
  runId,
  isActive,
  title,
  emptyText,
  summary,
  actions,
  compact,
  variant,
  maxHeightClass,
  isLive,
  onDone,
  onClose,
  onGateStatusChanged,
}: AgentRunPanelProps) {
  // ──────────────────────────────────────────────────────────────────────────
  // task-16 / FR-11：run 累计 input/output token 状态 + 5s 轮询刷新。
  //
  // 方案 A（task-16 选）：panel 内部 getAgentRun 轮询拉取 AgentRun.input/output_tokens
  // （daemon.ts:1070-1080 每 assistant message 实时回写），延迟 ≤ 5s。
  // 不改 use-agent-run-stream.ts（不在 allowed_paths）。
  //
  // 生命周期：
  //   - runId=null → tokenUsage=null，不渲染徽标（边界 4）
  //   - runId 变化 → cleanup 清旧 interval + cancelled flag 防 stale set（边界 4）
  //   - isActive=true → 每 5s 轮询；isActive=false 只 fetch 一次（非活跃 run 无需轮询）
  //   - getAgentRun 失败 → catch 静默，不阻断面板（边界 6）
  // ──────────────────────────────────────────────────────────────────────
  const [tokenUsage, setTokenUsage] = React.useState<{
    input: number | null;
    output: number | null;
    cacheRead: number | null;
    cacheCreation: number | null;
  } | null>(null);

  // fetchUsage 通过 ref 暴露给 handleDone：handleDone 闭包在 useAgentRunStream 内部
  // 注册一次（依赖 onDone 变化重连），如直接闭包 fetchUsage 会拿到 stale 值。
  // ref 永远指向最新 fetchUsage 实现，handleDone 回调内通过 ref 调用。
  const fetchUsageRef = React.useRef<(() => void) | null>(null);

  // task-16：onDone 包装器，稳定引用（useCallback）防止 hook 死循环重连 SSE。
  // 透传外部 onDone + 触发 fetchUsage 取终态 token（避免等下次 5s 轮询）。
  // 必须声明在 useAgentRunStream 调用之前（透传给其 options.onDone）。
  const handleDone = React.useCallback(
    (status: string) => {
      onDone?.(status);
      fetchUsageRef.current?.();
    },
    [onDone],
  );

  const {
    logs,
    loading,
    error,
    perms,
    dismissPerm,
    input,
    gateStatus,
  } = useAgentRunStream(
    workspaceId,
    runId,
    {
      isActive,
      onDone: handleDone,
    },
  );

  // task-12 / design §5.7：透传 gateStatus 到父组件（SSE gate_status_changed →
  // 父 page.tsx 更新 verify stage gate 徽标）。gateStatus=null 亦透传（初始化/清除）。
  React.useEffect(() => {
    onGateStatusChanged?.(gateStatus);
  }, [gateStatus, onGateStatusChanged]);

  React.useEffect(() => {
    if (!runId) {
      setTokenUsage(null);
      fetchUsageRef.current = null;
      return;
    }
    let cancelled = false;
    const fetchUsage = () => {
      getAgentRun(workspaceId, runId)
        .then((run) => {
          if (!cancelled) {
            setTokenUsage({
              input: run.input_tokens,
              output: run.output_tokens,
              cacheRead: run.cache_read_tokens,
              cacheCreation: run.cache_creation_tokens,
            });
          }
        })
        .catch(() => {
          /* 静默：token 拉取失败不阻断面板（边界 6） */
        });
    };
    fetchUsageRef.current = fetchUsage;
    fetchUsage();
    // 活跃 run 每 5s 轮询刷新（streaming 期间 token 累积，FR-11 实时增长）
    const interval = isActive ? setInterval(fetchUsage, 5000) : null;
    return () => {
      cancelled = true;
      if (interval) clearInterval(interval);
      if (fetchUsageRef.current === fetchUsage) {
        fetchUsageRef.current = null;
      }
    };
  }, [workspaceId, runId, isActive]);

  // 合并 token 徽标 + 外部传入的 summary 节点（边界 8：每个 panel 实例独立）
  const composedSummary = React.useMemo(
    () => (
      <>
        {tokenUsage && (
          <TokenUsageBadge
            input={tokenUsage.input}
            output={tokenUsage.output}
            cacheRead={tokenUsage.cacheRead}
            cacheCreation={tokenUsage.cacheCreation}
          />
        )}
        {summary}
      </>
    ),
    [tokenUsage, summary],
  );

  // X-002：input 适配，依赖 [input] 稳定引用（hook 每次 render 都返回新 input 对象，
  // 但内部字段引用稳定；此处依赖 input 整体引用，hook 未 memo，panel 适配对象每次
  // 新建——与原 page.tsx inline 传 inputControls 行为一致，不影响正确性）。
  const inputControls = React.useMemo(
    () => adaptInputControls(input),
    [input],
  );

  // D-003：卡片已自调 respondSessionPermission + onResolved 回调本处。
  // panel 只做本地 perms 移除（与决策方向无关，忽略 decision 参数）。
  const handlePermissionResolved = React.useCallback(
    (_requestId: string, _decision: "allow" | "deny") => {
      dismissPerm(_requestId);
    },
    [dismissPerm],
  );

  // onClose 便利注入：传入 onClose 时在 actions 末尾追加关闭按钮。
  const composedActions = React.useMemo(() => {
    if (!onClose) return actions;
    const closeBtn = (
      <Button
        variant="ghost"
        size="sm"
        onClick={onClose}
        className="h-6 gap-1 px-2 text-[11px] text-zinc-500 hover:text-zinc-800"
        title="关闭面板"
      >
        <X className="h-3 w-3" />
        关闭
      </Button>
    );
    return actions ? (
      <>
        {actions}
        {closeBtn}
      </>
    ) : (
      closeBtn
    );
  }, [actions, onClose]);

  return (
    <div className="min-w-0">
      {/* error 横幅（bootstrapError 风格）：hook setError 后展示，不阻断 viewer */}
      {error && (
        <div
          role="alert"
          className="mb-2 flex items-start gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700"
        >
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span className="min-w-0 break-words">{error}</span>
        </div>
      )}
      <AgentLogViewer
        title={title}
        runId={runId ?? ""}
        logs={logs}
        loading={loading}
        emptyText={emptyText ?? "暂无日志"}
        maxHeightClass={maxHeightClass}
        compact={compact}
        variant={variant}
        isLive={isLive}
        summary={composedSummary}
        actions={composedActions}
        inputControls={inputControls}
        permissionRequests={perms}
        onPermissionResolved={handlePermissionResolved}
      />
    </div>
  );
}
