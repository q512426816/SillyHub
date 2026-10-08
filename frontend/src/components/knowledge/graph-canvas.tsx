"use client";

/**
 * GraphCanvas — 知识图谱自绘画布（task-06 / 2026-10-08-platform-knowledge-graph
 * / FR-06 / D-003@v1；full 模式 task-05 / 2026-10-09-knowledge-graph-fullmap /
 * FR-04 / FR-05 / D-002@v1）。
 *
 * 依据：
 *   - 归档原型 prototype-knowledge-graph.html 的 step()/draw()/交互段生产直译：
 *     velocity Verlet 力场（斥力/弹簧/向心/阻尼/速度夹/NaN 自愈逐项一致）、
 *     拾取最近者胜、滚轮缩放光标锚点、空白拖拽平移、节点拖拽钉位、hover/选中环、
 *     标签分级（缩放阈值/选中/hover/高亮内，26 字符截断，字号随缩放补偿）、
 *     边三档虚实（strong 实线 / medium 长虚 / weak 点虚）；
 *   - design Phase 3：力场仅切片 ≤FORCE_NODE_LIMIT 节点启用，超限确定性静态
 *     降级（类型分环同心圆等角分布，不启 rAF 力场）；mode "full" 为全图 dump
 *     静态星空——节点按 CLI 预计算 x/y 直接摆放（不 seedSpiral 不步进力场，
 *     engine='full'，与 FORCE_NODE_LIMIT 语义正交：全图节点>200 恒静态）。
 *     lite 总览簇气泡 UI 已移除（2026-10-09-knowledge-graph-fullmap task-05，
 *     full 全图取代其语义；liteClusterLayout 纯函数保留供复用）；
 *   - full 态性能护栏（原型 HTML 同值）：缩放 k<0.5 跳过边绘制只画节点
 *     （shallDrawEdges）；标签分级只在大半径类型（module/project/doc）或
 *     k>1.35 或 hover/选中时出现（原型 HTML:396 同值）；
 *   - 主题铁律（D-003）：节点 10 类型色 = themes[theme].color 组合（brand 阶 +
 *     semantic + slate），组件级 CSS 变量 --kg-node-0..9 注入 + useThemeStore
 *     订阅换肤（commit-graph.tsx lanePalette 先例），本文件零硬编码 hex；
 *   - 力场/静态/全图构造/布局/拾取/适配均为具名导出纯函数（单测消费面）。
 *
 * 消费方（page.tsx）注意：nodes/edges 传引用稳定的数据（useMemo）——identity
 * 变化即视为新切片重摆布局（查询驱动的预期语义）。
 */

import { useEffect, useMemo, useRef } from "react";
import type { CSSProperties } from "react";

import type { GraphEdge, GraphNodeRef } from "@/lib/knowledge";
import { useThemeStore } from "@/stores/theme";
import { themes, type ThemeName } from "@/styles/themes";

// ── 常量（力场参数与原型逐项一致）───────────────────────────────────────────

/** 力场启用上限（>200 节点确定性静态降级，design 非目标排除在线全图力导向）。 */
export const FORCE_NODE_LIMIT = 200;

/** 边弹簧自然长基数（× 两端半径和 / 14，原型 REST）。 */
export const EDGE_STRENGTH_REST = {
  strong: 110,
  medium: 150,
  weak: 170,
} as const;

/** 斥力作用距离（超出跳过）。 */
const REPULSION_RANGE = 320;
/** 斥力强度系数（f = min(900/d², 0.5)）。 */
const REPULSION_GAIN = 900;
const REPULSION_FORCE_CAP = 0.5;
/** 弹簧系数与单边长度上限。 */
const SPRING_K = 0.02;
const SPRING_D_MAX = 600;
/** 向心牵引系数。 */
const CENTER_PULL = 0.004;
/** 阻尼与速度夹（|v| ≤ 9）。 */
const DAMPING = 0.85;
const VELOCITY_CLAMP = 9;
/** NaN 自愈重置圆环半径（中心复位）。 */
const NAN_RESET_RADIUS = 160;
/** 初始摆放黄金角（原型切片装载）。 */
const GOLDEN_ANGLE = 2.399;
/** 标签显示缩放阈值（切片模式）与截断长度。 */
const LABEL_ZOOM_THRESHOLD = 0.55;
const LABEL_MAX_CHARS = 26;
/** full 态标签高缩放阈值（原型 HTML:396 同值；低于此只画大半径类型标签）。 */
export const FULL_LABEL_ZOOM_THRESHOLD = 1.35;

/** 节点 10 类型（色板/半径映射序，与 CLI 图引擎节点类型一一对应）。 */
export const NODE_TYPE_ORDER = [
  "project",
  "module",
  "file",
  "test",
  "decision",
  "fr",
  "change",
  "entry",
  "doc",
  "ql",
] as const;

/** 节点类型 → 绘制半径（原型 NT.r 逐项一致；未知类型缺省）。 */
const NODE_RADIUS: Record<string, number> = {
  project: 13,
  module: 11,
  file: 6,
  test: 6,
  decision: 8,
  fr: 8,
  change: 8,
  entry: 7,
  doc: 9,
  ql: 5,
};

export function nodeRadius(type: string): number {
  return NODE_RADIUS[type] ?? 6;
}

