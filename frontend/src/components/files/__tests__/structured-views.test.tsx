/**
 * structured-views 单测（ql-20260917-004）：JsonView 折叠树 / DiffView 红绿渲染。
 */

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
  DiffView,
  JsonView,
  JsonlView,
  knownJsonView,
  knownJsonlView,
  PatchTreeView,
  TimelineView,
  tryParseJson,
  tryParseJsonl,
  tryParsePatchFiles,
  tryParseTimeline,
  type JsonValue,
} from "../structured-views";

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

  // ── 2026-10-09-close-trace-single-set-platform：收口留痕单套清单（含 scopeAudit 子对象）──
  it("change-patch.json（含 scopeAudit）→ 清单摘要 + 交付文件表 + 对账快照复用", () => {
    const changePatch = {
      change: "2026-10-09-demo",
      baseline: "ec5ee3dcd9db863a0f11c382b79bafee9c8b3cce",
      head: "524546f45bc4149b101c35a0feda8fcd185bdf04",
      files: ["frontend/src/a.tsx", "docs/x.md"],
      totals: { files: 2, additions: 30, deletions: 3 },
      savedAt: "2026-10-09T06:00:00.000Z",
      patchSha256: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      patchStatus: "ok",
      scopeAudit: {
        mode: "full-flow",
        ok: true,
        degradedReason: null,
        baseAnchor: "ec5ee3dcd9db863a0f11c382b79bafee9c8b3cce",
        totals: { files: 2, additions: 30, deletions: 3 },
        rows: [
          { path: "frontend/src/a.tsx", additions: 3, deletions: 3, kind: "modified", verdict: "planned" },
        ],
        excluded: { foreignDeclared: [] },
        closedBy: "flow done",
      },
    };
    const node = knownJsonView("change-patch.json", changePatch);
    expect(node).not.toBeNull();
    const { container } = render(<div>{node}</div>);
    const el = container.querySelector('[data-testid="change-patch-view"]');
    expect(el).not.toBeNull();
    // 清单摘要面：变更名 / 冻结徽章 / ±统计 / 锚点截断
    expect(el!.textContent).toContain("2026-10-09-demo");
    expect(el!.textContent).toContain("✓ patch 已冻结");
    expect(el!.textContent).toContain("+30");
    expect(el!.textContent).toContain("−3");
    expect(el!.textContent).toContain("ec5ee3dcd9db…");
    // 交付文件表
    expect(el!.textContent).toContain("frontend/src/a.tsx");
    expect(el!.textContent).toContain("docs/x.md");
    // scopeAudit 子对象复用 ScopeAuditView（对账快照小节 + 裁决徽章）
    expect(el!.textContent).toContain("范围对账快照");
    expect(el!.querySelector('[data-testid="scope-audit-view"]')).not.toBeNull();
    expect(el!.textContent).toContain("✓ 计划内");
  });

  it("change-patch.json（旧形态无 scopeAudit）→ 清单面照常 + 降级说明；结构漂移 → null", () => {
    const legacy = {
      change: "2026-09-25-demo",
      files: ["frontend/src/a.tsx"],
      totals: { files: 1, additions: 3, deletions: 0 },
      savedAt: "2026-09-25T06:00:00.000Z",
      patchStatus: "ok",
    };
    const node = knownJsonView("change-patch.json", legacy);
    expect(node).not.toBeNull();
    const { container } = render(<div>{node}</div>);
    const el = container.querySelector('[data-testid="change-patch-view"]');
    expect(el).not.toBeNull();
    expect(el!.textContent).toContain("frontend/src/a.tsx");
    expect(el!.textContent).toContain("无 scopeAudit 对账面");
    // 名字命中但结构漂移（files 非数组）→ null（回落 JsonView）
    expect(knownJsonView("change-patch.json", { change: "x", totals: {} })).toBeNull();
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

// ── 2026-10-10-change-patch-cross-repo-view：跨仓冻结面（scopeAudit.repos[]）──
describe("knownJsonView 跨仓冻结面", () => {
  // producer 契约（sillyspec 2026-10-10-cross-repo-patch-freeze）：repos[] 条目
  // { key, repoPath?, anchor, totals, degraded, degradedReason, patch?, patchSha256? }
  const crossScopeAudit = {
    mode: "full-flow",
    ok: true,
    degradedReason: null,
    baseAnchor: "ec5ee3dcd9db863a0f11c382b79bafee9c8b3cce",
    totals: { files: 3, additions: 13, deletions: 2 },
    rows: [
      { path: "frontend/src/a.tsx", additions: 3, deletions: 2, kind: "modified", verdict: "planned" },
      { path: "sub-x/src/a.go", additions: 5, deletions: 0, kind: "modified", planned: "修改", verdict: "planned", crossRepo: "sub-x" },
    ],
    repos: [
      {
        key: "main",
        repoPath: "C:/Users/x/local-main",
        anchor: { source: "reviews-window", base: "ec5ee3dcd9db863a0f11c382b79bafee9c8b3cce", head: "524546f45bc4149b101c35a0feda8fcd185bdf04", label: "锡点区间 reviews" },
        totals: { files: 2, additions: 10, deletions: 2, planned: 2, unplanned: 0, untouched: 0 },
        degraded: false,
        degradedReason: null,
        patch: "--- a/f.tsx\n+++ b/f.tsx\n@@ -1,1 +1,2 @@\n x\n+y",
        patchSha256: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      },
      {
        key: "sub-y",
        anchor: { source: "head~1-window", base: null, head: null, label: "HEAD~1 窗口" },
        totals: { files: 1, additions: 3, deletions: 0, planned: 1, unplanned: 0, untouched: 0 },
        degraded: false,
        degradedReason: null,
        patch: null,
        patchSha256: null,
      },
      {
        key: "sub-gone",
        anchor: { source: "degraded", base: null, head: null, label: "degraded" },
        totals: { files: 1, additions: 0, deletions: 0, planned: 0, unplanned: 0, untouched: 1 },
        degraded: true,
        degradedReason: "跨仓采集不可达",
        patch: null,
        patchSha256: null,
      },
    ],
  };

  function renderChangePatch(scopeAudit: JsonValue) {
    const node = knownJsonView("change-patch.json", {
      change: "2026-10-10-demo",
      files: ["frontend/src/a.tsx"],
      totals: { files: 1, additions: 3, deletions: 0 },
      savedAt: "2026-10-10T06:00:00.000Z",
      patchStatus: "ok",
      scopeAudit,
    });
    expect(node).not.toBeNull();
    const { container } = render(<div>{node}</div>);
    const el = container.querySelector('[data-testid="scope-audit-view"]');
    expect(el).not.toBeNull();
    return el!;
  }

  it("change-patch.json（跨仓冻结）→ repos[] 每仓段+锚点 chip+三态 chips+降级段", () => {
    const el = renderChangePatch(crossScopeAudit as JsonValue);
    // 三段齐（主仓/跨仓/降级）
    expect(el!.querySelector('[data-testid="scope-audit-repo-seg-main"]')).not.toBeNull();
    expect(el!.querySelector('[data-testid="scope-audit-repo-seg-sub-y"]')).not.toBeNull();
    expect(el!.querySelector('[data-testid="scope-audit-repo-seg-sub-gone"]')).not.toBeNull();
    // 仓标识：main → 主仓；分段标题带仓数
    expect(el!.textContent).toContain("主仓");
    expect(el!.textContent).toContain("sub-y");
    expect(el!.textContent).toContain("按仓冻结面（3 仓）");
    // 锚点 chip：label 文案 + base 前 7 位；base 缺失 → —
    expect(el!.textContent).toContain("锡点区间 reviews");
    expect(el!.textContent).toContain("ec5ee3d");
    expect(el!.textContent).toContain("HEAD~1 窗口");
    // 三态 chips 计数取 repos[].totals 单一源
    expect(el!.querySelector('[data-testid="scope-audit-chip-main-planned"]')!.textContent).toContain("2");
    expect(el!.querySelector('[data-testid="scope-audit-chip-sub-y-planned"]')!.textContent).toContain("1");
    // 降级段：无 chips，⚠️ + 原因
    expect(el!.querySelector('[data-testid="scope-audit-repo-degraded-sub-gone"]')!.textContent).toContain("跨仓采集不可达");
    expect(el!.querySelector('[data-testid="scope-audit-chip-sub-gone-planned"]')).toBeNull();
    // repoPath 字段（本机布局）不渲染
    expect(el!.textContent).not.toContain("C:/Users/x/local-main");
  });

  it("rows 跨仓行路径后仓标徽章，主仓行无", () => {
    const el = renderChangePatch(crossScopeAudit as JsonValue);
    expect(el!.querySelector('[data-repo-badge="sub-x"]')).not.toBeNull();
    // 恰 1 个仓标（主仓行无 crossRepo 无徽章）
    expect(el!.querySelectorAll("[data-repo-badge]").length).toBe(1);
  });

  it("repos[].patch：非空正文折叠展开+sha 短哈希；null 诚实未采集；降级段无 patch 面", () => {
    const el = renderChangePatch(crossScopeAudit as JsonValue);
    // 默认折叠：无 diff-view，点开展开（parseUnifiedDiff 剥 + 前缀，按 add 行断言）
    expect(el!.querySelector('[data-testid="diff-view"]')).toBeNull();
    fireEvent.click(el!.querySelector('[data-testid="scope-audit-repo-patch-main"]')!);
    expect(el!.querySelector('[data-testid="diff-view"]')).not.toBeNull();
    // 行内容 span 在行号列之后（行 div 末位），textContent 含行号 "2"+"y"
    const addRow = el!.querySelector('[data-testid="diff-view"] [data-diff-kind="add"]')!;
    expect(addRow.querySelector("span:last-child")!.textContent).toBe("y");
    // sha 短哈希 + title 全量
    const shaEl = el!.querySelector('[data-testid="scope-audit-repo-patch-main"]')!.parentElement!.querySelector("span[title]");
    expect(shaEl!.textContent).toBe("bbbbbbbbbbbb…");
    expect(shaEl!.getAttribute("title")).toBe("bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb");
    // patch=null（非降级段）→ 诚实未采集，无 DiffView 干扰
    expect(el!.querySelector('[data-testid="scope-audit-repo-patch-missing-sub-y"]')!.textContent).toContain("patch 未采集");
    // 降级段整段 ⚠️：patch 键在场（null）也不渲染 patch 面
    expect(el!.querySelector('[data-testid="scope-audit-repo-patch-missing-sub-gone"]')).toBeNull();
    expect(el!.querySelector('[data-testid="scope-audit-repo-patch-sub-gone"]')).toBeNull();
  });

  it("旧形态（无 repos 键/无 patch 键）→ 现状渲染：无仓段/仓标/patch 面", () => {
    const el = renderChangePatch({
      mode: "full-flow",
      ok: true,
      degradedReason: null,
      baseAnchor: "ec5ee3dcd9db863a0f11c382b79bafee9c8b3cce",
      totals: { files: 1, additions: 3, deletions: 0 },
      rows: [{ path: "frontend/src/a.tsx", additions: 3, deletions: 0, kind: "new", verdict: "planned" }],
    });
    expect(el!.querySelector("[data-testid^='scope-audit-repo-seg-']")).toBeNull();
    expect(el!.querySelector("[data-repo-badge]")).toBeNull();
    expect(el!.textContent).not.toContain("按仓冻结面");
    expect(el!.textContent).not.toContain("跨仓 patch 正文");
    // 既有面不受影响
    expect(el!.textContent).toContain("✓ 计划内");
    // repos 非法条目（缺 key/非 record）防御跳过
    const el2 = renderChangePatch({ ...crossScopeAudit, repos: [{ nokey: true }, "junk", { key: "", totals: {} }] } as JsonValue);
    expect(el2.querySelector("[data-testid^='scope-audit-repo-seg-']")).toBeNull();
  });
});

// ── 2026-09-29-change-detail-timeline-files-polish：JSONL 视图族 ─────────
describe("tryParseJsonl", () => {
  it("逐行合法（含空行容忍）→ 行值数组", () => {
    expect(tryParseJsonl('{"a":1}\n\n{"b":2}\r\n')).toEqual([{ a: 1 }, { b: 2 }]);
  });

  it("任一行非法 / 全空 → null（调用方回落纯文本）", () => {
    expect(tryParseJsonl('{"a":1}\nnot-json')).toBeNull();
    expect(tryParseJsonl("")).toBeNull();
    expect(tryParseJsonl("   \n  ")).toBeNull();
  });
});

describe("knownJsonlView（watcher-events.jsonl 专用表格）", () => {
  // 显式 JsonValue[]：第三行缺 stage 键（真实缺键场景），裸字面量联合类型
  // 带 stage?: undefined 不满足索引签名
  const lines: JsonValue[] = [
    { ts: 1790518116696, kind: "file", stage: "proposal", detail: "proposal.md 出现", provisional: true },
    { ts: 1790518385326, kind: "file-update", stage: "requirements", detail: "requirements.md 内容变更", provisional: true },
    { ts: 1790519000000, kind: "commit", detail: "提交 790c594bf", provisional: true },
  ];

  it("watcher-events.jsonl → 时刻/类型徽章/阶段/详情表格", () => {
    const node = knownJsonlView("watcher-events.jsonl", lines);
    expect(node).not.toBeNull();
    const { container } = render(<div>{node}</div>);
    const el = container.querySelector('[data-testid="watcher-events-view"]');
    expect(el).not.toBeNull();
    expect(el!.textContent).toContain("文件出现");
    expect(el!.textContent).toContain("文件变更");
    expect(el!.textContent).toContain("提交");
    expect(el!.textContent).toContain("proposal");
    expect(el!.textContent).toContain("proposal.md 出现");
    expect(el!.textContent).toContain("行数 3");
  });

  it("完整路径按 basename 分发；其他名/结构不符 → null", () => {
    expect(knownJsonlView("some/dir/watcher-events.jsonl", lines)).not.toBeNull();
    expect(knownJsonlView("events.jsonl", lines)).toBeNull();
    // 名字命中但结构漂移（无 kind 字段行）→ null
    expect(knownJsonlView("watcher-events.jsonl", [{ foo: 1 }])).toBeNull();
  });
});

describe("JsonlView（通用逐行树）", () => {
  it("每行独立渲染折叠树，含行号", () => {
    const { container } = render(<JsonlView lines={[{ a: 1 }, [1, 2]]} />);
    expect(container.querySelector('[data-testid="jsonl-view"]')).not.toBeNull();
    expect(container.textContent).toContain("第 1 行");
    expect(container.textContent).toContain("第 2 行");
    expect(container.querySelectorAll('[data-testid="json-view"]').length).toBe(2);
  });
});

// ── 2026-10-13-change-files-view-polish：timeline.md 时间线 + change.patch 文件树 ──

const timelineSample = [
  "# 合成时间线快照 — demo-change",
  "",
  "> 烤制于归档链（2026-10-13T00:00:00.000Z）：事件流机本位。",
  "> 末尾事件可能晚于烤制未入快照。",
  "📅 demo-change — 合成时间线（thin｜事件流 × tasks.md × git 提交锚）",
  "",
  "── 事件时间轴 ──",
  "06:05:57  📝 tasks.md 内容变更",
  "05:39:32  🁢 变更诞生（工件 frontmatter created_at）",
  "05:40:08  🔀 66393f432  fix(daemon): 示例提交标题",
  "",
  "── 任务面（勾选时刻 ≈ 顺序推断）──",
  "task-02  ≈06:10:00   后做的任务描述…  aabba1111",
  "task-01  ≈06:05:57   先做的任务描述…  66ba4df44",
  "",
  "墙钟：30min｜事件 3 条｜提交 1｜任务 2/2 勾选",
].join("\n");

describe("tryParseTimeline", () => {
  it("解析事件/任务/脚注：事件任务按时刻升序，提交锚剥离，≈ 保留", () => {
    const data = tryParseTimeline(timelineSample);
    expect(data).not.toBeNull();
    expect(data!.title).toBe("合成时间线快照 — demo-change");
    expect(data!.intro).toHaveLength(2);
    expect(data!.meta).toContain("demo-change");
    expect(data!.events.map((e) => e.text)).toEqual([
      "🁢 变更诞生（工件 frontmatter created_at）",
      "🔀 66393f432  fix(daemon): 示例提交标题",
      "📝 tasks.md 内容变更",
    ]);
    // 任务按 ≈时刻升序（task-01 在前），提交哈希独立成字段
    expect(data!.tasks).toEqual([
      { id: "task-01", time: "≈06:05:57", desc: "先做的任务描述…", commit: "66ba4df44" },
      { id: "task-02", time: "≈06:10:00", desc: "后做的任务描述…", commit: "aabba1111" },
    ]);
    expect(data!.footnotes.join("\n")).toContain("墙钟：30min");
  });

  it("无「── 事件时间轴 ──」区块（格式漂移）→ null（调用方回落 markdown）", () => {
    expect(tryParseTimeline("# 普通文档\n\n正文而已")).toBeNull();
    expect(tryParseTimeline("")).toBeNull();
  });

  it("真实归档任务行形态：未勾（无时刻）排尾部，无提交锚⚠️/— 尾标剥离不进描述", () => {
    // 形态取自归档 2026-09-28-drop-observation-card（未勾+—）与
    // 2026-09-23-md-card-render（无提交锚⚠️），评审 P2 修正
    const data = tryParseTimeline(
      [
        "── 事件时间轴 ──",
        "05:00:00  🁢 变更诞生",
        "",
        "── 任务面（勾选时刻 ≈ 顺序推断）──",
        "task-02  未勾          第二条未勾任务            —",
        "task-01  ≈06:05:57   先做的任务描述…  无提交锚⚠️",
        "task-03  未勾          第三条未勾任务            —",
      ].join("\n"),
    )!;
    expect(data).not.toBeNull();
    expect(data.tasks).toEqual([
      { id: "task-01", time: "≈06:05:57", desc: "先做的任务描述…", commit: null },
      { id: "task-02", time: "未勾", desc: "第二条未勾任务", commit: null },
      { id: "task-03", time: "未勾", desc: "第三条未勾任务", commit: null },
    ]);
    // 任务行不落脚注
    expect(data.footnotes).toEqual([]);
  });
});

describe("TimelineView", () => {
  it("渲染竖向时间线：时刻+事件文本按升序、任务面、脚注分区", () => {
    const data = tryParseTimeline(timelineSample)!;
    const { container } = render(<TimelineView data={data} />);
    const el = container.querySelector('[data-testid="timeline-view"]')!;
    expect(el).not.toBeNull();
    expect(el.textContent).toContain("合成时间线快照 — demo-change");
    const events = Array.from(el.querySelectorAll('[data-testid="timeline-event"]'));
    expect(events).toHaveLength(3);
    // 升序：首行是 05:39:32 的变更诞生
    expect(events[0]!.textContent).toContain("05:39:32");
    expect(events[0]!.textContent).toContain("变更诞生");
    // 任务面 + 提交锚 + 脚注
    expect(el.querySelectorAll('[data-testid="timeline-task"]').length).toBe(2);
    expect(el.textContent).toContain("66ba4df44");
    expect(el.textContent).toContain("勾选时刻 ≈ 顺序推断");
    expect(el.textContent).toContain("墙钟：30min");
  });

  it("无任务面/脚注时省略对应分区，不渲染空壳", () => {
    const data = tryParseTimeline("── 事件时间轴 ──\n05:00:00  唯一事件")!;
    const { container } = render(<TimelineView data={data} />);
    expect(container.querySelector('[data-testid="timeline-event"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="timeline-task"]')).toBeNull();
  });
});

const patchSample = [
  "diff --git a/src/a.ts b/src/a.ts",
  "index 123..456 100644",
  "--- a/src/a.ts",
  "+++ b/src/a.ts",
  "@@ -1,3 +1,4 @@",
  " context",
  "-removed",
  "+added",
  "+added2",
  "diff --git a/src/gone.py b/src/gone.py",
  "deleted file mode 100644",
  "index 789..abc 100644",
  "--- a/src/gone.py",
  "+++ /dev/null",
  "@@ -1,2 +0,0 @@",
  "-old line 1",
  "-old line 2",
].join("\n");

describe("tryParsePatchFiles", () => {
  it("按 diff --git 切分文件段：路径/增删计数正确，删除文件回退旧路径", () => {
    const sections = tryParsePatchFiles(patchSample);
    expect(sections).not.toBeNull();
    expect(sections).toHaveLength(2);
    expect(sections![0]!.path).toBe("src/a.ts");
    expect(sections![0]!.adds).toBe(2);
    expect(sections![0]!.dels).toBe(1);
    // +++ /dev/null → 路径回退 --- a/ 侧
    expect(sections![1]!.path).toBe("src/gone.py");
    expect(sections![1]!.adds).toBe(0);
    expect(sections![1]!.dels).toBe(2);
    // 段文本含完整 diff 头（喂给 DiffView 解析）
    expect(sections![0]!.text).toContain("diff --git a/src/a.ts");
  });

  it("无 diff --git 头（单文件 diff / 非 diff）→ null（调用方回落整片 DiffView）", () => {
    expect(tryParsePatchFiles("--- a/x\n+++ b/x\n@@ -1 +1 @@\n-a\n+b")).toBeNull();
    expect(tryParsePatchFiles("")).toBeNull();
    expect(tryParsePatchFiles("纯文本内容")).toBeNull();
  });
});

describe("PatchTreeView", () => {
  it("默认全收起，点击文件行展开该文件 diff", () => {
    const sections = tryParsePatchFiles(patchSample)!;
    const { container } = render(<PatchTreeView sections={sections} />);
    const el = container.querySelector('[data-testid="patch-tree-view"]')!;
    expect(el).not.toBeNull();
    expect(el.textContent).toContain("2 个文件");
    expect(el.textContent).toContain("src/a.ts");
    expect(el.textContent).toContain("src/gone.py");
    // 收起态：hunk 头与 diff 行不渲染
    expect(el.textContent).not.toContain("@@ -1,3 +1,4 @@");
    expect(container.querySelector('[data-testid="diff-view"]')).toBeNull();
    // 展开第一个文件行 → 该文件 diff 在场
    const rows = Array.from(el.querySelectorAll('[data-testid="patch-file-row"]'));
    fireEvent.click(rows[0]!);
    expect(container.querySelector('[data-testid="diff-view"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="diff-view"]')!.textContent).toContain("added2");
  });
});
