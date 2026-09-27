/**
 * FlowDiagram —— 流程类原型原语（prototype 管线，2026-09-27-prototype-pipeline FR-03）。
 *
 * 面向「无对应页面的流程描述类原型」（状态机/审批链/门禁管线）：
 * 源是节点与边的 JSON 声明（可 diff、可评审、agent 可直接产出），
 * 渲染为确定性分层 SVG（最长路径分层 + 泳道行），颜色全部走主题 token，
 * 零新增依赖。经 scripts/prototype-build.mjs 与页面视图共用同一条编译管线。
 */
import * as React from "react";

export type FlowTone = "default" | "brand" | "success" | "warning" | "error";

export interface FlowNode {
  id: string;
  /** 节点主标签（保持短，单行）。 */
  label: string;
  /** 副标签（第二行小字，如「2 次协议调用」）。 */
  sub?: string;
  /** 泳道键（配合 lanes 使用；缺省归入第一泳道）。 */
  lane?: string;
  /** 手动指定层（列号，从 0 起，权威钉住——跨道边不会推挤它）；缺省由边关系自动分层。 */
  layer?: number;
  /** 色调：default=常规 / brand=主径 / success=终态 / warning=门禁 / error=失败。 */
  tone?: FlowTone;
}

export interface FlowEdge {
  from: string;
  to: string;
  /** 边标签（如「实测失败自动升厚」）。 */
  label?: string;
  /** 虚线（转道/异常路径语义）。 */
  dashed?: boolean;
}

export interface FlowDiagramProps {
  nodes: FlowNode[];
  edges: FlowEdge[];
  /** 泳道顺序（每泳道一行）；不传则单泳道。 */
  lanes?: string[];
  /** 泳道显示名（缺省用键名）。 */
  laneLabels?: Record<string, string>;
  className?: string;
}

const NODE_W = 150;
const NODE_H = 52;
const COL_GAP = 72;
const LANE_GAP = 60;
const PAD_X = 120;
const PAD_Y = 24;

const TONE_STYLE: Record<FlowTone, { fill: string; stroke: string; text: string }> = {
  default: {
    fill: "hsl(var(--card))",
    stroke: "hsl(var(--border))",
    text: "hsl(var(--foreground))",
  },
  brand: {
    fill: "var(--color-brand-50)",
    stroke: "var(--color-brand-600)",
    text: "var(--color-brand-600)",
  },
  success: {
    fill: "var(--semantic-success-soft)",
    stroke: "hsl(var(--success))",
    text: "hsl(var(--success))",
  },
  warning: {
    fill: "var(--semantic-warning-soft)",
    stroke: "hsl(var(--warning))",
    text: "hsl(var(--warning))",
  },
  error: {
    fill: "var(--semantic-error-soft)",
    stroke: "hsl(var(--error))",
    text: "hsl(var(--error))",
  },
};

/** 分层：显式 layer 为权威钉住（不被边推挤）；缺省由最长路径推导（前驱最大层 +1）。 */
function computeLayers(nodes: FlowNode[], edges: FlowEdge[]): Map<string, number> {
  const layer = new Map<string, number>(nodes.map((n) => [n.id, n.layer ?? 0]));
  const pinned = new Set(nodes.filter((n) => n.layer !== undefined).map((n) => n.id));
  // 迭代至收敛（节点数小，O(n·e) 足够；环上节点保持原值不发散）。
  for (let round = 0; round < nodes.length; round++) {
    let changed = false;
    for (const e of edges) {
      if (pinned.has(e.to)) continue;
      const from = layer.get(e.from);
      const to = layer.get(e.to);
      if (from === undefined || to === undefined) continue;
      const next = Math.max(to, from + 1);
      if (next !== to) {
        layer.set(e.to, next);
        changed = true;
      }
    }
    if (!changed) break;
  }
  return layer;
}

