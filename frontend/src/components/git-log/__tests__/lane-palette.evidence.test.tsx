/**
 * task-07（验收证据用例，非源码改动）：≥8 并发泳道辨识度证据。
 *
 * 对应 design.md §12 遗留第 2 条——「lane 色板固定 5 色循环复用，超 5 并发分支
 * 同色相邻 lane 的可辨识性——execute 验收时补 ≥8 泳道视图作辨识度证据，不辨识
 * 再扩色板」。本用例构造 8 并发 lane 的 commits 数据渲染 CommitGraph，断言：
 *
 * 1. 8 条 lane 圆点 fill 的取值分布呈 5 色循环复用模式（lane5=lane0 色、
 *    lane6=lane1 色、lane7=lane2 色）；
 * 2. 相邻 lane（含循环复用边界 lane4↔lane5、lane5↔lane6）色值互不相同
 *    ——同色复用仅发生在相隔 ≥5 的 lane 之间，不落在相邻 lane；
 * 3. dark 主题下 8 lane 色值与浅色主题（ai-native 全档 / blue 的 primary·accent
 *    档）不同——提亮档/换青档生效；
 * 4. 三主题（blue/ai-native/dark）均满足上述相邻可辨识性 → §12 遗留第 2 条
 *    结论：8 泳道下同色复用不发生在相邻 lane，辨识度成立，无需扩色板。
 *
 * 取值链：CommitGraph 容器注入 --lane0..4（值源自 themes.ts 单一源，随
 * useThemeStore 切换），圆点 fill 引用 var(--laneN)。本用例将 var 引用解析为
 * 具体色值断言，断言值同步落盘 verify-evidence-theme.md。
 *
 * 依据：tasks/task-07.md、design.md §5.4 / §12 遗留第 2 条、R-08。
 */

import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  CommitGraph,
  lanePalette,
  laneX,
  LANE_PALETTE_SIZE,
} from "@/components/git-log/commit-graph";
import type { GitLogCommitItem } from "@/lib/git-log";
import { useThemeStore } from "@/stores/theme";
import { themes, type ThemeName } from "@/styles/themes";

/** 8 并发 lane：每 lane 恰 1 个提交（lane i ↔ seq i），拓扑极简聚焦色值断言。 */
const LANE_COUNT = 8;

function buildEightLaneCommits(): GitLogCommitItem[] {
  return Array.from({ length: LANE_COUNT }, (_, i) => ({
    hash: `evidence${String(i).padStart(2, "0")}`,
    short: `ev${String(i).padStart(2, "0")}`,
    parents: [],
    message: `泳道证据提交 ${i}`,
    author_name: "qinyi",
    author_email: "qinyi@example.com",
    author_date: "2026-08-25T12:00:00Z",
    lane: i,
    seq: i,
    // 每条 lane 一条指向下一 lane 的换道曲线边（仅示意拓扑，不影响色值断言）
    edges:
      i < LANE_COUNT - 1
        ? [{ to_seq: i + 1, to_lane: i + 1, kind: "curve" as const }]
        : [],
    refs: [],
  }));
}

/** 渲染一次并返回：容器 --laneN 取值表 + 各 lane 圆点的 fill var 解析结果。 */
function renderEightLanes() {
  const commits = buildEightLaneCommits();
  render(
    <CommitGraph
      commits={commits}
      visibleSeqs={new Set(commits.map((c) => c.seq))}
      height={LANE_COUNT * 36}
    />,
  );
}

/** 当前主题下 8 条 lane 圆点的具体 fill 色值（var(--laneN) → 容器注入值）。 */
function resolveLaneFills(): string[] {
  const wrap = screen.getByTestId("git-log-graph");
  const containerVars = Array.from(
    { length: LANE_PALETTE_SIZE },
    (_, i) => wrap.style.getPropertyValue(`--lane${i}`),
  );
  const dots = Array.from(
    wrap.querySelectorAll("circle[data-lane]"),
  ) as SVGCircleElement[];
  // lane 号 → fill var 序号（--laneN 的 N），从圆点 inline style 解析
  const laneToVarIdx = new Map<number, number>();
  for (const dot of dots) {
    const style = dot.getAttribute("style") ?? "";
    const m = /fill:\s*var\(--lane(\d)\)/.exec(style);
    if (m != null) laneToVarIdx.set(Number(dot.dataset.lane), Number(m[1]));
  }
  return Array.from({ length: LANE_COUNT }, (_, lane) => {
    const varIdx = laneToVarIdx.get(lane);
    expect(varIdx, `lane${lane} 圆点应解析出 --laneN 引用`).toBeDefined();
    return containerVars[varIdx as number] ?? "";
  });
}

beforeEach(() => {
  act(() => {
    useThemeStore.getState().setTheme("ai-native");
  });
});

afterEach(() => {
  cleanup();
});

