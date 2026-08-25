/**
 * task-06：泳道图组件测试（lane/edges → SVG path/圆点渲染映射）。
 *
 * 覆盖（acceptance「泳道渲染断言」）：
 * 1. straight/curve 边按 lane 定 x、seq 定 y 产出 path d；
 * 2. 圆点 cx/cy 按 lane/seq 定位；HEAD commit 画虚线环（仅一个）；
 * 3. 边色按源 commit 的 lane 取 --lane0..4 变量（颜色数量断言）；
 * 4. 视口外行（visibleSeqs 不含的 seq）不产出 path 与圆点（R-05）；
 * 5. lanePalette 经 themes.ts 消费链取值，随主题切换亮暗档（dark 提亮档）。
 *
 * 依据：tasks/task-06.md acceptance、design.md §5.4 / D-001 / R-05。
 */

import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  CommitGraph,
  edgePath,
  lanePalette,
  laneX,
  laneY,
} from "@/components/git-log/commit-graph";
import type { GitLogCommitItem } from "@/lib/git-log";
import { useThemeStore } from "@/stores/theme";
import { themes } from "@/styles/themes";

// ── fixture：含分叉/合并/lane0-lane1 双泳道的 9 提交窗口 ─────────────────
//
// 主线 lane0：seq0(HEAD/main)→1→2→3→6→7(tag v1.0)→8
// 分支 lane1：seq3(merge)→4→5(分叉点，父边曲线回 lane0 seq6)
// 拓扑合法（seq 越大越旧，边目标均为更旧提交）。

function makeCommit(
  partial: Partial<GitLogCommitItem> & Pick<GitLogCommitItem, "seq" | "lane">,
): GitLogCommitItem {
  return {
    hash: `hash000${partial.seq}`,
    short: `s0${partial.seq}`,
    parents: [],
    message: `提交 ${partial.seq}`,
    author_name: "qinyi",
    author_email: "qinyi@example.com",
    author_date: "2026-08-25T12:00:00Z",
    edges: [],
    refs: [],
    ...partial,
  };
}

function buildCommits(): GitLogCommitItem[] {
  return [
    makeCommit({
      seq: 0,
      lane: 0,
      refs: [
        { name: "HEAD", kind: "head" },
        { name: "main", kind: "branch" },
      ],
      edges: [{ to_seq: 1, to_lane: 0, kind: "straight" }],
    }),
    makeCommit({
      seq: 1,
      lane: 0,
      edges: [{ to_seq: 2, to_lane: 0, kind: "straight" }],
    }),
    makeCommit({
      seq: 2,
      lane: 0,
      edges: [{ to_seq: 3, to_lane: 0, kind: "straight" }],
    }),
    // merge 提交（lane1）：第一父边直线（同 lane1），第二父边曲线回主线 lane0
    makeCommit({
      seq: 3,
      lane: 1,
      refs: [{ name: "feat/x", kind: "branch" }],
      edges: [
        { to_seq: 4, to_lane: 1, kind: "straight" },
        { to_seq: 6, to_lane: 0, kind: "curve" },
      ],
    }),
    makeCommit({
      seq: 4,
      lane: 1,
      edges: [{ to_seq: 5, to_lane: 1, kind: "straight" }],
    }),
    // 分叉点（lane1）：父提交在主线 lane0，曲线换道
    makeCommit({
      seq: 5,
      lane: 1,
      edges: [{ to_seq: 6, to_lane: 0, kind: "curve" }],
    }),
    makeCommit({
      seq: 6,
      lane: 0,
      edges: [{ to_seq: 7, to_lane: 0, kind: "straight" }],
    }),
    makeCommit({
      seq: 7,
      lane: 0,
      refs: [{ name: "v1.0", kind: "tag" }],
      edges: [{ to_seq: 8, to_lane: 0, kind: "straight" }],
    }),
    makeCommit({ seq: 8, lane: 0 }),
  ];
}

function allVisible(commits: GitLogCommitItem[]): Set<number> {
  return new Set(commits.map((c) => c.seq));
}

function queryGraph() {
  return screen.getByTestId("git-log-graph");
}

beforeEach(() => {
  // 主题 store 复位到默认（ai-native），避免用例间主题串扰
  act(() => {
    useThemeStore.getState().setTheme("ai-native");
  });
});

afterEach(() => {
  cleanup();
});

describe("edgePath 纯函数", () => {
  it("straight：同泳道竖线，x 按 lane、y 按 seq", () => {
    expect(edgePath(0, 0, 0, 1, "straight")).toBe(
      `M ${laneX(0)} ${laneY(0)} V ${laneY(1)}`,
    );
    expect(edgePath(0, 0, 0, 1, "straight")).toBe("M 16.5 18 V 54");
  });

  it("curve：换泳道贝塞尔（中点控制）", () => {
    // lane1 seq5 → lane0 seq6
    expect(edgePath(1, 5, 0, 6, "curve")).toBe(
      "M 30.5 198 C 30.5 216, 16.5 216, 16.5 234",
    );
  });

  it("curve 但两端同 x 时退化为竖线（防零宽曲线）", () => {
    expect(edgePath(1, 3, 1, 5, "curve")).toBe("M 30.5 126 V 198");
  });
});

describe("lanePalette 主题消费链", () => {
  it("三主题色板取 themes.ts 的 primary/accent/success/warning/error 五系", () => {
    for (const name of ["blue", "ai-native", "dark"] as const) {
      const c = themes[name].color;
      expect(lanePalette(name)).toEqual([
        c.primary,
        c.accent,
        c.semantic.success,
        c.semantic.warning,
        c.semantic.error,
      ]);
    }
  });

  it("dark 与浅色主题取值不同（亮暗档随主题切换）", () => {
    expect(lanePalette("dark")).not.toEqual(lanePalette("ai-native"));
    expect(lanePalette("blue")).not.toEqual(lanePalette("ai-native"));
  });
});

