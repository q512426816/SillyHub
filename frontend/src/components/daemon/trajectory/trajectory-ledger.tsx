"use client";

/**
 * 轨迹账本（2026-10-22-trajectory-view-redesign / D-004 / D-019）。
 *
 * 无表头两列结构：
 *   - 事件列：轮次起始标签 + 轮次竖线（产品路径无请求边界数据，D-019 不画 request 点）；
 *   - 内容列：类型标签 + 摘要（有结果时右侧「→ 结果摘要」）。
 *
 * 行高 30px；折叠摘要行 20px 且不可选中；子工具按 depth 缩进。
 * 键盘：↑/↓ 在可见记录间移动，Esc 清空（D-014）。
 */

import { useCallback, useEffect, useMemo, useRef } from "react";
import type { KeyboardEvent } from "react";

import { cn } from "@/lib/utils";

import type { LedgerGroupView, LedgerRowView } from "./trajectory-view-model";
import { visibleRecordIds } from "./trajectory-view-model";

export interface TrajectoryLedgerProps {
  groups: LedgerGroupView[];
  selectedRowId: string | null;
  // eslint-disable-next-line no-unused-vars -- 接口回调签名形参
  onSelectRow: (rowId: string | null) => void;
  // eslint-disable-next-line no-unused-vars -- 接口回调签名形参
  onExpandTurn: (turnIndex: number) => void;
  // eslint-disable-next-line no-unused-vars -- 接口回调签名形参
  onExpandCalls: (key: string) => void;
  query: string;
  className?: string;
}

const KIND_TONE: Record<string, string> = {
  用户: "text-brand-700 border-brand-200 bg-brand-50",
  上下文: "text-success border-success/30 bg-success/10",
  助手: "text-foreground border-border bg-muted",
  消息: "text-foreground border-border bg-muted",
  工具: "text-warning border-warning/30 bg-warning/10",
  子工具: "text-warning border-warning/20 bg-warning/5",
  结果: "text-warning border-warning/30 bg-warning/10",
  系统: "text-muted-foreground border-border bg-muted",
  压缩: "text-muted-foreground border-border bg-muted",
  思考: "text-muted-foreground border-border bg-muted",
  错误: "text-error border-error/30 bg-error/10",
};

function TypeBadge({ label }: { label: string }) {
  return (
    <span
      className={cn(
        "inline-flex h-[19px] shrink-0 items-center rounded border px-1.5 text-[10px] font-semibold tracking-wide",
        KIND_TONE[label] ?? "text-muted-foreground border-border bg-muted",
      )}
    >
      {label}
    </span>
  );
}

