"use client";

/**
 * SessionListPanel — 左栏会话列表（2026-08-23-sessions-workspace-hub task-05
 * 工作区树重构，FR-01/FR-02 / D-103 / D-105 / D-107 / R-03 / R-05 / X-11）。
 *
 * 依据：
 *   - tasks/task-05.md（allowed_paths / implementation 六点 / acceptance）
 *   - design.md §2 FR-01/FR-02、§3 非目标（能力边界：状态筛选/批量删除/搜索
 *     保留，change 独立页左侧维持现状 scope 列表不改树）、§10 R-03/R-05
 *   - prototype-sessions-workspace-hub.html v2（.filter-bar 两层 tab /
 *     .ws-group .ws-head 组头 / .machine-sec 机器小节 / .sess-item chips）
 *   - FRONTEND_PAGE_STYLE.md（antd 组件 + tailwind 语义 token、空值 —）
 *
 * 形态分派（scope 判断分支保留）：
 *   - 全局（缺省）/ workspace scope → 工作区树 WorkspaceTreeList：
 *     数据一次拉取 limit=500（AGENT_SESSIONS_TREE_FETCH_LIMIT 收口，
 *     D-103）客户端按 workspace_id 分组；workspace scope 维持既有端点过滤
 *     （D-003@v2 只多传 workspace_id），树形态为 task-06 workspace 入口
 *     「深链预展开+滚动到该分组」（FR-06，经 defaultExpandedWorkspaceId）预留；
 *   - change scope：ql-20260823-003 起同走工作区树（用户要求三入口一致，
 *     D-106 修订——平铺分支 ChangeScopeFlatList 已退役删除）。
 *
 * 工作区树（全局/workspace 形态）结构：
 *   筛选区：
 *     - 标题搜索（回车应用，X-11 保留；树形态为纯视图过滤不进数据层）
 *     - 状态下拉（X-11 保留：组内过滤 = 视图过滤）
 *     - 两层筛选 tab（FR-02 / D-107）：第一层机器（含「全部」清空），选中后
 *       出第二层智能体（⚡Claude Code/◎Codex，含「全部」）；纯视图过滤不进
 *       数据层；筛选态隐藏机器小节标题；筛选变化重置展开态除当前组（R-05）
 *   树：
 *     - 工作区分组手风琴：组头 = 📂名称 + 会话数 + 「＋」新建 + 多选入口 +
 *       展开箭头；0 会话组仍显示（计数 0）；「非工作区」（workspace_id null）
 *       固定末尾组同样有「＋」（D-105）；workspace_id 无法解析（工作区已删）
 *       的会话落「未知工作区」桶（无「＋」——无法在其上新建）
 *     - 组内机器小节：机器名 + 在线状态点；runtime→machine 映射来自会话
 *       runtime_id，缺省回退 config_snapshot.machine_name
 *     - 组内超 50 截断 + 「显示全部」（R-03）
 *   条目（D-006 紧凑两行沿用）：第一行 = 状态点 + 标题 + 相对时间；第二行 =
 *     chips（引擎/创建人/档案/供应商/轮数——树形态下工作区/机器信息由组头与
 *     小节承载，chips 不再重复）；创建人 chip 读 owner_name（D-108@v2，任务
 *     卡：null 显"—"；本人隔离视图下恒为本人，字段为未来共享场景预留）。
 *
 * 退役清单（全局形态，X-11 / task-05 implementation 第 5 点）：
 *   引擎胶囊 tab（Segmented）→ 两层筛选 tab 智能体层取代；全局 useVirtualizer
 *   → 分组结构 + 组内截断取代（R-04）；机器多选 Select → 机器 tab 取代
 *  （ql-20260823-003：change 分支随平铺形态一并退役，三入口零残留）。
 *
 * 组头回调 onNewInGroup(workspaceId)（props 新增，上下文解析归 task-06）；
 * defaultExpandedWorkspaceId（受控展开 prop，供 task-06 workspace 深链预展开）。
 *
 * 历史（2026-08-14-sessions-portal task-11 / 2026-08-22-workspace-sessions-portal
 * task-11 v3 返工）：scope 判别联合（WorkspaceScope/ChangeScope 导出）、D-003@v2
 * 端点过滤、D-006 紧凑两行、ql-20260818-012 批量删除——语义均随本次重构迁移。
 */
import { useMemo, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button, Input, Modal, Select, Spin, Tag } from "antd";
import { SearchOutlined } from "@ant-design/icons";
import {
  BookUser,
  Cloud,
  Command,
  FileText,
  Folder,
  FolderOpen,
  ListChecks,
  Monitor,
  Plus,
  Trash2,
  User,
  Zap,
} from "lucide-react";
import { ApiError } from "@/lib/api";
import { useDaemonMachines } from "@/lib/use-daemon-machines";
import { listWorkspaces } from "@/lib/workspaces";
import {
  AGENT_SESSIONS_TREE_FETCH_LIMIT,
  listAgentSessions,
  type AgentSessionListResponse,
  type AgentSessionRead,
  type AgentSessionStatus,
  type DaemonMachineRead,
} from "@/lib/daemon";
import { cn } from "@/lib/utils";

/* ────────────── scope 判别联合（task-04 provides 契约，供 task-01 门户复用） ────────────── */

/** 工作区范围：列表与创建绑定锁定到单个工作区（design §4.A 判别联合，Grill P2）。 */
export type WorkspaceScope = { kind: "workspace"; workspaceId: string };

/** 变更范围：workspace 级超集，再绑定单个变更（change 级隐含 workspace）。 */
export type ChangeScope = {
  kind: "change";
  workspaceId: string;
  changeId: string;
};

/** scope 判别联合（缺省不传 = 全局门户现状）。 */
export type SessionListScope = WorkspaceScope | ChangeScope;

