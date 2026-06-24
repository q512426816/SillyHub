"use client";

/**
 * task-02（FR-01 / FR-03 / D-001@v1 / D-002@v1）：runtime 专属会话工作台弹窗。
 *
 * 单例由 page.tsx 的单一 dialogRuntime state 驱动：外层通过
 * `<RuntimeSessionDialog key={dialogRuntime?.id} ... />` 强制重 mount 重置
 * 内部状态（D-001 / R-04）。本组件接收 runtime（null=关闭），自管
 * sessions/selected/logs/attachSession/loading/error/deletingSessionId，
 * 内部三态渲染：attach 续聊 / 只读历史回看 / idle 新建空白面板。
 *
 * 默认态 D-002：open 后若有活跃会话（active/pending/reconnecting）→ attach
 * 最近活跃；无 → idle 新建空白面板（focusProvider 锁定本 runtime 的 provider）。
 *
 * active attach 续聊（FR-02 / D-004）：handleSelect 命中 active 会话时拉 logs
 * → logsToTurns 预填 → setAttachSession，右侧切 InteractiveSessionChatSection
 * attach 模式（建 SSE + 预填 + 轮询到 active + 可发送续聊）。
 *
 * 关闭清理（R-02 雏形）：Dialog unmount → InteractiveSessionChatSection unmount
 * → InteractiveSessionPanel 自身 cleanup effect 负责 closeStream + clearInterval，
 * 本组件无需额外处理；onClose 时显式 setAttachSession(null) 加固。
 *
 * URL 职责（D-003）不在此组件：不 import useRouter/useSearchParams，不写/清
 * ?session=（task-04 决定 onClose 时序）。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  InteractiveSessionChatSection,
  SessionHistoryView,
  SessionsSidebar,
  isActiveSession,
  logsToTurns,
  shortId,
} from "@/components/daemon/runtime-session-helpers";
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
} from "@/lib/daemon";

/**
 * 运行时 provider → 展示名。与 page.tsx 的 getProviderLabel 同语义（两行实现），
 * 此处本地内联避免依赖 task-01 是否下沉 getProviderLabel（task-01/task-02 规范
 * 在 getProviderLabel 归属上措辞不一，PROVIDER_META 为唯一真源，直接消费）。
 */
function getProviderLabel(provider: string | null | undefined): string {
  if (!provider) return "未知";
  return PROVIDER_META[provider]?.label ?? provider;
}

export interface RuntimeSessionDialogProps {
  /** null = 关闭（Dialog open 由外层控制，runtime 仅用于渲染内容/key）。 */
  runtime: DaemonRuntimeRead | null;
  open: boolean;
  onClose: () => void;
  /** 全部 runtime，供会话区 InteractiveSessionChatSection 选 provider。 */
  runtimes: DaemonRuntimeRead[];
  /**
   * task-04 / D-003：URL ?session= 恢复点。外层（page.tsx）从 URL 读到活跃会话 id 时
   * 传入，弹窗 open 后优先 attach 该会话（而非默认的「最近活跃」）。仅在该 runtime
   * 首次加载完成时生效一次，后续 reload 不再用此值（defaultAttachedRef 防重复）。
   * undefined / 非该 runtime 的会话 / 已结束 → 回退默认态。
   */
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
          onClose={onClose}
          runtimes={runtimes}
          initialSessionId={initialSessionId}
        />
      </DialogContent>
    </Dialog>
  );
}

/**
 * 弹窗主体。独立拆出便于外层 key 重 mount 时整体重建（D-001 / R-04）。
 * 即便外层忘记加 key，内部 [runtime?.id] effect 也会兜底重置全部状态。
 */