/** 节点类型 → 色板下标（未知类型归中性末位）。 */
export function nodeTypeIndex(type: string): number {
  const i = NODE_TYPE_ORDER.indexOf(type as (typeof NODE_TYPE_ORDER)[number]);
  return i >= 0 ? i : NODE_TYPE_ORDER.length - 1;
}

/** 边强度归一（后端 GraphEdge.strength；空/未知按 strong 结构边处理）。 */
export function strengthOf(strength: string): "strong" | "medium" | "weak" {
  return strength === "medium" || strength === "weak" ? strength : "strong";
}

/**
 * 节点 10 类型色板：按主题从 themes.ts 取值组合（brand 阶 + semantic + slate），
 * 映射原型 NT 的类型语义（project 主色 / module brand 主阶 / file 中性 /
 * test 成功 / decision 错误 / fr 警示 / change brand 深阶 / entry 交互青 /
 * doc brand 浅阶 / ql 中性深阶）。本函数不写任何 hex，单一源 themes.ts
 * （commit-graph lanePalette 同款先例）。
 */
export function nodePalette(theme: ThemeName): readonly string[] {
  const c = themes[theme].color;
  return [
    c.primary,
    c.brand[600],
    c.slate[500],
    c.semantic.success,
    c.semantic.error,
    c.semantic.warning,
    c.brand[800],
    c.accent,
    c.brand[400],
    c.slate[700],
  ];
}

/** 节点类型下标 → CSS 变量引用（色值由容器注入的 --kg-node-0..9 提供）。 */
export function nodeVar(index: number): string {
  const n = NODE_TYPE_ORDER.length;
  return `var(--kg-node-${((index % n) + n) % n})`;
}

// ── 纯函数层（具名导出，task-09 单测消费）──────────────────────────────────

/** 仿真节点（力场速度载体 px/py；拖拽钉位 drag+mx/my）。 */
export interface SimNode {
  id: string;
  type: string;
  label: string;
  r: number;
  x: number;
  y: number;
  px: number;
  py: number;
  drag: boolean;
  mx: number | null;
  my: number | null;
}

/** 仿真边（s→t 定方向）。 */
export interface SimEdge {
  s: string;
  t: string;
  type: string;
  strength: string;
}

/** 视口变换（世界坐标 → 屏幕：screen = world*k + (x,y)）。 */
export interface ViewBox {
  x: number;
  y: number;
  k: number;
}

/** 世界坐标包围盒。 */
export interface BBox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

function clampVelocity(v: number): number {
  return Math.max(-VELOCITY_CLAMP, Math.min(VELOCITY_CLAMP, v));
}

/**
 * velocity Verlet 力场单步（原型 step() 直译，参数逐项一致）：
 * 斥力（成对、距离 >320 跳过、力幅夹 0.5）→ 边弹簧（自然长=强弱档基数×半径
 * 和/14、长度夹 600）→ 向心 0.004 → 拖拽钉位 → 阻尼 0.85 + 速度夹 ±9 →
 * NaN 自愈（重置到中心半径 160 圆环）。dt 为本次推进的步数（rAF 传 1，测试
 * 可传 N 确定性快进）；view 提供向心/自愈中心（画布中心）。
 */
export function stepForceLayout(
  nodes: SimNode[],
  edges: SimEdge[],
  dt: number,
  view: { width: number; height: number },
): void {
  if (nodes.length === 0) return;
  const byId = new Map(nodes.map((n) => [n.id, n] as const));
  const cx = view.width / 2;
  const cy = view.height / 2;
  for (let step = 0; step < Math.max(0, Math.floor(dt)); step++) {
    // 斥力（近距成对，累积到速度载体 px/py）
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i]!;
        const b = nodes[j]!;
        if (
          !isFinite(a.x) ||
          !isFinite(a.y) ||
          !isFinite(b.x) ||
          !isFinite(b.y)
        ) {
          continue;
        }
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const d2 = dx * dx + dy * dy || 1;
        const d = Math.sqrt(d2);
        if (d > REPULSION_RANGE) continue;
        const f = Math.min(REPULSION_GAIN / d2, REPULSION_FORCE_CAP);
        const fx = (dx / d) * f;
        const fy = (dy / d) * f;
        a.px += fx;
        a.py += fy;
        b.px -= fx;
        b.py -= fy;
      }
    }
    // 边弹簧（自然长按强弱档 × 半径和缩放）
    for (const e of edges) {
      const a = byId.get(e.s);
      const b = byId.get(e.t);
      if (!a || !b) continue;
      if (
        !isFinite(a.x) ||
        !isFinite(a.y) ||
        !isFinite(b.x) ||
        !isFinite(b.y)
      ) {
        continue;
      }
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const d = Math.min(Math.sqrt(dx * dx + dy * dy) || 1, SPRING_D_MAX);
      const rest =
        EDGE_STRENGTH_REST[strengthOf(e.strength)] * ((a.r + b.r) / 14);
      const f = (d - rest) * SPRING_K;
      const fx = (dx / d) * f;
      const fy = (dy / d) * f;
      if (!isFinite(fx) || !isFinite(fy)) continue;
      a.px -= fx;
      a.py -= fy;
      b.px += fx;
      b.py += fy;
    }
    // 向心 + 拖拽钉位 + 阻尼积分 + NaN 自愈
    for (const n of nodes) {
      n.px -= (cx - n.x) * CENTER_PULL;
      n.py -= (cy - n.y) * CENTER_PULL;
      if (
        n.drag &&
        n.mx != null &&
        n.my != null &&
        isFinite(n.mx) &&
        isFinite(n.my)
      ) {
        n.x = n.mx;
        n.y = n.my;
        n.px = n.x;
        n.py = n.y;
        continue;
      }
      const vx = clampVelocity((n.x - n.px) * DAMPING);
      const vy = clampVelocity((n.y - n.py) * DAMPING);
      n.px = n.x;
      n.py = n.y;
      n.x += vx;
      n.y += vy;
      if (!isFinite(n.x) || !isFinite(n.y)) {
        const a = Math.random() * 6.28;
        n.x = cx + Math.cos(a) * NAN_RESET_RADIUS;
        n.y = cy + Math.sin(a) * NAN_RESET_RADIUS;
        n.px = n.x;
        n.py = n.y;
      }
    }
  }
}

