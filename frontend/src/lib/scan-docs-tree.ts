import type { ScanDocSummary } from "./scan-docs";

export interface TreeNode {
  name: string;
  path: string;
  doc?: ScanDocSummary;
  children: TreeNode[];
}

/**
 * 将扫描文档列表按 path 构建为目录树。
 *
 * path 有两种布局，本函数自适应剥离前导包裹段，保留其后的全部层级
 * （组件名 + flows/modules/scan 等子目录 + 文件）：
 *  - 扁平布局（daemon-client / platform-managed）：``docs/<组件>/...``
 *  - 包裹布局（repo-native / server-local）：``.sillyspec/docs/<组件>/...``
 *
 * 设计依据：backend ``scan_docs/parser.py`` —— ``platform_managed`` 决定 rel_path
 * 前缀（扁平 ``docs/`` vs 包裹 ``.sillyspec/docs/``）。修复前这里写死 ``slice(2)``
 * 只适配包裹布局，导致扁平布局下「组件名」层被切掉，树直接从 flows/modules/scan 开始。
 */
export function buildTree(docs: ScanDocSummary[]): TreeNode[] {
  const root: TreeNode = { name: "", path: "", children: [] };
  for (const doc of docs) {
    const allParts = doc.path.split("/");
    // 自适应剥离前导包裹段：可选的 .sillyspec 段 + docs 段，保留其后全部层级。
    let start = 0;
    if (allParts[0] === ".sillyspec") start = 1;
    if (allParts[start] === "docs") start += 1;
    const parts = allParts.slice(start);

    let current = root;
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i]!;
      const isFile = i === parts.length - 1;
      const existingChild = current.children.find((c) => c.name === part);
      if (existingChild) {
        current = existingChild;
      } else {
        const newNode: TreeNode = {
          name: part,
          path: parts.slice(0, i + 1).join("/"),
          children: [],
        };
        current.children.push(newNode);
        current = newNode;
      }
      if (isFile) {
        current.doc = doc;
      }
    }
  }
  const sortNodes = (nodes: TreeNode[]): TreeNode[] =>
    nodes
      .sort((a, b) => {
        const af = a.doc !== undefined,
          bf = b.doc !== undefined;
        if (af !== bf) return af ? 1 : -1;
        return a.name.localeCompare(b.name);
      })
      .map((n) => ({ ...n, children: sortNodes(n.children) }));
  return sortNodes(root.children);
}
