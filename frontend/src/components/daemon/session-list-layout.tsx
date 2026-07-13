"use client";

/**
 * 2026-07-11-unify-runtime-session-dialog / FR-01 / D-001: 公共会话列表组件。
 *
 * runtimes 弹窗（RuntimeSessionDialog）与变更会话（ChangeSessionSection）共用，
 * 杜绝两套列表样式分叉。调用方各自 fetch 数据并 map 成 SessionListEntry 传入，
 * 组件只管展示 + 选中回调；attach/续聊逻辑由调用方右侧挂的 InteractiveSessionPanel 负责。
 *
 * onDelete 可选：传入则每行右侧渲染删除按钮（runtimes 传），不传则无（变更会话）。
 */

import { Plus, RefreshCw, Trash2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface SessionListEntry {
  id: string;
  /** 列表项主标题；null/空 → 回退 shortId(id)。 */
  title: string | null;
  /** 状态徽标文本（active/pending/reconnecting/ended/failed），active 类显示 success。 */
  statusBadge: string;
  /** 次要行（调用方拼，如「提供方 · N 轮」或「作者 · 提供方」）。 */
  secondaryText: string;
  /** ISO 时间戳，渲染为 MM-DD HH:mm；null 不渲染时间行。 */
  lastActiveAt: string | null;
}

export interface SessionListLayoutProps {
  items: SessionListEntry[];
  loading: boolean;
  error: string | null;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onNewSession: () => void;
  onRetry: () => void;
  /** 可选删除回调：传入则每行渲染删除按钮。 */
  onDelete?: (id: string) => void;
  headerTitle?: string;
  newButtonLabel?: string;
}

function shortId(id: string): string {
  return id.length > 12 ? `${id.slice(0, 8)}...${id.slice(-4)}` : id;
}

function formatTime(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  return `${mm}-${dd} ${hh}:${mi}`;
}

function isActiveBadge(status: string): boolean {
  return status === "active" || status === "pending" || status === "reconnecting";
}

/** 会话状态英文 → 中文展示（CLAUDE.md 规则 11 中文 UI）。 */
const SESSION_STATUS_LABELS: Record<string, string> = {
  active: "进行中",
  pending: "启动中",
  reconnecting: "重连中",
  ended: "已结束",
  failed: "失败",
};

function statusLabel(status: string): string {
  return SESSION_STATUS_LABELS[status] ?? status;
}

export function SessionListLayout({
  items,
  loading,
  error,
  selectedId,
  onSelect,
  onNewSession,
  onRetry,
  onDelete,
  headerTitle = "会话历史",
  newButtonLabel = "新建会话",
}: SessionListLayoutProps) {
  return (
    <aside className="flex min-h-[420px] flex-col overflow-hidden rounded-md border bg-slate-50">
      <div className="flex shrink-0 items-center justify-between border-b bg-card px-3 py-2">
        <span className="text-xs font-medium text-foreground">{headerTitle}</span>
        <Button
          variant="ghost"
          size="sm"
          onClick={onRetry}
          disabled={loading}
          className="h-6 w-6 p-0"
          title="刷新"
        >
          <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
        </Button>
      </div>
      <div className="shrink-0 px-2 pt-2">
        <Button
          variant="outline"
          size="sm"
          onClick={onNewSession}
          className={cn(
            "h-8 w-full justify-center gap-1 border-dashed text-xs",
            selectedId === null && "border-blue-600 text-blue-700",
          )}
          title={newButtonLabel}
        >
          <Plus className="h-3.5 w-3.5" />
          {newButtonLabel}
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {error ? (
          <div className="space-y-2 px-3 py-3">
            <p className="text-[11px] text-destructive">{error}</p>
            <Button size="sm" variant="outline" onClick={onRetry} className="h-7 text-[11px]">
              重试
            </Button>
          </div>
        ) : items.length === 0 ? (
          <p className="px-3 py-6 text-center text-[11px] text-muted-foreground">
            {loading ? "加载中…" : "暂无会话，新建一个开始提问"}
          </p>
        ) : (
          <ul className="mt-1 divide-y">
            {items.map((s) => {
              const selected = selectedId === s.id;
              const active = isActiveBadge(s.statusBadge);
              return (
                <li key={s.id} className="flex items-stretch">
                  <button
                    type="button"
                    onClick={() => onSelect(s.id)}
                    className={cn(
                      "flex min-w-0 flex-1 flex-col items-start gap-1 border-l-[3px] border-transparent px-3 py-2.5 text-left hover:bg-blue-50/60",
                      selected && "border-blue-600 bg-blue-50",
                    )}
                  >
                    <span className="flex w-full items-center justify-between gap-2">
                      <span className="truncate text-xs font-medium text-foreground">
                        {s.title?.trim() || shortId(s.id)}
                      </span>
                      <Badge variant={active ? "success" : "outline"} className="shrink-0 text-[10px]">
                        {statusLabel(s.statusBadge)}
                      </Badge>
                    </span>
                    {s.secondaryText && (
                      <span className="truncate text-[11px] text-muted-foreground">
                        {s.secondaryText}
                      </span>
                    )}
                    {s.lastActiveAt && (
                      <span className="text-[10px] text-muted-foreground/80">
                        {formatTime(s.lastActiveAt)}
                      </span>
                    )}
                  </button>
                  {onDelete && (
                    <button
                      type="button"
                      aria-label={`删除会话 ${s.id}`}
                      title="删除会话"
                      onClick={() => onDelete(s.id)}
                      className="flex w-10 shrink-0 items-center justify-center border-l text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </aside>
  );
}
