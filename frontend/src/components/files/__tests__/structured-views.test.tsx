/**
 * structured-views 单测（ql-20260917-004）：JsonView 折叠树 / DiffView 红绿渲染。
 */

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { DiffView, JsonView, knownJsonView, tryParseJson } from "../structured-views";

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

  // ── ql-20260917-010：增量懒加载（去 5000 硬顶）────────────────────
  it("超大 diff 首屏 2000 行 + 续渲染按钮，点击增量加载直至全量（无总量上限）", () => {
    // 构造 5001 行 diff（1 hunk + 5000 ctx）
    const big = ["--- a/x", "+++ b/x", "@@ -1,5000 +1,5000 @@", ...Array.from({ length: 5000 }, (_, i) => ` line-${i}`)].join("\n");
    render(<DiffView content={big} />);
    const root = screen.getByTestId("diff-view");
    // 首屏渲染 2000 行（1 hunk + 1999 ctx；hunk 行不带 data-diff-kind），无截断警告
    expect(root.querySelectorAll("[data-diff-kind]").length).toBe(1999);
    expect(root.textContent).not.toContain("展示上限");
    // 哨兵按钮在，点击续渲染 +2000
    const more = screen.getByTestId("diff-view-more");
    expect(more.textContent).toContain("已渲染 2000/5001 行");
    fireEvent.click(more);
    expect(screen.getByTestId("diff-view").querySelectorAll("[data-diff-kind]").length).toBe(3999);
    // 再点到全量：哨兵消失
    fireEvent.click(screen.getByTestId("diff-view-more"));
    const root2 = screen.getByTestId("diff-view");
    expect(root2.querySelectorAll("[data-diff-kind]").length).toBe(5000);
    expect(screen.queryByTestId("diff-view-more")).toBeNull();
  });

  it("内容切换重置增量进度", () => {
    const { rerender } = render(<DiffView content={"--- a\n+++ b\n@@ -1,3 +1,3 @@\n a\n-b\n+c"} />);
    expect(screen.queryByTestId("diff-view-more")).toBeNull(); // 小 diff 无哨兵
    const big = ["--- a/x", "+++ b/x", "@@ -1,3000 +1,3000 @@", ...Array.from({ length: 3000 }, (_, i) => ` l${i}`)].join("\n");
    rerender(<DiffView content={big} />);
    // 3001 行（1 hunk + 3000 ctx）→ 首屏 2000 行 = 1 hunk + 1999 ctx
    expect(screen.getByTestId("diff-view").querySelectorAll("[data-diff-kind]").length).toBe(1999);
  });
});

// ── ql-20260917-010：固定结构报告 json 的表格视图分发 ─────────────────
describe("knownJsonView", () => {
  const scopeAudit = {
    mode: "full-flow",
    ok: true,
    degradedReason: null,
    baseAnchor: "4c6f5191c3af096df936810ce6fe996076e1e6e5",
    totals: { files: 2, additions: 30, deletions: 3 },
    rows: [
      { path: "frontend/src/a.tsx", additions: 3, deletions: 3, kind: "modified", planned: "修改", verdict: "planned" },
      { path: "docs/x.md", additions: 27, deletions: 0, kind: "new", planned: "新增", verdict: "unplanned" },
    ],
  };
  const applyManifest = {
    schemaVersion: 1,
    change: "demo",
    appliedAt: "2026-09-16T15:02:03.073Z",
    baseHash: "e3a25a76cb1d8d9acec3d048e99b40cd65920ea1bae0367701c737eff24a39b",
    files: [{ path: "frontend/src/a.tsx", sha256: "c7af2fed6b71372b3e9162ed9e551e7046c1ebf52304540805cfe70b3c5c4ab7" }],
  };
  const verifyFacts = {
    schemaVersion: 2,
    change: "demo",
    generatedAt: "2026-09-16T14:59:42.848Z",
    conclusion: "PASS WITH NOTES",
    probes: {
      probe1: { command: "sillyspec verify-probes --change demo", metrics: { matches: 0, skippedFiles: 0 } },
    },
    tests: { command: "module[frontend]", exitCode: 0, strategy: "module-subset", failedRemaining: [], passedAt: "2026-09-16T15:00:34.494Z" },
    factsConsistency: { checked: ["probe1"], verdict: "match", detail: null },
    handover: {
      count: 1,
      items: [{ type: "manual-acceptance", item: "390px 视觉冒烟", condition: "手机访问 /m/..." }],
    },
  };

  it("scope-audit.json → 裁决表格（徽章/路径/统计齐全）", () => {
    const node = knownJsonView("scope-audit.json", scopeAudit);
    expect(node).not.toBeNull();
    const { container } = render(<div>{node}</div>);
    expect(container.querySelector('[data-testid="scope-audit-view"]')).not.toBeNull();
    expect(container.textContent).toContain("✓ 计划内");
    expect(container.textContent).toContain("⚠️ 计划外");
    expect(container.textContent).toContain("frontend/src/a.tsx");
    expect(container.textContent).toContain("+30");
    expect(container.textContent).toContain("−3");
  });

  it("apply-manifest.json → 哈希清单表格", () => {
    const node = knownJsonView("apply-manifest.json", applyManifest);
    expect(node).not.toBeNull();
    const { container } = render(<div>{node}</div>);
    expect(container.querySelector('[data-testid="apply-manifest-view"]')).not.toBeNull();
    expect(container.textContent).toContain("frontend/src/a.tsx");
    expect(container.textContent).toContain("c7af2fed6b71372b…");
  });

  it("verify-facts.json → 探针/测试/一致性/移交分段", () => {
    const node = knownJsonView("verify-facts.json", verifyFacts);
    expect(node).not.toBeNull();
    const { container } = render(<div>{node}</div>);
    const el = container.querySelector('[data-testid="verify-facts-view"]');
    expect(el).not.toBeNull();
    expect(el!.textContent).toContain("PASS WITH NOTES");
    expect(el!.textContent).toContain("probe1");
    expect(el!.textContent).toContain("matches=0");
    expect(el!.textContent).toContain("退出码 0");
    expect(el!.textContent).toContain("390px 视觉冒烟");
  });

  it("其他 json 名 / 结构不符 → null（调用方回落 JsonView 折叠树）", () => {
    expect(knownJsonView("config.json", scopeAudit)).toBeNull();
    // 名字命中但结构漂移（rows 缺失）→ null
    expect(knownJsonView("scope-audit.json", { mode: "full-flow", ok: true })).toBeNull();
    // 完整路径按 basename 分发
    expect(knownJsonView("some/dir/verify-facts.json", verifyFacts)).not.toBeNull();
  });
});
