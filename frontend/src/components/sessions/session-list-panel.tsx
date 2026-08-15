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
  type InfiniteData,
} from "@tanstack/react-query";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Badge, Button, Input, Segmented, Select, Spin, Tag } from "antd";
import { SearchOutlined } from "@ant-design/icons";
import { ApiError } from "@/lib/api";
import { useDaemonMachines } from "@/lib/use-daemon-machines";
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
/** 虚拟行固定高（两行紧凑条目，D-006；chips 单行截断保证不超）。 */
const ROW_HEIGHT = 64;
/** 视口外预渲染行数（jsdom 无量测时也保证有可断言的条目）。 */
const OVERSCAN = 6;

export interface SessionListPanelProps {
  /** 当前选中会话 id（高亮，受控；页面组装归 task-10）。 */
  selectedSessionId?: string | null;
  /** 点击条目回调。 */
  onSelect?: (_session: AgentSessionRead) => void;
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
}: SessionListPanelProps) {
  // 四维筛选状态（选择型即查：setState → queryKey 变化 → react-query 停旧启新）。
  const [engine, setEngine] = useState<string>("");
  const [status, setStatus] = useState<string>("");
  const [machineIds, setMachineIds] = useState<string[]>([]);
  // 文本型：输入态 vs 已应用态分离，回车才把 q 应用进查询（不每键触发）。
  const [searchInput, setSearchInput] = useState("");
  const [appliedQuery, setAppliedQuery] = useState("");

  // 机器列表（筛选多选 + chips 机器名回退 / 离线判定共用一份数据源）。
  const { items: machines } = useDaemonMachines({ limit: 100 });

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
                  virtualStart={virtualRow.start}
                  virtualSize={virtualRow.size}
                  onSelect={onSelect}
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
  virtualStart: number;
  virtualSize: number;
  onSelect?: (_session: AgentSessionRead) => void;
}

function SessionRow({
  session,
  title,
  selected,
  runtimeToMachine,
  virtualStart,
  virtualSize,
  onSelect,
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
      onClick={() => onSelect?.(session)}
      onKeyDown={(e) => {
        if (e.key === "Enter") onSelect?.(session);
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
      {/* 第一行：状态点 + 标题截断 + 相对时间 */}
      <div className="flex items-center gap-1.5">
        <span
          className={`h-1.5 w-1.5 shrink-0 rounded-full ${statusDotClass(session.status)}`}
          aria-label={`状态 ${session.status}`}
        />
        <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-foreground">
          {title}
        </span>
        <span className="shrink-0 text-[11px] text-muted-foreground">
          {formatRelativeTime(session.last_active_at ?? session.created_at)}
        </span>
      </div>
      {/* 第二行：chips（机器/引擎/档案/供应商/轮数，单行截断保证固定行高） */}
      <div className="flex items-center gap-1 overflow-hidden pl-3 whitespace-nowrap">
        {machineName && (
          <Tag className={machineOffline ? "m-0 line-through opacity-60" : "m-0"}>
            🖥 {machineName}
            {machineOffline ? "（离线）" : ""}
          </Tag>
        )}
        <Tag className="m-0" color={engineValue === "codex" ? "purple" : "gold"}>
          {engineLabel(engineValue)}
        </Tag>
        {snapshot?.profile_name && (
          <Tag className="m-0" color="blue">
            📋 {snapshot.profile_name}
          </Tag>
        )}
        {snapshot?.provider_name && (
          <Tag className="m-0">☁ {snapshot.provider_name}</Tag>
        )}
        <Tag className="m-0">{session.turn_count} 轮</Tag>
      </div>
    </div>
  );
}