/** 状态下拉选项（active/ended/failed；空串=不过滤）。 */
const STATUS_OPTIONS = [
  { label: "全部状态", value: "" },
  { label: "活跃", value: "active" },
  { label: "已结束", value: "ended" },
  { label: "已失败", value: "failed" },
] as const;

/** 第二层智能体 tab 选项（D-107：claude/codex 固定两档，引擎标记线性图标）。 */
const AGENT_TABS = [
  { label: "Claude Code", value: "claude" },
  { label: "Codex", value: "codex" },
] as const;

/** 引擎身份标记（线性图标统一，2026-08-24 用户裁决 emoji 全退役）：claude=Zap / codex=Command。 */
function EngineMark({ provider }: { provider: string }) {
  const cls = "h-3 w-3 shrink-0";
  return provider === "claude" ? (
    <Zap aria-hidden className={cls} />
  ) : (
    <Command aria-hidden className={cls} />
  );
}

/** 组内截断阈值 + 「显示全部」（R-03）。 */
const GROUP_ITEM_LIMIT = 50;

/** 「非工作区」固定末尾组 id（分组/展开集合用；区别于 workspace uuid）。 */
const NO_WORKSPACE_GROUP_ID = "__no_workspace__";
/** 未知工作区分组 id（会话 workspace_id 已无法解析，如工作区被删）。 */
const UNKNOWN_WORKSPACE_GROUP_ID = "__unknown_workspace__";

