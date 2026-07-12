"use client";

/**
 * 2026-07-11-unify-runtime-session-dialog 重构（FR-02 / D-001 / D-002 / D-005）：
 *
 * 样式与交互对齐 ChangeSessionSection：
 *   - 左侧：SessionListLayout 公共组件（带删除按钮，字段=title/status/提供方·轮数/时间）
 *   - 右侧：去掉「返回历史」栏，直接挂 InteractiveSessionPanel
 *   - 二态化：selected（任意状态）→ attach 续聊；idle → 新建态
 *   - 删除 SessionHistoryView 只读回看分支
 *   - ended/failed 会话点开：先 reopenSession 转 reconnecting/active 再 attach
 *     （F-1/C-3：panel attach 轮询仅识别 active/failed，ended 直接 attach 会卡超时）
 *
 * 单例由 page.tsx 的单一 dialogRuntime state 驱动（key 重 mount 重置内部状态）。
 * URL ?session= 恢复点（initialSessionId）由 page.tsx 传入，首次加载优先 attach。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  InteractiveSessionPanel,
} from "@/components/daemon/interactive-session-panel";
import { isActiveSession, logsToTurns } from "@/components/daemon/runtime-session-helpers";
import {
  SessionListLayout,
  type SessionListEntry,
} from "@/components/daemon/session-list-layout";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog";
import { ApiError } from "@/lib/api";
import { type AgentRunLogEntry } from "@/lib/agent";
import {
  PROVIDER_META,
  deleteAgentSession,
  getAgentSessionLogs,
  listAgentSessions,
  reopenSession,
  type AgentSessionRead,
  type DaemonRuntimeRead,
  type InteractiveProvider,
} from "@/lib/daemon";

function getProviderLabel(provider: string | null | undefined): string {
  if (!provider) return "未知";
  return PROVIDER_META[provider]?.label ?? provider;
}

const SUPPORTED_SESSION_PROVIDERS = ["claude", "codex"];

export interface RuntimeSessionDialogProps {
  /** null = 关闭（Dialog open 由外层控制，runtime 仅用于渲染内容/key）。 */
  runtime: DaemonRuntimeRead | null;
  open: boolean;
  onClose: () => void;
  /** 全部 runtime，供会话区 InteractiveSessionPanel 选 provider。 */
  runtimes: DaemonRuntimeRead[];
  /** URL ?session= 恢复点：首次加载优先 attach 该活跃会话。 */
  initialSessionId?: string;
}

export function RuntimeSessionDialog({
  runtime,
  open,
  onClose,
  runtimes,
  initialSessionId,
}: RuntimeSessionDialogProps) {
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="flex h-[min(82vh,760px)] max-h-[calc(100vh-48px)] w-[min(1120px,calc(100vw-48px))] max-w-none flex-col gap-0 overflow-hidden p-0">
        {/* Radix 无障碍：DialogContent 缺 Title 会 console warn，sr-only 兜底 */}
        <DialogTitle className="sr-only">
          会话{runtime ? ` · ${runtime.name ?? getProviderLabel(runtime.provider)}` : ""}
        </DialogTitle>
        <RuntimeSessionDialogBody
          runtime={runtime}
          open={open}
          runtimes={runtimes}
          initialSessionId={initialSessionId}
        />
      </DialogContent>
    </Dialog>
  );
}

/**
 * 弹窗主体。独立拆出便于外层 key 重 mount 时整体重建。
 * 二态：selected（任意状态 attach 续聊）/ idle（新建空白）。
 */
