"use client";

/**
 * 知识图谱页（/workspaces/[id]/knowledge/graph）——task-07 /
 * 2026-10-08-platform-knowledge-graph / FR-05 / FR-06 / D-002@v1 / D-003@v1 /
 * D-006@v1 / D-008@v2。
 *
 * 三栏直译归档原型（sillyspec 仓 archive/2026-10-08-knowledge-graph/
 * prototype-knowledge-graph.html）+ lite 数据面扩展（原型未覆盖新面，R-04）：
 *
 *   - 左 300px：数据面胶囊（总览 lite / 查询切片——D-008@v2 状态机：执行查询或
 *     点代表节点自动切切片，胶囊手动回 lite；summary=null 旧 CLI 时 lite 胶囊
 *     隐藏）+ 查询表单（sub 七值默认 orphans / anchor·anchor2 补全输入 /
 *     edges all+16 型 / depth 1-3）+ 等价 CLI 提示条（黑底等宽动态拼）+
 *     预置演示六胶囊 + 图例（节点 10 类型与边 16 型三档点击高亮）；
 *   - 中：GraphCanvas（task-06）+ mode-chip（查询标题 · 引擎 · 节点数）；
 *   - 右 340px 三 tab：节点详情（色点/类型 chip/按边型分组出入邻居，行点击跳选；
 *     entry 类节点深链 /knowledge?file=&anchor=，page.tsx:274-279 惯例）/
 *     查询结果（ok/warn 左条结果卡；path 不可达 reason + 强边寻路注记；
 *     orphans/dangling top-50 清单 + count 口径）/ 使用说明简版。
 *
 * 默认视图（D-006）：overview 可用即自动发起 orphans（warn 红环 + 右栏孤儿清单
 * + mode-chip「orphans · 孤儿节点」）；?preset=orphans|dangling 深链（ops 图卡
 * 清单行跳转目标）按 preset 发起。
 *
 * unavailable（D-001@v2 六稳定键）：全页降级卡复用 ops-dashboard 的
 * graphReasonText 六键文案；unbound 附「去绑定」入口（runtime 页）；
 * isPending 骨架。锚点补全（D-005@v1）：debounce 300ms 调 nodes 端点，
 * 旧 CLI 信封 unavailable / 请求失败 → 静默禁用补全（不阻塞自由输入）。
 *
 * 主题铁律（D-003）：节点色点经 nodePalette(theme)（themes.ts 单一源），
 * 卡片/边框/文字全主题 token；唯一硬编码色面是 CLI 提示条的终端黑底
 * （bg-slate-900，login 页终端图标先例——CLI 语义色非品牌用途）。
 */

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Input, Select } from "antd";

import { PageContainer, PageHeader } from "@/components/layout";
import {
  GraphCanvas,
  NODE_TYPE_ORDER,
  edgeDash,
  graphEdgeKey,
  nodePalette,
  nodeTypeIndex,
  strengthOf,
} from "@/components/knowledge/graph-canvas";
import { graphReasonText } from "@/components/knowledge/ops-dashboard";
import { buttonVariants, Button } from "@/components/ui/button";
import {
  getKnowledgeGraphNodes,
  getKnowledgeGraphOverview,
  getKnowledgeGraphQuery,
  type GraphEdge,
  type GraphNodeRef,
  type GraphQueryOut,
  type GraphSub,
} from "@/lib/knowledge";
import {
  knowledgeGraphNodesQueryKey,
  knowledgeGraphOverviewQueryKey,
  knowledgeGraphQueryKey,
} from "@/lib/query-keys";
import { cn } from "@/lib/utils";
import { useThemeStore } from "@/stores/theme";

// ── 常量：sub / 边型 / 节点类型标签 / 预置演示 ─────────────────────────────

/** sub 七值（五查询主链路 + summary/nodes 直通）中文说明。 */
const SUB_OPTIONS: ReadonlyArray<{ value: GraphSub; label: string }> = [
  { value: "orphans", label: "orphans · 孤儿节点" },
  { value: "dangling", label: "dangling · 悬空引用" },
  { value: "neighbors", label: "neighbors · 一跳邻域" },
  { value: "impact", label: "impact · 变更影响面" },
  { value: "path", label: "path · 强边寻路" },
  { value: "summary", label: "summary · 全图聚合" },
  { value: "nodes", label: "nodes · 节点搜索" },
];

/** 需要锚点的 sub（执行按钮缺锚点禁用）。 */
const SUB_NEEDS_ANCHOR: ReadonlySet<string> = new Set([
  "neighbors",
  "impact",
  "path",
  "nodes",
]);

/**
 * 16 边型三档强度（CLI knowledge-graph.js EDGE_STRENGTH 键集的硬拷贝，与
 * daemon KNOWLEDGE_GRAPH_EDGES 白名单同源——CLI 加边型时三处同步）。
 */
const EDGE_TYPES: ReadonlyArray<{
  value: string;
  label: string;
  strength: "strong" | "medium" | "weak";
}> = [
  { value: "module-dep", label: "depends_on", strength: "strong" },
  { value: "module-files", label: "paths", strength: "strong" },
  { value: "anchors", label: "锚点/文件", strength: "strong" },
  { value: "supersedes", label: "supersedes/承接", strength: "strong" },
  { value: "from-change", label: "变更/来源", strength: "strong" },
  { value: "belongs-module", label: "域", strength: "strong" },
  { value: "deliverables", label: "交付清单", strength: "strong" },
  { value: "change-modules", label: "模块域", strength: "strong" },
  { value: "test-binding", label: "测试绑定", strength: "strong" },
  { value: "describes", label: "doc: 字段", strength: "strong" },
  { value: "changelog-of", label: "文件名派生", strength: "strong" },
  { value: "changelog-entry", label: "changelog 行", strength: "strong" },
  { value: "doc-refs", label: "正文路径提取", strength: "medium" },
  { value: "scan-refs", label: "正文路径提取", strength: "medium" },
  { value: "route", label: "INDEX 路由行", strength: "weak" },
  { value: "entry-link", label: "关联（预留）", strength: "weak" },
];

const EDGE_STRENGTH_LABEL: Readonly<Record<"strong" | "medium" | "weak", string>> = {
  strong: "强",
  medium: "中",
  weak: "弱",
};

/** 节点 10 类型中文标签（原型 NT.l 逐项一致；未知类型回退原值）。 */
const NODE_TYPE_LABELS: Readonly<Record<string, string>> = {
  project: "项目",
  module: "模块",
  file: "代码文件",
  test: "测试文件",
  decision: "决策 D-xxx",
  fr: "需求 FR",
  change: "变更",
  entry: "手册条目",
  doc: "文档",
  ql: "quicklog",
};

/**
 * 预置演示六胶囊（原型 presets 直译；锚点换本仓真实样例——当前变更名 /
 * FR 样例 / decision:decisions/unmapped.md#D-002@v1 → frontend 模块 /
 * 本仓前端文件反查）。CLI 模糊解析兜底：锚点未命中由查询结果态呈现。
 */
const PRESETS: ReadonlyArray<{
  label: string;
  sub: GraphSub;
  anchor?: string;
  anchor2?: string;
}> = [
  {
    label: "impact · 变更影响面",
    sub: "impact",
    anchor: "2026-10-08-platform-knowledge-graph",
  },
  { label: "neighbors · FR 一跳", sub: "neighbors", anchor: "FR-core-engine-001" },
  {
    label: "path · 决策→模块",
    sub: "path",
    anchor: "decision:decisions/unmapped.md#D-002@v1",
    anchor2: "frontend",
  },
  { label: "orphans · 孤儿条目", sub: "orphans" },
  { label: "dangling · 悬空引用", sub: "dangling" },
  {
    label: "文件反查 · neighbors",
    sub: "neighbors",
    anchor: "frontend/src/lib/knowledge.ts",
  },
];

