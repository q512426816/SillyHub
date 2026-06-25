"use client";

import { useMemo, useState } from "react";
import { Tree, type TreeDataNode } from "antd";
import type { OrganizationRead } from "@/lib/admin";

// 左侧组织树筛选组件:接收扁平 organizations,客户端按 parent_id 组装成树。
// 仅显示 status==='active' 的组织(disabled 整体不进树,但其成员已由后端聚合进
// 父节点 subtree_member_count,D-002@v1,组件不重算)。顶部固定「全部组织」节点
// (不显示成员数,避免子树重复累加歧义;成员总数由右侧表格 total 体现)。
// expandedKeys 受控(可展开/收起),初始全展开;树体限高 + overflow 避免纵向溢出。

export interface AdminOrgTreeProps {
  /** 扁平组织列表(含 disabled,组件内部过滤 active)。来自 listOrganizations()。 */
  organizations: OrganizationRead[];
  /** 当前选中组织 id;null = 「全部组织」。 */
  selectedOrgId: string | null;
  /** 点击节点回调:点「全部组织」或取消选中 → null;点组织 → org.id。 */
  onSelect: (id: string | null) => void;
}

/**
 * 按 parent_id 组装树(仅 active 组织)。返回不含「全部组织」根节点的组织子树。
 *
 * 算法:
 * 1. 过滤 status==='active';
 * 2. 按 parent_id 分组(Map<parent_id|null, org[]>);
 * 3. 从 parent_id===null 的根组织递归构建 children;
 * 4. 递归时维护 visited set 防御自引用环(design R-04,理论上 update_organization
 *    有环检测不会出现,但组件层防御)。
 */
function buildOrgTree(orgs: OrganizationRead[]): TreeDataNode[] {
  const active = orgs.filter((o) => o.status === "active");
  const byParent = new Map<string | null, OrganizationRead[]>();
  for (const o of active) {
    const list = byParent.get(o.parent_id);
    if (list) list.push(o);
    else byParent.set(o.parent_id, [o]);
  }

  const buildNode = (org: OrganizationRead, visited: Set<string>): TreeDataNode => {
    // 防御自引用环:理论上后端 update_organization 有环检测,不会出现。
    if (visited.has(org.id)) {
      return {
        title: orgNodeTitle(org),
        key: org.id,
        isLeaf: true,
      };
    }
    const nextVisited = new Set(visited);
    nextVisited.add(org.id);
    const children = (byParent.get(org.id) ?? []).map((c) => buildNode(c, nextVisited));
    return {
      title: orgNodeTitle(org),
      key: org.id,
      isLeaf: children.length === 0,
      children,
    };
  };

  return (byParent.get(null) ?? []).map((o) => buildNode(o, new Set()));
}

/** 组织节点 title:组织名 + subtree_member_count(fallback member_count,design §9 兼容)。 */
function orgNodeTitle(org: OrganizationRead) {
  const count = org.subtree_member_count ?? org.member_count;
  return (
    <span className="flex items-center justify-between gap-2">
      <span className="min-w-0 flex-1 truncate">{org.name}</span>
      <span className="shrink-0 text-xs text-muted-foreground">{count}</span>
    </span>
  );
}

/** 收集树所有 key(用于初始 expandedKeys 全展开)。 */
function collectAllKeys(nodes: TreeDataNode[]): string[] {
  const keys: string[] = [];
  for (const n of nodes) {
    keys.push(n.key as string);
    if (n.children && n.children.length > 0) {
      keys.push(...collectAllKeys(n.children));
    }
  }
  return keys;
}

export function AdminOrgTree({
  organizations,
  selectedOrgId,
  onSelect,
}: AdminOrgTreeProps) {
  const orgTree = useMemo(() => buildOrgTree(organizations), [organizations]);

  const treeData = useMemo<TreeDataNode[]>(
    () => [
      {
        title: (
          <span className="flex items-center justify-between gap-2 font-medium">
            <span>全部组织</span>
          </span>
        ),
        key: "all",
        children: orgTree,
      },
    ],
    [orgTree],
  );

  // 初始全展开;用户可折叠/展开(受控 expandedKeys + onExpand)。
  const allKeys = useMemo<string[]>(
    () => ["all", ...collectAllKeys(orgTree)],
    [orgTree],
  );
  const [expandedKeys, setExpandedKeys] = useState<string[]>(allKeys);
  // organizations 变化时重置展开状态(新数据全展开)。
  useMemo(() => setExpandedKeys(allKeys), [allKeys]);

  return (
    <div className="overflow-y-auto" style={{ maxHeight: "calc(100vh - 200px)" }}>
      <Tree
        blockNode
        treeData={treeData}
        expandedKeys={expandedKeys}
        selectedKeys={[selectedOrgId ?? "all"]}
        onExpand={(keys) => setExpandedKeys(keys as string[])}
        onSelect={(keys) => {
          const k = keys[0] as string | undefined;
          onSelect(!k || k === "all" ? null : k);
        }}
      />
    </div>
  );
}
