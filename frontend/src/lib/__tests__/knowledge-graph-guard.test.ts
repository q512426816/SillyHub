/**
 * isGraphNeighborsData 类型守卫（2026-10-15-assets-graph-narrow-typecheck）。
 *
 * 背景：change-assets-graph 组件对信封 data 裸 `"anchor" in` 收窄时 TS2339
 * （`?? null` 推断链联合的 in 收窄失效，见 knowledge.ts 守卫注释）。本文件钉
 * 守卫判定面：neighbors 形态放行、缺 anchor 的降级形态与空值拒绝——组件的
 * 「非 neighbors 分型整区隐藏」语义以此为判定源。
 */

import { describe, expect, it } from "vitest";

import { isGraphNeighborsData } from "@/lib/knowledge";

describe("isGraphNeighborsData 守卫三分型", () => {
  it("neighbors 形态（anchor/nodes/edges）→ 放行", () => {
    expect(
      isGraphNeighborsData({
        anchor: "conventions.md",
        nodes: [{ id: "conventions.md", type: "doc", label: "conventions" }],
        edges: [{ s: "conventions.md", t: "arch.md", type: "relates", strength: "" }],
      }),
    ).toBe(true);
  });

  it("缺 anchor 的分型（path 形态等非 neighbors 成员）→ 拒绝", () => {
    // 真实 GraphPathData 形态（生成类型同形，字段见 api-types.ts）：
    // 有数据但无 anchor 字段，组件按非 neighbors 分型整区隐藏。
    expect(
      isGraphNeighborsData({
        from: "conventions.md",
        to: "arch.md",
        found: false,
        reason: "node_not_found",
        hop_count: 0,
        hops: [],
      }),
    ).toBe(false);
  });

  it("空值（null/undefined）→ 拒绝", () => {
    expect(isGraphNeighborsData(null)).toBe(false);
    expect(isGraphNeighborsData(undefined)).toBe(false);
  });
});