/** 力场收敛判定阈值（世界系像素/帧）：全节点位移低于此值视为静止。 */
export const FORCE_SETTLE_EPSILON = 0.25;
/** 收敛判定的连续帧数守卫：弹簧系统在转折点会瞬时零速，单帧判定会误判。 */
export const FORCE_SETTLE_FRAMES = 30;

/**
 * 力场收敛判定（2026-10-09 提取供测试）：stepForceLayout 是 Verlet 积分，
 * 步后 ``x - px`` 即本帧位移——全节点（含 NaN 防御）位移和低于阈值即静止。
 * 收敛后调用方停步进，页面不再恒耗 CPU（原实现无截止，≤200 节点每帧 O(n²)）。
 */
export function forceSettled(
  nodes: SimNode[],
  maxDisp: number = FORCE_SETTLE_EPSILON,
): boolean {
  for (const n of nodes) {
    if (!isFinite(n.x) || !isFinite(n.y) || !isFinite(n.px) || !isFinite(n.py)) {
      return false;
    }
    if (Math.abs(n.x - n.px) + Math.abs(n.y - n.py) > maxDisp) return false;
  }
  return true;
}

/** 静态降级分环基数/间距（>200 节点确定性同心圆）。 */
export const STATIC_RING_BASE = 130;
export const STATIC_RING_GAP = 120;

/**
 * 确定性静态布局（>200 节点降级）：按节点类型分环同心圆，类型按
 * NODE_TYPE_ORDER 序（未知垫后），环内按 id 字典序等角分布——同输入必同
 * 输出（可快照测试）。直接写回各节点 x/y/px/py。
 */
export function staticLayout(nodes: SimNode[]): void {
  const groups = new Map<string, SimNode[]>();
  for (const n of nodes) {
    const g = groups.get(n.type);
    if (g) g.push(n);
    else groups.set(n.type, [n]);
  }
  const types = [...groups.keys()].sort((a, b) => {
    const oa = nodeTypeOrderValue(a);
    const ob = nodeTypeOrderValue(b);
    return oa - ob || (a < b ? -1 : a > b ? 1 : 0);
  });
  types.forEach((t, ring) => {
    const g = groups.get(t)!;
    g.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    const radius =
      STATIC_RING_BASE + ring * STATIC_RING_GAP + Math.sqrt(g.length) * 10;
    const offset = ring * 0.5;
    g.forEach((n, i) => {
      const a = offset + (i / g.length) * Math.PI * 2;
      n.x = Math.cos(a) * radius;
      n.y = Math.sin(a) * radius;
      n.px = n.x;
      n.py = n.y;
      n.drag = false;
      n.mx = null;
      n.my = null;
    });
  });
}

function nodeTypeOrderValue(type: string): number {
  const i = NODE_TYPE_ORDER.indexOf(type as (typeof NODE_TYPE_ORDER)[number]);
  return i >= 0 ? i : NODE_TYPE_ORDER.length;
}

// ── full 模式（全图 dump 静态星空，task-05 / 2026-10-09-knowledge-graph-fullmap）──

/** 画布节点输入：slice 传 GraphNodeRef（无坐标，画布摆位）；full 传 dump 节点（带预计算 x/y）。 */
export type CanvasNodeInput = GraphNodeRef & { x?: number; y?: number };

/**
 * full 模式仿真节点构造：直接消费 dump 节点自带 x/y（px/py 同值初始化——
 * 零初始速度，不 seedSpiral 不步进力场；rAF 循环 engine='full' 不调
 * stepForceLayout，节点坐标恒等于输入）。缺坐标节点按 (0,0) 归一。
 */
export function fullSimNodes(nodes: ReadonlyArray<CanvasNodeInput>): SimNode[] {
  return nodes.map((n) => toSimNode(n, n.x ?? 0, n.y ?? 0));
}

/** full 态边绘制缩放下限（原型 dump 星空同值）。 */
export const FULL_EDGE_ZOOM_THRESHOLD = 0.5;

/**
 * 边绘制护栏（full 态性能，原型同值）：缩放 k≥0.5 才画边，低于只画节点——
 * 千级边在远视野下的绘制开销远超信息量。slice 态不受此护栏约束。
 */
export function shallDrawEdges(k: number): boolean {
  return k >= FULL_EDGE_ZOOM_THRESHOLD;
}

/** full 态常显标签的大半径类型集（原型 HTML:396 同值）。 */
export const FULL_LABEL_TYPES: ReadonlySet<string> = new Set([
  "module",
  "project",
  "doc",
]);