/** 查询态（表单 draft 与已执行 active 分离——draft 逐键变化不触发查询）。 */
interface GraphQueryState {
  sub: GraphSub;
  anchor: string;
  anchor2: string;
  edges: string;
  depth: number;
}

const DEFAULT_QUERY: GraphQueryState = {
  sub: "orphans",
  anchor: "",
  anchor2: "",
  edges: "all",
  depth: 1,
};

/** active=null 时的占位查询键（enabled=false 恒不发起）。 */
const GRAPH_QUERY_NONE_KEY = ["knowledgeGraph", "query", "none"] as const;

// ── 稳定空常量（GraphCanvas 以 nodes/edges/clusters 的 identity 变化判定新切片）──
const EMPTY_NODES: GraphNodeRef[] = [];
const EMPTY_EDGES: GraphEdge[] = [];
const EMPTY_SET: ReadonlySet<string> = new Set();

/** 画布切片视图（lite 模式不用；warnIds=orphans/dangling 红环集）。 */
interface SliceView {
  nodes: GraphNodeRef[];
  edges: GraphEdge[];
  warnIds: ReadonlySet<string>;
}

const EMPTY_SLICE: SliceView = { nodes: EMPTY_NODES, edges: EMPTY_EDGES, warnIds: EMPTY_SET };

function asArray<T>(v: unknown): T[] {
  return Array.isArray(v) ? (v as T[]) : [];
}

function refOf(id: string, type?: string, label?: string): GraphNodeRef {
  return { id, type: type ?? "", label: label ?? id };
}

/**
 * 查询信封 data（按 sub 分型联合）→ 画布切片。运行时防御（旧后端形状漂移回退
 * 空切片不崩）：impact/path 的 closure/hops 是 CLI 实际形状的 id 数组（D-007@v1
 * 归一口径），节点类型未知时中性色展示；path 边恒按强边（强边子集寻路语义）。
 */
function sliceFromQuery(sub: GraphSub, data: GraphQueryOut["data"]): SliceView {
  if (!data) return EMPTY_SLICE;
  if (sub === "neighbors" && "anchor" in data) {
    return {
      nodes: asArray<GraphNodeRef>(data.nodes),
      edges: asArray<GraphEdge>(data.edges),
      warnIds: EMPTY_SET,
    };
  }
  if (sub === "orphans" && "items" in data) {
    const items = asArray<{ id: string; type?: string }>(data.items);
    const nodes = items.map((it) => refOf(it.id, it.type));
    return {
      nodes,
      edges: EMPTY_EDGES,
      warnIds: new Set(nodes.map((n) => n.id)),
    };
  }
  if (sub === "dangling" && "items" in data) {
    // dangling 条目的 type 是边型（引用方节点的节点类型未知）→ 中性色点。
    const items = asArray<{ id: string }>(data.items);
    const nodes = items.map((it) => refOf(it.id));
    return {
      nodes,
      edges: EMPTY_EDGES,
      warnIds: new Set(nodes.map((n) => n.id)),
    };
  }
  if (sub === "impact" && "closure" in data) {
    const byId = new Map<string, GraphNodeRef>();
    for (const id of asArray<string>(data.closure)) byId.set(id, refOf(id));
    for (const d of asArray<{ id: string; type?: string }>(data.decisions_and_frs)) {
      byId.set(d.id, refOf(d.id, d.type));
    }
    for (const r of asArray<{ id: string; title?: string }>(data.rejected_reachable)) {
      byId.set(r.id, refOf(r.id, "decision", r.title || r.id));
    }
    return { nodes: [...byId.values()], edges: EMPTY_EDGES, warnIds: EMPTY_SET };
  }
  if (sub === "path" && "hops" in data) {
    const hops = asArray<{ s: string; t: string; type: string }>(data.hops);
    if (!data.found) {
      return {
        nodes: [refOf(data.from), refOf(data.to)],
        edges: EMPTY_EDGES,
        warnIds: EMPTY_SET,
      };
    }
    const byId = new Map<string, GraphNodeRef>();
    byId.set(data.from, refOf(data.from));
    for (const h of hops) {
      byId.set(h.s, refOf(h.s));
      byId.set(h.t, refOf(h.t));
    }
    return {
      nodes: [...byId.values()],
      edges: hops.map((h) => ({ s: h.s, t: h.t, type: h.type, strength: "strong" })),
      warnIds: EMPTY_SET,
    };
  }
  // summary / nodes：结果仅在右栏呈现，画布空切片。
  return EMPTY_SLICE;
}

/** 查询态 → mode-chip 标题（orphans 钉死「orphans · 孤儿节点」，D-006）。 */
function subTitle(q: GraphQueryState): string {
  switch (q.sub) {
    case "neighbors":
      return `neighbors · ${q.anchor || "—"}`;
    case "impact":
      return `impact · ${q.anchor || "—"}`;
    case "path":
      return `path · ${q.anchor || "—"} → ${q.anchor2 || "—"}`;
    case "dangling":
      return "dangling · 悬空引用";
    case "summary":
      return "summary · 全图聚合";
    case "nodes":
      return `nodes · ${q.anchor || "—"}`;
    case "orphans":
    default:
      return "orphans · 孤儿节点";
  }
}

/**
 * entry 节点 id → 知识库深链 href（?file=&anchor=，knowledge/page.tsx:274-279
 * 深链惯例）。entry id 形如 ``<file>#<slug>``（缺 # 时整串作 file）；兼容
 * ``entry:`` 前缀形态。
 */
function entryKnowledgeHref(workspaceId: string, nodeId: string): string {
  let id = nodeId;
  if (id.startsWith("entry:")) id = id.slice("entry:".length);
  const hash = id.lastIndexOf("#");
  const file = hash >= 0 ? id.slice(0, hash) : id;
  const anchor = hash >= 0 ? id.slice(hash + 1) : "";
  const qs = new URLSearchParams();
  qs.set("file", file);
  if (anchor) qs.set("anchor", anchor);
  return `/workspaces/${workspaceId}/knowledge?${qs.toString()}`;
}

// ── 锚点补全输入（debounce 300ms 调 nodes 端点；不可用静默禁用）──────────────

/**
 * AnchorInput —— antd Input + 自绘下拉候选（id + 类型徽标）。D-005@v1 能力
 * 探测：信封 available=false（旧 CLI）或请求失败 → acDead 置位后不再发起，
 * 不报错不阻塞自由输入（CLI 模糊解析兜底）。候选点击 onMouseDown
 * preventDefault 防 blur 先于 click 吞事件。
 */
