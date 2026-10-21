"use client";

/**
 * 轨迹视图（Trajectory view）—— 纯展示组件，档 1（2026-10-20-session-page-dsh-alignment / D-024 / D-026）。
 *
 * 结构（左列 + 右列）：
 *   1. 左列：泳道时间轴（`trajectory-timeline.tsx`）在**账本之上**，二者共享同一列宽
 *      （时间轴右边缘 = 账本右边缘；此前时间轴横跨整页、右缘偏离账本 308px
 *      ＝ 320px 检查器列 − 12px 时间轴右内边距）。时间轴
 *      三条泳道（输入 / 模型 / 工具）共用同一个绝对时间轴，支持滚轮缩放 / 拖拽平移。
 *   2. 左列：账本表（ledger）：时间 / 轮·步 / 类型 / 名称·摘要 / 耗时 / tokens / 状态，
 *      22px 密排行、monospace 数字、按 depth 缩进。
 *   3. 右列：检查器（inspector，320px）：选中行详情、输入/输出 <pre>、JSON 美化切换、
 *      复制按钮；整列高度（时间轴那条不再横跨它的上方）。
 *
 * 约束：
 *   - 无 fetch / store / context —— 数据由 props 注入（见 build-trajectory.ts）。
 *   - 856 行规模不引虚拟化库：每行 CSS `content-visibility: auto` +
 *     `contain-intrinsic-size`（与 turn-timeline / turn-nav-list 既有做法一致）。
 *   - 颜色只用语义 token（bg-card / border-border / text-muted-foreground /
 *     text-success / text-error / text-warning / text-primary / text-info），
 *     三主题（ai-native / blue / dark）随 html[data-theme] 自动换肤。
 *   - 文本一律按文本渲染，无 dangerouslySetInnerHTML；真实路径/命令原样保留。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent } from "react";

import { cn } from "@/lib/utils";

import type {
  Trajectory,
  TrajectoryRow,
  TrajectoryRowKind,
  TrajectoryRowStatus,
} from "./build-trajectory";
import { TrajectoryTimeline } from "./trajectory-timeline";

const KIND_LABEL: Record<TrajectoryRowKind, string> = {
  user: "用户",
  assistant: "答复",
  thinking: "思考",
  tool: "工具",
  tool_result: "结果",
  system: "系统",
  compaction: "压缩",
  error: "错误",
};

const KIND_TONE: Record<TrajectoryRowKind, string> = {
  user: "text-primary",
  assistant: "text-foreground",
  thinking: "text-muted-foreground",
  tool: "text-info",
  tool_result: "text-info",
  system: "text-muted-foreground",
  compaction: "text-warning",
  error: "text-error",
};

const STATUS_LABEL: Record<TrajectoryRowStatus, string> = {
  ok: "成功",
  error: "失败",
  running: "运行中",
  interrupted: "中断",
};

const STATUS_TONE: Record<TrajectoryRowStatus, string> = {
  ok: "text-success",
  error: "text-error",
  running: "text-warning",
  interrupted: "text-muted-foreground",
};

const GRID_COLUMNS =
  "grid grid-cols-[72px_52px_58px_minmax(0,1fr)_58px_74px_54px] items-center gap-x-2";

const ROW_HEIGHT = 22;
const INSPECTOR_WIDTH = 320;

function formatOffset(ms: number): string {
  const total = Math.max(0, Math.round(ms));
  const minutes = Math.floor(total / 60_000);
  const seconds = Math.floor((total % 60_000) / 1000);
  const tenth = Math.floor((total % 1000) / 100);
  return `+${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}.${tenth}`;
}

function formatDuration(ms: number): string {
  if (!Number.isFinite(ms)) return "—";
  if (ms < 1000) return `${Math.max(0, Math.round(ms))}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const minutes = Math.floor(ms / 60_000);
  const seconds = Math.round((ms % 60_000) / 1000);
  return `${minutes}m${String(seconds).padStart(2, "0")}s`;
}

function formatTokens(tokens: { in?: number; out?: number } | undefined): string {
  if (!tokens) return "—";
  const one = (value: number | undefined) => {
    if (value == null) return "—";
    return value >= 1000 ? `${(value / 1000).toFixed(1)}k` : String(value);
  };
  return `${one(tokens.in)}→${one(tokens.out)}`;
}

function parseJsonObject(text: string | undefined): Record<string, unknown> | null {
  if (!text) return null;
  try {
    const parsed: unknown = JSON.parse(text);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // 非 JSON：不提供美化切换
  }
  return null;
}

function pickString(source: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "string" && value.trim()) return value;
  }
  return null;
}

/** 工具行摘要：优先取参数里的主命令/路径，其次工具名。 */
function toolSummary(row: TrajectoryRow): string {
  const args = parseJsonObject(row.inputText);
  const primary = args
    ? pickString(args, [
        "command",
        "file_path",
        "path",
        "pattern",
        "query",
        "description",
        "prompt",
        "url",
      ])
    : null;
  const name = row.toolName ?? "tool";
  if (primary) return `${name} · ${primary}`;
  if (row.inputText) return `${name} · ${row.inputText}`;
  return name;
}

