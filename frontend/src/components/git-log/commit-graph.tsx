"use client";

/**
 * task-06：Git 日志泳道图（类 IDEA Git Log 左列拓扑，自研 SVG，D-001 禁第三方 git 图组件）。
 *
 * - lane/edges 由 backend graph_layout 预计算（D-004），本组件纯渲染不自算布局；
 * - 与 commit-list 虚拟滚动对齐：y 以全局绝对序 seq 定位（跨页追加坐标连续），
 *   只绘可视区（±overscan）内源行的圆点与边——视口重绘（R-05）。
 *   取舍说明：边的可见性以「源行在可视区」为准，源行滚出视口后其长边即不绘制
 *   （长边中段经过可视区时不产出 path），与验收「视口外行不产出 path」一致，
 *   换取 O(可视行) 的重绘成本；滚动 ±overscan 覆盖绝大多数可视长边；
 * - lane 色板 5 色循环（design §5.4「primary/accent/success/warning/error 系」）：
 *   经 themes.ts 消费链取值（useThemeStore + themes[theme].color，对齐 charts
 *   组件先例），以组件级 --lane0..4 style 变量注入，禁硬编码 hex；dark 主题
 *   语义色已在 themes.ts 提亮一档（即泳道亮暗档）；
 * - HEAD commit（refs 含 kind=head）画虚线环（原型形态）。
 *
 * 依据：tasks/task-06.md、design.md §5.4 / §7.4、prototype-workspace-git-log.html。
 */

import { useMemo } from "react";
import type { CSSProperties } from "react";

import type { GitLogCommitItem } from "@/lib/git-log";
import { useThemeStore } from "@/stores/theme";
import { themes, type ThemeName } from "@/styles/themes";

/** 泳道几何常量（与 commit-list 行高/列宽对齐，原型取值）。 */
export const GRAPH_WIDTH = 148;
export const LANE_WIDTH = 14;
export const COMMIT_ROW_HEIGHT = 36;
const LANE_X0 = 12;
const DOT_R = 4.5;
/** 色板长度（lane 超出后循环取色）。 */
export const LANE_PALETTE_SIZE = 5;

/** lane 中心 x 坐标（px）。 */
export function laneX(lane: number): number {
  return LANE_X0 + lane * LANE_WIDTH + DOT_R;
}

/** 全局绝对序 seq 对应的圆点/行中心 y 坐标（跨页追加时坐标连续，§7.4 seq 定义）。 */
export function laneY(seq: number): number {
  return seq * COMMIT_ROW_HEIGHT + COMMIT_ROW_HEIGHT / 2;
}

/**
 * 泳道色板：按主题从 themes.ts 取 primary / accent / success / warning / error
 * 五系（design §5.4）。dark 主题语义取值即提亮档（themes.ts 已较浅色主题提亮），
 * 满足「三主题各配亮暗档」；本函数不写任何 hex，取值单一源 themes.ts。
 */
export function lanePalette(theme: ThemeName): readonly string[] {
  const c = themes[theme].color;
  return [
    c.primary,
    c.accent,
    c.semantic.success,
    c.semantic.warning,
    c.semantic.error,
  ];
}

/** lane 号 → CSS 变量引用（色值由容器注入的 --lane0..4 提供）。 */
export function laneVar(lane: number): string {
  return `var(--lane${((lane % LANE_PALETTE_SIZE) + LANE_PALETTE_SIZE) % LANE_PALETTE_SIZE})`;
}

/**
 * 单条父边的 SVG path d。
 * straight=同泳道竖线；curve=换泳道贝塞尔弧（中点控制，原型公式）。
 * 目标超出已加载窗口（lookahead 退化，§5.3 CC-03）时仍按 seq 定 y，
 * 线段延伸到画布外自然截断，不影响 lane 一致性。
 */
export function edgePath(
  fromLane: number,
  fromSeq: number,
  toLane: number,
  toSeq: number,
  kind: "straight" | "curve",
): string {
  const x1 = laneX(fromLane);
  const y1 = laneY(fromSeq);
  const x2 = laneX(toLane);
  const y2 = laneY(toSeq);
  if (kind === "straight" || x1 === x2) {
    return `M ${x1} ${y1} V ${y2}`;
  }
  const my = (y1 + y2) / 2;
  return `M ${x1} ${y1} C ${x1} ${my}, ${x2} ${my}, ${x2} ${y2}`;
}

export interface CommitGraphProps {
  /** 已加载的提交窗口（新→旧序，seq 为全局绝对序）。 */
  commits: GitLogCommitItem[];
  /** 可视区（±overscan）内的全局绝对序集合——视口外行不产出圆点与边（R-05）。 */
  visibleSeqs: ReadonlySet<number>;
  /** SVG 画布总高（= commit-list 虚拟化总高度）。 */
  height: number;
}

/** 泳道 SVG：绝对定位于列表滚动容器左列，pointer-events 穿透（行接管点击）。 */
export function CommitGraph({
  commits,
  visibleSeqs,
  height,
}: CommitGraphProps) {
  const theme = useThemeStore((s) => s.theme);

  // 组件级注入 --lane0..4（值源自 themes.ts 单一源，随主题切换即时换肤）
  const laneVars = useMemo(() => {
    const palette = lanePalette(theme);
    const style: Record<string, string> = {};
    palette.forEach((color, i) => {
      style[`--lane${i}`] = color;
    });
    return style as CSSProperties;
  }, [theme]);

  const visible = useMemo(
    () => commits.filter((c) => visibleSeqs.has(c.seq)),
    [commits, visibleSeqs],
  );

  return (
    <div
      className="pointer-events-none absolute left-0 top-0 z-0"
      style={{ ...laneVars, width: GRAPH_WIDTH, height }}
      aria-hidden="true"
      data-testid="git-log-graph"
    >
      <svg
        width={GRAPH_WIDTH}
        height={height}
        viewBox={`0 0 ${GRAPH_WIDTH} ${height}`}
        role="presentation"
      >
        {/* 边（先画，压在圆点下层）：颜色取源 commit 的 lane 色（原型语义） */}
        {visible.flatMap((c) =>
          c.edges.map((e) => (
            <path
              key={`edge-${c.seq}-${e.to_seq}-${e.to_lane}`}
              d={edgePath(c.lane, c.seq, e.to_lane, e.to_seq, e.kind)}
              style={{ stroke: laneVar(c.lane) }}
              fill="none"
              strokeWidth={2}
              strokeLinecap="round"
              data-kind={e.kind}
              data-from-seq={c.seq}
            />
          )),
        )}
        {/* 圆点：cx 按 lane、cy 按 seq；描边取卡片底色形成与行的视觉分隔 */}
        {visible.map((c) => {
          const isHead = c.refs.some((r) => r.kind === "head");
          return (
            <g key={`dot-${c.hash}`}>
              <circle
                cx={laneX(c.lane)}
                cy={laneY(c.seq)}
                r={DOT_R}
                style={{ fill: laneVar(c.lane), stroke: "hsl(var(--card))" }}
                strokeWidth={1.5}
                data-lane={c.lane}
                data-seq={c.seq}
              />
              {isHead && (
                <circle
                  cx={laneX(c.lane)}
                  cy={laneY(c.seq)}
                  r={DOT_R + 3}
                  style={{ stroke: laneVar(c.lane) }}
                  fill="none"
                  strokeWidth={1.2}
                  strokeDasharray="2.5 2"
                  data-testid="git-log-head-ring"
                />
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}
