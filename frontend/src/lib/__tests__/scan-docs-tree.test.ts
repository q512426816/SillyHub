import { describe, it, expect } from "vitest";

import { buildTree, type TreeNode } from "../scan-docs-tree";
import type { ScanDocSummary } from "../scan-docs";

function makeDoc(path: string, doc_type = "OTHER"): ScanDocSummary {
  return {
    id: path,
    doc_type,
    path,
    title: path.split("/").pop() ?? null,
    exists: true,
    last_modified_at: null,
  };
}

describe("buildTree", () => {
  it("扁平布局 docs/<组件>/... 保留组件名层（daemon-client 场景）", () => {
    const tree = buildTree([
      makeDoc("docs/SillyHub/flows/auth.md"),
      makeDoc("docs/SillyHub/modules/agent.md"),
    ]);

    // 顶层是组件名 SillyHub；修复前 slice(2) 会把它连同 docs 一起切掉，
    // 树错误地从 flows/modules 开始。
    expect(tree.map((n) => n.name)).toEqual(["SillyHub"]);

    const hub = tree[0]!;
    expect(hub.children.map((c) => c.name)).toEqual(["flows", "modules"]);

    const flows = hub.children[0]!;
    expect(flows.name).toBe("flows");
    expect(flows.children[0]?.doc?.path).toBe("docs/SillyHub/flows/auth.md");
  });

  it("包裹布局 .sillyspec/docs/<组件>/... 同样保留组件名层（server-local 场景）", () => {
    const tree = buildTree([
      makeDoc(".sillyspec/docs/SillyHub/scan/ARCHITECTURE.md", "ARCHITECTURE"),
    ]);

    expect(tree.map((n) => n.name)).toEqual(["SillyHub"]);
    expect(tree[0]!.children[0]!.name).toBe("scan");
    expect(tree[0]!.children[0]!.children[0]?.doc?.path).toBe(
      ".sillyspec/docs/SillyHub/scan/ARCHITECTURE.md",
    );
  });

  it("同一组件的多份文档归并到同一顶层节点，子目录按名排序", () => {
    const tree = buildTree([
      makeDoc("docs/SillyHub/flows/change-lifecycle.md"),
      makeDoc("docs/SillyHub/flows/auth.md"),
      makeDoc("docs/SillyHub/modules/_module-map.yaml", "_module-map"),
    ]);

    expect(tree.map((n) => n.name)).toEqual(["SillyHub"]);
    const hub = tree[0]!;
    expect(hub.children.map((c) => c.name)).toEqual(["flows", "modules"]);
    const flows = hub.children[0]!;
    expect(flows.children.map((c) => c.name)).toEqual([
      "auth.md",
      "change-lifecycle.md",
    ]);
  });
});