export interface SessionListPanelProps {
  /** 当前选中会话 id（高亮，受控；页面组装归 task-10）。 */
  selectedSessionId?: string | null;
  /** 点击条目回调。 */
  onSelect?: (_session: AgentSessionRead) => void;
  /** ql-20260818-012：删除会话回调（单条/批量共用，软删后 invalidate 列表）。 */
  onDeleteSessions?: (_ids: string[]) => Promise<void>;
  /**
   * task-04（2026-08-22-workspace-sessions-portal）：可选 scope，锁定列表
   * 到工作区/变更级。D-003@v2：scope 仅给全局端点多传 workspace_id/change_id
   * 过滤参；本卡（task-05）起全局/workspace 形态为工作区树、change 维持
   * 现状平铺列表（design §3 边界）。
   */
  scope?: SessionListScope;
  /**
   * task-05（FR-01/D-105）：组头「＋」新建回调——workspaceId 为组所在工作区
   * id，「非工作区」组传 null。上下文解析（筛选 tab > 绑定 > D-005 回退 +
   * 全部态两步浮层）归 task-06；未传则组头不渲染「＋」。
   */
  /**
   * 组头「＋」回调：workspaceId（null=非工作区分组）+ 当前两层筛选态快照
   * （ql-20260823-001：machineId/agent 为空串表示该层未选——消费方据此判断
   * 「筛选齐备直带上下文」还是回退浮层，D-107 优先级链第一段）。
   */
  onNewInGroup?: (
    _workspaceId: string | null,
    _filter?: { machineId: string; agent: string },
  ) => void;
  /**
   * task-05（FR-06）：默认展开的工作区分组 id（非受控一次性初值；供 task-06
   * workspace 入口深链预展开——缺省全部分组展开）。
   */
  defaultExpandedWorkspaceId?: string;
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

/** 条目引擎取值（快照优先，回退 session.provider；两层筛选第二层同源）。 */
function engineValueOf(s: AgentSessionRead): string | null {
  return s.config_snapshot?.engine ?? s.provider;
}

/** 状态点颜色（原型 .dot 语义；pending/reconnecting 视作活跃态）。 */
function statusDotClass(status: AgentSessionStatus): string {
  if (status === "failed") return "bg-destructive";
  if (status === "ended") return "bg-success";
  // 进行中 = info 青 + 光环（D-003 info 档统一 accent 青，2026-08-23 原型 .st.active）。
  if (status === "active") return "bg-info ring-2 ring-info/20";
  return "bg-muted-foreground/50";
}

/** runtime→机器映射值（机器小节 / 离线判定共用）。 */
type RuntimeMachineIndex = Map<
  string,
  { machine: DaemonMachineRead; online: boolean }
>;

/** 条目所属机器引用（机器小节分桶用；原型 .machine-sec 语义）。 */
interface SessionMachineRef {
  /** 分桶键：可解析时为 machine.id，快照回退时为 name: 前缀。 */
  key: string;
  label: string;
  online: boolean;
}

/**
 * 条目 → 机器引用：runtime_id 经 runtimeToMachine 映射（在线状态只能来自
 * 实时机器列表）；映射缺席（机器列表分页外/已删）回退 config_snapshot.
 * machine_name（无在线信息，按离线渲染）；两者皆无 → 未知机器。
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

/** 工作区树分组（客户端按 workspace_id 分组，D-103）。 */
interface TreeGroup {
  /** 分组 id（workspace uuid / 两个固定哨兵 id）。 */
  id: string;
  /** 组所在工作区 id；「非工作区」/「未知工作区」为 null（后者无「＋」）。 */
  workspaceId: string | null;
  name: string;
  /** 是否渲染组头「＋」（D-105：非工作区组也有；未知工作区组无法在其上新建）。 */
  canNew: boolean;
  /** 组内全部会话（视图过滤前）。 */
  sessions: AgentSessionRead[];
}

/* ────────────────────── 组件 ────────────────────── */

export function SessionListPanel(props: SessionListPanelProps) {
  // ql-20260823-003：change scope 平铺分支退役（用户要求三入口一致，D-106
  // 修订）——全部 scope 统一工作区树（change 数据仍带 change_id+workspace_id
  // 端点过滤，单组形态；组头「＋」经门户 handleNewInGroup 双传 change 上下文）。
  return <WorkspaceTreeList {...props} />;
}

/** 机器列表 + 工作区列表 + runtime→机器映射（树/平铺两分支共用数据源）。 */
function useSessionListSharedData() {
  // 机器列表（两层筛选机器 tab / 机器小节在线点 / chips 回退共用一份数据源）。
  const { items: machines } = useDaemonMachines({ limit: 100 });

  // 工作区列表（树分组 / chips 工作区名解析）。
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

  /** runtime_id → 所属机器（机器名回退 + 离线判定）。 */
  const runtimeToMachine = useMemo(() => {
    const map: RuntimeMachineIndex = new Map();
    for (const m of machines) {
      const online = m.status === "online";
      for (const r of m.runtimes ?? []) {
        map.set(r.id, { machine: m, online });
      }
    }
    return map;
  }, [machines]);

  return {
    machines,
    workspaces: workspacesQuery.data?.items ?? [],
    workspaceIdToName,
    runtimeToMachine,
  };
}

/* ────────────────────── 工作区树（全局 / workspace scope） ────────────────────── */

function WorkspaceTreeList({
  selectedSessionId,
  onSelect,
  onDeleteSessions,
  scope,
  onNewInGroup,
  defaultExpandedWorkspaceId,
}: SessionListPanelProps) {
  // 两层筛选 tab（D-107）：纯视图过滤，不进数据层（机器/智能体值都是 tab id）。
  const [filterMachineId, setFilterMachineId] = useState("");
  const [filterAgent, setFilterAgent] = useState("");
  // X-11 保留：状态下拉（组内过滤）+ 标题搜索（回车应用）——树形态同为视图过滤。
  const [status, setStatus] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [appliedQuery, setAppliedQuery] = useState("");
  // 展开态：折叠集合（null = 未交互，用渲染期默认——缺省全展开；
  // defaultExpandedWorkspaceId 给定时仅该组展开。默认在渲染期派生而非 effect
  // 落地：工作区列表晚于会话到达时分组会生长，派生值随之收敛）。
  const [collapsedIds, setCollapsedIds] = useState<Set<string> | null>(null);
  // 组头尾随多选态入口（X-11 批量删除保留；一次只在一个组内多选）。
  const [batchGroupId, setBatchGroupId] = useState<string | null>(null);
  const [checkedIds, setCheckedIds] = useState<Set<string>>(new Set());
  const [deleting, setDeleting] = useState(false);
  // 组内超 50 截断（R-03）的「显示全部」展开集合。
  const [showAllGroupIds, setShowAllGroupIds] = useState<Set<string>>(new Set());

  const { machines, workspaces, workspaceIdToName, runtimeToMachine } =
    useSessionListSharedData();

  // D-103：一次拉取 limit=500，客户端按 workspace_id 分组；workspace scope
  // 维持既有端点过滤（D-003@v2 只多传 workspace_id）。queryKey 沿用全局键
  // 结构（scope 槽位 + 参数对象），门户软删后按前缀 ["agentSessions"]
  // invalidate 继续全覆盖。
  const sessionsQuery = useQuery<AgentSessionListResponse, ApiError>({
    queryKey: [
      "agentSessions",
      "sessionsPortal",
      scope ?? null,
      { limit: AGENT_SESSIONS_TREE_FETCH_LIMIT },
    ],
    queryFn: () =>
      listAgentSessions({
        limit: AGENT_SESSIONS_TREE_FETCH_LIMIT,
        ...(scope?.workspaceId ? { workspace_id: scope.workspaceId } : {}),
        // ql-20260823-003：change 树化后端点过滤参随树透传（D-003@v2）。
        ...(scope?.kind === "change" ? { change_id: scope.changeId } : {}),
      }),
  });

  const sessions = useMemo(
    () => sessionsQuery.data?.items ?? [],
    [sessionsQuery.data],
  );
  const totalFromServer = sessionsQuery.data?.total ?? 0;

  // 分组：先按 workspace_id 分桶（不依赖名称解析——workspace scope 下端点已
  // 过滤，名称查询缺席/迟到时分组不落空）；workspace scope → 单组（名字解析
  // 失败兜底「当前工作区」）；全局 → 工作区列表序（0 会话组仍显示）+ 未知
  // 工作区桶 + 「非工作区」固定末尾组（D-105；全局形态恒渲染，含 0 会话）。
  const groups = useMemo<TreeGroup[]>(() => {
    const byWs = new Map<string, AgentSessionRead[]>();
    const none: AgentSessionRead[] = [];
    for (const s of sessions) {
      const wsId = s.workspace_id;
      if (!wsId) {
        none.push(s);
        continue;
      }
      const bucket = byWs.get(wsId);
      if (bucket) bucket.push(s);
      else byWs.set(wsId, [s]);
    }
    if (scope?.kind === "workspace") {
      return [
        {
          id: scope.workspaceId,
          workspaceId: scope.workspaceId,
          name: workspaceIdToName.get(scope.workspaceId) ?? "当前工作区",
          canNew: true,
          sessions: byWs.get(scope.workspaceId) ?? [],
        },
      ];
    }
    // ql-20260823-003：change 同款单组（端点已过滤 change_id+workspace_id，
    // 组头「＋」经门户 handleNewInGroup 双传 change 上下文）。
    if (scope?.kind === "change") {
      return [
        {
          id: scope.workspaceId,
          workspaceId: scope.workspaceId,
          name: workspaceIdToName.get(scope.workspaceId) ?? "当前工作区",
          canNew: true,
          sessions: byWs.get(scope.workspaceId) ?? [],
        },
      ];
    }
    const result: TreeGroup[] = workspaces.map((ws) => ({
      id: ws.id,
      workspaceId: ws.id,
      name: ws.name,
      canNew: true,
      sessions: byWs.get(ws.id) ?? [],
    }));
    // 工作区列表外残留的 workspace_id（如工作区已删）合并进「未知工作区」桶。
    const leftover: AgentSessionRead[] = [];
    for (const [wsId, list] of byWs) {
      if (!workspaceIdToName.has(wsId)) leftover.push(...list);
    }
    if (leftover.length > 0) {
      result.push({
        id: UNKNOWN_WORKSPACE_GROUP_ID,
        workspaceId: null,
        name: "未知工作区",
        canNew: false,
        sessions: leftover,
      });
    }
    result.push({
      id: NO_WORKSPACE_GROUP_ID,
      workspaceId: null,
      name: "非工作区",
      canNew: true,
      sessions: none,
    });
    return result;
  }, [sessions, workspaces, workspaceIdToName, scope]);

  // 视图过滤（R-05：纯视图，不进数据层）：机器 tab（+ 其下智能体 tab）、状态
  // 下拉、标题搜索。智能体层仅在选中机器后生效（与第二层 tab 出现条件一致）。
  const viewFiltered = useMemo(() => {
    const q = appliedQuery.trim().toLowerCase();
    return sessions.filter((s) => {
      if (filterMachineId) {
        if (sessionMachineRef(s, runtimeToMachine).key !== filterMachineId) {
          return false;
        }
        if (filterAgent && engineValueOf(s) !== filterAgent) return false;
      }
      if (status && s.status !== status) return false;
      if (q && !(s.title ?? "").toLowerCase().includes(q)) return false;
      return true;
    });
  }, [sessions, filterMachineId, filterAgent, status, appliedQuery, runtimeToMachine]);

  /** 分组 id → 视图过滤后条目。 */
  const visibleByGroup = useMemo(() => {
    const visible = new Set(viewFiltered);
    return new Map(
      groups.map((g) => [g.id, g.sessions.filter((s) => visible.has(s))]),
    );
  }, [groups, viewFiltered]);

  const groupIds = useMemo(() => groups.map((g) => g.id), [groups]);

  /** 当前组（R-05 展开态重置的豁免对象）：选中会话所在分组。 */
  const currentGroupId = useMemo(() => {
    if (!selectedSessionId) return null;
    return (
      groups.find((g) => g.sessions.some((s) => s.id === selectedSessionId))
        ?.id ?? null
    );
  }, [groups, selectedSessionId]);

  // 生效折叠集合：用户未交互（collapsedIds null）时用渲染期默认——缺省全展开；
  // defaultExpandedWorkspaceId 给定时仅该组展开。默认在渲染期派生而非 effect
  // 落地：工作区列表晚于会话到达时分组会生长，派生值随之收敛。
  const effectiveCollapsedIds = useMemo(() => {
    if (collapsedIds) return collapsedIds;
    if (
      defaultExpandedWorkspaceId &&
      groups.some((g) => g.id === defaultExpandedWorkspaceId)
    ) {
      return new Set(
        groups.filter((g) => g.id !== defaultExpandedWorkspaceId).map((g) => g.id),
      );
    }
    return new Set<string>();
  }, [collapsedIds, groups, defaultExpandedWorkspaceId]);

  // defaultExpandedWorkspaceId 初值见上方 effectiveCollapsedIds（渲染期派生）。

  /** R-05：筛选变化重置展开态（除当前组）与组内「显示全部」。 */
  const resetExpansionForFilter = () => {
    setShowAllGroupIds(new Set());
    setCollapsedIds(
      new Set(groupIds.filter((id) => id !== currentGroupId)),
    );
  };
  const pickMachineTab = (id: string) => {
    setFilterMachineId(id);
    setFilterAgent(""); // 第二层随第一层重置（原型 pickMachine 语义）
    resetExpansionForFilter();
  };
  const pickAgentTab = (v: string) => {
    setFilterAgent(v);
    resetExpansionForFilter();
  };

  const toggleGroup = (id: string) => {
    setCollapsedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // 组头尾随多选态入口（X-11）：一次一个组；切换清空勾选。
  const toggleGroupBatch = (id: string) => {
    setBatchGroupId((prev) => (prev === id ? null : id));
    setCheckedIds(new Set());
  };
  const toggleChecked = (id: string) => {
    setCheckedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const handleSingleDelete = (id: string, title: string) => {
    if (!onDeleteSessions || deleting) return;
    Modal.confirm({
      title: "删除会话",
      // 原型 .dlg（危险渐变图标头 + 明确影响范围文案，2026-08-23-sessions-page-style）。
      icon: (
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-destructive to-amber-500 text-white shadow-md">
          <Trash2 aria-hidden className="h-4 w-4" />
        </span>
      ),
      content: (
        <p className="mt-2 text-xs leading-5 text-muted-foreground">
          确定删除会话「{title}」吗？仅删除平台记录，本机日志文件不受影响。
        </p>
      ),
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
  const handleBatchDelete = (groupName: string) => {
    if (!onDeleteSessions || deleting || checkedIds.size === 0) return;
    Modal.confirm({
      title: "批量删除会话",
      icon: (
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-destructive to-amber-500 text-white shadow-md">
          <Trash2 aria-hidden className="h-4 w-4" />
        </span>
      ),
      content: (
        <p className="mt-2 text-xs leading-5 text-muted-foreground">
          确定删除「{groupName}」中选中的 {checkedIds.size}{" "}
          个会话吗？仅删除平台记录，本机日志文件不受影响。
        </p>
      ),
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

  const visibleTotal = viewFiltered.length;

  return (
    <div
      aria-label="会话列表"
      className="flex h-full min-h-0 flex-col overflow-hidden rounded-lg border border-border bg-card"
    >
      {/* 头部：标题 + 总数（视图过滤后计数；无筛选时 = 拉取条数） */}
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <h2 className="text-sm font-semibold text-foreground">会话</h2>
        <span className="rounded-full bg-brand-100 px-2 py-px text-[10.5px] font-semibold text-brand-700">
          共 {visibleTotal} 个
        </span>
      </div>

      {/* 筛选区：搜索（回车应用）+ 状态下拉（X-11 保留）+ 两层筛选 tab（D-107） */}
      <div className="flex flex-col gap-2 border-b border-border px-3 py-2">
        <div className="flex items-center gap-1.5">
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
          <Select
            id="slp-status"
            size="small"
            className="w-28 shrink-0"
            value={status}
            onChange={(v) => setStatus(v ?? "")}
            options={STATUS_OPTIONS.map((o) => ({ ...o }))}
          />
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="shrink-0 text-[11px] text-muted-foreground">机器</span>
          <FilterPill
            label="机器tab 全部"
            active={filterMachineId === ""}
            onClick={() => pickMachineTab("")}
          >
            全部
          </FilterPill>
          {machines.map((m) => (
            <FilterPill
              key={m.id}
              label={`机器tab ${machineLabel(m)}`}
              active={filterMachineId === m.id}
              onClick={() => pickMachineTab(m.id)}
            >
              <Monitor aria-hidden className="h-3 w-3 shrink-0" />
              {machineLabel(m)}
            </FilterPill>
          ))}
        </div>
        {/* 第二层：选中机器后出现（原型 #agentTabs display 语义）；「全部」清空智能体 */}
        {filterMachineId !== "" && (
          <div
            className="flex flex-wrap items-center gap-1.5"
            aria-label="智能体筛选层"
          >
            <span className="shrink-0 text-[11px] text-muted-foreground">
              智能体
            </span>
            <FilterPill
              label="智能体tab 全部"
              active={filterAgent === ""}
              onClick={() => pickAgentTab("")}
            >
              全部
            </FilterPill>
            {AGENT_TABS.map((t) => (
              <FilterPill
                key={t.value}
                label={`智能体tab ${t.label}`}
                active={filterAgent === t.value}
                onClick={() => pickAgentTab(t.value)}
              >
                <EngineMark provider={t.value} />
                {t.label}
              </FilterPill>
            ))}
          </div>
        )}
      </div>

      {/* 树区（分组结构 + 组内截断替代全局虚拟滚动，R-04） */}
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
      ) : (
        <div
          data-testid="session-tree"
          className="min-h-0 flex-1 overflow-y-auto p-2"
        >
          {groups.map((group) => {
            const groupVisible = visibleByGroup.get(group.id) ?? [];
            const batchActive = batchGroupId === group.id;
            const groupCheckedIds = groupVisible.filter((s) =>
              checkedIds.has(s.id),
            );
            const allChecked =
              groupVisible.length > 0 &&
              groupCheckedIds.length === groupVisible.length;
            return (
              <WorkspaceGroupNode
                key={group.id}
                group={group}
                visibleSessions={groupVisible}
                expanded={!effectiveCollapsedIds.has(group.id)}
                onToggleExpand={() => toggleGroup(group.id)}
                onNew={
                  onNewInGroup
                    ? (wsId: string | null) =>
                        // ql-20260823-001：点「＋」瞬间的筛选态随回调透出（空串=未筛）。
                        onNewInGroup(wsId, {
                          machineId: filterMachineId,
                          agent: filterAgent,
                        })
                    : undefined
                }
                batchActive={batchActive}
                onToggleBatch={() => toggleGroupBatch(group.id)}
                batchEnabled={Boolean(onDeleteSessions) && groupVisible.length > 0}
                allChecked={allChecked}
                checkedCount={groupCheckedIds.length}
                onToggleSelectAll={() =>
                  setCheckedIds(
                    allChecked
                      ? new Set()
                      : new Set(groupVisible.map((s) => s.id)),
                  )
                }
                onBatchDelete={() => handleBatchDelete(group.name)}
                deleting={deleting}
                checkedIds={checkedIds}
                onToggleChecked={toggleChecked}
                selectedSessionId={selectedSessionId}
                onSelect={onSelect}
                onDelete={
                  onDeleteSessions
                    ? (id, title) => handleSingleDelete(id, title)
                    : undefined
                }
                showAll={showAllGroupIds.has(group.id)}
                onToggleShowAll={() =>
                  setShowAllGroupIds((prev) => {
                    const next = new Set(prev);
                    if (next.has(group.id)) next.delete(group.id);
                    else next.add(group.id);
                    return next;
                  })
                }
                hideMachineTitles={filterMachineId !== ""}
                hideEngineChip={filterAgent !== ""}
                runtimeToMachine={runtimeToMachine}
              />
            );
          })}
          {visibleTotal === 0 && (
            <div className="flex items-center justify-center px-4 py-6 text-center text-xs text-muted-foreground">
              没有符合条件的会话
            </div>
          )}
          {/* R-03 提示：一次拉取上限外的余量（个人使用评估 <200，极端兜底可见） */}
          {totalFromServer > sessions.length && (
            <div className="px-2 pb-1 text-center text-[11px] text-muted-foreground">
              仅显示最近 {sessions.length} 条（共 {totalFromServer} 条）
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** 两层筛选 tab 的胶囊按钮（原型 .ftab：圆角胶囊，选中态主色描边+底色）。 */
function FilterPill({
  active,
  onClick,
  label,
  children,
}: {
  active: boolean;
  onClick: () => void;
  /** 无障碍名（两层都有「全部」，测试/读屏需锚定层级）。 */
  label: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "inline-flex min-w-0 max-w-[160px] shrink-0 items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs transition-colors",
        active
          ? "border-primary bg-primary/10 font-medium text-primary"
          : "border-border bg-muted/40 text-muted-foreground hover:border-primary/50",
      )}
    >
      <span className="min-w-0 truncate">{children}</span>
    </button>
  );
}

/** 工作区分组节点（组头手风琴 + 机器小节 + 条目，原型 .ws-group 结构）。 */
function WorkspaceGroupNode({
  group,
  visibleSessions,
  expanded,
  onToggleExpand,
  onNew,
  batchActive,
  onToggleBatch,
  batchEnabled,
  allChecked,
  checkedCount,
  onToggleSelectAll,
  onBatchDelete,
  deleting,
  checkedIds,
  onToggleChecked,
  selectedSessionId,
  onSelect,
  onDelete,
  showAll,
  onToggleShowAll,
  hideMachineTitles,
  hideEngineChip,
  runtimeToMachine,
}: {
  group: TreeGroup;
  visibleSessions: AgentSessionRead[];
  expanded: boolean;
  onToggleExpand: () => void;
  onNew?: (_workspaceId: string | null) => void;
  batchActive: boolean;
  onToggleBatch: () => void;
  batchEnabled: boolean;
  allChecked: boolean;
  checkedCount: number;
  onToggleSelectAll: () => void;
  onBatchDelete: () => void;
  deleting: boolean;
  checkedIds: ReadonlySet<string>;
  onToggleChecked: (_id: string) => void;
  selectedSessionId?: string | null;
  onSelect?: (_session: AgentSessionRead) => void;
  onDelete?: (_id: string, _title: string) => void;
  showAll: boolean;
  onToggleShowAll: () => void;
  /** 筛选态隐藏机器小节标题（FR-02：已隐含——条目按机器过滤后小节名冗余）。 */
  hideMachineTitles: boolean;
  /** ql-20260823-003：筛选智能体后条目隐藏引擎 chip（全部同引擎，冗余）。 */
  hideEngineChip: boolean;
  runtimeToMachine: RuntimeMachineIndex;
}) {
  // 组内超 50 截断（R-03）：截断作用于分组（跨机器小节），小节由可见条目派生。
  const truncated = !showAll && visibleSessions.length > GROUP_ITEM_LIMIT;
  const shownSessions = truncated
    ? visibleSessions.slice(0, GROUP_ITEM_LIMIT)
    : visibleSessions;

  // 机器小节：首现序分桶（后端按最近活跃倒序 → 最近活跃的机器排前）。
  const sections = useMemo(() => {
    const list: { key: string; label: string; online: boolean; sessions: AgentSessionRead[] }[] =
      [];
    const index = new Map<
      string,
      { key: string; label: string; online: boolean; sessions: AgentSessionRead[] }
    >();
    for (const s of shownSessions) {
      const ref = sessionMachineRef(s, runtimeToMachine);
      let sec = index.get(ref.key);
      if (!sec) {
        sec = { key: ref.key, label: ref.label, online: ref.online, sessions: [] };
        index.set(ref.key, sec);
        list.push(sec);
      }
      sec.sessions.push(s);
    }
    return list;
  }, [shownSessions, runtimeToMachine]);

  return (
    <div className="mb-2 overflow-hidden rounded-lg border border-border bg-card">
      {/* 组头：展开箭头 + Folder 图标 + 名称 + 会话数 + 「＋」新建 + 多选入口 */}
      <div
        role="button"
        tabIndex={0}
        aria-expanded={expanded}
        aria-label={`工作区分组 ${group.name}`}
        onClick={onToggleExpand}
        onKeyDown={(e) => {
          if (e.key === "Enter") onToggleExpand();
        }}
        className="group/g-head flex cursor-pointer select-none items-center gap-2 px-2.5 py-2 hover:bg-muted/40"
      >
        <span
          aria-hidden
          className={`text-[10px] text-muted-foreground transition-transform ${
            expanded ? "rotate-90" : ""
          }`}
        >
          ▶
        </span>
        <span className="flex min-w-0 flex-1 items-center gap-1.5 text-[13px] font-semibold text-foreground">
          <Folder aria-hidden className="h-3.5 w-3.5 shrink-0 text-brand-600" />
          <span className="min-w-0 truncate">{group.name}</span>
        </span>
        <span className="shrink-0 text-[11px] text-muted-foreground/80">
          {visibleSessions.length} 个会话
        </span>
        {/* 组头操作（原型 .g-acts）：展开组常显，收起组 hover/聚焦浮现——
            交互契约不变（组头＋= 新建入口 D-107，多选 X-11）。 */}
        <span
          className={cn(
            "flex shrink-0 items-center gap-1 transition-opacity",
            expanded || batchActive
              ? "opacity-100"
              : "opacity-0 group-hover/g-head:opacity-100 focus-within:opacity-100",
          )}
        >
          {group.canNew && onNew && (
            <button
              type="button"
              aria-label={`在 ${group.name} 新建会话`}
              title={`在 ${group.name} 新建会话`}
              onClick={(e) => {
                e.stopPropagation();
                onNew(group.workspaceId);
              }}
              className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-brand-300 bg-brand-100 text-brand-700 transition-colors hover:bg-brand-600 hover:text-white hover:shadow-primary"
            >
              <Plus aria-hidden className="h-3.5 w-3.5" />
            </button>
          )}
          {batchEnabled && (
            <button
              type="button"
              aria-label={`多选 ${group.name}`}
              aria-pressed={batchActive}
              onClick={(e) => {
                e.stopPropagation();
                onToggleBatch();
              }}
              className={cn(
                "flex h-6 w-6 shrink-0 items-center justify-center rounded-md border transition-colors",
                batchActive
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border bg-muted/40 text-muted-foreground hover:border-primary/50 hover:text-primary",
              )}
            >
              <ListChecks aria-hidden className="h-3.5 w-3.5" />
            </button>
          )}
        </span>
      </div>
      {expanded && (
        <div className="pb-1">
          {/* 多选态操作条：全选本组 / 删除选中（ql-20260818-012 语义随组化） */}
          {batchActive && (
            <div className="flex items-center gap-2 border-y border-border bg-muted/30 px-2.5 py-1.5">
              <Button size="small" onClick={onToggleSelectAll}>
                {allChecked ? "取消全选" : "全选本组"}
              </Button>
              <Button
                size="small"
                disabled={checkedCount === 0 || deleting}
                loading={deleting}
                onClick={onBatchDelete}
              >
                删除选中（{checkedCount}）
              </Button>
            </div>
          )}
          {sections.length === 0 ? (
            <p className="px-3 py-2 text-xs text-muted-foreground">（暂无会话）</p>
          ) : (
            sections.map((sec) => (
              <div key={sec.key} className="px-2 pb-1">
                {/* 机器小节标题：机器名 + 在线状态点（筛选态隐藏，FR-02） */}
                {!hideMachineTitles && (
                  <div
                    className="flex items-center gap-1.5 px-1.5 pb-0.5 pt-1.5 text-[11px] text-muted-foreground"
                    aria-label={`机器小节 ${sec.label}`}
                  >
                    <span
                      aria-hidden
                      className={cn(
                        "h-1.5 w-1.5 shrink-0 rounded-full",
                        sec.online
                          ? "bg-success ring-2 ring-success/20"
                          : "bg-muted-foreground/40",
                      )}
                    />
                    <span className="truncate">
                      {sec.label}
                      {sec.online ? "" : "（离线）"}
                    </span>
                  </div>
                )}
                {sec.sessions.map((s) => {
                  const title = s.title?.trim() || "未命名会话";
                  return (
                    <SessionRow
                      key={s.id}
                      variant="tree"
                      session={s}
                      title={title}
                      selected={s.id === selectedSessionId}
                      runtimeToMachine={runtimeToMachine}
                      hideEngineChip={hideEngineChip}
                      onSelect={onSelect}
                      batchMode={batchActive}
                      checked={checkedIds.has(s.id)}
                      onToggleCheck={() => onToggleChecked(s.id)}
                      onDelete={onDelete ? () => onDelete(s.id, title) : undefined}
                    />
                  );
                })}
              </div>
            ))
          )}
          {truncated && (
            <div className="border-t border-border px-3 py-1.5 text-center">
              <Button size="small" onClick={onToggleShowAll}>
                显示全部（共 {visibleSessions.length} 条）
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ────────────────────── change scope 现状平铺列表（design §3 边界 / D-106） ────────────────────── */

/* ────────────────────── 紧凑两行条目（D-006） ────────────────────── */

interface SessionRowProps {
  /** 形态：tree = 工作区树条目（chips 省工作区/机器，加创建人）；flat = 平铺列表条目（含虚拟定位）。 */
  variant: "tree" | "flat";
  session: AgentSessionRead;
  title: string;
  selected: boolean;
  runtimeToMachine: RuntimeMachineIndex;
  workspaceIdToName?: Map<string, string>;
  /** 仅 flat：虚拟滚动定位（tree 为文档流）。 */
  virtualStart?: number;
  virtualSize?: number;
  onSelect?: (_session: AgentSessionRead) => void;
  /** ql-20260818-012：批量模式/勾选/删除 */
  batchMode?: boolean;
  checked?: boolean;
  onToggleCheck?: () => void;
  onDelete?: () => void;
  /** ql-20260823-003：树形态筛选智能体后隐藏引擎 chip（全组同引擎冗余）。 */
  hideEngineChip?: boolean;
}

function SessionRow({
  variant,
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
  hideEngineChip,
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
  const engineValue = engineValueOf(session);
  // task-07（2026-08-23-agent-activity-sessions FR-08 / design §3.4）：origin=
  // tool_report 条目——标题旁 🧾「本地 Agent」徽标（brand 阶，原型
  // .badge-tool），chips 引擎位改显 harness 真实身份（D-007：创建时写入快照）。
  // title 直接用后端 title（tool_report 会话该字段即派生标题，无需特判）。
  const isToolReport = session.origin === "tool_report";
  // lib/daemon.ts 不在本卡 allowed_paths：AgentSessionConfigSnapshot 暂缺
  // harness 字段，按快照 JSON blob 直显语义本地窄化读取。
  const harnessName =
    (session.config_snapshot as { harness?: string | null } | null)?.harness ??
    "—";

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
      style={
        variant === "flat" &&
        virtualStart !== undefined &&
        virtualSize !== undefined
          ? {
              position: "absolute",
              top: 0,
              left: 0,
              width: "100%",
              height: virtualSize,
              transform: `translateY(${virtualStart}px)`,
            }
          : undefined
      }
      className={cn(
        "group flex cursor-pointer flex-col justify-center gap-1 overflow-hidden px-3 py-1.5 transition-colors",
        variant === "tree"
          ? // 树形态（原型 .s-row）：圆角行卡 + brand 选中态（brand-100 底 +
            // brand-600 竖条 + 标题 brand-700），无下边线。
            cn(
              "mb-0.5 rounded-lg border-l-[3px]",
              selected
                ? "border-l-brand-600 bg-brand-100"
                : "border-l-transparent hover:bg-muted/50",
            )
          : // 平铺形态（退役路径，原样式保留）。
            cn(
              "border-b border-border border-l-2",
              selected
                ? "border-l-primary bg-primary/5"
                : "border-l-transparent hover:bg-muted/40",
            ),
      )}
    >
      {/* 第一行：状态点 + 标题截断 + 相对时间 + 删除按钮（hover） */}
      <div className="group flex items-center gap-1.5">
        {/* 批量模式 → 勾选框替代点击选会话 */}
        {batchMode ? (
          <input
            type="checkbox"
            checked={checked ?? false}
            onChange={onToggleCheck}
            aria-label={`勾选 ${title}`}
            className="h-3.5 w-3.5 shrink-0 accent-brand-600"
          />
        ) : (
          <span
            className={`h-1.5 w-1.5 shrink-0 rounded-full ${statusDotClass(session.status)}`}
            aria-label={`状态 ${session.status}`}
          />
        )}
        {/* task-07：tool_report 标题旁 FileText「本地 Agent」徽标（原型
            .badge-tool：brand 阶，图标线性化 2026-08-24）。 */}
        <span className="flex min-w-0 flex-1 items-center gap-1">
          <span
            className={cn(
              "min-w-0 truncate text-[13px] font-medium",
              variant === "tree" && selected
                ? "text-brand-700"
                : "text-foreground",
            )}
          >
            {title}
          </span>
          {isToolReport && (
            <span
              title="由 SillySpec CLI 自动上报创建的本地 Agent 会话"
              data-testid="tool-report-badge"
              className="inline-flex shrink-0 items-center gap-0.5 rounded-full border border-brand-600 bg-brand-100 px-1.5 py-px text-[10px] font-medium leading-4 text-brand-700"
            >
              <FileText aria-hidden className="h-2.5 w-2.5" />
              本地 Agent
            </span>
          )}
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
      {/* 第二行（树形态=2026-08-23 原型 .r2 降噪版）：引擎身份 chip
          （claude=warning 金 / codex=brand 紫 / tool_report harness=info 青）
          + 创建人/档案/供应商/轮数纯文本 meta（title 悬停全量）；工作区/机器
          由组头与机器小节承载不重复。平铺形态（退役路径）保留原 antd Tag 集。 */}
      <div
        className={cn(
          "flex items-center gap-1.5 pl-3",
          variant === "tree"
            ? "min-w-0 overflow-hidden whitespace-nowrap"
            : "flex-wrap",
        )}
      >
        {variant === "flat" &&
          session.workspace_id &&
          workspaceIdToName?.has(session.workspace_id) && (
            <Tag
              title={workspaceIdToName.get(session.workspace_id)}
              className="m-0 max-w-[120px] truncate rounded-sm px-1 py-0 text-[10px] leading-4"
              color="cyan"
            >
              <FolderOpen aria-hidden className="mr-0.5 inline h-3 w-3" />
              {workspaceIdToName.get(session.workspace_id)}
            </Tag>
          )}
        {variant === "flat" && machineName && (
          <Tag
            title={machineOffline ? `${machineName}（离线）` : machineName}
            className={`m-0 max-w-[120px] truncate rounded-sm px-1 py-0 text-[10px] leading-4 ${
              machineOffline ? "line-through opacity-60" : ""
            }`}
          >
            <Monitor aria-hidden className="mr-0.5 inline h-3 w-3" />
            {machineName}
            {machineOffline ? "（离线）" : ""}
          </Tag>
        )}
        {!hideEngineChip && (
          <span
            className={cn(
              "inline-flex h-4 shrink-0 items-center rounded px-1.5 text-[10px] font-semibold leading-none",
              isToolReport
                ? "bg-info/10 text-info"
                : engineValue === "codex"
                  ? "bg-brand-100 text-brand-700"
                  : "bg-warning/15 text-warning",
            )}
          >
            {isToolReport ? harnessName : engineLabel(engineValue)}
          </span>
        )}
        {variant === "tree" ? (
          <span
            className="flex min-w-0 items-center gap-2 overflow-hidden whitespace-nowrap text-[10px] leading-4 text-muted-foreground/80"
            title={[
              `${session.owner_name ?? "—"}`,
              snapshot?.profile_name ?? null,
              snapshot?.provider_name ?? null,
              `${session.turn_count} 轮`,
            ]
              .filter(Boolean)
              .join(" · ")}
          >
            <span className="inline-flex min-w-0 items-center gap-0.5">
              <User aria-hidden className="h-3 w-3 shrink-0" />
              <span className="truncate">{session.owner_name ?? "—"}</span>
            </span>
            {snapshot?.profile_name && (
              <span className="inline-flex min-w-0 items-center gap-0.5">
                <BookUser aria-hidden className="h-3 w-3 shrink-0" />
                <span className="truncate">{snapshot.profile_name}</span>
              </span>
            )}
            {snapshot?.provider_name && (
              <span className="inline-flex min-w-0 items-center gap-0.5">
                <Cloud aria-hidden className="h-3 w-3 shrink-0" />
                <span className="truncate">{snapshot.provider_name}</span>
              </span>
            )}
            <span className="shrink-0">{session.turn_count} 轮</span>
          </span>
        ) : (
          <>
            {snapshot?.profile_name && (
              <Tag
                title={snapshot.profile_name}
                className="m-0 max-w-[150px] truncate rounded-sm px-1 py-0 text-[10px] leading-4"
                color="blue"
              >
                <BookUser aria-hidden className="mr-0.5 inline h-3 w-3" />
                {snapshot.profile_name}
              </Tag>
            )}
            {snapshot?.provider_name && (
              <Tag
                title={snapshot.provider_name}
                className="m-0 max-w-[130px] truncate rounded-sm px-1 py-0 text-[10px] leading-4"
              >
                <Cloud aria-hidden className="mr-0.5 inline h-3 w-3" />
                {snapshot.provider_name}
              </Tag>
            )}
            <Tag className="m-0 shrink-0 rounded-sm px-1 py-0 text-[10px] leading-4">
              {session.turn_count} 轮
            </Tag>
          </>
        )}
      </div>
    </div>
  );
}