function RuntimeSessionDialogBody({
  runtime,
  open,
  runtimes,
  initialSessionId,
}: RuntimeSessionDialogProps) {
  const [sessions, setSessions] = useState<AgentSessionRead[]>([]);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);
  const [selected, setSelected] = useState<AgentSessionRead | null>(null);
  const [logs, setLogs] = useState<AgentRunLogEntry[]>([]);
  const [logsLoading, setLogsLoading] = useState(false);
  const [logsError, setLogsError] = useState<string | null>(null);
  const [deletingSessionId, setDeletingSessionId] = useState<string | null>(null);
  // attach 续聊面板（D-002 默认 attach / active attach 续聊 / reopen 续聊）
  const [attachSession, setAttachSession] = useState<AgentSessionRead | null>(null);
  const runtimeId = runtime?.id;

  // D-002：默认 attach 只在「该 runtime 首次加载完成」触发一次，防 sessions 重载重复触发
  const defaultAttachedRef = useRef<string | null>(null);

  // 仅显示当前 runtime 的历史会话（ql-012 聚焦过滤）
  const visibleSessions = useMemo(
    () => (runtimeId ? sessions.filter((s) => s.runtime_id === runtimeId) : sessions),
    [sessions, runtimeId],
  );

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

  // open 且 runtime 有效时加载会话列表（task-08：codex runtime 也加载历史，撤销 quick-chat 分流）
  useEffect(() => {
    if (!open || !runtimeId) return;
    void reloadSessions();
  }, [open, runtimeId, reloadSessions]);

  // D-001 单例切换兜底：runtime 变化时重置全部状态（外层 key 重 mount 已清，此为防御）
  useEffect(() => {
    defaultAttachedRef.current = null;
    setSessions([]);
    setSelected(null);
    setLogs([]);
    setAttachSession(null);
    setListError(null);
    setLogsError(null);
  }, [runtimeId]);

  // D-002 默认态：sessions 加载完成后，若有活跃会话 → attach 最近活跃；无 → idle。
  // task-04 / D-003：若外层传入 initialSessionId 且其属于本 runtime 的活跃会话 → 优先
  // attach 它（URL ?session= 恢复点）；否则回退「最近活跃」。仅在该 runtime 首次加载
  // 完成时触发一次（defaultAttachedRef 按 runtime.id 去重）。
  useEffect(() => {
    if (!open || loading || !runtimeId) return;
    if (defaultAttachedRef.current === runtimeId) return;
    defaultAttachedRef.current = runtimeId;
    // 优先：URL 恢复点 initialSessionId（需活跃 + 属于本 runtime）
    const restored =
      initialSessionId
        ? visibleSessions.find((s) => s.id === initialSessionId && isActiveSession(s))
        : undefined;
    // 「最近活跃」兜底：后端 listAgentSessions 排序不保证，按 last_active_at/created_at
    // 倒序后取第一个活跃（design.md §12 自审 C-5）。字段缺失时回退原顺序。
    const ordered = [...visibleSessions].sort((a, b) => {
      const ta = a.last_active_at ?? a.created_at ?? "";
      const tb = b.last_active_at ?? b.created_at ?? "";
      return tb.localeCompare(ta);
    });
    const active = restored ?? ordered.find(isActiveSession);
    if (active) {
      // 预填历史 turn：拉 logs → logsToTurns，再切 attach（右侧建 SSE + 轮询到 active）
      void (async () => {
        try {
          const fetched = await getAgentSessionLogs(active.id);
          setLogs(fetched);
        } catch {
          // 预填失败不阻断 attach（panel 会自行拉取/轮询）
          setLogs([]);
        }
        setAttachSession(active);
      })();
    }
    // 无活跃 → 不 setAttachSession，右侧自然进入 idle 三态分支（新建空白面板）
  }, [open, loading, runtimeId, visibleSessions, initialSessionId]);

  const handleSelect = useCallback(async (session: AgentSessionRead) => {
    // FR-02 / D-004：active 会话点开走 attach 续聊（拉 logs → 预填 → setAttachSession）
    if (isActiveSession(session)) {
      setAttachSession(session);
      setSelected(null);
      setLogsLoading(true);
      setLogsError(null);
      try {
        const fetched = await getAgentSessionLogs(session.id);
        setLogs(fetched);
      } catch (err) {
        setLogsError(err instanceof ApiError ? err.message : "加载历史失败");
        setLogs([]);
      } finally {
        setLogsLoading(false);
      }
      return;
    }
    // ended/failed → 只读历史回看（SessionHistoryView 内部按 canResumeSession 决定续聊按钮）
    setSelected(session);
    setLogsLoading(true);
    setLogsError(null);
    try {
      const fetched = await getAgentSessionLogs(session.id);
      setLogs(fetched);
    } catch (err) {
      setLogsError(err instanceof ApiError ? err.message : "加载历史失败");
      setLogs([]);
    } finally {
      setLogsLoading(false);
    }
  }, []);

  const handleDelete = useCallback(async (session: AgentSessionRead) => {
    const confirmed = window.confirm(
      `确定删除会话 ${shortId(session.id)}？运行记录和日志仍会保留。`,
    );
    if (!confirmed) return;

    setDeletingSessionId(session.id);
    setListError(null);
    try {
      await deleteAgentSession(session.id);
      setSessions((current) => current.filter((item) => item.id !== session.id));
      if (selected?.id === session.id) {
        setSelected(null);
        setLogs([]);
        setLogsError(null);
      }
      if (attachSession?.id === session.id) {
        setAttachSession(null);
      }
    } catch (err) {
      setListError(err instanceof ApiError ? err.message : "删除会话失败");
    } finally {
      setDeletingSessionId(null);
    }
  }, [selected?.id, attachSession?.id]);

  // 续聊（reopen ended/failed claude/codex；canResumeSession 守 provider+threadId，D-007）
  // 不写 URL（task-04 职责）
  const handleContinue = useCallback(async (session: AgentSessionRead) => {
    setListError(null);
    try {
      await reopenSession(session.id);
      setAttachSession(session);
    } catch (err) {
      setListError(err instanceof ApiError ? err.message : "恢复会话失败");
    }
  }, []);

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
      <div className="grid min-h-0 flex-1 grid-cols-[280px_minmax(0,1fr)] grid-rows-[minmax(0,1fr)] bg-background">
        <SessionsSidebar
          sessions={visibleSessions}
          loading={loading}
          error={listError}
          selectedSessionId={selected?.id ?? null}
          deletingSessionId={deletingSessionId}
          onSelect={(s) => void handleSelect(s)}
          onDelete={(s) => void handleDelete(s)}
          onRetry={() => void reloadSessions()}
        />
        {attachSession ? (
          // attach 续聊：D-002 默认 attach / active attach / reopen；key 强制切换重 mount 清旧 SSE
          <InteractiveSessionChatSection
            key={attachSession.id}
            runtimes={runtimes}
            attachSession={attachSession}
            initialTurns={logsToTurns(logs)}
            onCloseAttach={() => setAttachSession(null)}
            focusProvider={runtime?.provider ?? undefined}
          />
        ) : selected ? (
          <SessionHistoryView
            session={selected}
            logs={logs}
            loading={logsLoading}
            error={logsError}
            onClose={() => setSelected(null)}
            onContinue={(s) => void handleContinue(s)}
          />
        ) : (
          // idle 新建：focusProvider 锁定本 runtime 的 provider；key 随 runtime 切换重 mount
          <InteractiveSessionChatSection
            key={runtime?.id ?? "closed"}
            runtimes={runtimes}
            focusProvider={runtime?.provider ?? undefined}
          />
        )}
      </div>
    </>
  );
}
