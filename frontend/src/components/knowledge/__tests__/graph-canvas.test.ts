/**
 * GraphCanvas 纯函数单测（task-09 / 2026-10-08-platform-knowledge-graph /
 * FR-06 / D-003@v1）。
 *
 * jsdom 无 canvas 2D 上下文，画布交互（缩放/平移/拾取回调/rAF 循环）不可测
 * ——以力场/静态/lite 布局/拾取/适配具名导出纯函数覆盖（commit-graph.tsx
 * 先例，见 task-06 头注释「task-09 单测消费面」）：
 *
 *   - stepForceLayout：两节点弹簧距离多步快进趋近自然长（远/近双起点）+
 *     NaN 坐标自愈（中心 160 圆环复位）；
 *   - pickNode：最近者胜 + 屏幕向 7px 容差内外（随缩放 7/k 换算）；
 *   - fitView：包围盒居中 + 缩放上下夹 [0.08, 2]；
 *   - staticLayout：>200（201 节点）降级判定口径 + 同输入同输出确定性 +
 *     同类型同环摆放；
 *   - liteClusterLayout：count 降序/key 升序钉死 + 乱序输入同输出 +
 *     气泡半径下限 56 与代表节点簇内摆放；
 *   - edgeDash：strong/medium/weak 三档线型映射（未知档归 strong）。
 */

import { describe, expect, it } from "vitest";

import {
  EDGE_STRENGTH_REST,
  edgeDash,
  fitView,
  FORCE_NODE_LIMIT,
  graphBbox,
  liteClusterLayout,
  pickNode,
  staticLayout,
  stepForceLayout,
  type LiteClusterInput,
  type SimEdge,
  type SimNode,
} from "@/components/knowledge/graph-canvas";

/** 仿真节点工厂（缺省 file/r=6/静止初速；px/py 默认取 x/y）。 */
function simNode(p: Partial<SimNode> & Pick<SimNode, "id">): SimNode {
  const x = p.x ?? 0;
  const y = p.y ?? 0;
  return {
    id: p.id,
    type: p.type ?? "file",
    label: p.label ?? p.id,
    r: p.r ?? 6,
    x,
    y,
    px: p.px ?? x,
    py: p.py ?? y,
    drag: false,
    mx: null,
    my: null,
  };
}

function edge(s: string, t: string, strength = "strong", type = "anchors"): SimEdge {
  return { s, t, type, strength };
}

// ── stepForceLayout：弹簧收敛 + NaN 自愈 ───────────────────────────────────

describe("stepForceLayout（velocity Verlet 力场单步）", () => {
  /** 强边弹簧自然长 = 档位基数 × 半径和/14（graph-canvas 契约）。 */
  const restOf = (a: SimNode, b: SimNode) =>
    EDGE_STRENGTH_REST.strong * ((a.r + b.r) / 14);

  it("两节点远距起始：多步快进后距离收敛到自然长带（斥力/弹簧/向心平衡）", () => {
    const a = simNode({ id: "a", type: "module", r: 11, x: 100, y: 300 });
    const b = simNode({ id: "b", type: "project", r: 13, x: 700, y: 300 });
    const rest = restOf(a, b); // 110 × 24/14 ≈ 188.57
    expect(rest).toBeCloseTo(188.57, 2);

    stepForceLayout([a, b], [edge("a", "b")], 4000, { width: 800, height: 600 });

    const d = Math.hypot(a.x - b.x, a.y - b.y);
    // 平衡点 = 弹簧 + 斥力 + 向心合成，略偏自然长（±20% 带内即「趋近自然长」）。
    expect(d).toBeGreaterThan(rest * 0.8);
    expect(d).toBeLessThan(rest * 1.2);
    // 从 600 起始净收敛（弹簧内拉主导）。
    expect(d).toBeLessThan(600);
  });

  it("两节点近距起始：被弹簧/斥力推开并稳定到自然长带", () => {
    const a = simNode({ id: "a", type: "module", r: 11, x: 380, y: 300 });
    const b = simNode({ id: "b", type: "project", r: 13, x: 420, y: 300 });
    const rest = restOf(a, b);

    stepForceLayout([a, b], [edge("a", "b")], 4000, { width: 800, height: 600 });

    const d = Math.hypot(a.x - b.x, a.y - b.y);
    expect(d).toBeGreaterThan(rest * 0.8);
    expect(d).toBeLessThan(rest * 1.2);
    expect(d).toBeGreaterThan(40); // 从 40 起始净推开
  });

  it("NaN 坐标自愈：一步后复位到画布中心半径 160 圆环（坐标恢复有限）", () => {
    const broken = simNode({ id: "bad", type: "file" });
    broken.x = Number.NaN;
    broken.y = Number.NaN;
    broken.px = Number.NaN;
    broken.py = Number.NaN;
    const ok = simNode({ id: "ok", type: "file", x: 500, y: 300 });

    stepForceLayout([broken, ok], [], 1, { width: 800, height: 600 });

    expect(Number.isFinite(broken.x)).toBe(true);
    expect(Number.isFinite(broken.y)).toBe(true);
    expect(Number.isFinite(ok.x)).toBe(true);
    // 中心 (400,300) 半径 160 圆环复位（NaN_RESET_RADIUS）。
    expect(Math.hypot(broken.x - 400, broken.y - 300)).toBeCloseTo(160, 6);
  });

  it("空节点集与 dt=0 为无操作（不抛错）", () => {
    expect(() => stepForceLayout([], [], 5, { width: 800, height: 600 })).not.toThrow();
    const a = simNode({ id: "a", x: 10, y: 10 });
    stepForceLayout([a], [], 0, { width: 800, height: 600 });
    expect(a.x).toBe(10);
    expect(a.y).toBe(10);
  });
});

