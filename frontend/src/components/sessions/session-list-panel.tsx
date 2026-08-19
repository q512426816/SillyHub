"use client";

/**
 * SessionListPanel — 左栏会话列表：筛选 + 虚拟滚动 + 紧凑两行条目
 * （2026-08-14-sessions-portal task-11 / FR-02 / D-003 / D-006 / R-04）。
 *
 * 依据：
 *   - tasks/task-11.md（allowed_paths / implementation / acceptance）
 *   - design.md §2 FR-02、§5 Wave3 SessionListPanel 段、§10 R-04（真分页+过滤）
 *   - prototype-sessions-portal.html renderList / renderSessionPanel（视觉语义）
 *   - FRONTEND_PAGE_STYLE.md（antd 组件 + tailwind 变量、Tag color、空值 —）
 *
 * 结构：
 *   筛选区（FR-02 四维）：
 *     - 引擎胶囊 tab（Segmented 全部/Claude/Codex → provider 参数，单选即查）
 *     - 状态下拉（active/ended/failed → status 参数，即查）
 *     - 机器多选（useDaemonMachines；恰好选中 1 台 → machine_id 走 server 侧过滤；
 *       多台 → 后端仅支持单 machine_id（task-16 契约），退化为客户端过滤）
 *     - 标题搜索（回车触发 q 参数，FRONTEND_PAGE_STYLE 查询触发规则）
 *   列表：@tanstack/react-virtual useVirtualizer（D-003 决策），只渲染可视区；
 *     数据经 listAgentSessions 后端真分页（useInfiniteQuery + 加载更多，R-04）。
 *   条目（D-006 紧凑两行）：
 *     第一行 = 状态点 + 标题截断 + 相对时间；
 *     第二行 = chips（机器/引擎/档案/供应商/轮数）——优先读 config_snapshot 直显
 *     免二次查询（Grill C-12）；快照缺省（旧数据 null）回退 runtime/provider
 *     基础信息（机器名经 runtime_id→机器映射、引擎用 session.provider）。
 *   点击条目 → onSelect(session)（页面组装归 task-10，本组件自治）。
 */
import { useMemo, useRef, useState } from "react";
import {
  useInfiniteQuery,
  useQuery,
  type InfiniteData,
} from "@tanstack/react-query";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Badge, Button, Input, Modal, Segmented, Select, Spin, Tag } from "antd";
import { SearchOutlined } from "@ant-design/icons";
import { Trash2 } from "lucide-react";
import { ApiError } from "@/lib/api";
import { useDaemonMachines } from "@/lib/use-daemon-machines";
import { listWorkspaces } from "@/lib/workspaces";
import {
  listAgentSessions,
  type AgentSessionListResponse,
  type AgentSessionRead,
  type AgentSessionStatus,
  type DaemonMachineRead,
} from "@/lib/daemon";

/** 引擎胶囊 tab（FR-02：全部/claude/codex → provider 参数）。 */
const ENGINE_TABS = [
  { label: "全部", value: "" },
  { label: "Claude", value: "claude" },
  { label: "Codex", value: "codex" },
] as const;

/** 状态下拉选项（FR-02：active/ended/failed；空串=不过滤）。 */
const STATUS_OPTIONS = [
  { label: "全部状态", value: "" },
  { label: "活跃", value: "active" },
  { label: "已结束", value: "ended" },
  { label: "已失败", value: "failed" },
] as const;

/** 后端真分页页大小（R-04）。 */
const PAGE_SIZE = 50;
/** 虚拟行固定高（ql-20260817-002：标题行 + chips 换行至多 3 行，96px 容纳）。 */
const ROW_HEIGHT = 96;
/** 视口外预渲染行数（jsdom 无量测时也保证有可断言的条目）。 */
const OVERSCAN = 6;

export interface SessionListPanelProps {
  /** 当前选中会话 id（高亮，受控；页面组装归 task-10）。 */
  selectedSessionId?: string | null;
  /** 点击条目回调。 */
  onSelect?: (_session: AgentSessionRead) => void;
  /** ql-20260818-012：删除会话回调（单条/批量共用，软删后 invalidate 列表）。 */
  onDeleteSessions?: (_ids: string[]) => Promise<void>;
}

/* ────────────────────── 纯辅助（组件外便于单测推理） ────────────────────── */

/** 机器显示名（与 new-session-form.tsx 同语义：别名优先）。 */
function machineLabel(m: DaemonMachineRead): string {
  return m.display_alias?.trim() || m.hostname;
}

