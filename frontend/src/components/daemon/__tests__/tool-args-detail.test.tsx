/**
 * ql-20260824-019：工具展开区详情组件族单测。
 *
 * computeLineDiff（纯函数，行为规格）：修改/新增/删除/全同/超大回退 + 双侧行号语义。
 * parseStructuredPatch（ql-20260824-020）：SDK structuredPatch hunks → DiffRow[]
 * 真实文件行号（oldStart/newStart 起计、'\' 标记行跳过、多 hunk 分隔、非法回退 null）。
 * ToolExpandBody（经 ToolRowView 的接线断言在 turn-segment-views.test.tsx，本文件
 * 只测 diff 视图的红/绿行底与行号列渲染）。
 */
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";

import { computeLineDiff, DiffView, parseStructuredPatch } from "../tool-args-detail";

describe("computeLineDiff（Edit 行级 diff，LCS）", () => {
  it("修改一行：ctx / del / add / ctx 序列，双侧行号各自推进", () => {
    const rows = computeLineDiff("a\nb\nc", "a\nX\nc");
    expect(rows).toEqual([
      { type: "ctx", oldNo: 1, newNo: 1, text: "a" },
      { type: "del", oldNo: 2, newNo: null, text: "b" },
      { type: "add", oldNo: null, newNo: 2, text: "X" },
      { type: "ctx", oldNo: 3, newNo: 3, text: "c" },
    ]);
  });

  it("纯新增：追加行为 add，仅新侧行号", () => {
    const rows = computeLineDiff("a", "a\nb");
    expect(rows).toEqual([
      { type: "ctx", oldNo: 1, newNo: 1, text: "a" },
      { type: "add", oldNo: null, newNo: 2, text: "b" },
    ]);
  });

  it("纯删除：被删行为 del，仅旧侧行号", () => {
    const rows = computeLineDiff("a\nb", "a");
    expect(rows).toEqual([
      { type: "ctx", oldNo: 1, newNo: 1, text: "a" },
      { type: "del", oldNo: 2, newNo: null, text: "b" },
    ]);
  });

  it("完全相同：全 ctx，双侧行号同步", () => {
    const rows = computeLineDiff("x\ny", "x\ny");
    if (!rows) throw new Error("computeLineDiff should not return null for 2x2 input");
    expect(rows.every((r) => r.type === "ctx")).toBe(true);
    expect(rows.map((r) => [r.oldNo, r.newNo])).toEqual([
      [1, 1],
      [2, 2],
    ]);
  });

  it("超大输入（>100 万 LCS 单元格）返回 null，调用方回退两块展示", () => {
    const big = Array.from({ length: 1001 }, (_, i) => `line-${i}`).join("\n");
    expect(computeLineDiff(big, big + "\nextra")).toBeNull();
  });
});

describe("DiffView 渲染", () => {
  it("del 行红底 / add 行绿底 + 双侧行号列 + -/+ 标记", () => {
    const rows = computeLineDiff("a\nb", "a\nB");
    if (!rows) throw new Error("computeLineDiff should not return null for 2x2 input");
    render(<DiffView rows={rows} />);
    const delRow = screen.getByText("b").closest("div.flex");
    const addRow = screen.getByText("B").closest("div.flex");
    expect(delRow?.className).toContain("bg-red-500/10");
    expect(addRow?.className).toContain("bg-emerald-500/10");
    // 行号列：del 行旧侧 2、新侧空；add 行新侧 2、旧侧空
    expect(delRow?.textContent).toContain("2");
    expect(delRow?.textContent).toContain("-");
    expect(addRow?.textContent).toContain("+");
  });
});

describe("parseStructuredPatch（ql-20260824-020：SDK structuredPatch → 真实文件行号）", () => {
  it("单 hunk：oldStart/newStart 起计，ctx 双侧推进、del 仅旧侧、add 仅新侧", () => {
    const patch = JSON.stringify([
      {
        oldStart: 55,
        newStart: 55,
        oldLines: 3,
        newLines: 4,
        lines: [" ctx-a", "-del-b", "+add-B", "+add-B2", " ctx-c"],
      },
    ]);
    expect(parseStructuredPatch(patch)).toEqual([
      { type: "ctx", oldNo: 55, newNo: 55, text: "ctx-a" },
      { type: "del", oldNo: 56, newNo: null, text: "del-b" },
      { type: "add", oldNo: null, newNo: 56, text: "add-B" },
      { type: "add", oldNo: null, newNo: 57, text: "add-B2" },
      { type: "ctx", oldNo: 57, newNo: 58, text: "ctx-c" },
    ]);
  });

  it("多 hunk：各自 oldStart/newStart 起计，hunk 间插双侧空行号「…」分隔行", () => {
    const patch = JSON.stringify([
      { oldStart: 10, newStart: 10, oldLines: 2, newLines: 2, lines: [" a", "-b", "+B"] },
      { oldStart: 80, newStart: 80, oldLines: 1, newLines: 1, lines: ["-x", "+X"] },
    ]);
    expect(parseStructuredPatch(patch)).toEqual([
      { type: "ctx", oldNo: 10, newNo: 10, text: "a" },
      { type: "del", oldNo: 11, newNo: null, text: "b" },
      { type: "add", oldNo: null, newNo: 11, text: "B" },
      { type: "ctx", oldNo: null, newNo: null, text: "…" },
      { type: "del", oldNo: 80, newNo: null, text: "x" },
      { type: "add", oldNo: null, newNo: 80, text: "X" },
    ]);
  });

  it("'\\' 标记行（No newline at end of file）不占行号跳过", () => {
    const patch = JSON.stringify([
      {
        oldStart: 3,
        newStart: 3,
        oldLines: 2,
        newLines: 2,
        lines: ["-a", "\\ No newline at end of file", "+A", " b"],
      },
    ]);
    expect(parseStructuredPatch(patch)).toEqual([
      { type: "del", oldNo: 3, newNo: null, text: "a" },
      { type: "add", oldNo: null, newNo: 3, text: "A" },
      { type: "ctx", oldNo: 4, newNo: 4, text: "b" },
    ]);
  });

  it("非法 JSON / 形状不符（缺 oldStart、lines 非数组、空前缀行、空数组、未知前缀）→ null", () => {
    expect(parseStructuredPatch("not json")).toBeNull();
    expect(parseStructuredPatch("{}")).toBeNull();
    expect(parseStructuredPatch("[]")).toBeNull();
    expect(
      parseStructuredPatch(JSON.stringify([{ newStart: 1, lines: [" a"] }])),
    ).toBeNull();
    expect(
      parseStructuredPatch(JSON.stringify([{ oldStart: 1, newStart: 1, lines: "x" }])),
    ).toBeNull();
    expect(
      parseStructuredPatch(JSON.stringify([{ oldStart: 1, newStart: 1, lines: [""] }])),
    ).toBeNull();
    expect(
      parseStructuredPatch(JSON.stringify([{ oldStart: 1, newStart: 1, lines: ["?bad"] }])),
    ).toBeNull();
  });
});