// ── pickNode：最近者胜 + 容差内外 ───────────────────────────────────────────

describe("pickNode（拾取最近者胜）", () => {
  it("两点重叠可选区：距离最近者胜", () => {
    const a = simNode({ id: "a", x: 0, y: 0 });
    const b = simNode({ id: "b", x: 20, y: 0 });
    // (12.5,0) 两点均在 r+7=13 内，b 距 7.5 < a 距 12.5。
    expect(pickNode([a, b], 12.5, 0, 1)?.id).toBe("b");
    expect(pickNode([a, b], 7.4, 0, 1)?.id).toBe("a");
  });

  it("容差内外：屏幕向 7px 恒定容差（k=1）", () => {
    const a = simNode({ id: "a", x: 0, y: 0 }); // r=6 → 命中半径 13
    expect(pickNode([a], 12, 0, 1)).not.toBeNull(); // 容差内
    expect(pickNode([a], 14, 0, 1)).toBeNull(); // 容差外
  });

  it("容差随缩放换算 7/k：缩小（k=0.5）时容差放大到世界向 14", () => {
    const a = simNode({ id: "a", x: 0, y: 0 }); // 命中半径 6+14=20
    expect(pickNode([a], 19, 0, 0.5)).not.toBeNull();
    // 同一世界坐标在 k=1 下容差外。
    expect(pickNode([a], 19, 0, 1)).toBeNull();
  });

  it("NaN 坐标节点跳过 + 空集回 null", () => {
    const bad = simNode({ id: "bad", x: 0, y: 0 });
    bad.x = Number.NaN;
    expect(pickNode([bad], 0, 0, 1)).toBeNull();
    expect(pickNode([], 0, 0, 1)).toBeNull();
  });
});

// ── fitView：包围盒 + 缩放上下夹 ───────────────────────────────────────────

describe("fitView（视口适配）", () => {
  it("小包围盒：缩放上夹 2 并居中", () => {
    const v = fitView({ x0: 0, y0: 0, x1: 100, y1: 100 }, 800, 600);
    // 原始 k=min(800/160,600/160)=5 → 夹 2；中心点 (50,50) 映射到画布中心。
    expect(v.k).toBe(2);
    expect(v.x).toBe(800 / 2 - 50 * 2);
    expect(v.y).toBe(600 / 2 - 50 * 2);
  });

  it("巨包围盒：缩放下夹 0.08", () => {
    const v = fitView({ x0: 0, y0: 0, x1: 10000, y1: 10000 }, 800, 600);
    // 原始 k=600/10060≈0.0596 → 夹 0.08。
    expect(v.k).toBe(0.08);
    expect(v.x).toBeCloseTo(800 / 2 - 5000 * 0.08, 10);
    expect(v.y).toBeCloseTo(600 / 2 - 5000 * 0.08, 10);
  });

  it("常规包围盒：k=min(w,h)/尺寸+pad 且几何居中（不触夹）", () => {
    const v = fitView({ x0: 0, y0: 0, x1: 400, y1: 400 }, 800, 600);
    const k = Math.min(800 / 460, 600 / 460); // 高度向约束 600/460
    expect(v.k).toBeCloseTo(k, 10);
    expect(v.x).toBeCloseTo(800 / 2 - 200 * k, 10);
    expect(v.y).toBeCloseTo(600 / 2 - 200 * k, 10);
  });

  it("graphBbox：空集回全零退化盒", () => {
    expect(graphBbox([])).toEqual({ x0: 0, y0: 0, x1: 0, y1: 0 });
    const box = graphBbox([simNode({ id: "a", x: -30, y: 10 }), simNode({ id: "b", x: 50, y: -70 })]);
    expect(box).toEqual({ x0: -30, y0: -70, x1: 50, y1: 10 });
  });
});

// ── staticLayout：>200 降级 + 确定性 ───────────────────────────────────────

