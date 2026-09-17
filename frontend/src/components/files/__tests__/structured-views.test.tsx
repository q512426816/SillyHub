/**
 * structured-views 单测（ql-20260917-004）：JsonView 折叠树 / DiffView 红绿渲染。
 */

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { DiffView, JsonView, tryParseJson } from "../structured-views";

describe("tryParseJson", () => {
  it("合法 json → 解析值", () => {
    expect(tryParseJson('{"a":1}')).toEqual({ a: 1 });
  });

  it("非法 json → null（调用方回落纯文本）", () => {
    expect(tryParseJson("{oops")).toBeNull();
    expect(tryParseJson("")).toBeNull();
  });
});

describe("JsonView", () => {
  const sample = {
    mode: "full-flow",
    ok: true,
    totals: { files: 9, additions: 1916 },
    rows: [
      { path: "a.tsx", additions: 3, deletions: 3, verdict: "planned" },
      { path: "b.tsx", additions: 7, deletions: 0, verdict: "planned" },
    ],
    degradedReason: null,
  };

  it("渲染顶层键与嵌套值（前两层默认展开）", () => {
    render(<JsonView value={sample} />);
    expect(screen.getByText("mode:")).toBeInTheDocument();
    expect(screen.getByText('"full-flow"')).toBeInTheDocument();
    expect(screen.getByText("totals:")).toBeInTheDocument();
    expect(screen.getByText("files:")).toBeInTheDocument();
    expect(screen.getByText("1916")).toBeInTheDocument();
    expect(screen.getAllByTestId("json-branch").length).toBeGreaterThan(0);
  });

  it("第三层默认折叠（rows 内对象收起），点击可收起父层", () => {
    render(<JsonView value={sample} />);
    // rows（depth 1）默认展开，其元素分支（depth 2）默认折叠——path 键不可见
    expect(screen.queryByText("path:")).toBeNull();
    const rowsBranch = screen.getByText("rows:").closest("button");
    expect(rowsBranch).not.toBeNull();
    fireEvent.click(rowsBranch!);
    // 收起后以摘要呈现
    expect(screen.getByText("[ … ] 2 项")).toBeInTheDocument();
  });

  it("数组摘要与原始值类型着色（null 斜体类）", () => {
    render(<JsonView value={sample} />);
    expect(screen.getByText("degradedReason:")).toBeInTheDocument();
    const nullValue = screen.getByText("null");
    expect(nullValue.className).toContain("italic");
  });
});

describe("DiffView", () => {
  const diffText = [
    "diff --git a/x.ts b/x.ts",
    "index 123..456 100644",
    "--- a/x.ts",
    "+++ b/x.ts",
    "@@ -1,3 +1,4 @@",
    " context line",
    "-removed line",
    "+added line",
    " tail line",
  ].join("\n");

  it("解析 unified diff：hunk/add/del/ctx 行齐全且跳过文件头", () => {
    render(<DiffView content={diffText} />);
    const root = screen.getByTestId("diff-view");
    expect(root.textContent).toContain("@@ -1,3 +1,4 @@");
    expect(root.querySelectorAll('[data-diff-kind="add"]').length).toBe(1);
    expect(root.querySelectorAll('[data-diff-kind="del"]').length).toBe(1);
    expect(root.querySelectorAll('[data-diff-kind="ctx"]').length).toBe(2);
    // 文件头（diff --git / index / --- / +++）不渲染
    expect(root.textContent).not.toContain("diff --git");
  });

  it("非 diff 内容回落纯文本（无 hunk）", () => {
    render(<DiffView content="就是一段普通文本" />);
    expect(screen.getByTestId("diff-view-raw").textContent).toContain("就是一段普通文本");
  });

  it("空内容回落（空文件）", () => {
    render(<DiffView content="" />);
    expect(screen.getByTestId("diff-view-raw").textContent).toContain("（空文件）");
  });
});
