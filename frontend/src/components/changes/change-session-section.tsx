"use client";

/**
 * task-13（FR-05 / D-005@v1）：变更详情页内嵌的「会话」区块。
 *
 * 左：listChangeSessions(workspaceId, changeId) 该变更的会话历史列表（跨成员
 *     可见，显示作者 display_name / D-005）；点击切换；「新建会话」清空选择。
 * 右：复用 InteractiveSessionPanel（单一 SSE / attach 恢复 / inject / interrupt /
 *     end 全套已实现，不重造）。
 *     - 选中历史会话 → attachSessionId + initialTurns（logsToTurns(getAgentSessionLogs)）
 *       → Panel 走 attach 恢复路径（建 SSE + 轮询到 active + 可续聊）
 *     - 未选（新建）→ idle 新建空白面板，createSession 带 change_id/workspace_id
 *       （onSessionCreated 回调把新建 id 写入 activeSessionId + 刷新列表）
 *
 * providers/model 来源 = listDaemonRuntimes（与 RuntimeSessionDialog 同源，避免
 * 引入第二套 hook）。当前用户无在线 daemon 时 Panel 既有「没有在线守护进程」
 * 占位生效，不新增错误态（task-13 约束）。
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Plus, RefreshCw } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  InteractiveSessionPanel,
  type SessionTurnView,
} from "@/components/daemon/interactive-session-panel";
import { logsToTurns } from "@/components/daemon/runtime-session-helpers";
import { type AgentRunLogEntry } from "@/lib/agent";
import { ApiError } from "@/lib/api";
import {
  getAgentSessionLogs,
  listChangeSessions,
  listDaemonRuntimes,
  type AgentSessionListItem,
  type DaemonRuntimeRead,
  type InteractiveProvider,
} from "@/lib/daemon";
import { cn } from "@/lib/utils";

export interface ChangeSessionSectionProps {
  workspaceId: string;
  changeId: string;
}

function shortId(id: string): string {
  return id.length > 12 ? `${id.slice(0, 8)}...${id.slice(-4)}` : id;
}

/** interactive 支持的 provider（与 runtime-session-helpers 内联逻辑一致）。 */
const SUPPORTED_SESSION_PROVIDERS = ["claude", "codex"];

/** 把 AgentSessionListItem 的 status（string）宽松判定为活跃态。 */
function isActiveListItem(s: AgentSessionListItem): boolean {
  return s.status === "pending" || s.status === "active" || s.status === "reconnecting";
}

/** ISO 字符串 → 本地简短时间（MM-DD HH:mm）。失败原样返回。 */
function formatTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  return `${mm}-${dd} ${hh}:${mi}`;
}

