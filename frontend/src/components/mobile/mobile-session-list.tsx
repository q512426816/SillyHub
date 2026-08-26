"use client";

/**
 * MobileSessionList — 移动会话分组卡片列表（task-11 / FR-06 / Grill C-08 /
 * design §5.4 + §7，原型「工作区主页 · 会话 Tab」屏）。
 *
 * 数据契约（C-08 / X-04 锁 key，R-03 防 key 漂移）：
 * - useQuery key 逐字对齐桌面门户 session-list-panel.tsx:584 形态：
 *   ["agentSessions","sessionsPortal",scope,{limit,archived,assoc}]，其中
 *   scope = {kind:"workspace",workspaceId}（session-list-panel.tsx:110
 *   WorkspaceScope）、assoc 恒 null（移动端无关联筛选）——与桌面共享缓存，
 *   也落在 ["agentSessions"] 前缀下被门户/本组件 invalidate 全覆盖（D-103）。
 * - queryFn 调 listAgentSessions({limit, ...(archived?{archived:true}:{}),
 *   workspace_id})——不是 listWorkspaceAgentSessions（后者无 limit/archived
 *   参数、返回类型不同，C-08 裁决）；limit 必须 import
 *   AGENT_SESSIONS_TREE_FETCH_LIMIT（daemon.ts 导出），禁止写死。
 *
 * UI（对齐原型会话列表屏）：
 * - 状态 Tab：全部 / 进行中（客户端 status 过滤：非 ended/failed，口径对齐
 *   sessionListPollInterval 的「进行中」判定）/ 已归档（isArchivedView 切 key
 *   自动重拉服务端归档数据）。
 * - 机器分组：useDaemonMachines({limit:100})（与桌面树同源同参在线态）；
 *   runtime_id → 机器映射缺席时回退 config_snapshot.machine_name（按离线），
 *   再缺 → 「未知机器」；在线组在前、离线组在后（组内保持首次出现序）。
 * - 卡片：会话名（title ?? config_snapshot.agent_name）/ 引擎
 *   （config_snapshot.engine ?? provider）/ 状态中文 / 最后活动相对时间
 *   （formatRelativeTime 复用 runtime-card-helpers）。
 * - ⋯ 菜单经 MobileActionMenu（底部 ActionSheet）承载：归档/取消归档（按
 *   当前视图）+ 删除（danger + Modal.confirm 二次确认，对齐 ppm 移动页删除
 *   先例）；三个 mutation 调 deleteAgentSession/archiveAgentSession/
 *   unarchiveAgentSession，成功后 invalidate ["agentSessions"] 前缀（与门户
 *   同前缀全覆盖）。
 * - 点击卡片 onSelect(sessionId)（宿主 task-12 接路由跳转）；空态引导
 *   onNew（宿主接 PreSessionPicker bottomSheet，不在本组件）。
 *
 * 移动约束（design §5.5 / R-04）：触摸热区 ≥44px、正文 ≥14px、语义 token
 * （border/bg-card/text-foreground/primary 语义阶），无写死色值。
 */

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Modal } from "antd";
import { MoreVertical } from "lucide-react";

import { formatRelativeTime } from "@/components/daemon/runtime-card-helpers";
import { MobileActionMenu, type MobileAction } from "@/components/mobile/mobile-action-menu";
import { ApiError } from "@/lib/api";
import { useDaemonMachines } from "@/lib/use-daemon-machines";
import {
  AGENT_SESSIONS_TREE_FETCH_LIMIT,
  archiveAgentSession,
  deleteAgentSession,
  listAgentSessions,
  unarchiveAgentSession,
  type AgentSessionListResponse,
  type AgentSessionRead,
  type AgentSessionStatus,
  type DaemonMachineRead,
} from "@/lib/daemon";
import { cn } from "@/lib/utils";

/* ────────────── 纯辅助（组件外，便于单测推理；语义对齐 session-list-panel） ────────────── */

/** 会话状态英文 → 中文展示（CLAUDE.md 规则 12 中文 UI；口径对齐
 *  session-list-layout.tsx SESSION_STATUS_LABELS 只读展示先例）。 */
const SESSION_STATUS_LABELS: Record<AgentSessionStatus, string> = {
  pending: "启动中",
  active: "进行中",
  reconnecting: "重连中",
  ended: "已结束",
  failed: "失败",
};

function statusLabel(status: AgentSessionStatus): string {
  return SESSION_STATUS_LABELS[status] ?? status;
}

/**
 * 「进行中」判定（状态 Tab 客户端过滤口径）：非 ended/failed 即视为进行中
 * （聊天/排队/恢复中），逐字对齐 session-list-panel sessionListPollInterval
 * 的 hasOngoing 判定。
 */