function AnchorInput({
  workspaceId,
  value,
  onChange,
  onEnter,
  placeholder,
  testId,
}: {
  workspaceId: string;
  value: string;
  onChange: (_v: string) => void;
  onEnter?: () => void;
  placeholder?: string;
  testId: string;
}) {
  const [debounced, setDebounced] = useState("");
  const [open, setOpen] = useState(false);
  const [acDead, setAcDead] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(value.trim()), 300);
    return () => clearTimeout(t);
  }, [value]);

  const nodesQ = useQuery({
    queryKey: knowledgeGraphNodesQueryKey(workspaceId, debounced),
    queryFn: () => getKnowledgeGraphNodes(workspaceId, debounced, 8),
    enabled: !acDead && debounced !== "",
  });

  // 能力探测：unavailable / 失败 → 静默禁用（一次性置位，之后不再探测）。
  useEffect(() => {
    if (nodesQ.data && !nodesQ.data.available) setAcDead(true);
    if (nodesQ.isError) setAcDead(true);
  }, [nodesQ.data, nodesQ.isError]);

  const candidates = nodesQ.data?.data?.nodes ?? [];
  const showList = open && !acDead && candidates.length > 0;

  return (
    <div className="relative">
      <Input
        allowClear
        data-testid={testId}
        aria-label={placeholder}
        placeholder={placeholder}
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onPressEnter={() => {
          setOpen(false);
          onEnter?.();
        }}
      />
      {showList ? (
        <div
          data-testid={`${testId}-options`}
          className="absolute left-0 right-0 top-full z-30 mt-1 max-h-56 overflow-y-auto rounded-md border border-border bg-card p-1 shadow-lg"
        >
          {candidates.map((c) => (
            <button
              key={c.id}
              type="button"
              data-testid="anchor-option"
              className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-xs hover:bg-brand-50/70"
              // mousedown 先于 input blur；阻止默认保住点击再落值。
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                onChange(c.id);
                setOpen(false);
              }}
            >
              <span className="shrink-0 rounded-full bg-brand-50 px-1.5 py-0.5 text-[10px] font-bold text-brand-700">
                {NODE_TYPE_LABELS[c.type] ?? c.type ?? "节点"}
              </span>
              <span className="min-w-0 flex-1 truncate font-mono text-[11px]" title={c.id}>
                {c.id}
              </span>
              {c.label && c.label !== c.id ? (
                <span className="max-w-[40%] shrink-0 truncate text-[10px] text-muted-foreground">
                  {c.label}
                </span>
              ) : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/** 强度档 chip（图例/邻居分组/边型下拉共用）。 */
function StrengthChip({ strength }: { strength: "strong" | "medium" | "weak" }) {
  return (
    <span
      className={cn(
        "shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-bold leading-4",
        strength === "strong"
          ? "bg-brand-50 text-brand-700"
          : strength === "medium"
            ? "bg-warning/15 text-warning"
            : "bg-muted text-muted-foreground",
      )}
    >
      {EDGE_STRENGTH_LABEL[strength]}
    </span>
  );
}

// ── 页面 ────────────────────────────────────────────────────────────────────

interface Props {
  params: { id: string };
}

export default function KnowledgeGraphPage({ params }: Props) {
  const workspaceId = params.id;
  const searchParams = useSearchParams();
  const theme = useThemeStore((s) => s.theme);
  /** 图例/详情色点：themes.ts 单一源（GraphCanvas 注入同一组 CSS 变量）。 */
  const palette = useMemo(() => nodePalette(theme), [theme]);

  // ── 数据链：overview（lite 数据面 + 页面可用性门）与查询切片 ──────────────
  const overviewQ = useQuery({
    queryKey: knowledgeGraphOverviewQueryKey(workspaceId),
    queryFn: () => getKnowledgeGraphOverview(workspaceId),
  });
  const overviewData = overviewQ.data?.available ? overviewQ.data.data ?? null : null;
  const summary = overviewData?.summary ?? null;

  const [draft, setDraft] = useState<GraphQueryState>(DEFAULT_QUERY);
  /** 已执行查询（null=未发起；发起即切切片模式）。 */
  const [active, setActive] = useState<GraphQueryState | null>(null);
  /** lite ↔ 切片状态机（D-008@v2）：查询/点代表→slice；胶囊手动→lite。 */
  const [dataMode, setDataMode] = useState<"lite" | "slice">("slice");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [rightTab, setRightTab] = useState<"detail" | "result" | "help">("result");
  const [legendNodeType, setLegendNodeType] = useState<string | null>(null);
  const [legendEdgeType, setLegendEdgeType] = useState<string | null>(null);
  const [fitSignal, setFitSignal] = useState(0);
  const [layoutInfo, setLayoutInfo] = useState<{
    engine: "force" | "static" | "lite";
    nodeCount: number;
  } | null>(null);

  /** 执行查询：钉 active + 切切片 + 清选区/图例 + 右栏切结果 tab + draft 同步。 */
  const runQuery = useCallback((q: GraphQueryState) => {
    setDraft(q);
    setActive(q);
    setDataMode("slice");
    setSelectedId(null);
    setLegendNodeType(null);
    setLegendEdgeType(null);
    setRightTab("result");
  }, []);

  /** lite 代表节点下钻：以该节点为锚点发起 neighbors（D-008@v2 状态机）。 */
  const runNeighbors = useCallback(
    (anchor: string) => {
      runQuery({ ...DEFAULT_QUERY, sub: "neighbors", anchor });
    },
    [runQuery],
  );

  // 默认视图（D-006）：overview 可用即自动发起（?preset=dangling 深链优先，
  // 缺省 orphans）——只在首次可用落定时执行一次（bootstrappedRef 守卫）。
  const bootstrappedRef = useRef(false);
  useEffect(() => {
    if (bootstrappedRef.current || !overviewQ.data?.available) return;
    bootstrappedRef.current = true;
    const preset = searchParams.get("preset");
    const sub: GraphSub = preset === "dangling" ? "dangling" : "orphans";
    runQuery({ ...DEFAULT_QUERY, sub });
    // runQuery 稳定（setState-only）；searchParams 仅首载消费一次。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [overviewQ.data, runQuery]);

  // ── 查询切片数据链（active 进 key；norm 参数与 key 同源）─────────────────
  const activeParams = useMemo(() => {
    if (!active) return null;
    return {
      sub: active.sub,
      anchor: active.anchor.trim() || undefined,
      anchor2: active.anchor2.trim() || undefined,
      edges: active.edges !== "all" ? active.edges : undefined,
      depth: active.depth !== 1 ? active.depth : undefined,
    };
  }, [active]);

  const queryQ = useQuery({
    queryKey: activeParams
      ? knowledgeGraphQueryKey(
          workspaceId,
          activeParams.sub,
          activeParams.anchor,
          activeParams.anchor2,
          activeParams.edges,
          activeParams.depth,
        )
      : GRAPH_QUERY_NONE_KEY,
    queryFn: () =>
      getKnowledgeGraphQuery(workspaceId, activeParams!.sub, {
        anchor: activeParams!.anchor,
        anchor2: activeParams!.anchor2,
        edges: activeParams!.edges,
        depth: activeParams!.depth,
      }),
    enabled: activeParams != null,
  });

  const slice = useMemo(
    () =>
      activeParams && queryQ.data
        ? sliceFromQuery(activeParams.sub, queryQ.data.data)
        : EMPTY_SLICE,
    [activeParams, queryQ.data],
  );
  const nodeMap = useMemo(() => new Map(slice.nodes.map((n) => [n.id, n] as const)), [slice]);
  const clusters = useMemo(() => summary?.clusters ?? [], [summary]);

  // ── 高亮集：选中一跳邻域 ∪ 图例节点类型 ∪ 图例边型（原型语义合并）────────
  const highlight = useMemo(() => {
    const nodeIds = new Set<string>();
    const edgeKeys = new Set<string>();
    if (selectedId) {
      nodeIds.add(selectedId);
      for (const e of slice.edges) {
        if (e.s === selectedId || e.t === selectedId) {
          edgeKeys.add(graphEdgeKey(e.s, e.t, e.type));
          nodeIds.add(e.s);
          nodeIds.add(e.t);
        }
      }
    }
    if (legendNodeType) {
      for (const n of slice.nodes) {
        if (n.type === legendNodeType) nodeIds.add(n.id);
      }
    }
    if (legendEdgeType) {
      for (const e of slice.edges) {
        if (e.type === legendEdgeType) {
          edgeKeys.add(graphEdgeKey(e.s, e.t, e.type));
          nodeIds.add(e.s);
          nodeIds.add(e.t);
        }
      }
    }
    if (nodeIds.size === 0 && edgeKeys.size === 0) return null;
    return { nodeIds, edgeKeys };
  }, [selectedId, legendNodeType, legendEdgeType, slice]);

  // 选中节点出入邻居（dir/edge_type 从 edges[] 派生，s→t 定方向）。
  const neighborGroups = useMemo(() => {
    if (!selectedId) return [];
    const groups = new Map<
      string,
      { type: string; rows: { other: string; dir: "出" | "入" }[] }
    >();
    for (const e of slice.edges) {
      if (e.s === selectedId || e.t === selectedId) {
        const g = groups.get(e.type) ?? { type: e.type, rows: [] };
        if (e.s === selectedId) g.rows.push({ other: e.t, dir: "出" });
        if (e.t === selectedId) g.rows.push({ other: e.s, dir: "入" });
        groups.set(e.type, g);
      }
    }
    return [...groups.values()];
  }, [selectedId, slice]);

  /** 画布节点选择：lite 模式代表节点=下钻 neighbors；切片模式=选中看详情。 */
  const handleCanvasSelect = useCallback(
    (id: string | null) => {
      if (dataMode === "lite") {
        if (id) runNeighbors(id);
        return;
      }
      setSelectedId(id);
      if (id) setRightTab("detail");
    },
    [dataMode, runNeighbors],
  );

  const goLite = useCallback(() => {
    setDataMode("lite");
    setSelectedId(null);
    setLegendNodeType(null);
    setLegendEdgeType(null);
    setRightTab("result");
  }, []);

  const engineText =
    layoutInfo?.engine === "static"
      ? "静态布局"
      : layoutInfo?.engine === "lite"
        ? "lite 总览"
        : "力场";
  const chipText =
    dataMode === "lite"
      ? `总览 lite · ${clusters.length} 簇 · 代表为度数前 5`
      : `${active ? subTitle(active) : "查询切片"}${
          layoutInfo ? ` · ${layoutInfo.nodeCount} 节点 · ${engineText}` : ""
        }`;

  // CLI 提示条（黑底等宽，动态拼当前 draft；非缺省旗标才出现）。
  const cliCommand = useMemo(() => {
    const parts = ["sillyspec", "knowledge", "graph", draft.sub];
    if (draft.anchor.trim()) parts.push(`"${draft.anchor.trim()}"`);
    if (draft.sub === "path" && draft.anchor2.trim()) parts.push(`"${draft.anchor2.trim()}"`);
    if (draft.edges !== "all") parts.push(`--edges ${draft.edges}`);
    if (draft.depth !== 1) parts.push(`--depth ${draft.depth}`);
    parts.push("--json");
    return parts.join(" ");
  }, [draft]);

  const canRun = !(SUB_NEEDS_ANCHOR.has(draft.sub) && draft.anchor.trim() === "");
  const runDraft = useCallback(() => {
    if (SUB_NEEDS_ANCHOR.has(draft.sub) && draft.anchor.trim() === "") return;
    runQuery(draft);
  }, [draft, runQuery]);

  const selectedNode = selectedId ? nodeMap.get(selectedId) ?? null : null;

  // ── 全页三态：isPending 骨架 / unavailable 六键降级 / 可用三栏 ────────────
  if (overviewQ.isPending) {
    return (
      <PageContainer size="full">
        <PageHeader title="知识图谱" subtitle="知识图完整性 · 与 CLI 同源单源真相" />
        <div
          data-testid="graph-page-loading"
          className="flex min-h-[420px] flex-col gap-3 lg:h-[calc(100vh-240px)] lg:flex-row"
        >
          <div className="hidden w-[300px] shrink-0 animate-pulse rounded-lg border border-border bg-muted/40 lg:block" />
          <div className="flex min-h-[320px] flex-1 animate-pulse items-center justify-center rounded-lg border border-border bg-muted/40 text-xs text-muted-foreground">
            知识图数据加载中…
          </div>
          <div className="hidden w-[340px] shrink-0 animate-pulse rounded-lg border border-border bg-muted/40 lg:block" />
        </div>
      </PageContainer>
    );
  }

  const unavailableReason: string | null = overviewQ.isError
    ? "rpc_error"
    : overviewQ.data && !overviewQ.data.available
      ? overviewQ.data.reason ?? "rpc_error"
      : null;
  if (unavailableReason != null) {
    return (
      <PageContainer size="full">
        <PageHeader title="知识图谱" subtitle="知识图完整性 · 与 CLI 同源单源真相" />
        <div
          data-testid="graph-page-unavailable"
          data-reason={unavailableReason}
          className="rounded-lg border border-border bg-card px-4 py-10 text-center shadow-sm"
        >
          <p className="text-2xl" aria-hidden>
            🧭
          </p>
          <p className="mt-2 text-sm font-semibold">知识图暂不可用</p>
          <p
            data-testid="graph-unavailable-reason"
            className="mx-auto mt-1.5 max-w-md text-xs leading-5 text-muted-foreground"
          >
            {graphReasonText(unavailableReason)}
          </p>
          {unavailableReason === "unbound" ? (
            <Link
              href={`/workspaces/${workspaceId}/runtime`}
              data-testid="graph-unbound-link"
              className={cn(buttonVariants({ variant: "default" }), "mt-4")}
            >
              去绑定 daemon 运行时
            </Link>
          ) : null}
        </div>
      </PageContainer>
    );
  }

  const lite = dataMode === "lite";
  const queryEnvelope = queryQ.data;

  return (
    <PageContainer size="full">
      <PageHeader
        title={
          <span>
            <Link
              href={`/workspaces/${workspaceId}`}
              className="text-[11px] font-normal text-muted-foreground hover:underline"
            >
              ← 工作空间
            </Link>
            <span className="mt-0.5 block">知识图谱</span>
          </span>
        }
        subtitle="知识图完整性 · 与 CLI 同源单源真相（解析时内存派生）"
        actions={
          <Button
            variant="outline"
            data-testid="graph-fit-btn"
            onClick={() => setFitSignal((n) => n + 1)}
          >
            适配视图
          </Button>
        }
      />

      <div className="flex min-h-[560px] flex-col gap-3 lg:h-[calc(100vh-235px)] lg:flex-row">
        {/* ── 左栏 300px：数据面 / 查询表单 / 预置演示 / 图例 ── */}
        <div className="flex w-full shrink-0 flex-col gap-3 overflow-y-auto lg:w-[300px]">
          {/* 数据面胶囊（D-008@v2 状态机；summary=null 旧 CLI 时 lite 胶囊隐藏） */}
          <div className="rounded-lg border border-border bg-card p-3 shadow-sm">
            <div className="mb-2 flex items-baseline justify-between">
              <span className="text-xs font-bold">🗂 数据面</span>
              <span className="text-[10px] text-muted-foreground/70">daemon-rpc 单源</span>
            </div>
            <div className="flex gap-1.5" role="group" aria-label="数据面模式">
              {summary ? (
                <button
                  type="button"
                  data-testid="mode-capsule-lite"
                  aria-pressed={lite}
                  onClick={goLite}
                  className={cn(
                    "rounded-full border px-2.5 py-1 text-[11px] transition-colors",
                    lite
                      ? "border-brand-400 bg-brand-50 font-semibold text-brand-700"
                      : "border-border text-muted-foreground hover:border-brand-300 hover:text-brand-700",
                  )}
                >
                  总览 lite
                </button>
              ) : null}
              <button
                type="button"
                data-testid="mode-capsule-slice"
                aria-pressed={!lite}
                onClick={() => setDataMode("slice")}
                className={cn(
                  "rounded-full border px-2.5 py-1 text-[11px] transition-colors",
                  !lite
                    ? "border-brand-400 bg-brand-50 font-semibold text-brand-700"
                    : "border-border text-muted-foreground hover:border-brand-300 hover:text-brand-700",
                )}
              >
                查询切片
              </button>
            </div>
            <p className="mt-2 text-[10.5px] leading-4 text-muted-foreground/80">
              {lite
                ? `全图 ${summary ? `${summary.nodes} 节点 · ${summary.edges} 边` : ""}——簇气泡代表节点为度数前 5，点击代表下钻 neighbors`
                : "切片查询驱动 · 力场上限 200 节点，超限确定性静态布局"}
            </p>
          </div>

          {/* 查询表单 */}
          <div className="rounded-lg border border-border bg-card p-3 shadow-sm">
            <div className="mb-2.5 flex items-baseline justify-between">
              <span className="text-xs font-bold">🔎 图谱查询</span>
              <span className="text-[10px] text-muted-foreground/70">CLI 同源</span>
            </div>
            <div className="flex flex-col gap-2.5">
              <label className="flex flex-col gap-1">
                <span className="text-[11px] leading-4 text-muted-foreground">查询类型 sub</span>
                <Select<GraphSub>
                  data-testid="sub-select"
                  aria-label="查询类型"
                  value={draft.sub}
                  onChange={(v) => setDraft((d) => ({ ...d, sub: v }))}
                  options={SUB_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-[11px] leading-4 text-muted-foreground">
                  锚点 anchor（锚点 / 文件 / 模块 / 变更 / FR / 决策）
                </span>
                <AnchorInput
                  workspaceId={workspaceId}
                  testId="anchor-input"
                  placeholder="如 FR-core-engine-001 或 frontend/src/lib/knowledge.ts"
                  value={draft.anchor}
                  onChange={(v) => setDraft((d) => ({ ...d, anchor: v }))}
                  onEnter={runDraft}
                />
              </label>
              {draft.sub === "path" ? (
                <label className="flex flex-col gap-1">
                  <span className="text-[11px] leading-4 text-muted-foreground">
                    终点 anchor2（path 查询）
                  </span>
                  <AnchorInput
                    workspaceId={workspaceId}
                    testId="anchor2-input"
                    placeholder="如 frontend（模块）"
                    value={draft.anchor2}
                    onChange={(v) => setDraft((d) => ({ ...d, anchor2: v }))}
                    onEnter={runDraft}
                  />
                </label>
              ) : null}
              <div className="grid grid-cols-2 gap-2">
                <label className="flex flex-col gap-1">
                  <span className="text-[11px] leading-4 text-muted-foreground">边型 edges</span>
                  <Select
                    data-testid="edges-select"
                    aria-label="边型过滤"
                    value={draft.edges}
                    onChange={(v) => setDraft((d) => ({ ...d, edges: v }))}
                    options={[
                      { value: "all", label: "all · 全部边型" },
                      ...EDGE_TYPES.map((e) => ({
                        value: e.value,
                        label: `${e.value}（${EDGE_STRENGTH_LABEL[e.strength]}）`,
                      })),
                    ]}
                  />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-[11px] leading-4 text-muted-foreground">深度 depth</span>
                  <Select
                    data-testid="depth-select"
                    aria-label="遍历深度"
                    value={draft.depth}
                    onChange={(v) => setDraft((d) => ({ ...d, depth: v }))}
                    options={[
                      { value: 1, label: "1 跳" },
                      { value: 2, label: "2 跳" },
                      { value: 3, label: "3 跳" },
                    ]}
                  />
                </label>
              </div>
              <div className="flex gap-2">
                <Button
                  data-testid="run-query-btn"
                  className="flex-1"
                  disabled={!canRun}
                  onClick={runDraft}
                >
                  执行查询
                </Button>
                <Button
                  variant="outline"
                  data-testid="reset-view-btn"
                  onClick={() => {
                    setDraft(DEFAULT_QUERY);
                    setSelectedId(null);
                    setLegendNodeType(null);
                    setLegendEdgeType(null);
                    setFitSignal((n) => n + 1);
                  }}
                >
                  重置
                </Button>
              </div>
            </div>
            {/* 等价 CLI 提示条：黑底等宽终端语义（login 页终端先例，非品牌色面） */}
            <div className="mt-2.5">
              <div className="mb-1 text-[10px] text-muted-foreground/70">等价 CLI</div>
              <code
                data-testid="cli-hint"
                className="block break-all rounded-md bg-slate-900 px-2.5 py-1.5 font-mono text-[10.5px] leading-4 text-slate-100"
              >
                {cliCommand}
              </code>
            </div>
          </div>

          {/* 预置演示六胶囊 */}
          <div className="rounded-lg border border-border bg-card p-3 shadow-sm">
            <div className="mb-2 flex items-baseline justify-between">
              <span className="text-xs font-bold">📚 预置演示</span>
              <span className="text-[10px] text-muted-foreground/70">本仓真实样例</span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {PRESETS.map((p) => (
                <button
                  key={p.label}
                  type="button"
                  data-testid="preset-btn"
                  onClick={() =>
                    runQuery({
                      ...DEFAULT_QUERY,
                      sub: p.sub,
                      anchor: p.anchor ?? "",
                      anchor2: p.anchor2 ?? "",
                    })
                  }
                  className="rounded-full border border-border px-2.5 py-1 text-[11px] text-muted-foreground transition-colors hover:border-brand-400 hover:bg-brand-50/60 hover:text-brand-700"
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>

          {/* 图例：节点 10 类型（点击过滤高亮）+ 边 16 型三档（hover/点击高亮） */}
          <div className="rounded-lg border border-border bg-card p-3 shadow-sm">
            <div className="mb-2 text-xs font-bold">◉ 节点类型（10）</div>
            <div className="grid grid-cols-2 gap-1">
              {NODE_TYPE_ORDER.map((t) => (
                <button
                  key={t}
                  type="button"
                  data-testid={`legend-node-${t}`}
                  aria-pressed={legendNodeType === t}
                  onClick={() =>
                    setLegendNodeType((v) => (v === t ? null : t))
                  }
                  className={cn(
                    "flex items-center gap-1.5 rounded-sm border border-transparent px-1.5 py-1 text-left text-[11px] transition-colors",
                    legendNodeType === t
                      ? "border-brand-400 bg-brand-50 font-semibold text-brand-700"
                      : "text-muted-foreground hover:bg-muted/60",
                  )}
                >
                  <span
                    aria-hidden
                    className="h-2.5 w-2.5 shrink-0 rounded-full"
                    style={{ backgroundColor: palette[nodeTypeIndex(t)] }}
                  />
                  {NODE_TYPE_LABELS[t] ?? t}
                </button>
              ))}
            </div>
            <div className="mb-2 mt-3 text-xs font-bold">─ 边类型（16）· 三档强度</div>
            <div className="flex flex-col gap-0.5">
              {EDGE_TYPES.map((e) => (
                <button
                  key={e.value}
                  type="button"
                  data-testid={`legend-edge-${e.value}`}
                  aria-pressed={legendEdgeType === e.value}
                  title={`${e.value} · ${e.label}——点击高亮该边型`}
                  onClick={() =>
                    setLegendEdgeType((v) => (v === e.value ? null : e.value))
                  }
                  className={cn(
                    "flex items-center gap-1.5 rounded-sm border border-transparent px-1.5 py-1 text-left text-[11px] transition-colors",
                    legendEdgeType === e.value
                      ? "border-brand-400 bg-brand-50 font-semibold text-brand-700"
                      : "text-muted-foreground hover:bg-muted/60",
                  )}
                >
                  {/* 线样色仅作用于线本身（与画布三档色对齐），行文字色走行态。 */}
                  <span
                    aria-hidden
                    className={cn(
                      "flex shrink-0 items-center",
                      e.strength === "medium"
                        ? "text-warning"
                        : e.strength === "weak"
                          ? "text-muted-foreground/70"
                          : "text-slate-400",
                    )}
                  >
                    <svg width="30" height="8" aria-hidden>
                      <line
                        x1="1"
                        y1="4"
                        x2="29"
                        y2="4"
                        stroke="currentColor"
                        strokeWidth={edgeDash(e.strength).width + 0.4}
                        strokeDasharray={
                          edgeDash(e.strength).dash.length > 0
                            ? edgeDash(e.strength).dash.join(",")
                            : undefined
                        }
                      />
                    </svg>
                  </span>
                  <span className="font-mono text-[10.5px]">{e.value}</span>
                  <StrengthChip strength={e.strength} />
                  <span className="min-w-0 flex-1 truncate text-[10px] opacity-70">
                    {e.label}
                  </span>
                </button>
              ))}
            </div>
            <p className="mt-2 flex flex-wrap items-center gap-x-1 gap-y-1 text-[10px] leading-4 text-muted-foreground">
              <StrengthChip strength="strong" />
              可进 impact / 召回传播
              <StrengthChip strength="medium" />
              仅查询展示
              <StrengthChip strength="weak" />
              仅展示与自检
            </p>
          </div>
        </div>

        {/* ── 中栏：画布 + mode-chip ── */}
        <div className="relative min-h-[420px] flex-1 overflow-hidden rounded-lg border border-border bg-card shadow-sm">
          <GraphCanvas
            className="absolute inset-0"
            nodes={lite ? EMPTY_NODES : slice.nodes}
            edges={lite ? EMPTY_EDGES : slice.edges}
            mode={lite ? "lite" : "slice"}
            clusters={lite ? clusters : undefined}
            selectedId={selectedId}
            warnIds={slice.warnIds}
            highlight={highlight}
            onSelect={handleCanvasSelect}
            onLayoutMode={setLayoutInfo}
            fitSignal={fitSignal}
          />
          <div
            data-testid="graph-mode-chip"
            className="absolute left-3 top-3 z-10 flex items-center gap-1.5 rounded-full border border-border bg-card/95 px-2.5 py-1 text-[11px] shadow-sm"
          >
            <span className="max-w-[320px] truncate font-mono">{chipText}</span>
            {selectedId || legendNodeType || legendEdgeType ? (
              <button
                type="button"
                data-testid="graph-chip-clear"
                aria-label="清除高亮与选中"
                className="rounded-full px-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                onClick={() => {
                  setSelectedId(null);
                  setLegendNodeType(null);
                  setLegendEdgeType(null);
                }}
              >
                ✕
              </button>
            ) : null}
          </div>
          <p className="pointer-events-none absolute bottom-2 right-3 text-[10px] text-muted-foreground/60">
            拖拽平移 · 滚轮缩放 · 点击节点看详情 · 拖动节点扰动力场
          </p>
        </div>

        {/* ── 右栏 340px：节点详情 / 查询结果 / 使用说明 ── */}
        <div className="flex w-full shrink-0 flex-col rounded-lg border border-border bg-card shadow-sm lg:w-[340px]">
          <div
            className="flex gap-1 border-b border-border p-2"
            role="tablist"
            aria-label="图谱右栏"
          >
            {(
              [
                ["detail", "节点详情"],
                ["result", "查询结果"],
                ["help", "使用说明"],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                role="tab"
                data-testid={`rtab-${key}`}
                aria-selected={rightTab === key}
                onClick={() => setRightTab(key)}
                className={cn(
                  "rounded-sm border px-2.5 py-1 text-xs transition-colors",
                  rightTab === key
                    ? "border-brand-400 bg-brand-50 font-semibold text-brand-600"
                    : "border-transparent text-muted-foreground hover:text-brand-600",
                )}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-3 text-xs">
            {/* ── 节点详情 tab ── */}
            {rightTab === "detail" ? (
              !selectedNode ? (
                <p className="py-8 text-center text-[11px] leading-5 text-muted-foreground">
                  点击画布中的节点
                  <br />
                  查看详情与一跳邻居
                </p>
              ) : (
                <div>
                  <div className="flex items-center gap-2">
                    <span
                      aria-hidden
                      className="h-3 w-3 shrink-0 rounded-full"
                      style={{
                        backgroundColor: palette[nodeTypeIndex(selectedNode.type)],
                      }}
                    />
                    <span className="min-w-0 break-all text-sm font-semibold">
                      {selectedNode.label || selectedNode.id}
                    </span>
                  </div>
                  <div className="mt-2.5 space-y-1.5">
                    <div className="flex gap-2 text-[11px]">
                      <span className="w-14 shrink-0 text-muted-foreground">节点类型</span>
                      <span className="min-w-0">
                        <span className="rounded-full bg-brand-50 px-2 py-0.5 text-[10px] font-bold text-brand-700">
                          {NODE_TYPE_LABELS[selectedNode.type] ?? (selectedNode.type || "未知")}
                        </span>
                      </span>
                    </div>
                    <div className="flex gap-2 text-[11px]">
                      <span className="w-14 shrink-0 text-muted-foreground">节点 id</span>
                      <span
                        className="min-w-0 break-all font-mono text-[10.5px]"
                        title={selectedNode.id}
                      >
                        {selectedNode.id}
                      </span>
                    </div>
                    {selectedNode.type === "entry" ? (
                      <Link
                        data-testid="open-in-knowledge"
                        href={entryKnowledgeHref(workspaceId, selectedNode.id)}
                        className="inline-block text-[11px] font-medium text-brand-600 hover:underline"
                      >
                        在知识库打开 ↗
                      </Link>
                    ) : null}
                  </div>
                  {neighborGroups.length > 0 ? (
                    <div className="mt-3 space-y-2.5">
                      {neighborGroups.map((g) => (
                        <div key={g.type}>
                          <div className="flex items-center gap-1.5 text-[11px] font-semibold">
                            <StrengthChip strength={strengthOf(edgeStrengthOf(g.type))} />
                            <span className="font-mono">{g.type}</span>
                            <span className="font-normal text-muted-foreground">
                              {EDGE_TYPES.find((e) => e.value === g.type)?.label ?? ""}
                            </span>
                          </div>
                          <div className="mt-1 space-y-0.5">
                            {g.rows.map((row, i) => {
                              const other = nodeMap.get(row.other);
                              return (
                                <button
                                  key={`${row.other}:${row.dir}:${i}`}
                                  type="button"
                                  data-testid="neighbor-row"
                                  disabled={!other}
                                  onClick={() => {
                                    setSelectedId(row.other);
                                    setRightTab("detail");
                                  }}
                                  className="flex w-full items-center gap-2 rounded-sm border border-border/50 px-1.5 py-1 text-left text-[11px] transition-colors hover:border-brand-300 hover:bg-brand-50/50 disabled:cursor-default disabled:opacity-60"
                                >
                                  <span
                                    aria-hidden
                                    className="h-2 w-2 shrink-0 rounded-full"
                                    style={{
                                      // 未知类型归中性末位色（nodeTypeIndex 语义）。
                                      backgroundColor: palette[
                                        nodeTypeIndex(other?.type ?? "")
                                      ],
                                    }}
                                  />
                                  <span className="min-w-0 flex-1 truncate" title={row.other}>
                                    {other ? other.label || other.id : row.other}
                                  </span>
                                  <span className="shrink-0 text-[10px] text-muted-foreground">
                                    {row.dir}
                                  </span>
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="mt-3 text-[10.5px] text-muted-foreground">
                      当前切片内无邻接边（orphans/dangling/impact 清单面）。
                    </p>
                  )}
                </div>
              )
            ) : rightTab === "help" ? (
              /* ── 使用说明 tab（简版）── */
              <div className="space-y-3 text-[11px] leading-5 text-muted-foreground">
                <div>
                  <p className="font-semibold text-foreground">数据面两模式</p>
                  <p>
                    「总览 lite」＝全图簇气泡总览（代表节点为度数前 5，点击代表下钻
                    neighbors）；「查询切片」＝查询驱动力场切片，&gt;200 节点自动确定性静态布局。
                  </p>
                </div>
                <div>
                  <p className="font-semibold text-foreground">默认视图与治理</p>
                  <p>
                    进入页面自动执行 orphans——孤儿条目红环警示，右栏「查询结果」为
                    top-50 清单；完整治理走 CLI（等价命令见左栏提示条）。
                  </p>
                </div>
                <div>
                  <p className="font-semibold text-foreground">画布交互</p>
                  <p>
                    拖拽平移 · 滚轮缩放（光标锚点）· 点击节点选中并高亮一跳邻域 ·
                    拖动节点扰动力场 · 空白双击重新适配；图例节点类型/边型点击过滤高亮。
                  </p>
                </div>
                <div>
                  <p className="font-semibold text-foreground">深链</p>
                  <p>
                    entry 类节点可「在知识库打开」跳转条目详情；运营页图·孤儿/图·悬空
                    卡清单行可跳回本页对应 preset 查询。
                  </p>
                </div>
              </div>
            ) : (
              /* ── 查询结果 tab（lite 总览面板 / 切片查询结果卡）── */
              lite ? (
                summary ? (
                  <div>
                    <div className="text-sm font-semibold">全图 lite 总览</div>
                    <p className="mt-1 font-mono text-[10.5px] text-muted-foreground">
                      {summary.nodes} 节点 · {summary.edges} 边 · 孤儿 {summary.orphans} ·
                      悬空引用 {summary.dangling_refs}
                    </p>
                    <div className="mt-2.5 space-y-2.5">
                      {clusters.map((c) => (
                        <div
                          key={c.key}
                          data-testid="lite-cluster"
                          className="rounded-md border border-border/60 p-2"
                        >
                          <div className="flex items-baseline justify-between gap-2">
                            <span
                              className="min-w-0 truncate text-[11px] font-semibold"
                              title={`${c.key} · ${c.label}`}
                            >
                              {c.label || c.key}
                            </span>
                            <span className="shrink-0 rounded-full bg-brand-50 px-1.5 py-0.5 text-[10px] font-bold text-brand-700">
                              {c.count} 节点
                            </span>
                          </div>
                          <div className="mt-1.5 flex flex-wrap gap-1">
                            {c.representatives.map((rep) => (
                              <button
                                key={rep.id}
                                type="button"
                                data-testid="lite-rep-row"
                                title={`${rep.id}——点击以该节点发起 neighbors`}
                                onClick={() => runNeighbors(rep.id)}
                                className="flex items-center gap-1 rounded-full border border-border px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground transition-colors hover:border-brand-400 hover:bg-brand-50/60 hover:text-brand-700"
                              >
                                <span
                                  aria-hidden
                                  className="h-1.5 w-1.5 rounded-full"
                                  style={{
                                    backgroundColor: palette[nodeTypeIndex(rep.type ?? "")],
                                  }}
                                />
                                {rep.label || rep.id}
                              </button>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (
                  <p className="py-8 text-center text-[11px] text-muted-foreground">
                    总览 lite 不可用（旧 CLI）。
                  </p>
                )
              ) : !active ? (
                <p className="py-8 text-center text-[11px] leading-5 text-muted-foreground">
                  尚未执行查询
                  <br />
                  左侧选择查询类型与参数，或点击预置演示
                </p>
              ) : queryQ.isPending ? (
                <p className="py-8 text-center text-[11px] text-muted-foreground">
                  查询加载中…
                </p>
              ) : queryQ.isError ? (
                <p className="py-8 text-center text-[11px] text-muted-foreground">
                  查询请求失败，请稍后再试。
                </p>
              ) : queryEnvelope && !queryEnvelope.available ? (
                <div className="rounded-md border-l-2 border-warning bg-muted/30 px-2.5 py-2 text-[11px] leading-5 text-muted-foreground">
                  <p className="font-semibold text-foreground">本次查询不可用</p>
                  <p className="mt-1">{graphReasonText(queryEnvelope.reason)}</p>
                </div>
              ) : (
                <QueryResultPanel
                  active={active}
                  data={queryEnvelope?.data ?? null}
                  onSelectNode={(id) => {
                    setSelectedId(id);
                    setRightTab("detail");
                  }}
                />
              )
            )}
          </div>
        </div>
      </div>
    </PageContainer>
  );
}

/** 边型 → 三档强度（图例 EDGE_TYPES 单源；未知型按 strong 结构边）。 */
function edgeStrengthOf(edgeType: string): string {
  return EDGE_TYPES.find((e) => e.value === edgeType)?.strength ?? "strong";
}

/** ok/warn 左条结果卡。 */
function ResultCard({
  warn,
  title,
  children,
}: {
  warn?: boolean;
  title: string;
  children?: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "mt-2 rounded-md border-l-2 bg-muted/30 px-2.5 py-2",
        warn ? "border-warning" : "border-success",
      )}
    >
      <div className="text-[11.5px] font-semibold">{title}</div>
      {children ? (
        <div className="mt-1 text-[11px] leading-5 text-muted-foreground">{children}</div>
      ) : null}
    </div>
  );
}

/**
 * 查询结果面板（按 active.sub 分型渲染；data 形状由后端分型契约保证，运行时
 * 防御 asArray 兜底）。orphans/dangling top-50 清单行点击跳选画布节点。
 */
function QueryResultPanel({
  active,
  data,
  onSelectNode,
}: {
  active: GraphQueryState;
  data: GraphQueryOut["data"];
  onSelectNode: (_id: string) => void;
}) {
  if (!data) {
    return (
      <p className="py-8 text-center text-[11px] text-muted-foreground">
        本次查询无数据。
      </p>
    );
  }

  if (active.sub === "orphans" && "items" in data) {
    const items = asArray<{ id: string; type?: string; kind?: string }>(data.items);
    const count = typeof data.count === "number" ? data.count : items.length;
    return (
      <div>
        <div data-testid="result-title" className="text-sm font-semibold">
          orphans · {count} 个孤儿
        </div>
        <p className="mt-1 text-[10.5px] leading-4 text-muted-foreground">
          零度节点或无路由条目（doctor: graph-orphan-entry）
        </p>
        {count > items.length ? (
          <p data-testid="result-count-note" className="mt-1 text-[10.5px] text-muted-foreground">
            共 {count} 条 · 展示 top-{items.length}（完整治理走 CLI doctor）
          </p>
        ) : null}
        <div className="mt-2 space-y-1">
          {items.map((it) => (
            <button
              key={it.id}
              type="button"
              data-testid="orphan-row"
              onClick={() => onSelectNode(it.id)}
              className="flex w-full items-center gap-2 rounded-sm border border-border/50 px-1.5 py-1 text-left transition-colors hover:border-brand-300 hover:bg-brand-50/50"
            >
              <span className="min-w-0 flex-1 break-all text-left font-mono text-[10.5px]">
                {it.id}
              </span>
              {it.type ? (
                <span className="shrink-0 text-[10px] text-muted-foreground">
                  {NODE_TYPE_LABELS[it.type] ?? it.type}
                </span>
              ) : null}
              {it.kind ? (
                <span className="shrink-0 rounded-full bg-warning/15 px-1.5 py-0.5 text-[10px] font-bold text-warning">
                  {it.kind}
                </span>
              ) : null}
            </button>
          ))}
        </div>
      </div>
    );
  }

  if (active.sub === "dangling" && "items" in data) {
    const items = asArray<{
      id: string;
      type?: string;
      kind?: string;
      detail?: string;
    }>(data.items);
    const count = typeof data.count === "number" ? data.count : items.length;
    return (
      <div>
        <div data-testid="result-title" className="text-sm font-semibold">
          dangling · {count} 处悬空
        </div>
        <p className="mt-1 text-[10.5px] leading-4 text-muted-foreground">
          变更日志/文档引用缺失目标（强边悬空将升 error，中/弱边 warning）
        </p>
        {count > items.length ? (
          <p data-testid="result-count-note" className="mt-1 text-[10.5px] text-muted-foreground">
            共 {count} 条 · 展示 top-{items.length}（完整治理走 CLI doctor）
          </p>
        ) : null}
        <div className="mt-2 space-y-1">
          {items.map((it) => (
            <button
              key={`${it.id}:${it.type}:${it.detail ?? ""}`}
              type="button"
              data-testid="dangling-row"
              onClick={() => onSelectNode(it.id)}
              className="flex w-full flex-col gap-0.5 rounded-sm border border-border/50 px-1.5 py-1 text-left transition-colors hover:border-brand-300 hover:bg-brand-50/50"
            >
              <span className="flex w-full items-center gap-2">
                <span className="min-w-0 flex-1 break-all text-left font-mono text-[10.5px]">
                  {it.id}
                </span>
                {it.kind ? (
                  <span className="shrink-0 rounded-full bg-warning/15 px-1.5 py-0.5 text-[10px] font-bold text-warning">
                    {it.kind}
                  </span>
                ) : null}
              </span>
              {it.detail ? (
                <span className="break-all text-[10px] text-muted-foreground">
                  缺失目标：{it.detail}
                </span>
              ) : null}
            </button>
          ))}
        </div>
      </div>
    );
  }

  if (active.sub === "neighbors" && "anchor" in data) {
    const nodes = asArray<GraphNodeRef>(data.nodes);
    const edges = asArray<GraphEdge>(data.edges);
    const anchorNode = nodes.find((n) => n.id === data.anchor);
    return (
      <div>
        <div data-testid="result-title" className="text-sm font-semibold">
          neighbors · {anchorNode ? anchorNode.label || anchorNode.id : data.anchor}
        </div>
        <p className="mt-1 text-[10.5px] leading-4 text-muted-foreground">
          一跳邻域（全边型，弱边仅展示）
        </p>
        <ResultCard title={`${nodes.length} 节点 · ${edges.length} 边`}>
          点击画布节点或左栏图例可过滤高亮；边型三档强度见左栏图例。
        </ResultCard>
      </div>
    );
  }

  if (active.sub === "path" && "hops" in data) {
    if (!data.found) {
      return (
        <div>
          <div data-testid="result-title" className="text-sm font-semibold">
            path · 不可达
          </div>
          <p className="mt-1 font-mono text-[10.5px] text-muted-foreground">
            {data.from} → {data.to}
          </p>
          <ResultCard warn title="未找到路径">
            {data.reason || "起点与终点在强边子集上不连通"}
          </ResultCard>
          <p className="mt-2 text-[10px] leading-4 text-muted-foreground">
            注：寻路仅在强边子集上进行（中/弱边不参与）。
          </p>
        </div>
      );
    }
    const hops = asArray<{ s: string; t: string; type: string }>(data.hops);
    return (
      <div>
        <div data-testid="result-title" className="text-sm font-semibold">
          path · {data.hop_count} 跳
        </div>
        <p className="mt-1 font-mono text-[10.5px] text-muted-foreground">
          {data.from} → {data.to}
        </p>
        <ResultCard title="推理链">
          <span className="block whitespace-pre-line break-all font-mono text-[10px] leading-4">
            {hops
              .map((h) => `${h.s} —${h.type}→ ${h.t}`)
              .join("\n")}
          </span>
        </ResultCard>
        <p className="mt-2 text-[10px] leading-4 text-muted-foreground">
          注：寻路仅在强边子集上进行（中/弱边不参与）。
        </p>
      </div>
    );
  }

  if (active.sub === "impact" && "closure" in data) {
    const closure = asArray<string>(data.closure);
    const modules = asArray<string>(data.modules);
    const decisions = asArray<{ id: string; type?: string; status?: string }>(
      data.decisions_and_frs,
    );
    const rejected = asArray<{ id: string; title?: string; reason?: string }>(
      data.rejected_reachable,
    );
    return (
      <div>
        <div data-testid="result-title" className="text-sm font-semibold">
          impact · {data.key}
        </div>
        <p className="mt-1 text-[10.5px] leading-4 text-muted-foreground">
          强边闭包（深度≤2）· 中/弱边不传播
        </p>
        <ResultCard title={`闭包 ${closure.length} 节点 · 触及模块 ${modules.length}`}>
          {modules.length > 0 ? (
            <span className="break-all font-mono text-[10px]">{modules.join("、")}</span>
          ) : (
            "无模块触及"
          )}
        </ResultCard>
        <ResultCard title={`锚定决策/FR ${decisions.length}`}>
          {decisions.length > 0 ? (
            <span className="break-all font-mono text-[10px]">
              {decisions.map((d) => d.id).join("、")}
            </span>
          ) : (
            "无决策/FR 锚定"
          )}
        </ResultCard>
        <ResultCard warn title={`防复潮保底 · 可达 ${rejected.length} 条`}>
          {rejected.length > 0 ? (
            <span className="block whitespace-pre-line break-all font-mono text-[10px] leading-4">
              {rejected
                .map((r) => `${r.title || r.id}：${r.reason || "沿强边可达"}`)
                .join("\n")}
            </span>
          ) : (
            "rejected/死路条目无强边可达项"
          )}
        </ResultCard>
      </div>
    );
  }

  if (active.sub === "summary" && "by_type" in data) {
    return (
      <div>
        <div data-testid="result-title" className="text-sm font-semibold">
          summary · 全图聚合
        </div>
        <ResultCard title={`${data.nodes} 节点 · ${data.edges} 边`}>
          孤儿 {data.orphans} · 模块文档缺口 {data.module_doc_gaps} · changelog 悬空{" "}
          {data.changelog_danglings} · 悬空引用 {data.dangling_refs}
        </ResultCard>
      </div>
    );
  }

  if (active.sub === "nodes" && "nodes" in data) {
    const nodes = asArray<GraphNodeRef>(data.nodes);
    return (
      <div>
        <div data-testid="result-title" className="text-sm font-semibold">
          nodes · {active.anchor}
        </div>
        <ResultCard title={`${nodes.length} 个命中`}>
          {nodes.length > 0 ? (
            <span className="block break-all font-mono text-[10px] leading-4">
              {nodes.map((n) => n.id).join("、")}
            </span>
          ) : (
            "无命中节点（id/label 不区分大小写包含匹配）"
          )}
        </ResultCard>
      </div>
    );
  }

  return (
    <p className="py-8 text-center text-[11px] text-muted-foreground">本次查询无数据。</p>
  );
}
