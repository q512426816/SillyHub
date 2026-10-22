// 2026-10-22-trajectory-view-redesign（D-013/D-014/D-019）：
// 账本视图模型——分组、轮次折叠、调用折叠、搜索过滤（AND、忽略折叠）、可见行。
import { describe, expect, it } from "vitest";

import type { Trajectory, TrajectoryRow } from "../build-trajectory";
import {
  buildLedgerView,
  collectCollapsibleCallGroups,
  visibleRecordIds,
} from "../trajectory-view-model";

function row(partial: Partial<TrajectoryRow> & { id: string; turnIndex: number }): TrajectoryRow {
  return {
    kind: "assistant",
    stepIndex: 1,
    depth: 0,
    status: "ok",
    startedAt: 0,
    endedAt: 0,
    durationMs: 0,
    ...partial,
  };
}

function makeTrajectory(rows: TrajectoryRow[]): Trajectory {
  return {
    rows,
    turns: [],
    lanes: { input: [], model: [], tool: [] },
    coverage: { modelMs: 0, toolMs: 0, windowMs: 1 },
    modelBasis: "approx",
    windowStart: 0,
    windowEnd: 1,
  };
}

const ROWS: TrajectoryRow[] = [
  row({ id: "t1:user", turnIndex: 1, kind: "user", inputText: "跑一下测试" }),
  row({ id: "t1:a1", turnIndex: 1, kind: "assistant", outputText: "开始执行" }),
  row({ id: "t1:tool1", turnIndex: 1, kind: "tool", toolName: "Bash", inputText: '{"command":"pnpm test"}', outputText: "ok" }),
  row({ id: "t1:tool2", turnIndex: 1, kind: "tool", toolName: "Read", inputText: '{"file_path":"a.ts"}' }),
  row({ id: "t2:user", turnIndex: 2, kind: "user", inputText: "继续" }),
  row({ id: "t2:a1", turnIndex: 2, kind: "assistant", outputText: "完成" }),
];

const EMPTY = { collapsedTurns: new Set<number>(), collapsedCalls: new Set<string>(), query: "" };

describe("buildLedgerView：分组与折叠", () => {
  it("按 turnIndex 分组，记录行保持顺序与类型标签", () => {
    const groups = buildLedgerView(makeTrajectory(ROWS), EMPTY);

    expect(groups.map((group) => group.turnIndex)).toEqual([1, 2]);
    expect(groups[0]!.rows.map((item) => item.record?.id)).toEqual([
      "t1:user",
      "t1:a1",
      "t1:tool1",
      "t1:tool2",
    ]);
    expect(groups[0]!.rows[2]!.kindLabel).toBe("工具");
    expect(groups[0]!.toolCallCount).toBe(2);
  });

  it("轮次折叠：保留首行 + 一条摘要行，摘要含步骤数与工具调用数", () => {
    const groups = buildLedgerView(makeTrajectory(ROWS), {
      ...EMPTY,
      collapsedTurns: new Set([1]),
    });

    const rows = groups[0]!.rows;
    expect(rows).toHaveLength(2);
    expect(rows[0]!.record?.id).toBe("t1:user");
    expect(rows[1]!.kind).toBe("summary");
    expect(rows[1]!.collapseAxis).toBe("turn");
    expect(rows[1]!.summary).toContain("4 个步骤");
    expect(rows[1]!.summary).toContain("2 个工具调用");
  });

  it("调用折叠：连续工具行合并为一条摘要行，组内记录隐藏", () => {
    const groups = collectCollapsibleCallGroups(makeTrajectory(ROWS));
    expect(groups).toHaveLength(1);
    expect(groups[0]!.key).toBe("t1:tool1");
    expect(groups[0]!.names).toEqual(["Bash", "Read"]);

    const view = buildLedgerView(makeTrajectory(ROWS), {
      ...EMPTY,
      collapsedCalls: new Set(["t1:tool1"]),
    });
    const rows = view[0]!.rows;
    expect(rows.some((item) => item.record?.id === "t1:tool1")).toBe(false);
    expect(rows.some((item) => item.record?.id === "t1:tool2")).toBe(false);
    const summary = rows.find((item) => item.kind === "summary");
    expect(summary?.collapseAxis).toBe("calls");
    expect(summary?.summary).toContain("2 个工具调用");
    expect(summary?.summary).toContain("Bash");
  });

  it("单个工具行不构成可折叠调用组", () => {
    const groups = collectCollapsibleCallGroups(
      makeTrajectory([row({ id: "a:tool", turnIndex: 1, kind: "tool", toolName: "Bash" })]),
    );
    expect(groups).toEqual([]);
  });
});

describe("buildLedgerView：搜索", () => {
  it("AND 分词、大小写不敏感，只保留命中记录", () => {
    const groups = buildLedgerView(makeTrajectory(ROWS), { ...EMPTY, query: "PNPM test" });

    const ids = groups.flatMap((group) => group.rows.map((item) => item.record?.id));
    expect(ids).toEqual(["t1:tool1"]);
  });

  it("有查询时忽略折叠（折叠状态下命中行仍显示）", () => {
    const groups = buildLedgerView(makeTrajectory(ROWS), {
      collapsedTurns: new Set([1]),
      collapsedCalls: new Set(["t1:tool1"]),
      query: "Bash",
    });

    const ids = groups.flatMap((group) => group.rows.map((item) => item.record?.id));
    expect(ids).toEqual(["t1:tool1"]);
    expect(groups.flatMap((group) => group.rows).some((item) => item.kind === "summary")).toBe(false);
  });

  it("零命中返回空分组数组", () => {
    const groups = buildLedgerView(makeTrajectory(ROWS), { ...EMPTY, query: "不存在的词" });
    expect(groups).toEqual([]);
  });
});

describe("visibleRecordIds", () => {
  it("只返回可见记录行（跳过摘要行与折叠隐藏行）", () => {
    const groups = buildLedgerView(makeTrajectory(ROWS), {
      ...EMPTY,
      collapsedCalls: new Set(["t1:tool1"]),
    });
    expect(visibleRecordIds(groups)).toEqual([
      "t1:user",
      "t1:a1",
      "t2:user",
      "t2:a1",
    ]);
  });
});