function isOngoingSession(s: AgentSessionRead): boolean {
  return s.status !== "ended" && s.status !== "failed";
}

/** 机器显示名（与 session-list-panel machineLabel 同语义：别名优先）。 */
function machineLabel(m: DaemonMachineRead): string {
  return m.display_alias?.trim() || m.hostname;
}

/** runtime→机器映射值（机器分组 / 在线判定共用；对齐桌面 RuntimeMachineIndex）。 */
type RuntimeMachineIndex = Map<
  string,
  { machine: DaemonMachineRead; online: boolean }
>;

/** 条目所属机器引用（分桶键 + 显示名 + 在线态）。 */
interface SessionMachineRef {
  /** 分桶键：runtime 可解析时为 machine.id，快照回退 name: 前缀。 */
  key: string;
  label: string;
  online: boolean;
}

/**
 * 条目 → 机器引用：runtime_id 经映射取实时机器（在线状态只能来自实时机器
 * 列表）；映射缺席（机器列表分页外/已删）回退 config_snapshot.machine_name
 * （无在线信息，按离线渲染）；两者皆无 → 未知机器。
 * 语义对齐 session-list-panel sessionMachineRef。
 */
function sessionMachineRef(
  s: AgentSessionRead,
  runtimeToMachine: RuntimeMachineIndex,
): SessionMachineRef {
  if (s.runtime_id) {
    const hit = runtimeToMachine.get(s.runtime_id);
    if (hit) {
      return {
        key: hit.machine.id,
        label: machineLabel(hit.machine),
        online: hit.online,
      };
    }
  }
  const snapName = s.config_snapshot?.machine_name;
  if (snapName) return { key: `name:${snapName}`, label: snapName, online: false };
  return { key: "__unknown_machine__", label: "未知机器", online: false };
}

/** 机器分组（组内会话按 Tab 过滤后装入；组序 = 在线在前 + 首次出现序）。 */
interface MachineGroup {
  key: string;
  label: string;
  online: boolean;
  sessions: AgentSessionRead[];
}

/** 会话名：title 优先（首句摘要），回退 config_snapshot.agent_name。 */
function sessionDisplayName(s: AgentSessionRead): string {
  return s.title?.trim() || s.config_snapshot?.agent_name?.trim() || "未命名会话";
}

/** 引擎显示（config_snapshot.engine 优先，回退 provider；对齐桌面 engineValueOf）。 */
function engineLabel(s: AgentSessionRead): string {
  return s.config_snapshot?.engine ?? s.provider;
}

/* ────────────── 组件 ────────────── */

/** 状态 Tab key（已归档 = isArchivedView 服务端切换；其余客户端过滤）。 */
export type MobileSessionTabKey = "all" | "ongoing" | "archived";

export interface MobileSessionListProps {
  /** 工作区 id（scope + listAgentSessions workspace_id 过滤参）。 */
  workspaceId: string;
  /** 点击会话卡（宿主跳 /m/workspaces/[id]/sessions/[sid]）。 */
  onSelect: (sessionId: string) => void;
  /** 新建会话入口（宿主接 PreSessionPicker bottomSheet，task-12）。 */
  onNew: () => void;
}

/** 状态 Tab 配置（顺序即渲染顺序，对齐原型 .list-tabs）。 */
const SESSION_TABS: { key: MobileSessionTabKey; label: string }[] = [
  { key: "all", label: "全部" },
  { key: "ongoing", label: "进行中" },
  { key: "archived", label: "已归档" },
];