/**
 * full 态标签分级谓词（原型 HTML:396 同值）：大半径类型（module/project/doc）
 * 恒显；其余类型仅 k>1.35 放大后显示。hover/选中由 drawNodeShape 叠加，
 * 不进本谓词。
 */
export function shallShowFullLabel(type: string, k: number): boolean {
  return FULL_LABEL_TYPES.has(type) || k > FULL_LABEL_ZOOM_THRESHOLD;
}

/** lite 簇输入（GraphCluster 结构兼容；representatives 为度数 top-5）。 */
export interface LiteClusterInput {
  key: string;
  label?: string;
  count: number;
  representatives: ReadonlyArray<{
    id: string;
    type?: string;
    label?: string;
  }>;
}

/** lite 簇摆放结果（气泡中心/半径 + 代表节点坐标，均世界坐标）。 */
export interface LiteClusterPlacement {
  key: string;
  label: string;
  count: number;
  x: number;
  y: number;
  radius: number;
  reps: ReadonlyArray<{ id: string; x: number; y: number }>;
}

/**
 * lite 簇摆放（总览 lite，D-008@v2）：簇按 count 降序（同数按 key 升序）沿
 * 大环等角摆放，气泡半径随节点数开方增长；簇内代表节点在内圈等角分布——
 * 全确定性。R-04：原型未覆盖的新面，纯函数导出交单测兜底。
 *
 * 【保留标注】lite UI 已移除（2026-10-09-knowledge-graph-fullmap task-05，
 * full 全图模式取代总览簇气泡语义），本布局纯函数与单测保留供复用——
 * 确定性多簇气泡摆放的独立可复用件，不随 UI 分支消亡。
 */
export function liteClusterLayout(
  clusters: ReadonlyArray<LiteClusterInput>,
): LiteClusterPlacement[] {
  const sorted = [...clusters].sort(
    (a, b) => b.count - a.count || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0),
  );
  const bubbles = sorted.map((c) => ({
    c,
    r: Math.max(56, Math.sqrt(Math.max(0, c.count)) * 9),
  }));
  const gap = 36;
  const circumference = bubbles.reduce((s, b) => s + b.r * 2 + gap, 0);
  const R = Math.max(240, circumference / (Math.PI * 2));
  return bubbles.map((b, i) => {
    const a = (i / Math.max(1, bubbles.length)) * Math.PI * 2;
    const x = Math.cos(a) * R;
    const y = Math.sin(a) * R;
    const reps = b.c.representatives.map((rep, j) => {
      const ra = (j / Math.max(1, b.c.representatives.length)) * Math.PI * 2;
      const rr = b.r * 0.58;
      return {
        id: rep.id,
        x: x + Math.cos(ra) * rr,
        y: y + Math.sin(ra) * rr,
      };
    });
    return {
      key: b.c.key,
      label: b.c.label || b.c.key,
      count: b.c.count,
      x,
      y,
      radius: b.r,
      reps,
    };
  });
}

/**
 * 拾取：半径 + 7/k 容差内最近者胜（屏幕向 7px 恒定容差；原型 +7 世界容差的
 * 缩放等价推广）。x/y 为世界坐标。
 */
export function pickNode(
  nodes: ReadonlyArray<SimNode>,
  x: number,
  y: number,
  k: number,
): SimNode | null {
  const tol = k > 0 ? 7 / k : 7;
  let best: SimNode | null = null;
  let bd = Infinity;
  for (const n of nodes) {
    if (!isFinite(n.x) || !isFinite(n.y)) continue;
    const d = Math.hypot(n.x - x, n.y - y);
    if (d < n.r + tol && d < bd) {
      bd = d;
      best = n;
    }
  }
  return best;
}

/** 节点集包围盒（空集回全零退化盒，fitView 自行夹取）。 */
export function graphBbox(nodes: ReadonlyArray<SimNode>): BBox {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const n of nodes) {
    if (!isFinite(n.x) || !isFinite(n.y)) continue;
    x0 = Math.min(x0, n.x);
    y0 = Math.min(y0, n.y);
    x1 = Math.max(x1, n.x);
    y1 = Math.max(y1, n.y);
  }
  if (!isFinite(x0)) return { x0: 0, y0: 0, x1: 0, y1: 0 };
  return { x0, y0, x1, y1 };
}

/**
 * 自动 re-fit 判定（2026-10-09 提取供测试）：数据到达后前 6 秒在
 * 90/180/270/360 tick 上自动重适配视口；用户已交互（滚轮缩放或指针按下
 * 拖拽/平移，双源置位 userTouched）后一律不再抢视口。
 */
export function shouldAutoRefit(tick: number, userTouched: boolean): boolean {
  return !userTouched && [90, 180, 270, 360].includes(tick);
}

/** 视口适配（原型 fitView 直译）：缩放夹 [0.08,2]、pad 60、居中。 */
export function fitView(bbox: BBox, w: number, h: number): ViewBox {
  const pad = 60;
  const k = Math.min(
    2,
    Math.max(
      0.08,
      Math.min(w / (bbox.x1 - bbox.x0 + pad), h / (bbox.y1 - bbox.y0 + pad)),
    ),
  );
  return {
    k,
    x: w / 2 - ((bbox.x0 + bbox.x1) / 2) * k,
    y: h / 2 - ((bbox.y0 + bbox.y1) / 2) * k,
  };
}