export function FlowDiagram({ nodes, edges, lanes, laneLabels, className }: FlowDiagramProps) {
  const laneKeys = lanes ?? [nodes[0]?.lane ?? "main"];
  const firstLane = laneKeys[0] ?? "main";
  const laneOf = new Map(nodes.map((n) => [n.id, laneKeys.indexOf(n.lane ?? firstLane)]));
  const layer = computeLayers(nodes, edges);

  const pos = new Map<string, { x: number; y: number }>();
  for (const n of nodes) {
    const laneIdx = Math.max(0, laneOf.get(n.id) ?? 0);
    pos.set(n.id, {
      x: PAD_X + (layer.get(n.id) ?? 0) * (NODE_W + COL_GAP),
      y: PAD_Y + laneIdx * (NODE_H + LANE_GAP),
    });
  }

  const maxLayer = Math.max(0, ...[...layer.values()]);
  const width = PAD_X + maxLayer * (NODE_W + COL_GAP) + NODE_W + PAD_X / 2;
  const height = PAD_Y + laneKeys.length * (NODE_H + LANE_GAP) - LANE_GAP + PAD_Y;

  const edgeColor = "hsl(var(--muted-foreground))";

  return (
    <svg
      role="img"
      viewBox={`0 0 ${width} ${height}`}
      width={width}
      height={height}
      className={className}
      style={{ display: "block" }}
    >
      {laneKeys.map((key, i) => (
        <text
          key={key}
          x={8}
          y={PAD_Y + i * (NODE_H + LANE_GAP) + NODE_H / 2}
          style={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }}
        >
          {laneLabels?.[key] ?? key}
        </text>
      ))}

      {edges.map((e) => {
        const a = pos.get(e.from);
        const b = pos.get(e.to);
        if (!a || !b) return null;
        const x1 = a.x + NODE_W;
        const y1 = a.y + NODE_H / 2;
        const x2 = b.x;
        const y2 = b.y + NODE_H / 2;
        const mid = (x1 + x2) / 2;
        return (
          <g key={`${e.from}->${e.to}`}>
            <path
              d={`M ${x1} ${y1} C ${Math.max(mid, x1 + 16)} ${y1}, ${Math.min(mid, x2 - 16)} ${y2}, ${x2 - 6} ${y2}`}
              fill="none"
              stroke={edgeColor}
              strokeWidth={1.25}
              strokeDasharray={e.dashed ? "5 4" : undefined}
              markerEnd="url(#flow-arrow)"
            />
            {e.label ? (
              <text
                x={mid}
                y={(y1 + y2) / 2 - 6}
                textAnchor="middle"
                style={{ fill: edgeColor, fontSize: 10 }}
              >
                {e.label}
              </text>
            ) : null}
          </g>
        );
      })}

      {nodes.map((n) => {
        const p = pos.get(n.id);
        if (!p) return null;
        const tone = TONE_STYLE[n.tone ?? "default"];
        return (
          <g key={n.id} data-flow-id={n.id} transform={`translate(${p.x}, ${p.y})`}>
            <rect width={NODE_W} height={NODE_H} rx={8} style={{ fill: tone.fill, stroke: tone.stroke }} />
            <text
              x={NODE_W / 2}
              y={n.sub ? NODE_H / 2 - 3 : NODE_H / 2 + 4}
              textAnchor="middle"
              style={{ fill: tone.text, fontSize: 13, fontWeight: 500 }}
            >
              {n.label}
            </text>
            {n.sub ? (
              <text
                x={NODE_W / 2}
                y={NODE_H / 2 + 13}
                textAnchor="middle"
                style={{ fill: "hsl(var(--muted-foreground))", fontSize: 10 }}
              >
                {n.sub}
              </text>
            ) : null}
          </g>
        );
      })}

      <defs>
        <marker id="flow-arrow" viewBox="0 0 8 8" refX={7} refY={4} markerWidth={7} markerHeight={7} orient="auto">
          <path d="M 0 0 L 8 4 L 0 8 z" style={{ fill: edgeColor }} />
        </marker>
      </defs>
    </svg>
  );
}
