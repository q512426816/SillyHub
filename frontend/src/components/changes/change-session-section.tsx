"use client";

/**
 * task-13（FR-05 / D-005@v1）+ 2026-07-11-unify-runtime-session-dialog 对齐：
 *
 * 变更详情页内嵌「会话」区块。左侧复用 SessionListLayout 公共组件（与 runtimes
 * 弹窗一致样式），右侧复用 InteractiveSessionPanel。
 *   - 选中历史会话 → attachSessionId + initialTurns（logsToTurns）→ attach 恢复
 *   - ended/failed 会话：先 reopenSession 转 reconnecting/active 再 attach
 *     （F-1/C-3：panel 轮询仅识别 active/failed，ended 直接 attach 会卡超时）
 *   - 未选（新建）→ idle 新建空白，createSession 带 change_id/workspace_id
 *
 * providers/model 来源 = listDaemonRuntimes（与 RuntimeSessionDialog 同源）。
 */

import { useCallback, useEffect, useMemo, useState } from "react";

import {
  InteractiveSessionPanel,
  type SessionTurnView,
} from "@/components/daemon/interactive-session-panel";
import {
  SessionListLayout,
  type SessionListEntry,
} from "@/components/daemon/session-list-layout";
import { logsToTurns } from "@/components/daemon/runtime-session-helpers";
import { type AgentRunLogEntry } from "@/lib/agent";
import { ApiError } from "@/lib/api";
import {
  getAgentSessionLogs,
  listChangeSessions,
  listDaemonRuntimes,
  reopenSession,
  PROVIDER_META,
  type AgentSessionListItem,
  type DaemonRuntimeRead,
  type InteractiveProvider,
} from "@/lib/daemon";

export interface ChangeSessionSectionProps {
  workspaceId: string;
  changeId: string;
}

function getProviderLabel(provider: string | null | undefined): string {
  if (!provider) return "未知";
  return PROVIDER_META[provider]?.label ?? provider;
}

/** interactive 支持的 provider（与 runtime-session-helpers 内联逻辑一致）。 */
const SUPPORTED_SESSION_PROVIDERS = ["claude", "codex"];

/** 把 AgentSessionListItem 的 status（string）宽松判定为活跃态。 */
function isActiveListItem(s: AgentSessionListItem): boolean {
  return s.status === "pending" || s.status === "active" || s.status === "reconnecting";
}

export function ChangeSessionSection({ workspaceId, changeId }: ChangeSessionSectionProps) {
  // 选中的历史会话 id；null = 新建模式（Panel 走 idle 新建空白）
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [sessions, setSessions] = useState<AgentSessionListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);
  // 选中会话的历史日志（attach 预填 initialTurns 用）
  const [turns, setTurns] = useState<SessionTurnView[]>([]);
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

  // idle 时清空 turns（attach 时 logs 由 handleSelect 提前拉好 setTurns）
  useEffect(() => {
    if (!activeSessionId) setTurns([]);
  }, [activeSessionId]);

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

  // handleSelect：active 直接 attach；ended/failed 先 reopen 再 attach（F-1/C-3）。
  // 先拉 logs 再 setActiveSessionId：panel key 随 activeSessionId 重 mount，mount 时
  // initialTurns 即读到完整历史，避免 mount 后 logs 才到的时序 BUG。
  const handleSelect = useCallback(
    async (session: AgentSessionListItem) => {
      const id = session.id;
      let fetched: AgentRunLogEntry[] = [];
      try {
        fetched = await getAgentSessionLogs(id);
      } catch {
        fetched = [];
      }
      setTurns(logsToTurns(fetched));
      if (isActiveListItem(session)) {
        setActiveSessionId(id);
        return;
      }
      // ended/failed → 先 reopenSession 转 reconnecting/active（panel 轮询仅识别 active/failed）
      try {
        await reopenSession(id);
      } catch {
        // reopen 失败仍 attach：panel 会转 failed + 中文 errorMsg（C-3 可接受）
      }
      setActiveSessionId(id);
    },
    [],
  );

  const handleSelectById = useCallback(
    (id: string) => {
      const s = sessions.find((x) => x.id === id);
      if (s) void handleSelect(s);
    },
    [sessions, handleSelect],
  );

  const handleNewSession = useCallback(() => {
    setActiveSessionId(null);
  }, []);

  // createSession 成功：仅刷新列表（不改 activeSessionId：panel 自管新建 session 的
  // view，避免 panel remount 清掉 currentRunId 致打断按钮失灵）。
  const handleSessionCreated = useCallback(() => {
    void reloadSessions();
  }, [reloadSessions]);

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

  const entries: SessionListEntry[] = useMemo(
    () =>
      orderedSessions.map((s) => ({
        id: s.id,
        title: s.title,
        statusBadge: s.status,
        secondaryText: `${s.author?.display_name ?? "未知成员"} · ${getProviderLabel(s.provider)}`,
        lastActiveAt: s.last_active_at,
      })),
    [orderedSessions],
  );

  return (
    <div className="grid gap-3 md:grid-cols-[230px_minmax(0,1fr)]">
      {/* 左：历史列表（SessionListLayout 公共组件，不传 onDelete） */}
      <SessionListLayout
        items={entries}
        loading={loading}
        error={listError}
        selectedId={activeSessionId}
        onSelect={handleSelectById}
        onNewSession={handleNewSession}
        onRetry={() => void reloadSessions()}
      />

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