export function ChangeSessionSection({ workspaceId, changeId }: ChangeSessionSectionProps) {
  // 选中的历史会话 id；null = 新建模式（Panel 走 idle 新建空白）
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [sessions, setSessions] = useState<AgentSessionListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);
  // 选中会话的历史日志（attach 预填 initialTurns 用）
  const [turns, setTurns] = useState<SessionTurnView[]>([]);
  const [turnsLoading, setTurnsLoading] = useState(false);
  // providers/model 来源：daemon runtimes（与 RuntimeSessionDialog 同源）
  const [runtimes, setRuntimes] = useState<DaemonRuntimeRead[]>([]);
  const [model, setModel] = useState<string | null>(null);

  const reloadSessions = useCallback(async () => {
    setLoading(true);
    setListError(null);
    try {
      const list = await listChangeSessions(workspaceId, changeId);
      setSessions(list);
    } catch (err) {
      setListError(err instanceof ApiError ? err.message : "加载会话失败");
      setSessions([]);
    } finally {
      setLoading(false);
    }
  }, [workspaceId, changeId]);

  // 挂载即拉历史 + runtimes（一次）
  useEffect(() => {
    void reloadSessions();
  }, [reloadSessions]);

  useEffect(() => {
    let cancelled = false;
    void listDaemonRuntimes()
      .then((list) => {
        if (!cancelled) setRuntimes(list);
      })
      .catch(() => {
        // runtimes 拉取失败不阻断：Panel 有「没有在线守护进程」占位
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // 选中历史会话：拉 logs → initialTurns（attach 预填）
  useEffect(() => {
    if (!activeSessionId) {
      setTurns([]);
      return;
    }
    let cancelled = false;
    setTurnsLoading(true);
    void getAgentSessionLogs(activeSessionId)
      .then((logs: AgentRunLogEntry[]) => {
        if (cancelled) return;
        setTurns(logsToTurns(logs));
      })
      .catch(() => {
        if (!cancelled) setTurns([]);
        // 预填失败不阻断 attach（Panel 会自行轮询）
      })
      .finally(() => {
        if (!cancelled) setTurnsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [activeSessionId]);

  // onlineProviders / defaultProvider / hasOnlineProvider（与 runtime-session-helpers
  // InteractiveSessionChatSection 同源逻辑，内联以保持 change-session-section 自洽）
  const onlineProviders = useMemo(() => {
    const list = runtimes
      .filter(
        (r) =>
          r.status === "online" &&
          r.provider &&
          SUPPORTED_SESSION_PROVIDERS.includes(r.provider),
      )
      .map((r) => r.provider!);
    return [...new Set(list)];
  }, [runtimes]);
  const hasOnlineProvider = onlineProviders.length > 0;
  const defaultProvider: InteractiveProvider = onlineProviders.includes("claude")
    ? "claude"
    : (onlineProviders[0] as InteractiveProvider | undefined) ?? "claude";
  const providers = hasOnlineProvider ? onlineProviders : [defaultProvider];

  const handleSelect = useCallback((session: AgentSessionListItem) => {
    setActiveSessionId(session.id);
  }, []);

  const handleNewSession = useCallback(() => {
    setActiveSessionId(null);
  }, []);

  // createSession 成功：上报 session_id → 写入 activeSessionId（后续注入走同 session）+ 刷新列表
  const handleSessionCreated = useCallback((sessionId: string) => {
    setActiveSessionId(sessionId);
    void reloadSessions();
  }, [reloadSessions]);

  // Panel 重置回 idle（用户点 Panel 内「新建会话」）→ 清空 activeSessionId
  const handleSessionReset = useCallback(() => {
    setActiveSessionId(null);
  }, []);

  // visibleSessions: 按 last_active_at 倒序（后端不保证顺序，design 自审 C-5）
  const orderedSessions = useMemo(() => {
    return [...sessions].sort((a, b) => {
      const ta = a.last_active_at ?? "";
      const tb = b.last_active_at ?? "";
      return tb.localeCompare(ta);
    });
  }, [sessions]);

  return (
    <div className="grid gap-3 md:grid-cols-[230px_minmax(0,1fr)]">
      {/* 左：历史列表 */}
      <aside className="flex min-h-[420px] flex-col overflow-hidden rounded-md border bg-slate-50">
        <div className="flex shrink-0 items-center justify-between border-b bg-card px-3 py-2">
          <span className="text-xs font-medium text-foreground">会话历史</span>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void reloadSessions()}
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
            onClick={handleNewSession}
            className={cn(
              "h-8 w-full justify-center gap-1 border-dashed text-xs",
              activeSessionId === null && "border-blue-600 text-blue-700",
            )}
            title="新建会话"
          >
            <Plus className="h-3.5 w-3.5" />
            新建会话
          </Button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {listError ? (
            <div className="space-y-2 px-3 py-3">
              <p className="text-[11px] text-destructive">{listError}</p>
              <Button size="sm" variant="outline" onClick={() => void reloadSessions()} className="h-7 text-[11px]">
                重试
              </Button>
            </div>
          ) : orderedSessions.length === 0 ? (
            <p className="px-3 py-6 text-center text-[11px] text-muted-foreground">
              {loading ? "加载中…" : "暂无会话，新建一个开始提问"}
            </p>
          ) : (
            <ul className="mt-1 divide-y">
              {orderedSessions.map((s) => {
                const active = isActiveListItem(s);
                const selected = activeSessionId === s.id;
                return (
                  <li key={s.id}>
                    <button
                      type="button"
                      onClick={() => handleSelect(s)}
                      className={cn(
                        "flex w-full min-w-0 flex-col items-start gap-1 border-l-[3px] border-transparent px-3 py-2.5 text-left hover:bg-blue-50/60",
                        selected && "border-blue-600 bg-blue-50",
                      )}
                    >
                      <span className="flex w-full items-center justify-between gap-2">
                        <span className="truncate text-xs font-medium text-foreground">
                          {s.title?.trim() || shortId(s.id)}
                        </span>
                        <Badge variant={active ? "success" : "outline"} className="shrink-0 text-[10px]">
                          {s.status}
                        </Badge>
                      </span>
                      <span className="flex w-full items-center justify-between gap-2 text-[11px] text-muted-foreground">
                        <span className="truncate">
                          {s.author?.display_name ?? "未知成员"}
                        </span>
                        <span className="shrink-0">{s.turn_count} 轮</span>
                      </span>
                      {s.last_active_at && (
                        <span className="text-[10px] text-muted-foreground/80">
                          {formatTime(s.last_active_at)}
                        </span>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
        {turnsLoading && activeSessionId && (
          <div className="shrink-0 border-t bg-card px-3 py-1.5 text-center text-[10px] text-muted-foreground">
            正在加载历史轮次…
          </div>
        )}
      </aside>

      {/* 右：会话面板（复用 InteractiveSessionPanel，attach 恢复历史 / 新建带 change_id） */}
      <div className="flex min-h-[420px] flex-col overflow-hidden rounded-md border bg-card">
        {/* key 强制 activeSessionId 切换时重 mount（清旧 SSE/轮询）。
            Panel 自管 SSE/inject/interrupt/end，组件不重造。 */}
        <InteractiveSessionPanel
          key={activeSessionId ?? "new"}
          providers={providers}
          defaultProvider={defaultProvider}
          model={model}
          onModelChange={setModel}
          hasOnlineProvider={hasOnlineProvider}
          changeId={changeId}
          workspaceId={workspaceId}
          attachSessionId={activeSessionId ?? undefined}
          initialTurns={activeSessionId ? turns : undefined}
          onSessionCreated={handleSessionCreated}
          onSessionReset={handleSessionReset}
        />
      </div>
    </div>
  );
}
