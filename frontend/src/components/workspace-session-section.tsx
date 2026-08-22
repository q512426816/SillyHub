"use client";

/**
 * task-08（D-002@v1 / FR-03）：工作区「会话」页的两栏通用组件。
 *
 * 从 ChangeSessionSection（components/changes/change-session-section.tsx）抽出的
 * workspace 级通用版：props 只含 workspaceId，去 changeId 依赖——会话不绑定具体变更，
 * 而是工作区级（与变更中心平级）。左侧复用 SessionListLayout 公共组件（含已结束会话，
 * listWorkspaceAgentSessions include_ended=true），右侧复用 InteractiveSessionPanel
 * （建会话传 workspace_id，不传 change_id）。
 *   - 选中历史会话 → attachSessionId + initialTurns（logsToTurns）→ attach 恢复
 *   - ended/failed 会话：先 reopenSession 转 reconnecting/active 再 attach
 *     （F-1/C-3：panel 轮询仅识别 active/failed，ended 直接 attach 会卡超时）
 *   - 未选（新建）→ idle 新建空白，createSession 带 workspace_id（无 change_id）
 *
 * providers/model 来源 = listDaemonRuntimes（与 RuntimeSessionDialog 同源）。
 */

import { useCallback, useEffect, useMemo, useState } from "react";

import { useSearchParams } from "next/navigation";
import { SessionPanel } from "@/components/daemon/session-panel";
import type { SessionTurnView } from "@/components/daemon/turn-timeline";
import {
  SessionListLayout,
  type SessionListEntry,
} from "@/components/daemon/session-list-layout";
import { logsToTurns } from "@/components/daemon/runtime-session-helpers";
import { SectionCard } from "@/components/layout";
import { type AgentRunLogEntry } from "@/lib/agent";
import { ApiError } from "@/lib/api";
import { useSession } from "@/stores/session";
import {
  getAgentSessionLogs,
  listDaemonRuntimes,
  listWorkspaceAgentSessions,
  reopenSession,
  PROVIDER_META,
  type AgentSessionListItem,
  type DaemonRuntimeRead,
  type InteractiveProvider,
} from "@/lib/daemon";

export interface WorkspaceSessionSectionProps {
  workspaceId: string;
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

export function WorkspaceSessionSection({ workspaceId }: WorkspaceSessionSectionProps) {
  const currentUserId = useSession((s) => s.user?.id ?? null);
  const searchParams = useSearchParams();
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
      // workspace 级列表（含已结束，task-06 include_ended 配套）
      const list = await listWorkspaceAgentSessions(workspaceId, { include_ended: true });
      setSessions(list);
    } catch (err) {
      setListError(err instanceof ApiError ? err.message : "加载会话失败");
      setSessions([]);
    } finally {
      setLoading(false);
    }
  }, [workspaceId]);

  useEffect(() => {
    void reloadSessions();
  }, [reloadSessions]);

  // 深链 attach：URL ?session= 参数到达时直接加载（不依赖列表异步加载）
  useEffect(() => {
    const deepSessionId = searchParams.get("session");
    if (!deepSessionId) return;
    let cancelled = false;
    void (async () => {
      try {
        const fetched = await getAgentSessionLogs(deepSessionId);
        if (!cancelled) {
          setTurns(logsToTurns(fetched));
          setActiveSessionId(deepSessionId);
        }
      } catch {
        // 深链 session 不存在或无权访问：静默忽略，用户留在新建模式
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [searchParams]);

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
  // 仅展示本人会话：列表跨成员可见（D-005@v1），但 logs/dialogs/stream 端点
  // owner-only（跨用户 404），attach 他人会话必然全 404，展示只会误导点击。
  const orderedSessions = useMemo(() => {
    return sessions
      .filter((s) => s.author?.user_id == null || s.author.user_id === currentUserId)
      .sort((a, b) => {
        const ta = a.last_active_at ?? "";
        const tb = b.last_active_at ?? "";
        return tb.localeCompare(ta);
      });
  }, [sessions, currentUserId]);

  const entries: SessionListEntry[] = useMemo(
    () =>
      orderedSessions.map((s) => ({
        id: s.id,
        title: s.title,
        statusBadge: s.status,
        kind: s.mode === "scan" ? "scan" : undefined,
        secondaryText: `${s.author?.display_name ?? "未知成员"} · ${getProviderLabel(s.provider)}`,
        lastActiveAt: s.last_active_at,
      })),
    [orderedSessions],
  );

  return (
    <div className="grid gap-3 md:grid-cols-[230px_minmax(0,1fr)]">
      {/* 左：workspace 级历史列表（SessionListLayout 公共组件，不传 onDelete） */}
      <SessionListLayout
        items={entries}
        loading={loading}
        error={listError}
        selectedId={activeSessionId}
        onSelect={handleSelectById}
        onNewSession={handleNewSession}
        onRetry={() => void reloadSessions()}
      />

      {/* 右：会话面板（复用 InteractiveSessionPanel，attach 恢复历史 / 新建只带 workspace_id）。
          task-05 容器统一：自写 rounded-md border div 换 SectionCard（基类
          bg-card border rounded-lg shadow-sm）。flex 高度链：SectionCard 无 header 时
          内层 body div（bodyPadding=p-0）是唯一包裹层，外层 flex/min-h/overflow 经
          [&>div] 透传到 body（kanban 页 [&_.ant-*] 同款先例），保证 Panel h-full 撑满不断链。 */}
      <SectionCard
        bodyPadding="p-0"
        className="flex min-h-[420px] flex-col overflow-hidden [&>div]:flex [&>div]:min-h-0 [&>div]:flex-1 [&>div]:flex-col"
      >
        {/* key 强制 activeSessionId 切换时重 mount（清旧 SSE/轮询）。
            Panel 自管 SSE/inject/interrupt/end，组件不重造。 */}
        <SessionPanel
          key={activeSessionId ?? "new"}
          mode="dialog"
          sessionId={activeSessionId ?? null}
          providers={providers}
          defaultProvider={defaultProvider}
          model={model}
          onModelChange={setModel}
          hasOnlineProvider={hasOnlineProvider}
          workspaceId={workspaceId}
          initialTurns={activeSessionId ? turns : undefined}
          onSessionCreated={handleSessionCreated}
          onSessionReset={handleSessionReset}
        />
      </SectionCard>
    </div>
  );
}