/**
 * 边三档线型（形状区分主题无关）：strong 实线 1.6 / medium 长虚 6,5 1.1 /
 * weak 点虚 2,4 1.1。
 */
export function edgeDash(
  strength: string,
): { dash: readonly number[]; width: number } {
  if (strength === "medium") return { dash: [6, 5], width: 1.1 };
  if (strength === "weak") return { dash: [2, 4], width: 1.1 };
  return { dash: [], width: 1.6 };
}

/** 标签截断（>26 字符截 25 + 省略号，原型 draw 同款）。 */
export function truncateLabel(label: string, maxChars = LABEL_MAX_CHARS): string {
  return label.length > maxChars
    ? label.slice(0, maxChars - 1) + "…"
    : label;
}

/** 边高亮键（s→t 定方向 + 边型）。 */
export function graphEdgeKey(s: string, t: string, type: string): string {
  return `${s}\u2192${t}:${type}`;
}

// ── 组件层 ──────────────────────────────────────────────────────────────────

/** 高亮集（邻域/查询结果）；非 null 即开启 dimOthers（原型语义）。 */
export interface GraphHighlight {
  nodeIds: ReadonlySet<string>;
  edgeKeys?: ReadonlySet<string>;
}

export interface GraphCanvasProps {
  /**
   * 节点输入（CanvasNodeInput；label 空串回退显示 id）——slice 传切片 ref
   * （无坐标），full 传 dump 节点（x/y 预计算坐标，fullSimNodes 消费）。
   */
  nodes: ReadonlyArray<CanvasNodeInput>;
  /** 边（strength 驱动线型与弹簧档；full 态 k<0.5 不绘制——shallDrawEdges）。 */
  edges: ReadonlyArray<GraphEdge>;
  /**
   * slice（默认，查询切片力场）/ full（全图 dump 静态星空，engine='full'
   * 不步进力场）。lite 总览模式已移除（2026-10-09-knowledge-graph-fullmap
   * task-05，full 取代其语义）。
   */
  mode?: "slice" | "full";
  /** 选中节点 id（选中环 + 标签常显）。 */
  selectedId?: string | null;
  /** 警示节点 id 集（orphans 命中红色警示环）。 */
  warnIds?: ReadonlySet<string>;
  /** 高亮集（非 null 时非高亮元素压暗：边 0.06 / 节点 0.1）。 */
  highlight?: GraphHighlight | null;
  /** 节点点击（full 模式=下钻锚点；null=点空白由调用方决定是否清选）。 */
  onSelect?: (id: string | null) => void;
  /** 布局引擎回调（数据重建时上报：force/static/full + 节点数，mode-chip 数据源）。 */
  onLayoutMode?: (info: {
    engine: "force" | "static" | "full";
    nodeCount: number;
  }) => void;
  /** 递增触发重新适配视口（工具栏「适配」按钮等）。 */
  fitSignal?: number;
  className?: string;
}

/** 画布用色（全部经 themes[theme].color 组合，零硬编码 hex）。 */
interface CanvasColors {
  palette: readonly string[];
  edgeStrong: string;
  edgeMedium: string;
  edgeWeak: string;
  edgeHl: string;
  selRing: string;
  warnRing: string;
  nodeBorder: string;
  label: string;
}

function canvasColors(theme: ThemeName): CanvasColors {
  const c = themes[theme].color;
  return {
    palette: nodePalette(theme),
    edgeStrong: c.slate[400],
    edgeMedium: c.semantic.warning,
    edgeWeak: c.slate[300],
    edgeHl: c.brand[500],
    selRing: c.brand[500],
    warnRing: c.semantic.error,
    nodeBorder: c.card,
    label: c.slate[700],
  };
}

const FONT_STACK = `-apple-system,'PingFang SC','Microsoft YaHei',sans-serif`;

function toSimNode(n: GraphNodeRef, x: number, y: number): SimNode {
  return {
    id: n.id,
    type: n.type || "",
    label: n.label || n.id,
    r: nodeRadius(n.type || ""),
    x,
    y,
    px: x,
    py: y,
    drag: false,
    mx: null,
    my: null,
  };
}

/** 黄金角螺旋初始摆放（原型切片装载直译；center 为画布中心世界坐标）。 */
function seedSpiral(nodes: SimNode[], cx: number, cy: number, count = nodes.length): void {
  // 半径自适应：≤10 节点用大半径（散开），随节点数递增回落原型值
  const spread = count <= 10 ? 1.9 : count <= 30 ? 1.35 : 1;
  nodes.forEach((n, i) => {
    const a = i * GOLDEN_ANGLE;
    n.x = cx + Math.cos(a) * (120 + (i % 5) * 70) * spread;
    n.y = cy + Math.sin(a) * (90 + (i % 4) * 60) * spread;
    n.px = n.x;
    n.py = n.y;
  });
}

