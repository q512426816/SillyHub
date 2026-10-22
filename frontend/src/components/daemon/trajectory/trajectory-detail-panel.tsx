"use client";

/**
 * 轨迹详情面板（2026-10-22-trajectory-view-redesign / D-005 / D-007 / D-008 / D-015）。
 *
 * 按行类型分两档：
 *   - 工具行：概述 / 参数 / 结果 / 计时（Schema 按 D-007 隐藏）；
 *   - 其它行：概述 / 原始内容。
 *
 * 宽度可拖拽（320–720），双击复位；窄容器走抽屉（绝对定位覆盖）。
 * 计时缺失的指标显式写「未记录 / 不可用」，不估算（D-006）。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { cn } from "@/lib/utils";

import type { Trajectory, TrajectoryRow } from "./build-trajectory";
import { KIND_LABEL } from "./trajectory-view-model";

export interface TrajectoryDetailPanelProps {
  trajectory: Trajectory;
  selectedRowId: string | null;
  onClose: () => void;
  className?: string;
}

type TabKey = "overview" | "payload" | "result" | "timing" | "raw";

const STATUS_LABEL: Record<TrajectoryRow["status"], string> = {
  ok: "已完成",
  error: "失败",
  running: "运行中",
  interrupted: "中断",
};

const STATUS_TONE: Record<TrajectoryRow["status"], string> = {
  ok: "text-success",
  error: "text-error",
  running: "text-warning",
  interrupted: "text-muted-foreground",
};

const MIN_WIDTH = 320;
const MAX_WIDTH = 720;
const DEFAULT_WIDTH = 360;

function formatTime(ms: number): string {
  return new Date(ms).toLocaleTimeString("zh-CN", { hour12: false });
}

function formatDuration(ms: number): string {
  if (!Number.isFinite(ms)) return "不可用";
  if (ms < 1000) return `${Math.max(0, Math.round(ms))}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const minutes = Math.floor(ms / 60_000);
  const seconds = Math.round((ms % 60_000) / 1000);
  return `${minutes}m${String(seconds).padStart(2, "0")}s`;
}

function parseJsonObject(text: string | undefined): Record<string, unknown> | null {
  if (!text) return null;
  try {
    const parsed: unknown = JSON.parse(text);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    /* 非 JSON：不提供美化切换 */
  }
  return null;
}