describe("≥8 泳道辨识度证据（task-07 / design §12 遗留第 2 条）", () => {
  it("8 条 lane 圆点齐全，cx 按 lane 递增（8 泳道并发形态成立）", () => {
    renderEightLanes();
    const dots = Array.from(
      screen.getByTestId("git-log-graph").querySelectorAll("circle[data-lane]"),
    ) as SVGCircleElement[];
    expect(dots).toHaveLength(LANE_COUNT);
    for (const dot of dots) {
      const lane = Number(dot.dataset.lane);
      expect(dot.getAttribute("cx")).toBe(String(laneX(lane)));
    }
  });

  it("fill 取值分布呈 5 色循环复用：lane5=lane0、lane6=lane1、lane7=lane2 色", () => {
    renderEightLanes();
    const fills = resolveLaneFills();
    expect(fills).toHaveLength(LANE_COUNT);
    // 循环复用模式（lane i 取 lanePalette[i % 5]）
    expect(fills[5]).toBe(fills[0]);
    expect(fills[6]).toBe(fills[1]);
    expect(fills[7]).toBe(fills[2]);
    // 未复用段前 5 条 lane 取值恰为 lanePalette 五系原序
    expect(fills.slice(0, 5)).toEqual(lanePalette("ai-native"));
  });

  it("色板五系两两互异（相邻可辨识的前置条件，三主题各自成立）", () => {
    for (const name of ["blue", "ai-native", "dark"] as const) {
      const palette = lanePalette(name);
      expect(new Set(palette).size).toBe(LANE_PALETTE_SIZE);
    }
  });

  it("三主题下相邻 lane（含循环复用边界）色值互不相同——辨识度成立", () => {
    renderEightLanes();
    for (const name of ["blue", "ai-native", "dark"] as const) {
      act(() => {
        useThemeStore.getState().setTheme(name);
      });
      const fills = resolveLaneFills();
      for (let lane = 0; lane + 1 < LANE_COUNT; lane += 1) {
        expect(
          fills[lane] !== fills[lane + 1],
          `${name} 主题 lane${lane}(${fills[lane]}) 与相邻 lane${lane + 1}(${fills[lane + 1]}) 同色`,
        ).toBe(true);
      }
      // §12 遗留第 2 条判定点：复用点 lane5（=lane0 色）与左右邻 lane4 / lane6(=lane1 色) 均不同色
      expect(fills[5]).not.toBe(fills[4]);
      expect(fills[5]).not.toBe(fills[6]);
    }
  });

  it("dark 主题 8 lane 色值与浅色不同（提亮/换青档生效）", () => {
    renderEightLanes();
    const capture = (name: ThemeName) => {
      act(() => {
        useThemeStore.getState().setTheme(name);
      });
      return resolveLaneFills();
    };
    const aiNative = capture("ai-native");
    const blue = capture("blue");
    const dark = capture("dark");

    // dark vs ai-native（默认浅色）：8 档全部不同（success/warning/error 600→500 提亮 + primary/accent 换青）
    for (let lane = 0; lane < LANE_COUNT; lane += 1) {
      expect(dark[lane], `dark lane${lane}`).not.toBe(aiNative[lane]);
    }
    // dark vs blue：blue 主题语义色本就取 500 系（与 dark 相同），差异落在 primary/accent 档
    // ——即 lane0/1/5/6（primary/accent 色位）必不同
    for (const lane of [0, 1, 5, 6]) {
      expect(dark[lane], `dark lane${lane} vs blue`).not.toBe(blue[lane]);
    }

    // 关键断言值（证据落盘口径）：三主题 8 lane 解析色值
    expect(aiNative).toEqual([
      "#7C3AED",
      "#0891B2",
      "#059669",
      "#D97706",
      "#DC2626",
      "#7C3AED",
      "#0891B2",
      "#059669",
    ]);
    expect(blue).toEqual([
      "#2563EB",
      "#06b6d4",
      "#10b981",
      "#f59e0b",
      "#ef4444",
      "#2563EB",
      "#06b6d4",
      "#10b981",
    ]);
    expect(dark).toEqual([
      "#0891b2",
      "#22d3ee",
      "#10b981",
      "#f59e0b",
      "#ef4444",
      "#0891b2",
      "#22d3ee",
      "#10b981",
    ]);
    // 与 themes.ts 单一源一致（防断言值与实现脱钩）
    expect(dark.slice(0, 5)).toEqual(lanePalette("dark"));
    expect(dark.slice(0, 5)).toEqual([
      themes.dark.color.primary,
      themes.dark.color.accent,
      themes.dark.color.semantic.success,
      themes.dark.color.semantic.warning,
      themes.dark.color.semantic.error,
    ]);
  });

  it("结论（§12 遗留第 2 条）：8 泳道同色复用不落在相邻 lane，无需扩色板", () => {
    // 数学口径：5 色循环下 lane i 与 lane j 同色 ⇔ (i-j) mod 5 === 0；
    // 相邻 lane 差恒为 1（mod 5 ≠ 0），同色复用只可能出现在相隔 ≥5 的 lane 上。
    for (let lane = 0; lane + 1 < LANE_COUNT; lane += 1) {
      expect((lane + 1 - lane) % LANE_PALETTE_SIZE).not.toBe(0);
    }
    renderEightLanes();
    const fills = resolveLaneFills();
    // 同色 lane 对枚举（8 lane 内）：仅 (0,5)、(1,6)、(2,7) 三对，间隔均为 5
    const sameColorPairs: Array<[number, number]> = [];
    for (let i = 0; i < LANE_COUNT; i += 1) {
      for (let j = i + 1; j < LANE_COUNT; j += 1) {
        if (fills[i] === fills[j]) sameColorPairs.push([i, j]);
      }
    }
    expect(sameColorPairs).toEqual([
      [0, 5],
      [1, 6],
      [2, 7],
    ]);
    for (const [i, j] of sameColorPairs) {
      expect(j - i).toBeGreaterThanOrEqual(LANE_PALETTE_SIZE);
    }
  });
});
