/**
 * ql-20260824-019：工具展开区详情组件族单测。
 *
 * computeLineDiff（纯函数，行为规格）：修改/新增/删除/全同/超大回退 + 双侧行号语义。
 * ToolExpandBody（经 ToolRowView 的接线断言在 turn-segment-views.test.tsx，本文件
 * 只测 diff 视图的红/绿行底与行号列渲染）。
 */
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";

import { computeLineDiff, DiffView } from "../tool-args-detail";

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
