/**
 * 2026-10-13-agentlog-write-diff：agent-log 视图 Write 工具卡 diff 渲染单测。
 *
 * 经导出入口 ToolCallPreview（tool=Write 分派到 WriteToolPreview）断言：
 * - 有 editPatch（structuredPatch JSON）→ 红删绿增 DiffView + 变更对比标题 + 复制完整原文
 * - 无 editPatch → 保持既有「内容预览」全文形态（零回归）
 */
import { describe, it, expect } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

import { ToolCallPreview } from "../tool-renderers";
import type { ToolCallEntry } from "../types";

function writeEntry(content: string): ToolCallEntry {
  return {
    timestamp: "2026-10-13T10:00:00.000Z",
    tool: "Write",
    args: JSON.stringify({ file_path: "src/a.ts", content }),
    status: "allowed",
    success: true,
    rawArgs: { file_path: "src/a.ts", content },
  };
}

describe("WriteToolPreview diff 渲染（2026-10-13-agentlog-write-diff）", () => {
  it("有 editPatch：structuredPatch 红删绿增渲染，标题「变更对比（覆盖写入 +2 −1）」，复制完整原文", () => {
    const patch = JSON.stringify([
      { oldStart: 1, newStart: 1, oldLines: 1, newLines: 2, lines: ["-old-line", "+new-A", "+new-B"] },
    ]);
    render(
      <ToolCallPreview
        entry={writeEntry("new-A\nnew-B")}
        mergedResult="The file src/a.ts has been updated."
        editPatch={patch}
      />,
    );
    const delRow = screen.getByText("old-line").closest("div.flex");
    const addRow = screen.getByText("new-A").closest("div.flex");
    expect(delRow?.className).toContain("bg-red-500/10");
    expect(addRow?.className).toContain("bg-emerald-500/10");
    expect(screen.getByText(/变更对比（覆盖写入 \+2 −1）/)).toBeTruthy();
    // 复制按钮复制完整新文件内容（不随 diff 截断）
    expect(screen.getByTitle("复制内容")).toBeTruthy();
    cleanup();
  });

  it("无 editPatch：保持既有「内容预览」全文形态（零回归）", () => {
    render(
      <ToolCallPreview
        entry={writeEntry("line-1\nline-2")}
        mergedResult="File created successfully at: src/a.ts"
      />,
    );
    expect(screen.getByText(/内容预览 \(2 行\)/)).toBeTruthy();
    expect(screen.queryByText(/变更对比/)).toBeNull();
    cleanup();
  });

  it("editPatch 非法 JSON → 回退既有全文预览（不崩）", () => {
    render(<ToolCallPreview entry={writeEntry("line-1")} editPatch="not json" />);
    expect(screen.getByText(/内容预览 \(1 行\)/)).toBeTruthy();
    expect(screen.queryByText(/变更对比/)).toBeNull();
    cleanup();
  });
});