function RuntimeSessionDialogBody({
  runtime,
  open,
  runtimes,
  initialSessionId,
}: Omit<RuntimeSessionDialogProps, "onClose">) {
  const [sessions, setSessions] = useState<AgentSessionRead[]>([]);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);
  // 选中的会话 id（任意状态都走 attach 续聊）；null = idle 新建
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [logs, setLogs] = useState<AgentRunLogEntry[]>([]);
  const [model, setModel] = useState<string | null>(null);
  const runtimeId = runtime?.id;

  // initialSessionId 恢复点去重（按 runtime.id）
  const restoredRef = useRef<string | null>(null);

  const visibleSessions = useMemo(
    () => (runtimeId ? sessions.filter((s) => s.runtime_id === runtimeId) : sessions),
    [sessions, runtimeId],
  );

  const entries: SessionListEntry[] = useMemo(
    () =>
      visibleSessions.map((s) => ({
        id: s.id,
        title: s.title,
        statusBadge: s.status,
        secondaryText: `${getProviderLabel(s.provider)} · ${s.turn_count} 轮`,
        lastActiveAt: s.last_active_at,
      })),
    [visibleSessions],
  );

  // providers（与 ChangeSessionSection / InteractiveSessionChatSection 同源逻辑）
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
  const focusProvider = runtime?.provider;
  const defaultProvider: InteractiveProvider =
    focusProvider === "claude" || focusProvider === "codex"
      ? focusProvider
      : onlineProviders.includes("claude")
        ? "claude"
        : (onlineProviders[0] as InteractiveProvider | undefined) ?? "claude";
  const providers = hasOnlineProvider ? onlineProviders : [defaultProvider];

  const reloadSessions = useCallback(async () => {
    setLoading(true);
    setListError(null);
    try {
      const resp = await listAgentSessions({ limit: 50 });
      setSessions(resp.items);
    } catch (err) {
      setListError(err instanceof ApiError ? err.message : "加载会话失败");
      setSessions([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open || !runtimeId) return;
    void reloadSessions();
  }, [open, runtimeId, reloadSessions]);

  // runtime 切换重置全部状态（外层 key 重 mount 已清，此为防御）
  useEffect(() => {
    restoredRef.current = null;
    setSessions([]);
    setSelectedId(null);
    setLogs([]);
    setListError(null);
  }, [runtimeId]);

  // handleSelect：active 直接 attach；ended/failed 先 reopen 再 attach（F-1/C-3）。
  // 先拉 logs 再 setSelectedId：panel key 随 selectedId 重 mount，mount 时
  // initialTurns=logsToTurns(logs) 即读到完整历史，避免 mount 后 logs 才到的时序 BUG。
  const handleSelect = useCallback(
    async (session: AgentSessionRead) => {
      const id = session.id;
      let fetched: AgentRunLogEntry[] = [];
      try {
        fetched = await getAgentSessionLogs(id);
      } catch {
        fetched = [];
      }
      setLogs(fetched);
      if (isActiveSession(session)) {
        setSelectedId(id);
        return;
      }
      // ended/failed：尝试 reopen 续聊（仅当有 agent_session_id 才可能成功）；
      // 失败（如无 SDK session id 的老会话）静默降级 attach 只读历史——panel
      // 轮询遇 ended/failed 转 ended/failed 态显示 initialTurns，不卡轮询。
      setListError(null);
      try {
        await reopenSession(id);
      } catch {
        // 静默：reopen 不可行时仍 attach 显示历史（panel ended 态只读）
      }
      setSelectedId(id);
    },
    [],
  );

  // initialSessionId 恢复点（URL ?session=）：首次加载若该活跃会话属于本 runtime → attach
  useEffect(() => {
    if (!open || loading || !runtimeId) return;
    if (restoredRef.current === runtimeId) return;
    restoredRef.current = runtimeId;
    const restored = initialSessionId
      ? visibleSessions.find((s) => s.id === initialSessionId && isActiveSession(s))
      : undefined;
    if (restored) {
      void handleSelect(restored);
    }
  }, [open, loading, runtimeId, visibleSessions, initialSessionId, handleSelect]);

  // idle 时清空历史 logs（attach 时 logs 由 handleSelect 提前拉好 setLogs，
  // panel mount 即读到 initialTurns，避免 mount 后 logs 才到的时序 BUG）
  useEffect(() => {
    if (!selectedId) setLogs([]);
  }, [selectedId]);

  const handleSelectById = useCallback(
    (id: string) => {
      const s = sessions.find((x) => x.id === id);
      if (s) void handleSelect(s);
    },
    [sessions, handleSelect],
  );

  const handleNewSession = useCallback(() => {
    setSelectedId(null);
  }, []);

  // panel 新建成功 → 仅刷新列表（不改 selectedId：panel 自管新建 session 的 view，
  // 避免 panel remount 清掉 createSession 设置的 currentRunId 致打断按钮失灵）。
  const handleSessionCreated = useCallback(() => {
    void reloadSessions();
  }, [reloadSessions]);
  const handleSessionReset = useCallback(() => {
    setSelectedId(null);
  }, []);

  const handleDelete = useCallback(
    async (id: string) => {
      const confirmed = window.confirm("确定删除该会话？运行记录和日志仍会保留。");
      if (!confirmed) return;
      setListError(null);
      try {
        await deleteAgentSession(id);
        setSessions((cur) => cur.filter((x) => x.id !== id));
        if (selectedId === id) setSelectedId(null);
      } catch (err) {
        setListError(err instanceof ApiError ? err.message : "删除会话失败");
      }
    },
    [selectedId],
  );

  return (
    <>
      <header className="flex shrink-0 items-start justify-between gap-4 border-b border-slate-200 bg-card px-5 py-4">
        <div className="min-w-0">
          <h2 className="truncate text-base font-semibold text-foreground">
            会话 · {runtime?.name ?? getProviderLabel(runtime?.provider)}
          </h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            历史仅显示该运行时的会话，新建会话使用此提供方
          </p>
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={() => void reloadSessions()}
          disabled={loading}
          className="h-8 shrink-0 text-xs"
        >
          刷新会话
        </Button>
      </header>
      <div className="grid min-h-0 flex-1 grid-cols-[280px_minmax(0,1fr)] gap-3 bg-background p-3">
        <SessionListLayout
          items={entries}
          loading={loading}
          error={listError}
          selectedId={selectedId}
          onSelect={handleSelectById}
          onNewSession={handleNewSession}
          onRetry={() => void reloadSessions()}
          onDelete={handleDelete}
        />
        <div className="flex min-h-[420px] flex-col overflow-hidden rounded-md border bg-card">
          {/* key 随 selectedId 切换重 mount（清旧 SSE/轮询）；idle 用 runtime.id 锁 focusProvider */}
          <InteractiveSessionPanel
            key={selectedId ?? `new-${runtimeId ?? "closed"}`}
            providers={providers}
            defaultProvider={defaultProvider}
            model={model}
            onModelChange={setModel}
            hasOnlineProvider={hasOnlineProvider}
            attachSessionId={selectedId ?? undefined}
            initialTurns={selectedId ? logsToTurns(logs) : undefined}
            onSessionCreated={handleSessionCreated}
            onSessionReset={handleSessionReset}
          />
        </div>
      </div>
    </>
  );
}