/** ISO → 中文相对时间；空/非法 → —（FRONTEND_PAGE_STYLE 空值统一）。 */
export function formatRelativeTime(
  iso: string | null | undefined,
  now: number = Date.now(),
): string {
  if (!iso) return "—";
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "—";
  const diffMin = Math.floor((now - t) / 60_000);
  if (diffMin < 1) return "刚刚";
  if (diffMin < 60) return `${diffMin} 分钟前`;
  const hours = Math.floor(diffMin / 60);
  if (hours < 24) return `${hours} 小时前`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} 天前`;
  const d = new Date(t);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** 引擎显示名（快照 engine 缺省回退 session.provider）。 */
function engineLabel(engine: string | null | undefined): string {
  if (engine === "claude") return "Claude";
  if (engine === "codex") return "Codex";
  return engine || "—";
}

/** 状态点颜色（原型 .dot 语义；pending/reconnecting 视作活跃态）。 */
function statusDotClass(status: AgentSessionStatus): string {
  if (status === "failed") return "bg-destructive";
  if (status === "ended") return "bg-muted-foreground/50";
  return "bg-primary";
}

/* ────────────────────── 组件 ────────────────────── */

export function SessionListPanel({
  selectedSessionId,
  onSelect,
  onDeleteSessions,
}: SessionListPanelProps) {
  // 四维筛选状态（选择型即查：setState → queryKey 变化 → react-query 停旧启新）。
  const [engine, setEngine] = useState<string>("");
  const [status, setStatus] = useState<string>("");
  const [machineIds, setMachineIds] = useState<string[]>([]);
  // 文本型：输入态 vs 已应用态分离，回车才把 q 应用进查询（不每键触发）。
  const [searchInput, setSearchInput] = useState("");
  const [appliedQuery, setAppliedQuery] = useState("");
  // ql-20260818-012：批量选择模式 + 已勾选 id 集合 + 删除进行中。
  const [batchMode, setBatchMode] = useState(false);
  const [checkedIds, setCheckedIds] = useState<Set<string>>(new Set());
  const [deleting, setDeleting] = useState(false);

  // 机器列表（筛选多选 + chips 机器名回退 / 离线判定共用一份数据源）。
  const { items: machines } = useDaemonMachines({ limit: 100 });

  // 工作区列表（chips 工作区名称解析）。
  const workspacesQuery = useQuery({
    queryKey: ["workspaces", "session-list"],
    queryFn: () => listWorkspaces({ limit: 100 }),
    staleTime: 60_000,
  });
  /** workspace_id → 工作区名称映射。 */
  const workspaceIdToName = useMemo(() => {
    const map = new Map<string, string>();
    for (const ws of workspacesQuery.data?.items ?? []) {
      map.set(ws.id, ws.name);
    }
    return map;
  }, [workspacesQuery.data]);

  /** server 侧过滤参数（task-16 契约：runtime_id/machine_id/provider/q/status）。 */
  const serverParams = useMemo(
    () => ({
      limit: PAGE_SIZE,
      ...(engine ? { provider: engine } : {}),
      ...(status ? { status: status as AgentSessionStatus } : {}),
      // 后端 machine_id 是单值参数：恰好选 1 台才下发；多台走客户端过滤。
      ...(machineIds.length === 1 ? { machine_id: machineIds[0] } : {}),
      ...(appliedQuery ? { q: appliedQuery } : {}),
    }),
    [engine, status, machineIds, appliedQuery],
  );

  const sessionsQuery = useInfiniteQuery<
    AgentSessionListResponse,
    ApiError,
    InfiniteData<AgentSessionListResponse, number>,
    readonly unknown[],
    number
  >({
    queryKey: ["agentSessions", "sessionsPortal", serverParams],
    queryFn: ({ pageParam }) =>
      listAgentSessions({
        ...serverParams,
        // 首页省略 offset（与 listAgentSessions 默认参数一致）。
        ...(pageParam > 0 ? { offset: pageParam } : {}),
      }),
    initialPageParam: 0,
    getNextPageParam: (lastPage, pages) => {
      const loaded = pages.reduce((n, p) => n + p.items.length, 0);
      return loaded < lastPage.total && lastPage.items.length > 0
        ? loaded
        : undefined;
    },
  });

  /** runtime_id → 所属机器（机器名回退 + 离线划线判定）。 */
  const runtimeToMachine = useMemo(() => {
    const map = new Map<
      string,
      { machine: DaemonMachineRead; online: boolean }
    >();
    for (const m of machines) {
      const online = m.status === "online";
      for (const r of m.runtimes ?? []) {
        map.set(r.id, { machine: m, online });
      }
    }
    return map;
  }, [machines]);

  const loadedItems = useMemo(
    () => sessionsQuery.data?.pages.flatMap((p) => p.items) ?? [],
    [sessionsQuery.data],
  );

  // 机器多选（>1）：后端单 machine_id 装不下 → 对已加载页客户端过滤。
  const items = useMemo(() => {
    if (machineIds.length <= 1) return loadedItems;
    const selected = new Set(machineIds);
    return loadedItems.filter((s) => {
      if (!s.runtime_id) return false;
      const hit = runtimeToMachine.get(s.runtime_id);
      return hit ? selected.has(hit.machine.id) : false;
    });
  }, [loadedItems, machineIds, runtimeToMachine]);

  const total = sessionsQuery.data?.pages.at(-1)?.total ?? 0;

  // ql-20260818-012：删除处理（单条/批量共用 onDeleteSessions 回调）。
  // ql-20260818-013：加二次确认（Modal.confirm）。
  const handleSingleDelete = (id: string, title: string) => {
    if (!onDeleteSessions || deleting) return;
    Modal.confirm({
      title: "删除会话",
      content: `确定要删除「${title}」吗？删除后将从列表中移除。`,
      okText: "删除",
      okButtonProps: { danger: true },
      cancelText: "取消",
      onOk: async () => {
        setDeleting(true);
        try {
          await onDeleteSessions([id]);
        } finally {
          setDeleting(false);
        }
      },
    });
  };
  const handleBatchDelete = () => {
    if (!onDeleteSessions || deleting || checkedIds.size === 0) return;
    Modal.confirm({
      title: "批量删除会话",
      content: `确定要删除选中的 ${checkedIds.size} 个会话吗？删除后将从列表中移除。`,
      okText: `删除 ${checkedIds.size} 个`,
      okButtonProps: { danger: true },
      cancelText: "取消",
      onOk: async () => {
        setDeleting(true);
        try {
          await onDeleteSessions([...checkedIds]);
          setCheckedIds(new Set());
        } finally {
          setDeleting(false);
        }
      },
    });
  };
  const toggleChecked = (id: string) => {
    setCheckedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // 虚拟滚动（D-003）：固定行高（estimateSize），jsdom/真实环境行为一致。
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: OVERSCAN,
  });
  const virtualItems = virtualizer.getVirtualItems();

  const machineOptions = useMemo(
    () =>
      machines.map((m) => ({
        value: m.id,
        label: (
          <span className="flex items-center gap-1.5">
            <Badge status={m.status === "online" ? "success" : "default"} />
            <span>{machineLabel(m)}</span>
          </span>
        ),
      })),
    [machines],
  );

  return (
    <div
      aria-label="会话列表"
      className="flex h-full min-h-0 flex-col overflow-hidden rounded-lg border border-border bg-card"
    >
      {/* 头部：标题 + 总数 */}
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <h2 className="text-sm font-semibold text-foreground">会话</h2>
        <span className="text-[11px] text-muted-foreground">共 {total} 个</span>
      </div>

      {/* 筛选区（FR-02 四维；选择型即查、文本回车查） */}
      <div className="flex flex-col gap-2 border-b border-border px-3 py-2">
        <Input
          size="small"
          allowClear
          prefix={<SearchOutlined />}
          placeholder="搜索会话标题…（回车搜索）"
          aria-label="搜索会话标题"
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          onPressEnter={() => setAppliedQuery(searchInput.trim())}
        />
        <div className="flex items-center gap-1.5">
          <Select
            id="slp-status"
            size="small"
            className="w-28 shrink-0"
            value={status}
            onChange={(v) => setStatus(v ?? "")}
            options={STATUS_OPTIONS.map((o) => ({ ...o }))}
          />
          <Select
            id="slp-machine"
            mode="multiple"
            size="small"
            className="min-w-0 flex-1"
            placeholder="机器（全部）"
            allowClear
            maxTagCount={2}
            value={machineIds}
            onChange={(v) => setMachineIds(v ?? [])}
            options={machineOptions}
          />
        </div>
        <Segmented
          size="small"
          value={engine}
          onChange={(v) => setEngine(v as string)}
          options={ENGINE_TABS.map((o) => ({ ...o }))}
        />
      </div>

      {/* ql-20260818-012：批量选择模式切换 + 批量删除/单条删除操作栏 */}
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-border">
        <Button
          size="small"
          type={batchMode ? "primary" : "default"}
          onClick={() => {
            setBatchMode(!batchMode);
            setCheckedIds(new Set());
          }}
        >
          {batchMode ? "退出批量" : "批量管理"}
        </Button>
        {batchMode && (
          <>
            <Button
              size="small"
              disabled={checkedIds.size === 0 || deleting}
              loading={deleting}
              onClick={handleBatchDelete}
            >
              删除选中（{checkedIds.size}）
            </Button>
            <Button
              size="small"
              onClick={() => {
                const allIds = new Set(loadedItems.map((s) => s.id));
                setCheckedIds(
                  checkedIds.size === allIds.size ? new Set() : allIds,
                );
              }}
            >
              {checkedIds.size === loadedItems.length && checkedIds.size > 0
                ? "取消全选"
                : "全选"}
            </Button>
          </>
        )}
      </div>

      {/* 列表区 */}
      {sessionsQuery.isError ? (
        <div className="m-3 rounded border border-destructive/30 bg-red-50 px-3 py-2 text-xs text-destructive">
          加载会话失败：{sessionsQuery.error?.message ?? "未知错误"}
          <Button
            size="small"
            className="ml-2"
            onClick={() => void sessionsQuery.refetch()}
          >
            重新加载
          </Button>
        </div>
      ) : sessionsQuery.isLoading ? (
        <div className="flex flex-1 items-center justify-center">
          <Spin data-testid="sessions-loading" />
        </div>
      ) : items.length === 0 ? (
        <div className="flex flex-1 items-center justify-center px-4 text-center text-xs text-muted-foreground">
          没有符合条件的会话
        </div>
      ) : (
        <div
          ref={scrollRef}
          data-testid="session-scroll"
          className="min-h-0 flex-1 overflow-y-auto"
        >
          <div
            style={{
              height: virtualizer.getTotalSize(),
              position: "relative",
              width: "100%",
            }}
          >
            {virtualItems.flatMap((virtualRow) => {
              // noUncheckedIndexedAccess：越界项（数据与虚拟索引瞬时错位）跳过。
              const session = items[virtualRow.index];
              if (!session) return [];
              const selected = session.id === selectedSessionId;
              const title = session.title?.trim() || "未命名会话";
              return [
                <SessionRow
                  key={session.id}
                  session={session}
                  title={title}
                  selected={selected}
                  runtimeToMachine={runtimeToMachine}
                  workspaceIdToName={workspaceIdToName}
                  virtualStart={virtualRow.start}
                  virtualSize={virtualRow.size}
                  onSelect={onSelect}
                  batchMode={batchMode}
                  checked={checkedIds.has(session.id)}
                  onToggleCheck={() => toggleChecked(session.id)}
                  onDelete={onDeleteSessions ? () => handleSingleDelete(session.id, title) : undefined}
                />,
              ];
            })}
          </div>
          {/* 后端真分页（R-04）：未取完时手动加载下一页。 */}
          {sessionsQuery.hasNextPage && (
            <div className="border-t border-border px-3 py-2 text-center">
              <Button
                size="small"
                loading={sessionsQuery.isFetchingNextPage}
                onClick={() => void sessionsQuery.fetchNextPage()}
              >
                加载更多（已加载 {loadedItems.length}/{total}）
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ────────────────────── 紧凑两行条目（D-006） ────────────────────── */

interface SessionRowProps {
  session: AgentSessionRead;
  title: string;
  selected: boolean;
  runtimeToMachine: Map<string, { machine: DaemonMachineRead; online: boolean }>;
  workspaceIdToName: Map<string, string>;
  virtualStart: number;
  virtualSize: number;
  onSelect?: (_session: AgentSessionRead) => void;
  /** ql-20260818-012：批量模式/勾选/删除 */
  batchMode?: boolean;
  checked?: boolean;
  onToggleCheck?: () => void;
  onDelete?: () => void;
}

function SessionRow({
  session,
  title,
  selected,
  runtimeToMachine,
  workspaceIdToName,
  virtualStart,
  virtualSize,
  onSelect,
  batchMode,
  checked,
  onToggleCheck,
  onDelete,
}: SessionRowProps) {
  // chips 数据源：config_snapshot 直显免二次查询；快照缺省回退基础信息。
  const snapshot = session.config_snapshot;
  const machineHit = session.runtime_id
    ? runtimeToMachine.get(session.runtime_id)
    : undefined;
  // 机器名：快照 machine_name 优先；缺省回退 runtime→机器映射（快照与机器
  // 列表都可能缺席——机器列表分页外/已删除，此时显示 —）。
  const machineName =
    snapshot?.machine_name ??
    (machineHit ? machineLabel(machineHit.machine) : null);
  // 离线判定只能来自实时机器列表（快照是建会话时的名字，无在线状态）。
  const machineOffline = machineHit ? !machineHit.online : false;
  const engineValue = snapshot?.engine ?? session.provider;

  return (
    <div
      role="button"
      tabIndex={0}
      aria-pressed={selected}
      aria-label={`会话 ${title}`}
      onClick={() => (batchMode ? onToggleCheck?.() : onSelect?.(session))}
      onKeyDown={(e) => {
        if (e.key === "Enter") batchMode ? onToggleCheck?.() : onSelect?.(session);
      }}
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        width: "100%",
        height: virtualSize,
        transform: `translateY(${virtualStart}px)`,
      }}
      className={`flex cursor-pointer flex-col justify-center gap-1 overflow-hidden border-b border-border px-3 py-1.5 ${
        selected
          ? "border-l-2 border-l-primary bg-primary/5"
          : "border-l-2 border-l-transparent hover:bg-muted/40"
      }`}
    >
      {/* 第一行：状态点 + 标题截断 + 相对时间 + 删除按钮（hover） */}
      <div className="group flex items-center gap-1.5">
        {/* ql-20260818-012：批量模式 → 勾选框替代点击选会话 */}
        {batchMode ? (
          <input
            type="checkbox"
            checked={checked ?? false}
            onChange={onToggleCheck}
            aria-label={`勾选 ${title}`}
            className="h-3.5 w-3.5 shrink-0 accent-blue-600"
          />
        ) : (
          <span
            className={`h-1.5 w-1.5 shrink-0 rounded-full ${statusDotClass(session.status)}`}
            aria-label={`状态 ${session.status}`}
          />
        )}
        <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-foreground">
          {title}
        </span>
        <span className="shrink-0 text-[11px] text-muted-foreground">
          {formatRelativeTime(session.last_active_at ?? session.created_at)}
        </span>
        {/* 单条删除按钮：hover 显示，阻止行点击冒泡 */}
        {onDelete && !batchMode && (
          <button
            type="button"
            aria-label={`删除 ${title}`}
            onClick={(e) => {
              e.stopPropagation();
              onDelete();
            }}
            className="ml-1 hidden h-5 w-5 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-destructive/10 hover:text-destructive group-hover:flex"
          >
            <Trash2 className="h-3 w-3" />
          </button>
        )}
      </div>
      {/* 第二行：chips（工作区/机器/引擎/档案/供应商/轮数）——ql-20260817-002 改
          flex-wrap 自动换行 2-3 行（单行压挤更看不清）；Tag 紧凑样式保留、
          长名 max-w+truncate 防单个长名占整行，截断悬停有 title 全名。 */}
      <div className="flex flex-wrap items-center gap-0.5 pl-2.5">
        {session.workspace_id && workspaceIdToName.has(session.workspace_id) && (
          <Tag
            title={workspaceIdToName.get(session.workspace_id)}
            className="m-0 max-w-[120px] truncate rounded-sm px-1 py-0 text-[10px] leading-4"
            color="cyan"
          >
            📂 {workspaceIdToName.get(session.workspace_id)}
          </Tag>
        )}
        {machineName && (
          <Tag
            title={machineOffline ? `${machineName}（离线）` : machineName}
            className={`m-0 max-w-[120px] truncate rounded-sm px-1 py-0 text-[10px] leading-4 ${
              machineOffline ? "line-through opacity-60" : ""
            }`}
          >
            🖥 {machineName}
            {machineOffline ? "（离线）" : ""}
          </Tag>
        )}
        <Tag
          className="m-0 shrink-0 rounded-sm px-1 py-0 text-[10px] leading-4"
          color={engineValue === "codex" ? "purple" : "gold"}
        >
          {engineLabel(engineValue)}
        </Tag>
        {snapshot?.profile_name && (
          <Tag
            title={snapshot.profile_name}
            className="m-0 max-w-[150px] truncate rounded-sm px-1 py-0 text-[10px] leading-4"
            color="blue"
          >
            📋 {snapshot.profile_name}
          </Tag>
        )}
        {snapshot?.provider_name && (
          <Tag
            title={snapshot.provider_name}
            className="m-0 max-w-[130px] truncate rounded-sm px-1 py-0 text-[10px] leading-4"
          >
            ☁ {snapshot.provider_name}
          </Tag>
        )}
        <Tag className="m-0 shrink-0 rounded-sm px-1 py-0 text-[10px] leading-4">
          {session.turn_count} 轮
        </Tag>
      </div>
    </div>
  );
}