export function TrajectoryLedger({
  groups,
  selectedRowId,
  onSelectRow,
  onExpandTurn,
  onExpandCalls,
  query,
  className,
}: TrajectoryLedgerProps) {
  const visibleIds = useMemo(() => visibleRecordIds(groups), [groups]);
  // 2026-10-22-trajectory-context-jump（FR-03）：选中行滚入视野——点行 / 点时间线
  // 条块 / 键盘 ↑↓ / 轮次跳转统一入口；清空选中不滚动。jsdom 无实现，typeof 守卫。
  const gridRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!selectedRowId) return;
    const el = gridRef.current?.querySelector(
      `[data-row-id="${CSS.escape(selectedRowId)}"]`,
    );
    if (el && typeof el.scrollIntoView === "function") {
      el.scrollIntoView({ block: "nearest" });
    }
  }, [selectedRowId]);

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onSelectRow(null);
        return;
      }
      if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
      if (visibleIds.length === 0) return;
      event.preventDefault();
      const current = selectedRowId ? visibleIds.indexOf(selectedRowId) : -1;
      let next: number;
      if (event.key === "ArrowDown") {
        next = current < 0 ? 0 : Math.min(visibleIds.length - 1, current + 1);
      } else {
        next = current < 0 ? visibleIds.length - 1 : Math.max(0, current - 1);
      }
      onSelectRow(visibleIds[next] ?? null);
    },
    [onSelectRow, selectedRowId, visibleIds],
  );

  const handleSummaryClick = useCallback(
    (item: LedgerRowView) => {
      if (item.collapseAxis === "turn" && item.collapseKey) {
        onExpandTurn(Number(item.collapseKey));
        return;
      }
      if (item.collapseAxis === "calls" && item.collapseKey) {
        onExpandCalls(item.collapseKey);
      }
    },
    [onExpandCalls, onExpandTurn],
  );

  return (
    <div
      ref={gridRef}
      role="grid"
      aria-label="轨迹账本"
      tabIndex={0}
      onKeyDown={handleKeyDown}
      data-testid="trajectory-grid"
      className={cn(
        "min-h-0 flex-1 overflow-y-auto outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-brand-400",
        className,
      )}
    >
      {groups.length === 0 && query.trim() ? (
        <div
          data-testid="trajectory-no-match"
          className="px-3 py-3 text-[11px] text-muted-foreground"
        >
          没有匹配的记录
        </div>
      ) : null}
      {groups.map((group) => {
        let firstRecordShown = false;
        return (
          <div key={group.turnIndex} data-testid="trajectory-turn-group">
            {group.rows.map((item, idx) => {
              if (item.kind === "summary") {
                return (
                  <button
                    key={`summary-${group.turnIndex}-${idx}`}
                    type="button"
                    data-testid="trajectory-summary-row"
                    onClick={() => handleSummaryClick(item)}
                    className="flex h-[20px] w-full items-center gap-2 border-b border-border/40 pl-[96px] pr-3 text-left text-[11px] text-muted-foreground hover:bg-muted/60"
                  >
                    <span aria-hidden>…</span>
                    <span className="truncate">{item.summary}</span>
                  </button>
                );
              }
              const record = item.record;
              if (!record) return null;
              const showTurnLabel = !firstRecordShown;
              firstRecordShown = true;
              const selected = selectedRowId === record.id;
              return (
                <div
                  key={record.id}
                  id={`trajectory-row-${record.id.replace(/[^a-zA-Z0-9_-]/g, "_")}`}
                  role="row"
                  aria-selected={selected}
                  data-testid="trajectory-row"
                  data-row-id={record.id}
                  data-row-kind={record.kind}
                  data-tool-name={record.toolName}
                  onClick={() => onSelectRow(record.id)}
                  title={`${item.kindLabel} · ${item.summary}`}
                  className={cn(
                    "flex h-[30px] cursor-pointer items-center border-b border-border/60 text-[12px]",
                    "hover:bg-muted/60",
                    selected && "bg-brand-50 ring-1 ring-inset ring-brand-500",
                  )}
                  style={{ contentVisibility: "auto", containIntrinsicSize: "30px" }}
                >
                  <div className="flex h-full w-[84px] shrink-0 items-center gap-1.5 pl-3">
                    {showTurnLabel ? (
                      <span className="rounded bg-muted px-1 py-px font-mono text-[9.5px] font-semibold text-muted-foreground">
                        第 {group.turnIndex} 轮
                      </span>
                    ) : (
                      <span aria-hidden className="ml-[3px] h-full w-[2px] bg-brand-200" />
                    )}
                  </div>
                  <div
                    className="flex min-w-0 flex-1 items-center gap-2 pr-3"
                    style={{ paddingLeft: record.depth > 0 ? 26 : 0 }}
                  >
                    <TypeBadge label={item.kindLabel} />
                    <span className="min-w-0 flex-1 truncate text-foreground/90">
                      {item.summary}
                    </span>
                    {item.resultSummary ? (
                      <span className="max-w-[38%] shrink-0 truncate text-[11px] text-muted-foreground">
                        → {item.resultSummary}
                      </span>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}