export function TrajectoryDetailPanel({
  trajectory,
  selectedRowId,
  onClose,
  className,
}: TrajectoryDetailPanelProps) {
  const selectedRow = useMemo(
    () => trajectory.rows.find((row) => row.id === selectedRowId) ?? null,
    [trajectory.rows, selectedRowId],
  );
  const [tab, setTab] = useState<TabKey>("overview");
  const [width, setWidth] = useState<number | null>(null);
  const [copied, setCopied] = useState(false);
  const [showPretty, setShowPretty] = useState(true);
  const panelRef = useRef<HTMLElement | null>(null);
  const dragRef = useRef<{ startX: number; startWidth: number } | null>(null);

  useEffect(() => {
    setTab("overview");
    setCopied(false);
    setShowPretty(true);
  }, [selectedRowId]);

  const handlePointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const el = panelRef.current;
    if (!el) return;
    dragRef.current = { startX: event.clientX, startWidth: el.getBoundingClientRect().width };
    event.currentTarget.setPointerCapture(event.pointerId);
  }, []);

  const handlePointerMove = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    const next = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, drag.startWidth + (drag.startX - event.clientX)));
    setWidth(next);
  }, []);

  const handlePointerUp = useCallback(() => {
    dragRef.current = null;
  }, []);

  const handleCopy = useCallback(async () => {
    if (!selectedRow) return;
    const text = [selectedRow.inputText, selectedRow.outputText]
      .filter((part): part is string => Boolean(part))
      .join("\n\n");
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* 剪贴板被拒：保持原状 */
    }
  }, [selectedRow]);

  if (!selectedRow) return null;

  const isTool = selectedRow.kind === "tool";
  const tabs: Array<{ key: TabKey; label: string }> = isTool
    ? [
        { key: "overview", label: "概述" },
        { key: "payload", label: "参数" },
        { key: "result", label: "结果" },
        { key: "timing", label: "计时" },
      ]
    : [
        { key: "overview", label: "概述" },
        { key: "raw", label: "原始内容" },
      ];

  const parsedInput = parseJsonObject(selectedRow.inputText);
  const prettyInput = parsedInput ? JSON.stringify(parsedInput, null, 2) : null;
  const turn = trajectory.turns.find((item) => item.index === selectedRow.turnIndex) ?? null;

  return (
    <aside
      ref={panelRef}
      aria-label="行详情"
      data-testid="trajectory-detail-panel"
      style={width ? { width } : { width: "clamp(320px, 38%, 440px)" }}
      className={cn(
        "absolute inset-y-0 right-0 z-20 flex min-h-0 max-w-[calc(100%-280px)] shrink-0 flex-col border-l border-border bg-card shadow-lg",
        "@[760px]:static @[760px]:z-auto @[760px]:shadow-none",
        className,
      )}
    >
      {/* 拖拽把手（左缘） */}
      <div
        role="separator"
        aria-label="调整事件详情宽度"
        title="拖动调整宽度；双击复位"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onDoubleClick={() => setWidth(null)}
        className="absolute inset-y-0 left-0 w-1 cursor-col-resize bg-transparent hover:bg-brand-300/60"
      />
      <div className="flex h-[42px] shrink-0 items-center gap-2 border-b border-border px-3">
        <span className="rounded border border-border bg-warning/10 px-1.5 text-[10px] font-semibold text-warning">
          {KIND_LABEL[selectedRow.kind] ?? selectedRow.kind}
        </span>
        <span className="truncate text-[12px] font-medium">
          {selectedRow.toolName ?? KIND_LABEL[selectedRow.kind]}
        </span>
        <span className="font-mono text-[10.5px] text-muted-foreground">
          第 {selectedRow.turnIndex} 轮 · 第 {selectedRow.stepIndex} 步
        </span>
        <button
          type="button"
          aria-label="关闭详情"
          onClick={onClose}
          className="ml-auto rounded px-1 text-[14px] leading-none text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          ×
        </button>
      </div>

      <div role="tablist" aria-label="行详情分区" className="flex h-[34px] shrink-0 items-stretch gap-3 border-b border-border px-3">
        {tabs.map((item) => (
          <button
            key={item.key}
            type="button"
            role="tab"
            aria-selected={tab === item.key}
            onClick={() => setTab(item.key)}
            className={cn(
              "inline-flex items-center border-b-2 text-[11.5px] transition-colors",
              tab === item.key
                ? "border-brand-600 font-medium text-brand-700"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {item.label}
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2">
        {tab === "overview" ? (
          <dl className="grid grid-cols-[64px_minmax(0,1fr)] gap-x-2 gap-y-1 text-[11px]">
            <dt className="text-muted-foreground">类型</dt>
            <dd>{KIND_LABEL[selectedRow.kind] ?? selectedRow.kind}</dd>
            <dt className="text-muted-foreground">状态</dt>
            <dd className={STATUS_TONE[selectedRow.status]}>{STATUS_LABEL[selectedRow.status]}</dd>
            <dt className="text-muted-foreground">层级</dt>
            <dd>
              第 {selectedRow.turnIndex} 轮 · 第 {selectedRow.stepIndex} 步
              {selectedRow.depth > 0 ? ` · 深度 ${selectedRow.depth}` : ""}
            </dd>
            {selectedRow.toolName ? (
              <>
                <dt className="text-muted-foreground">工具</dt>
                <dd className="break-words">{selectedRow.toolName}</dd>
              </>
            ) : null}
            {selectedRow.callId ? (
              <>
                <dt className="text-muted-foreground">call</dt>
                <dd className="break-all font-mono text-[10.5px]">{selectedRow.callId}</dd>
              </>
            ) : null}
            <dt className="text-muted-foreground">tokens</dt>
            <dd>
              {selectedRow.inlineTokens
                ? `${selectedRow.inlineTokens.in ?? "—"}→${selectedRow.inlineTokens.out ?? "—"}`
                : turn
                  ? `轮级 ${turn.inputTokens ?? "—"}→${turn.outputTokens ?? "—"}`
                  : "不可用"}
            </dd>
          </dl>
        ) : null}

        {tab === "payload" ? (
          <section>
            <div className="mb-1 flex items-center gap-2 text-[10.5px] text-muted-foreground">
              <span className="font-medium text-foreground">参数</span>
              {prettyInput ? (
                <button
                  type="button"
                  aria-pressed={showPretty}
                  onClick={() => setShowPretty((value) => !value)}
                  className="rounded border border-border px-1 font-mono text-[10px] hover:bg-muted"
                  title="JSON 美化 / 原文"
                >
                  {"{}"}
                </button>
              ) : null}
              {selectedRow.truncated ? <span className="text-warning">已截断</span> : null}
              <button
                type="button"
                onClick={() => void handleCopy()}
                className="ml-auto rounded border border-border px-1 text-[10px] hover:bg-muted"
              >
                {copied ? "已复制" : "复制"}
              </button>
            </div>
            {selectedRow.inputText ? (
              <pre className="max-h-[42vh] overflow-auto whitespace-pre-wrap break-words rounded border border-border bg-muted/40 p-2 font-mono text-[10.5px] leading-[1.55]">
                {showPretty && prettyInput ? prettyInput : selectedRow.inputText}
              </pre>
            ) : (
              <div className="text-[11px] text-muted-foreground">未捕获参数</div>
            )}
          </section>
        ) : null}

        {tab === "result" ? (
          <section>
            <div className="mb-1 flex items-center gap-2 text-[10.5px] text-muted-foreground">
              <span className="font-medium text-foreground">结果</span>
              {selectedRow.toolName && !selectedRow.outputText ? (
                <span>（仅摘要，未捕获结果）</span>
              ) : null}
            </div>
            {selectedRow.outputText ? (
              <pre className="max-h-[50vh] overflow-auto whitespace-pre-wrap break-words rounded border border-border bg-muted/40 p-2 font-mono text-[10.5px] leading-[1.55]">
                {selectedRow.outputText}
              </pre>
            ) : (
              <div className="text-[11px] text-muted-foreground">未捕获结果</div>
            )}
          </section>
        ) : null}

        {tab === "timing" ? (
          <dl className="grid grid-cols-[86px_minmax(0,1fr)] gap-x-2 gap-y-1 text-[11px]">
            <dt className="text-muted-foreground">开始时间</dt>
            <dd className="font-mono tabular-nums">{formatTime(selectedRow.startedAt)}</dd>
            <dt className="text-muted-foreground">结束时间</dt>
            <dd className="font-mono tabular-nums">{formatTime(selectedRow.endedAt)}</dd>
            <dt className="text-muted-foreground">总时长</dt>
            <dd className="font-mono tabular-nums">{formatDuration(selectedRow.durationMs)}</dd>
            <dt className="text-muted-foreground">首 token 延迟</dt>
            <dd className="text-muted-foreground">未记录</dd>
            <dt className="text-muted-foreground">生成</dt>
            <dd className="text-muted-foreground">未记录</dd>
            <dt className="text-muted-foreground">吞吐</dt>
            <dd className="text-muted-foreground">不可用</dd>
            <dt className="text-muted-foreground">计时来源</dt>
            <dd className="text-muted-foreground">会话时间戳</dd>
          </dl>
        ) : null}

        {tab === "raw" ? (
          <section>
            <div className="mb-1 text-[10.5px] font-medium text-foreground">原始内容</div>
            {selectedRow.outputText || selectedRow.inputText ? (
              <pre className="max-h-[60vh] overflow-auto whitespace-pre-wrap break-words rounded border border-border bg-muted/40 p-2 font-mono text-[10.5px] leading-[1.55]">
                {selectedRow.outputText ?? selectedRow.inputText}
              </pre>
            ) : (
              <div className="text-[11px] text-muted-foreground">无内容</div>
            )}
          </section>
        ) : null}
      </div>
    </aside>
  );
}