export function MobileSessionList({
  workspaceId,
  onSelect,
  onNew,
}: MobileSessionListProps) {
  const [tab, setTab] = useState<MobileSessionTabKey>("all");
  const [menuSession, setMenuSession] = useState<AgentSessionRead | null>(null);
  const isArchivedView = tab === "archived";
  const queryClient = useQueryClient();

  // X-04 / C-08：scope 槽位 + 参数对象槽位逐字对齐桌面（assoc 恒 null——移动
  // 端无关联筛选；key 变化（archived 翻转）即自动重拉，无需手动 refetch）。
  const scope = useMemo(
    () => ({ kind: "workspace" as const, workspaceId }),
    [workspaceId],
  );

  const sessionsQuery = useQuery<AgentSessionListResponse, ApiError>({
    queryKey: [
      "agentSessions",
      "sessionsPortal",
      scope,
      {
        limit: AGENT_SESSIONS_TREE_FETCH_LIMIT,
        archived: isArchivedView,
        assoc: null,
      },
    ],
    queryFn: () =>
      listAgentSessions({
        limit: AGENT_SESSIONS_TREE_FETCH_LIMIT,
        ...(isArchivedView ? { archived: true } : {}),
        workspace_id: workspaceId,
      }),
  });

  const sessions = useMemo(
    () => sessionsQuery.data?.items ?? [],
    [sessionsQuery.data],
  );

  // 机器分组数据源：与桌面树同源同参（session-list-panel.tsx:436）。
  const { items: machines } = useDaemonMachines({ limit: 100 });

  /** runtime_id → 所属机器（在线判定：machine.status === "online"）。 */
  const runtimeToMachine = useMemo<RuntimeMachineIndex>(() => {
    const map: RuntimeMachineIndex = new Map();
    for (const m of machines) {
      const online = m.status === "online";
      for (const r of m.runtimes ?? []) {
        map.set(r.id, { machine: m, online });
      }
    }
    return map;
  }, [machines]);

  /** Tab 过滤（全部/进行中客户端按 status；已归档已由服务端 key 切换）→ 机器分组。 */
  const groups = useMemo<MachineGroup[]>(() => {
    const visible =
      tab === "ongoing" ? sessions.filter(isOngoingSession) : sessions;
    const order: MachineGroup[] = [];
    const byKey = new Map<string, MachineGroup>();
    for (const s of visible) {
      const ref = sessionMachineRef(s, runtimeToMachine);
      let group = byKey.get(ref.key);
      if (!group) {
        group = { key: ref.key, label: ref.label, online: ref.online, sessions: [] };
        byKey.set(ref.key, group);
        order.push(group);
      }
      group.sessions.push(s);
    }
    // 在线组在前、离线组在后；Array#sort 稳定（ES2019+）保首次出现序。
    return order.sort((a, b) => Number(b.online) - Number(a.online));
  }, [sessions, tab, runtimeToMachine]);

  // 三操作 mutation：成功后 invalidate ["agentSessions"] 前缀（与门户同前缀，
  // 同时覆盖桌面与移动两份同 key 查询；错误不阻断列表——对齐门户
  // Promise.allSettled 吞错语义）。
  const invalidateSessions = () => {
    void queryClient.invalidateQueries({ queryKey: ["agentSessions"] });
  };
  // mutationFn 包一层单参 lambda：隔离 react-query 传入的 mutation 上下文第二参，
  // 保持 lib/daemon API 的单参 (sessionId) 调用形态。
  const deleteMutation = useMutation({
    mutationFn: (sessionId: string) => deleteAgentSession(sessionId),
    onSuccess: invalidateSessions,
  });
  const archiveMutation = useMutation({
    mutationFn: (sessionId: string) => archiveAgentSession(sessionId),
    onSuccess: invalidateSessions,
  });
  const unarchiveMutation = useMutation({
    mutationFn: (sessionId: string) => unarchiveAgentSession(sessionId),
    onSuccess: invalidateSessions,
  });

  /** 删除二次确认（design §5.5 危险操作；Modal.confirm 对齐 ppm 移动页先例）。 */
  const confirmDelete = (s: AgentSessionRead) => {
    Modal.confirm({
      title: `删除会话「${sessionDisplayName(s)}」?`,
      content: "该操作不可恢复。",
      okText: "确认删除",
      okButtonProps: { danger: true },
      cancelText: "取消",
      maskClosable: false,
      onOk: async () => {
        try {
          await deleteMutation.mutateAsync(s.id);
        } catch {
          // 吞错对齐门户 onDeleteSessions（allSettled）语义：失败仅不刷新。
        }
      },
    });
  };

  /** ⋯ 菜单动作集：归档/取消归档（按当前视图）+ 删除（danger）。 */
  const buildActions = (s: AgentSessionRead): MobileAction[] => [
    isArchivedView
      ? {
          key: "unarchive",
          label: "取消归档",
          onPress: () => unarchiveMutation.mutate(s.id),
        }
      : {
          key: "archive",
          label: "归档",
          onPress: () => archiveMutation.mutate(s.id),
        },
    {
      key: "delete",
      label: "删除",
      danger: true,
      onPress: () => confirmDelete(s),
    },
  ];

  const ongoingCount = useMemo(
    () => sessions.filter(isOngoingSession).length,
    [sessions],
  );

  const emptyText = isArchivedView
    ? "暂无已归档会话"
    : tab === "ongoing"
      ? "暂无进行中会话"
      : "暂无会话";

  return (
    <div
      data-testid="mobile-session-list"
      className="flex flex-col gap-2 pb-4"
    >
      {/* 状态 Tab（pill 段控，对齐原型 .list-tabs；全部/进行中带计数） */}
      <div role="tablist" aria-label="会话状态筛选" className="flex gap-2">
        {SESSION_TABS.map((t) => {
          const selected = tab === t.key;
          return (
            <button
              key={t.key}
              type="button"
              role="tab"
              aria-selected={selected}
              data-testid={`mobile-session-tab-${t.key}`}
              onClick={() => setTab(t.key)}
              className={cn(
                "inline-flex min-h-[44px] items-center gap-1 rounded-full border px-3 text-[14px] transition-colors",
                selected
                  ? "border-primary bg-primary font-medium text-primary-foreground"
                  : "border-border bg-card text-muted-foreground",
              )}
            >
              {t.label}
              {t.key === "all" && (
                <span className="text-xs opacity-80">{sessions.length}</span>
              )}
              {t.key === "ongoing" && (
                <span className="text-xs opacity-80">{ongoingCount}</span>
              )}
            </button>
          );
        })}
      </div>

      {sessionsQuery.isLoading ? (
        <div
          data-testid="mobile-session-list-loading"
          className="py-10 text-center text-[14px] text-muted-foreground"
        >
          加载中…
        </div>
      ) : sessionsQuery.isError ? (
        <div
          data-testid="mobile-session-list-error"
          className="py-10 text-center text-[14px] text-destructive"
        >
          会话加载失败：{sessionsQuery.error.message}
        </div>
      ) : groups.length === 0 ? (
        /* 空态引导新建（非归档视图）；onNew 由宿主接预会话流程（task-12） */
        <div
          data-testid="mobile-session-list-empty"
          className="flex flex-col items-center gap-3 py-10"
        >
          <p className="text-[14px] text-muted-foreground">{emptyText}</p>
          {!isArchivedView && (
            <button
              type="button"
              onClick={onNew}
              data-testid="mobile-session-list-new"
              className="inline-flex min-h-[44px] items-center rounded-[var(--radius-md)] bg-primary px-4 text-[14px] font-medium text-primary-foreground"
            >
              新建会话
            </button>
          )}
        </div>
      ) : (
        groups.map((group) => (
          <section
            key={group.key}
            data-testid="mobile-session-group"
            className="mt-1 flex flex-col gap-2"
          >
            {/* 组头：在线点 + 机器名 + 在线/离线（原型 .group-h） */}
            <div
              data-testid="mobile-session-group-header"
              className="flex items-center gap-2 px-1 pt-1"
            >
              <span
                aria-hidden
                className={cn(
                  "h-2 w-2 shrink-0 rounded-full",
                  group.online ? "bg-success" : "bg-muted-foreground/40",
                )}
              />
              <span className="truncate text-[13px] font-medium text-foreground">
                {group.label}
              </span>
              <span className="shrink-0 text-xs text-muted-foreground">
                {group.online ? "在线" : "离线"}
              </span>
            </div>
            {group.sessions.map((s) => {
              const name = sessionDisplayName(s);
              return (
                <div
                  key={s.id}
                  data-testid="mobile-session-card"
                  className="flex items-stretch rounded-[var(--radius-lg)] border border-border bg-card shadow-[var(--shadow-sm)]"
                >
                  {/* 卡片主体：可点进会话（热区 ≥44px，正文 ≥14px） */}
                  <button
                    type="button"
                    onClick={() => onSelect(s.id)}
                    aria-label={`打开会话 ${name}`}
                    className="flex min-h-[44px] min-w-0 flex-1 flex-col gap-1 p-3 text-left transition-colors active:bg-muted/50"
                  >
                    <span
                      className="truncate text-[14px] font-medium text-foreground"
                      title={name}
                    >
                      {name}
                    </span>
                    {/* 引擎 · 状态 · 最后活动相对时间（原型 .ses-sub） */}
                    <span className="truncate text-xs text-muted-foreground">
                      {engineLabel(s)} · {statusLabel(s.status)} ·{" "}
                      {formatRelativeTime(s.last_active_at)}
                    </span>
                  </button>
                  {/* ⋯ 菜单按钮（独立于卡片主体，避免 button 嵌套；热区 ≥44px） */}
                  <button
                    type="button"
                    aria-label={`会话操作 ${name}`}
                    data-testid={`mobile-session-card-menu-${s.id}`}
                    onClick={() => setMenuSession(s)}
                    className="inline-flex min-h-[44px] min-w-[44px] shrink-0 items-center justify-center self-stretch rounded-r-[var(--radius-lg)] text-muted-foreground transition-colors hover:bg-muted"
                  >
                    <MoreVertical className="h-5 w-5" aria-hidden />
                  </button>
                </div>
              );
            })}
          </section>
        ))
      )}

      {/* ⋯ 菜单（MobileActionMenu 底部 ActionSheet；关闭即清目标会话） */}
      <MobileActionMenu
        open={menuSession !== null}
        actions={menuSession ? buildActions(menuSession) : []}
        onClose={() => setMenuSession(null)}
        title="会话操作"
      />
    </div>
  );
}