describe("CommitGraph 渲染", () => {
  it("全部可见：直线/曲线 path 数量与 d 坐标按 lane/seq 确定", () => {
    const commits = buildCommits();
    render(
      <CommitGraph
        commits={commits}
        visibleSeqs={allVisible(commits)}
        height={commits.length * 36}
      />,
    );

    const svg = queryGraph().querySelector("svg");
    expect(svg).not.toBeNull();
    const paths = Array.from(svg!.querySelectorAll("path"));
    // 9 条边：7 直线 + 2 曲线（seq3→6、seq5→6 曲线）
    expect(paths.filter((p) => p.dataset.kind === "straight")).toHaveLength(7);
    expect(paths.filter((p) => p.dataset.kind === "curve")).toHaveLength(2);

    // 具体坐标：seq0→1 直线；seq3→6 与 seq5→6 曲线
    const dList = paths.map((p) => p.getAttribute("d") ?? "");
    expect(dList).toContain("M 16.5 18 V 54");
    expect(dList).toContain("M 30.5 126 C 30.5 180, 16.5 180, 16.5 234");
    expect(dList).toContain("M 30.5 198 C 30.5 216, 16.5 216, 16.5 234");
  });

  it("圆点 cx 按 lane、cy 按 seq 定位；HEAD 虚线环恰一个", () => {
    const commits = buildCommits();
    render(
      <CommitGraph
        commits={commits}
        visibleSeqs={allVisible(commits)}
        height={commits.length * 36}
      />,
    );

    const svg = queryGraph().querySelector("svg")!;
    const dots = Array.from(
      svg.querySelectorAll("circle[data-lane]"),
    ) as SVGCircleElement[];
    expect(dots).toHaveLength(9);
    // lane0：seq 0/1/2/6/7/8 → cx=16.5；lane1：seq 3/4/5 → cx=30.5
    const lane0 = dots.filter((d) => d.dataset.lane === "0");
    const lane1 = dots.filter((d) => d.dataset.lane === "1");
    expect(lane0).toHaveLength(6);
    expect(lane1).toHaveLength(3);
    expect(lane0.map((d) => d.getAttribute("cx"))).toContain("16.5");
    expect(lane1.map((d) => d.getAttribute("cx"))).toContain("30.5");
    expect(dots.map((d) => d.getAttribute("cy"))).toContain(String(laneY(7)));

    // HEAD（seq0，refs 含 kind=head）虚线环；tag v1.0 不画环
    const rings = svg.querySelectorAll(
      'circle[data-testid="git-log-head-ring"]',
    );
    expect(rings).toHaveLength(1);
    expect(rings[0]?.getAttribute("stroke-dasharray")).toBe("2.5 2");
  });

  it("边色按源 commit lane 取 --laneN 变量（颜色数量）", () => {
    const commits = buildCommits();
    render(
      <CommitGraph
        commits={commits}
        visibleSeqs={allVisible(commits)}
        height={commits.length * 36}
      />,
    );

    const strokes = Array.from(
      queryGraph().querySelectorAll("path"),
    ).map((p) => p.getAttribute("style") ?? "");
    // lane0 源边（seq0/1/2/6/7）5 条、lane1 源边（seq3×2/seq4/seq5）4 条
    expect(strokes.filter((s) => s.includes("var(--lane0)"))).toHaveLength(5);
    expect(strokes.filter((s) => s.includes("var(--lane1)"))).toHaveLength(4);
    expect(strokes.filter((s) => s.includes("var(--lane2)"))).toHaveLength(0);
  });

  it("视口外行不产出 path 与圆点（R-05 视口重绘）", () => {
    const commits = buildCommits();
    const visible = new Set([0, 1, 2]);
    render(
      <CommitGraph commits={commits} visibleSeqs={visible} height={330} />,
    );

    const svg = queryGraph().querySelector("svg")!;
    // 只绘可视 3 行的源边（0→1、1→2、2→3）与 3 个圆点
    expect(svg.querySelectorAll("path")).toHaveLength(3);
    expect(svg.querySelectorAll("circle[data-lane]")).toHaveLength(3);
    // 视口外源行（如 seq7→8）不出现在任何 path 中
    const dList = Array.from(svg.querySelectorAll("path")).map(
      (p) => p.getAttribute("d") ?? "",
    );
    expect(dList.some((d) => d.includes(String(laneY(7))))).toBe(false);
    // 视口外行（seq8）无圆点
    const cys = Array.from(svg.querySelectorAll("circle[data-lane]")).map((c) =>
      c.getAttribute("cy"),
    );
    expect(cys).not.toContain(String(laneY(8)));
  });

  it("容器注入 --lane0..4 且随主题切换（themes.ts 取值）", () => {
    const commits = buildCommits();
    render(
      <CommitGraph
        commits={commits}
        visibleSeqs={allVisible(commits)}
        height={100}
      />,
    );
    const wrap = queryGraph();
    const style = wrap.style;
    expect(style.getPropertyValue("--lane0")).toBe(
      themes["ai-native"].color.primary,
    );
    expect(style.getPropertyValue("--lane4")).toBe(
      themes["ai-native"].color.semantic.error,
    );

    // 切 dark：--lane0 换为 dark 主题 primary（提亮档）
    act(() => {
      useThemeStore.getState().setTheme("dark");
    });
    expect(wrap.style.getPropertyValue("--lane0")).toBe(
      themes.dark.color.primary,
    );
  });
});