function rowSummary(row: TrajectoryRow): string {
  if (row.kind === "tool") return toolSummary(row);
  const text = (row.outputText ?? row.inputText ?? "").replace(/\s+/g, " ").trim();
  return text || row.toolName || "—";
}

function domRowId(rowId: string): string {
  return `trajectory-row-${rowId.replace(/[^a-zA-Z0-9_-]/g, "_")}`;
}

export interface TrajectoryViewProps {
  trajectory: Trajectory;
  selectedRowId?: string | null;
  onSelectRow?: (_rowId: string | null) => void;
  className?: string;
}

export function TrajectoryView({
  trajectory,
  selectedRowId,
  onSelectRow,
  className,
}: TrajectoryViewProps) {
  const { rows, turns, windowStart } = trajectory;
  const gridRef = useRef<HTMLDivElement | null>(null);
  const rowRefs = useRef(new Map<string, HTMLDivElement>());
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [copied, setCopied] = useState(false);
  const [showJson, setShowJson] = useState(false);

  const selectedRow = useMemo(
    () => rows.find((row) => row.id === selectedRowId) ?? null,
    [rows, selectedRowId],
  );
  const selectedTurn = useMemo(
    () => (selectedRow ? turns.find((turn) => turn.index === selectedRow.turnIndex) ?? null : null),
    [turns, selectedRow],
  );

  useEffect(() => {
    setCopied(false);
    setShowJson(false);
  }, [selectedRowId]);

  useEffect(() => {
    if (!selectedRowId) return;
    rowRefs.current.get(selectedRowId)?.scrollIntoView({ block: "nearest" });
  }, [selectedRowId]);

  useEffect(
    () => () => {
      if (copyTimer.current) clearTimeout(copyTimer.current);
    },
    [],
  );

  const parsedInput = useMemo(() => parseJsonObject(selectedRow?.inputText), [selectedRow]);
  const prettyInput = useMemo(
    () => (parsedInput ? JSON.stringify(parsedInput, null, 2) : null),
    [parsedInput],
  );

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onSelectRow?.(null);
        return;
      }
      if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
      if (rows.length === 0) return;
      event.preventDefault();
      const current = selectedRowId
        ? rows.findIndex((row) => row.id === selectedRowId)
        : -1;
      let nextIndex: number;
      if (event.key === "ArrowDown") {
        nextIndex = current < 0 ? 0 : Math.min(rows.length - 1, current + 1);
      } else {
        nextIndex = current < 0 ? rows.length - 1 : Math.max(0, current - 1);
      }
      onSelectRow?.(rows[nextIndex]?.id ?? null);
    },
    [onSelectRow, rows, selectedRowId],
  );

  const handleCopy = useCallback(async () => {
    if (!selectedRow) return;
    const textParts = [
      showJson && prettyInput ? prettyInput : selectedRow.inputText,
      selectedRow.outputText,
    ].filter((part): part is string => Boolean(part && part.length > 0));
    try {
      await navigator.clipboard.writeText(textParts.join("\n\n"));
      setCopied(true);
      if (copyTimer.current) clearTimeout(copyTimer.current);
      copyTimer.current = setTimeout(() => setCopied(false), 1500);
    } catch {
      // 剪贴板权限被拒：保持按钮原状，不打断阅读
    }
  }, [prettyInput, selectedRow, showJson]);

  return (
    <div
      className={cn(
        "flex h-full min-h-0 w-full min-w-0 flex-col overflow-hidden bg-background text-foreground",
        className,
      )}
    >
      {/* ── 左列：泳道时间轴（输入/模型/工具共轴）+ 账本；右列：检查器 ────
       *
       * 时间轴放在**左列内部**、账本之上：它和账本共享同一列宽，右边缘与账本
       * 右边缘对齐（此前时间轴横跨整页，右缘偏离账本 308px ＝ 320px 检查器列
       * − 12px 时间轴右内边距）。
       */}
      <div className="flex min-h-0 min-w-0 flex-1">
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <TrajectoryTimeline
            trajectory={trajectory}
            selectedRowId={selectedRowId}
            onSelectRow={(rowId) => {
              gridRef.current?.focus();
              onSelectRow?.(rowId);
            }}
          />

          <div
            ref={gridRef}
            role="grid"
            aria-label="轨迹账本"
            aria-rowcount={rows.length}
            aria-colcount={7}
            aria-activedescendant={selectedRow ? domRowId(selectedRow.id) : undefined}
            tabIndex={0}
            onKeyDown={handleKeyDown}
            data-testid="trajectory-grid"
            className="min-h-0 min-w-0 flex-1 overflow-y-auto outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-brand-400"
          >
            <div role="rowgroup" className="sticky top-0 z-[1] bg-card">
              <div
                role="row"
                className={cn(
                  GRID_COLUMNS,
                  "h-[24px] border-b border-border px-3 text-[10px] font-medium text-muted-foreground",
                )}
              >
                <span role="columnheader">时间</span>
                <span role="columnheader">轮/步</span>
                <span role="columnheader">类型</span>
                <span role="columnheader">名称/摘要</span>
                <span role="columnheader" className="text-right">
                  耗时
                </span>
                <span role="columnheader" className="text-right">
                  tokens
                </span>
                <span role="columnheader" className="text-right">
                  状态
                </span>
              </div>
            </div>
            <div role="rowgroup">
              {rows.length === 0 ? (
                <div className="px-3 py-2 text-[11px] text-muted-foreground">无轨迹记录</div>
              ) : (
                rows.map((row) => {
                  const selected = selectedRowId === row.id;
                  return (
                    <div
                      key={row.id}
                      ref={(element) => {
                        if (element) rowRefs.current.set(row.id, element);
                        else rowRefs.current.delete(row.id);
                      }}
                      id={domRowId(row.id)}
                      role="row"
                      aria-selected={selected}
                      data-testid="trajectory-row"
                      data-row-id={row.id}
                      data-row-kind={row.kind}
                      data-tool-name={row.toolName}
                      onClick={() => {
                        gridRef.current?.focus();
                        onSelectRow?.(row.id);
                      }}
                      title={`${KIND_LABEL[row.kind]} · ${rowSummary(row)}`}
                      className={cn(
                        GRID_COLUMNS,
                        "h-[22px] cursor-pointer overflow-hidden border-b border-border/60 px-3 text-[11px] leading-[21px]",
                        "hover:bg-muted/60",
                        selected && "bg-muted ring-1 ring-inset ring-brand-500",
                      )}
                      style={{
                        contentVisibility: "auto",
                        containIntrinsicSize: `${ROW_HEIGHT}px`,
                        paddingLeft: 12 + row.depth * 14,
                      }}
                    >
                      <span className="font-mono tabular-nums text-muted-foreground">
                        {formatOffset(row.startedAt - windowStart)}
                      </span>
                      <span className="font-mono tabular-nums text-muted-foreground">
                        T{String(row.turnIndex).padStart(2, "0")}·
                        {String(row.stepIndex).padStart(2, "0")}
                      </span>
                      <span className={cn("truncate font-medium", KIND_TONE[row.kind])}>
                        {KIND_LABEL[row.kind]}
                      </span>
                      <span className="truncate text-foreground" title={rowSummary(row)}>
                        {rowSummary(row)}
                      </span>
                      <span className="text-right font-mono tabular-nums text-muted-foreground">
                        {row.durationMs > 0 ? formatDuration(row.durationMs) : "—"}
                      </span>
                      <span className="text-right font-mono tabular-nums text-muted-foreground">
                        {formatTokens(row.inlineTokens)}
                      </span>
                      <span
                        className={cn(
                          "flex items-center justify-end gap-1 truncate font-mono",
                          STATUS_TONE[row.status],
                        )}
                      >
                        <span aria-hidden className="inline-block h-1 w-1 rounded-full bg-current" />
                        {STATUS_LABEL[row.status]}
                      </span>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>

        {/* ── 检查器 ──────────────────────────────────────────────────── */}
        <aside
          aria-label="行详情"
          className="hidden min-h-0 shrink-0 flex-col border-l border-border bg-card md:flex"
          style={{ width: INSPECTOR_WIDTH }}
        >
          {selectedRow ? (
            <div className="flex min-h-0 flex-1 flex-col">
              <div className="flex items-center gap-2 border-b border-border px-3 py-1.5">
                <span
                  className={cn(
                    "rounded border border-border px-1 py-px text-[10px] font-medium",
                    KIND_TONE[selectedRow.kind],
                  )}
                >
                  {KIND_LABEL[selectedRow.kind]}
                </span>
                <span className="truncate text-[11px] font-medium">
                  {selectedRow.toolName ?? selectedRow.kind}
                </span>
                <button
                  type="button"
                  onClick={() => void handleCopy()}
                  className="ml-auto rounded border border-border px-1.5 py-px text-[10px] text-muted-foreground hover:bg-muted hover:text-foreground"
                >
                  {copied ? "已复制" : "复制"}
                </button>
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2">
                <dl className="grid grid-cols-[64px_minmax(0,1fr)] gap-x-2 gap-y-0.5 font-mono text-[10.5px] tabular-nums text-muted-foreground">
                  <dt>轮/步</dt>
                  <dd className="text-foreground">
                    T{String(selectedRow.turnIndex).padStart(2, "0")} ·{" "}
                    {String(selectedRow.stepIndex).padStart(2, "0")}
                    {selectedTurn ? (
                      <span className="ml-1 text-muted-foreground">{selectedTurn.status}</span>
                    ) : null}
                  </dd>
                  <dt>开始</dt>
                  <dd className="text-foreground">
                    {formatOffset(selectedRow.startedAt - windowStart)}
                  </dd>
                  <dt>结束</dt>
                  <dd className="text-foreground">
                    {formatOffset(selectedRow.endedAt - windowStart)}
                  </dd>
                  <dt>耗时</dt>
                  <dd className="text-foreground">{formatDuration(selectedRow.durationMs)}</dd>
                  <dt>tokens</dt>
                  <dd className="text-foreground">
                    {formatTokens(selectedRow.inlineTokens)}
                    {!selectedRow.inlineTokens && selectedTurn ? (
                      <span className="ml-1 text-muted-foreground">
                        （轮级 {selectedTurn.inputTokens ?? "—"}→
                        {selectedTurn.outputTokens ?? "—"}）
                      </span>
                    ) : null}
                  </dd>
                  <dt>状态</dt>
                  <dd className={STATUS_TONE[selectedRow.status]}>
                    {STATUS_LABEL[selectedRow.status]}
                  </dd>
                  {selectedRow.toolName ? (
                    <>
                      <dt>工具</dt>
                      <dd className="break-words text-foreground">{selectedRow.toolName}</dd>
                    </>
                  ) : null}
                  {selectedRow.meta?.toolKind ? (
                    <>
                      <dt>种类</dt>
                      <dd className="break-words text-foreground">{selectedRow.meta.toolKind}</dd>
                    </>
                  ) : null}
                  {selectedRow.callId ? (
                    <>
                      <dt>call</dt>
                      <dd className="break-all text-foreground">{selectedRow.callId}</dd>
                    </>
                  ) : null}
                  {selectedRow.depth > 0 || selectedRow.parentCallId ? (
                    <>
                      <dt>层级</dt>
                      <dd className="break-all text-foreground">
                        depth {selectedRow.depth}
                        {selectedRow.parentCallId ? ` · ${selectedRow.parentCallId}` : ""}
                      </dd>
                    </>
                  ) : null}
                </dl>

                {selectedRow.inputText !== undefined ? (
                  <section className="mt-2">
                    <div className="mb-1 flex items-center gap-2 text-[10.5px] text-muted-foreground">
                      <span className="font-medium text-foreground">输入</span>
                      {prettyInput ? (
                        <button
                          type="button"
                          aria-pressed={showJson}
                          onClick={() => setShowJson((value) => !value)}
                          className={cn(
                            "rounded border border-border px-1 font-mono text-[10px] hover:bg-muted",
                            showJson && "bg-muted text-foreground",
                          )}
                          title="JSON 美化 / 原文"
                        >
                          {"{}"}
                        </button>
                      ) : null}
                      {selectedRow.truncated ? (
                        <span className="text-warning">已截断</span>
                      ) : null}
                    </div>
                    <pre className="max-h-[34vh] overflow-auto whitespace-pre-wrap break-words rounded border border-border bg-muted/40 p-2 font-mono text-[10.5px] leading-[1.55] text-foreground">
                      {showJson && prettyInput ? prettyInput : selectedRow.inputText}
                    </pre>
                  </section>
                ) : null}

                {selectedRow.outputText !== undefined ? (
                  <section className="mt-2">
                    <div className="mb-1 flex items-center gap-2 text-[10.5px] text-muted-foreground">
                      <span className="font-medium text-foreground">输出</span>
                      {selectedRow.truncated ? (
                        <span className="text-warning">已截断</span>
                      ) : null}
                    </div>
                    <pre className="max-h-[34vh] overflow-auto whitespace-pre-wrap break-words rounded border border-border bg-muted/40 p-2 font-mono text-[10.5px] leading-[1.55] text-foreground">
                      {selectedRow.outputText}
                    </pre>
                  </section>
                ) : null}

                {selectedRow.inputText === undefined &&
                selectedRow.outputText === undefined ? (
                  <div className="mt-2 text-[11px] text-muted-foreground">无正文</div>
                ) : null}
              </div>
            </div>
          ) : (
            <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-1 px-4 text-center">
              <span className="font-mono text-[11px] text-muted-foreground">{"{ }"}</span>
              <span className="text-[11px] text-muted-foreground">
                选中一行查看输入 / 输出
              </span>
              <span className="text-[10px] text-muted-foreground">
                ↑ ↓ 切换 · Esc 清除
              </span>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