describe("staticLayout（确定性静态降级布局）", () => {
  /** 201 节点（4 类型交错）——超 FORCE_NODE_LIMIT 触发组件侧降级判定的口径。 */
  function makeNodes(count: number): SimNode[] {
    const types = ["file", "decision", "fr", "module"];
    return Array.from({ length: count }, (_, i) =>
      simNode({
        id: `n${String(i).padStart(3, "0")}`,
        type: types[i % types.length] ?? "file",
      }),
    );
  }

  it("降级判定口径：FORCE_NODE_LIMIT=200，201 超限 / 200 不超限", () => {
    expect(FORCE_NODE_LIMIT).toBe(200);
    expect(makeNodes(201).length > FORCE_NODE_LIMIT).toBe(true);
    expect(makeNodes(200).length > FORCE_NODE_LIMIT).toBe(false);
  });

  it("201 节点：同输入同输出（确定性）+ 坐标全部有限", () => {
    const a = makeNodes(201);
    const b = a.map((n) => ({ ...n }));
    staticLayout(a);
    staticLayout(b);
    expect(b.map((n) => [n.id, n.x, n.y])).toEqual(a.map((n) => [n.id, n.x, n.y]));
    for (const n of a) {
      expect(Number.isFinite(n.x)).toBe(true);
      expect(Number.isFinite(n.y)).toBe(true);
      // 布局后速度载体清零（不残留力场速度）。
      expect(n.px).toBe(n.x);
      expect(n.py).toBe(n.y);
    }
  });

  it("按类型分环：同类型节点等距原点（同一环），环半径 ≥ 基数 130", () => {
    const nodes = makeNodes(201);
    staticLayout(nodes);
    const byType = new Map<string, number[]>();
    for (const n of nodes) {
      const d = Math.hypot(n.x, n.y);
      const arr = byType.get(n.type) ?? [];
      arr.push(d);
      byType.set(n.type, arr);
    }
    for (const [type, dists] of byType) {
      expect(dists.length).toBeGreaterThan(0);
      for (const d of dists) {
        expect(d).toBeCloseTo(dists[0]!, 6); // 同环同半径
      }
      expect(dists[0]).toBeGreaterThanOrEqual(130); // STATIC_RING_BASE
      expect(type).toBeTruthy();
    }
  });
});

// ── liteClusterLayout：簇摆放确定性 ────────────────────────────────────────

describe("liteClusterLayout（lite 簇摆放，D-008@v2）", () => {
  const clusters: LiteClusterInput[] = [
    { key: "b", label: "B 簇", count: 5, representatives: [{ id: "rb1" }, { id: "rb2" }] },
    { key: "a", label: "A 簇", count: 5, representatives: [{ id: "ra1" }] },
    { key: "c", label: "C 簇", count: 9, representatives: [] },
    { key: "d", label: "D 簇", count: 1, representatives: [{ id: "rd1" }] },
  ];

  it("确定性：同输入同输出；乱序输入经 count 降序 + key 升序归一后仍同输出", () => {
    const p1 = liteClusterLayout(clusters);
    const p2 = liteClusterLayout([...clusters]);
    const p3 = liteClusterLayout([...clusters].reverse());
    expect(p2).toEqual(p1);
    expect(p3).toEqual(p1);
    // 排序钉死：c(9) → a(5) → b(5，同数 key 升序) → d(1)。
    expect(p1.map((p) => p.key)).toEqual(["c", "a", "b", "d"]);
  });

  it("气泡半径下限 56（count 开方增长但不小于下限）+ 代表节点在簇内摆放", () => {
    const p = liteClusterLayout(clusters);
    const byKey = new Map(p.map((c) => [c.key, c]));
    // count=1 → sqrt(1)*9=9 → max(56, 9)=56。
    expect(byKey.get("d")?.radius).toBe(56);
    // count=9 → sqrt(9)*9=27 → 56（仍下限）；count=25 才会超下限（此处验证增长函数存在即可）。
    expect(byKey.get("c")?.radius).toBe(56);
    const big = liteClusterLayout([
      { key: "big", count: 100, representatives: [{ id: "r1" }, { id: "r2" }, { id: "r3" }] },
    ]);
    expect(big[0]?.radius).toBe(Math.sqrt(100) * 9); // 90 > 56
    // 代表节点内圈等角分布：距簇心 ≤ 半径。
    const b = byKey.get("b")!;
    for (const rep of b.reps) {
      expect(Math.hypot(rep.x - b.x, rep.y - b.y)).toBeLessThanOrEqual(b.radius);
    }
    expect(b.reps).toHaveLength(2);
  });

  it("空簇集回空数组", () => {
    expect(liteClusterLayout([])).toEqual([]);
  });
});

// ── edgeDash：三档线型映射 ─────────────────────────────────────────────────

describe("edgeDash（边三档线型）", () => {
  it("strong 实线 1.6 / medium 长虚 6,5 1.1 / weak 点虚 2,4 1.1", () => {
    expect(edgeDash("strong")).toEqual({ dash: [], width: 1.6 });
    expect(edgeDash("medium")).toEqual({ dash: [6, 5], width: 1.1 });
    expect(edgeDash("weak")).toEqual({ dash: [2, 4], width: 1.1 });
  });

  it("未知/空强度归 strong（结构边缺省档）", () => {
    expect(edgeDash("")).toEqual({ dash: [], width: 1.6 });
    expect(edgeDash("foo")).toEqual({ dash: [], width: 1.6 });
  });
});
