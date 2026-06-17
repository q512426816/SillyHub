"use client";

import { useMemo, useState } from "react";

import type { OrganizationRead } from "@/lib/admin";

interface AdminOrganizationTreeProps {
  nodes: OrganizationRead[];
  selectedId: string | null;
  onSelect: (_id: string) => void;
  searchKeyword?: string;
  defaultExpandedIds?: string[];
}

interface TreeNode {
  node: OrganizationRead;
  children: TreeNode[];
}

function buildTree(nodes: OrganizationRead[]): TreeNode[] {
  const byId = new Map<string, TreeNode>();
  for (const n of nodes) {
    byId.set(n.id, { node: n, children: [] });
  }
  const roots: TreeNode[] = [];
  for (const n of nodes) {
    const current = byId.get(n.id)!;
    if (n.parent_id && byId.has(n.parent_id)) {
      byId.get(n.parent_id)!.children.push(current);
    } else {
      roots.push(current);
    }
  }
  return roots;
}

function collectDescendantIds(nodes: OrganizationRead[], id: string): Set<string> {
  const result = new Set<string>();
  const queue = [id];
  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const n of nodes) {
      if (n.parent_id === current && !result.has(n.id)) {
        result.add(n.id);
        queue.push(n.id);
      }
    }
  }
  return result;
}

function collectAncestorIds(nodes: OrganizationRead[], id: string): Set<string> {
  const result = new Set<string>();
  const byId = new Map(nodes.map((n) => [n.id, n] as const));
  let current = byId.get(id);
  while (current?.parent_id && byId.has(current.parent_id)) {
    result.add(current.parent_id);
    current = byId.get(current.parent_id);
  }
  return result;
}

function highlight(text: string, keyword: string): React.ReactNode {
  if (!keyword) return text;
  const lower = text.toLowerCase();
  const kw = keyword.toLowerCase();
  const idx = lower.indexOf(kw);
  if (idx < 0) return text;
  return (
    <>
      {text.slice(0, idx)}
      <mark className="rounded bg-yellow-200 px-0.5 text-foreground">
        {text.slice(idx, idx + kw.length)}
      </mark>
      {text.slice(idx + kw.length)}
    </>
  );
}

export function AdminOrganizationTree({
  nodes,
  selectedId,
  onSelect,
  searchKeyword = "",
  defaultExpandedIds,
}: AdminOrganizationTreeProps) {
  const tree = useMemo(() => buildTree(nodes), [nodes]);

  const autoExpanded = useMemo(() => {
    if (!searchKeyword) return new Set<string>(defaultExpandedIds ?? []);
    const matched = nodes.filter(
      (n) =>
        n.name.toLowerCase().includes(searchKeyword.toLowerCase()) ||
        n.code.toLowerCase().includes(searchKeyword.toLowerCase()),
    );
    const expand = new Set<string>();
    for (const m of matched) {
      expand.add(m.id);
      for (const aid of collectAncestorIds(nodes, m.id)) expand.add(aid);
    }
    return expand;
  }, [nodes, searchKeyword, defaultExpandedIds]);

  const [manualExpanded, setManualExpanded] = useState<Set<string>>(() => {
    const childCount = new Map<string, number>();
    for (const n of nodes) {
      if (n.parent_id) {
        childCount.set(n.parent_id, (childCount.get(n.parent_id) ?? 0) + 1);
      }
    }
    return new Set(childCount.keys());
  });
  const isExpanded = (id: string) =>
    autoExpanded.has(id) || manualExpanded.has(id);
  const toggleExpand = (id: string) => {
    setManualExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const filter = (node: TreeNode): TreeNode | null => {
    if (!searchKeyword) return node;
    const matches = (n: OrganizationRead) =>
      n.name.toLowerCase().includes(searchKeyword.toLowerCase()) ||
      n.code.toLowerCase().includes(searchKeyword.toLowerCase());
    const filteredChildren = node.children
      .map(filter)
      .filter((c): c is TreeNode => c !== null);
    if (matches(node.node) || filteredChildren.length > 0) {
      return { node: node.node, children: filteredChildren };
    }
    return null;
  };

  const filteredTree = searchKeyword
    ? tree.map(filter).filter((t): t is TreeNode => t !== null)
    : tree;

  const renderNode = (tn: TreeNode, depth: number): React.ReactNode => {
    const n = tn.node;
    const hasChildren = tn.children.length > 0;
    const expanded = isExpanded(n.id);
    const isSelected = selectedId === n.id;
    const matchesSelf =
      searchKeyword &&
      (n.name.toLowerCase().includes(searchKeyword.toLowerCase()) ||
        n.code.toLowerCase().includes(searchKeyword.toLowerCase()));

    return (
      <div key={n.id}>
        <div
          className={`flex cursor-pointer items-center gap-1 rounded px-2 py-1 text-xs transition-colors ${
            isSelected
              ? "bg-primary/10 text-primary"
              : matchesSelf
                ? "bg-yellow-50"
                : "hover:bg-muted"
          } ${n.status === "disabled" ? "text-muted-foreground" : ""}`}
          style={{ paddingLeft: `${depth * 16 + 8}px` }}
          onClick={() => onSelect(n.id)}
        >
          {hasChildren ? (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                toggleExpand(n.id);
              }}
              className="flex h-4 w-4 items-center justify-center text-[10px] text-muted-foreground hover:text-foreground"
              aria-label={expanded ? "折叠" : "展开"}
            >
              {expanded ? "▼" : "▶"}
            </button>
          ) : (
            <span className="inline-block w-4" />
          )}
          <span className="flex-1 truncate">
            {highlight(n.name, searchKeyword)}{" "}
            <span className="font-mono text-[10px] text-muted-foreground">
              ({n.code})
            </span>
          </span>
          <span className="ml-1 rounded bg-muted px-1 text-[10px] text-muted-foreground">
            {n.member_count}
          </span>
        </div>
        {hasChildren && expanded && (
          <div>{tn.children.map((c) => renderNode(c, depth + 1))}</div>
        )}
      </div>
    );
  };

  if (filteredTree.length === 0) {
    return (
      <p className="px-3 py-8 text-center text-[11px] text-muted-foreground">
        {searchKeyword ? "无匹配组织" : "暂无组织"}
      </p>
    );
  }

  return <div className="py-1">{filteredTree.map((tn) => renderNode(tn, 0))}</div>;
}

export { collectDescendantIds };