export function GraphCanvas({
  nodes,
  edges,
  mode = "slice",
  selectedId = null,
  warnIds,
  highlight = null,
  onSelect,
  onLayoutMode,
  fitSignal = 0,
  className,
}: GraphCanvasProps) {
  const theme = useThemeStore((s) => s.theme);
  const colors = useMemo(() => canvasColors(theme), [theme]);

  // 组件级注入 --kg-node-0..9（值源自 themes.ts 单一源，随主题切换即时换肤）。
  const nodeVars = useMemo(() => {
    const palette = nodePalette(theme);
    const style: Record<string, string> = {};
    palette.forEach((color, i) => {
      style[`--kg-node-${i}`] = color;
    });
    return style as CSSProperties;
  }, [theme]);

  const wrapRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // 仿真/交互状态全走 ref（rAF 循环消费，不经 react 重渲染）。
  const simRef = useRef<SimNode[]>([]);
  const edgeSimRef = useRef<SimEdge[]>([]);
  const byIdRef = useRef<Map<string, SimNode>>(new Map());
  const engineRef = useRef<"force" | "static" | "full">("force");
  const viewRef = useRef<ViewBox>({ x: 0, y: 0, k: 1 });
  const sizeRef = useRef({ w: 0, h: 0 });
  const hoverRef = useRef<string | null>(null);
  const dragRef = useRef<SimNode | null>(null);
  const panRef = useRef<{ x: number; y: number } | null>(null);
  const dirtyRef = useRef(true);
  // 力场收敛跟随（2026-10-08 用户实证修）：tick 计数 + 用户交互即停标记
  const forceTickRef = useRef(0);
  const userTouchedRef = useRef(false);
  // 力场收敛截止（2026-10-09）：连续 FORCE_SETTLE_FRAMES 帧全节点位移低于阈值
  // 判静止并停步进——原实现无截止，布局静止后仍每帧 O(n²) 步进 + 重绘恒耗 CPU。
  const forceLiveRef = useRef(true);
  const forceSettledFramesRef = useRef(0);

  // 每渲染同步 prop 面到 ref（rAF/draw 消费，避免闭包过期）。
  const colorsRef = useRef(colors);
  const selectedRef = useRef(selectedId);
  const warnRef = useRef(warnIds);
  const hlRef = useRef(highlight);
  const onSelectRef = useRef(onSelect);
  useEffect(() => {
    colorsRef.current = colors;
    selectedRef.current = selectedId;
    warnRef.current = warnIds;
    hlRef.current = highlight;
    onSelectRef.current = onSelect;
    dirtyRef.current = true;
  });

  // 数据重建（identity 变化=新切片）：full 消费自带 x/y 静态摆放 / slice 黄金角
  // 螺旋起步 / >200 静态降级，随后 fitView 适配。
  useEffect(() => {
    const w = sizeRef.current.w || 800;
    const h = sizeRef.current.h || 600;
    edgeSimRef.current = edges.map((e) => ({
      s: e.s,
      t: e.t,
      type: e.type,
      strength: e.strength,
    }));
    if (mode === "full") {
      // 全图 dump 静态星空：节点坐标恒等于输入（不 seedSpiral 不步进力场，
      // engine='full'——rAF 循环仅 force 引擎步进）。
      const sim = fullSimNodes(nodes);
      byIdRef.current = new Map(sim.map((n) => [n.id, n] as const));
      simRef.current = sim;
      engineRef.current = "full";
      onLayoutMode?.({ engine: "full", nodeCount: sim.length });
      viewRef.current = fitView(graphBbox(sim), w, h);
      dirtyRef.current = true;
      return;
    }
    const sim = nodes.map((n) => toSimNode(n, 0, 0));
    // 小图（无边/少节点）初始散布更开：螺旋半径按节点数自适应（原型固定
    // 120+ 偏小，4 个孤儿挤一团——实证修）
    seedSpiral(sim, w / 2, h / 2, sim.length);
    forceTickRef.current = 0;
    userTouchedRef.current = false;
    // 新数据重启力场演化（收敛截止状态随数据重建复位）。
    forceLiveRef.current = true;
    forceSettledFramesRef.current = 0;
    byIdRef.current = new Map(sim.map((n) => [n.id, n] as const));
    const engine: "force" | "static" =
      sim.length > FORCE_NODE_LIMIT ? "static" : "force";
    if (engine === "static") staticLayout(sim);
    simRef.current = sim;
    engineRef.current = engine;
    onLayoutMode?.({ engine, nodeCount: sim.length });
    viewRef.current = fitView(graphBbox(sim), w, h);
    dirtyRef.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes, edges, mode, fitSignal]);

  // 挂载：测量 + rAF 循环 + 非被动滚轮（缩放需 preventDefault）。
  useEffect(() => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    if (!wrap || !canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    const measure = () => {
      const rect = wrap.getBoundingClientRect();
      const first = sizeRef.current.w === 0 && sizeRef.current.h === 0;
      sizeRef.current = { w: rect.width, h: rect.height };
      canvas.width = Math.max(1, Math.round(rect.width * dpr));
      canvas.height = Math.max(1, Math.round(rect.height * dpr));
      if (first) refit();
      dirtyRef.current = true;
    };

    const refit = () => {
      const { w, h } = sizeRef.current;
      if (w === 0 || h === 0) return;
      viewRef.current = fitView(graphBbox(simRef.current), w, h);
      dirtyRef.current = true;
    };

    const drawNodeShape = (n: SimNode, c: CanvasColors, k: number) => {
      const hl = hlRef.current;
      const dim = hl != null;
      const inHl = !hl || hl.nodeIds.has(n.id);
      const isSel = n.id === selectedRef.current;
      const isHov = n.id === hoverRef.current;
      ctx.globalAlpha = dim && !inHl ? 0.1 : 1;
      if (isSel || isHov) {
        ctx.beginPath();
        ctx.arc(n.x, n.y, n.r + 5, 0, 7);
        ctx.strokeStyle = c.selRing;
        ctx.lineWidth = 2;
        ctx.stroke();
      }
      if (warnRef.current?.has(n.id)) {
        ctx.beginPath();
        ctx.arc(n.x, n.y, n.r + 8, 0, 7);
        ctx.strokeStyle = c.warnRing;
        ctx.lineWidth = 2.4;
        ctx.stroke();
      }
      ctx.beginPath();
      ctx.arc(n.x, n.y, n.r, 0, 7);
      ctx.fillStyle = c.palette[nodeTypeIndex(n.type)]!;
      ctx.fill();
      ctx.strokeStyle = c.nodeBorder;
      ctx.lineWidth = 1.5;
      ctx.stroke();
      // 标签分级（原型同源）：切片 = 缩放阈值/选中/hover/高亮内；full = 大半径
      // 类型（module/project/doc）恒显，其余 k>1.35 或选中/hover（HTML:396 同值）。
      const showLbl =
        engineRef.current === "full"
          ? shallShowFullLabel(n.type, k) || isSel || isHov
          : k > LABEL_ZOOM_THRESHOLD || isSel || isHov || inHl;
      if (showLbl) {
        ctx.font = `${isSel || isHov ? 600 : 400} ${Math.max(
          10,
          10 / Math.sqrt(k),
        )}px ${FONT_STACK}`;
        ctx.textAlign = "center";
        if (dim && !inHl) {
          ctx.globalAlpha = 0.15;
          ctx.fillStyle = c.label;
        } else {
          ctx.fillStyle = c.label;
        }
        // 小图放宽截断（≤30 节点 46 字符——长锚点 id 全显，实证修）
        ctx.fillText(truncateLabel(n.label, simRef.current.length <= 30 ? 46 : LABEL_MAX_CHARS), n.x, n.y - n.r - 5);
      }
    };

    const draw = () => {
      const { w, h } = sizeRef.current;
      const v = viewRef.current;
      const c = colorsRef.current;
      const hl = hlRef.current;
      const dim = hl != null;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      ctx.save();
      ctx.translate(v.x, v.y);
      ctx.scale(v.k, v.k);

      // 边（三档虚实 + 高亮 brand 变粗）。full 态性能护栏：k<0.5 跳过边绘制
      // 只画节点（shallDrawEdges，原型 dump 星空同值）。
      if (shallDrawEdges(v.k)) {
        for (const e of edgeSimRef.current) {
          const a = byIdRef.current.get(e.s);
          const b = byIdRef.current.get(e.t);
          if (!a || !b) continue;
          const inHl =
            !hl || !hl.edgeKeys || hl.edgeKeys.has(graphEdgeKey(e.s, e.t, e.type));
          ctx.globalAlpha = dim && !inHl ? 0.06 : 0.55;
          const st = strengthOf(e.strength);
          const { dash, width } = edgeDash(st);
          ctx.strokeStyle =
            st === "strong"
              ? c.edgeStrong
              : st === "medium"
                ? c.edgeMedium
                : c.edgeWeak;
          ctx.lineWidth = width;
          ctx.setLineDash(dash);
          if (hl && inHl) {
            ctx.strokeStyle = c.edgeHl;
            ctx.lineWidth = 2.2;
            ctx.globalAlpha = 0.95;
          }
          ctx.beginPath();
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
          ctx.stroke();
        }
      }
      ctx.setLineDash([]);
      for (const n of simRef.current) drawNodeShape(n, c, v.k);
      ctx.restore();
      ctx.globalAlpha = 1;
    };

    const loop = () => {
      raf = requestAnimationFrame(loop);
      // 力场仅 force 引擎步进（static/full 不启力场——full 坐标恒等于 dump 输入）
      if (
        engineRef.current === "force" &&
        forceLiveRef.current &&
        sizeRef.current.w > 0 &&
        simRef.current.length > 0 &&
        simRef.current.length <= FORCE_NODE_LIMIT
      ) {
        stepForceLayout(simRef.current, edgeSimRef.current, 1, {
          width: sizeRef.current.w,
          height: sizeRef.current.h,
        });
        dirtyRef.current = true;
        // 力场收敛截止（2026-10-09）：连续 FORCE_SETTLE_FRAMES 帧全节点位移
        // 低于阈值判静止，停步进省 CPU（原实现无截止恒耗）；定格时若用户
        // 未交互做一次终局 fitView，承接收敛跟随语义（tick 随停不再推进）。
        // 拖拽活跃守卫（评审 P1）：被拖节点在步内钉死在指针处（x=mx 且 px=x）
        // 位移恒零——按住不动约 0.5s 会误判收敛停步进，而 mx/my 的唯一施加点
        // 就在力场步内，停了节点即冻结不跟指针；拖拽期间禁止判静止。
        if (dragRef.current === null && forceSettled(simRef.current)) {
          forceSettledFramesRef.current += 1;
          if (forceSettledFramesRef.current >= FORCE_SETTLE_FRAMES) {
            forceLiveRef.current = false;
            if (!userTouchedRef.current && simRef.current.length > 0) {
              viewRef.current = fitView(
                graphBbox(simRef.current),
                sizeRef.current.w,
                sizeRef.current.h,
              );
            }
          }
        } else {
          forceSettledFramesRef.current = 0;
        }
        // 力场收敛跟随：数据到达后前 6 秒按衰减节奏自动重新适配视口
        // （fitView 只在数据瞬间执行一次，节点被力场从螺旋初始位推开后
        // 视口不跟随 → 节点漂出视野/挤一角大片留白——2026-10-08 用户实证）。
        // 用户一旦交互（拖拽/缩放，滚轮与指针按下双源置位）即停跟随，避免抢操作。
        forceTickRef.current += 1;
        if (
          shouldAutoRefit(forceTickRef.current, userTouchedRef.current) &&
          simRef.current.length > 0
        ) {
          viewRef.current = fitView(graphBbox(simRef.current), sizeRef.current.w, sizeRef.current.h);
        }
      }
      if (!dirtyRef.current) return;
      dirtyRef.current = false;
      draw();
    };

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      userTouchedRef.current = true;
      const rect = canvas.getBoundingClientRect();
      const cx = e.clientX - rect.left;
      const cy = e.clientY - rect.top;
      const v = viewRef.current;
      const f = e.deltaY < 0 ? 1.12 : 0.89;
      const k2 = Math.min(3, Math.max(0.3, v.k * f));
      const p = { x: (cx - v.x) / v.k, y: (cy - v.y) / v.k };
      viewRef.current = { k: k2, x: cx - p.x * k2, y: cy - p.y * k2 };
      dirtyRef.current = true;
    };

    let raf = 0;
    const ro = new ResizeObserver(measure);
    ro.observe(wrap);
    measure();
    canvas.addEventListener("wheel", onWheel, { passive: false });
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      canvas.removeEventListener("wheel", onWheel);
    };
  }, []);

  // 指针交互（pointer capture：拖拽/平移出画布不丢事件）。
  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    // 任何指针按下（拖节点/平移/点选）都算用户交互——与滚轮同款置位停自动
    // re-fit 跟随（2026-10-09 风险审查：原实现只 onWheel 置位，数据到达后
    // 前 360 tick 内拖拽会被 refit 抢回视口，与「拖拽/缩放即停」声明不符）。
    userTouchedRef.current = true;
    const rect = canvas.getBoundingClientRect();
    const cx = e.clientX - rect.left;
    const cy = e.clientY - rect.top;
    const p = {
      x: (cx - viewRef.current.x) / viewRef.current.k,
      y: (cy - viewRef.current.y) / viewRef.current.k,
    };
    const hit = pickNode(simRef.current, p.x, p.y, viewRef.current.k);
    if (hit) {
      dragRef.current = hit;
      hit.drag = true;
      hit.mx = p.x;
      hit.my = p.y;
      onSelectRef.current?.(hit.id);
      // 拖节点重启力场（2026-10-09 收敛截止配套）：布局已静止时用户重排节点，
      // 松手后需要重新演化收敛（平移/缩放是纯视口操作，不重启）。
      forceLiveRef.current = true;
      forceSettledFramesRef.current = 0;
    } else {
      panRef.current = { x: e.clientX, y: e.clientY };
    }
    canvas.setPointerCapture(e.pointerId);
    dirtyRef.current = true;
  };

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const cx = e.clientX - rect.left;
    const cy = e.clientY - rect.top;
    if (dragRef.current) {
      const p = {
        x: (cx - viewRef.current.x) / viewRef.current.k,
        y: (cy - viewRef.current.y) / viewRef.current.k,
      };
      dragRef.current.mx = p.x;
      dragRef.current.my = p.y;
      dirtyRef.current = true;
      return;
    }
    if (panRef.current) {
      viewRef.current = {
        ...viewRef.current,
        x: viewRef.current.x + (e.clientX - panRef.current.x),
        y: viewRef.current.y + (e.clientY - panRef.current.y),
      };
      panRef.current = { x: e.clientX, y: e.clientY };
      dirtyRef.current = true;
      return;
    }
    // hover：探节点
    const p = {
      x: (cx - viewRef.current.x) / viewRef.current.k,
      y: (cy - viewRef.current.y) / viewRef.current.k,
    };
    const hit = pickNode(simRef.current, p.x, p.y, viewRef.current.k);
    const nextHover = hit?.id ?? null;
    if (nextHover !== hoverRef.current) {
      hoverRef.current = nextHover;
      dirtyRef.current = true;
    }
    canvas.style.cursor = hit ? "pointer" : panRef.current ? "grabbing" : "grab";
  };

  const onPointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (dragRef.current) {
      dragRef.current.drag = false;
      dragRef.current = null;
    }
    panRef.current = null;
    canvasRef.current?.releasePointerCapture(e.pointerId);
    dirtyRef.current = true;
  };

  // 空白双击重新适配（浏览大图回位手段）
  const onDoubleClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const p = {
      x: (e.clientX - rect.left - viewRef.current.x) / viewRef.current.k,
      y: (e.clientY - rect.top - viewRef.current.y) / viewRef.current.k,
    };
    if (!pickNode(simRef.current, p.x, p.y, viewRef.current.k)) {
      const { w, h } = sizeRef.current;
      viewRef.current = fitView(graphBbox(simRef.current), w, h);
      dirtyRef.current = true;
    }
  };

  return (
    <div
      ref={wrapRef}
      className={className}
      style={nodeVars}
      data-testid="graph-canvas"
    >
      <canvas
        ref={canvasRef}
        role="img"
        aria-label="知识图谱画布：滚轮缩放，拖拽平移，点击节点查看详情"
        className="block h-full w-full cursor-grab touch-none"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onDoubleClick={onDoubleClick}
      />
    </div>
  );
}
