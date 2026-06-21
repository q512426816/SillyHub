"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { type TableProps } from "antd";

import { ComponentDetailDrawer } from "@/components/component-detail-drawer";
import {
  DataTable,
  PageContainer,
  PageHeader,
  SectionCard,
} from "@/components/layout";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import { ApiError } from "@/lib/api";
import {
  getWorkspace,
  getWorkspaceRelations,
  listWorkspaces,
  reparseWorkspace,
  type Workspace,
  type WorkspaceRelation,
} from "@/lib/workspaces";

interface Props {
  params: { id: string };
}

const NAV_ITEMS = [
  { href: "changes", label: "变更中心" },
  { href: "scan-docs", label: "扫描文档" },
  { href: "components/topology", label: "拓扑图" },
  { href: "runtime", label: "运行时" },
  { href: "knowledge", label: "知识 & 日志" },
  { href: "releases", label: "发布" },
  { href: "approvals", label: "审批中心" },
  { href: "audit", label: "审计日志" },
  { href: "agent", label: "智能体" },
  { href: "incidents", label: "事件" },
  { href: "/settings", label: "设置", absolute: true },
] as const;

export default function ComponentsPage({ params }: Props) {
  const workspaceId = params.id;
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [outgoing, setOutgoing] = useState<WorkspaceRelation[]>([]);
  const [incoming, setIncoming] = useState<WorkspaceRelation[]>([]);
  const [children, setChildren] = useState<Workspace[]>([]);
  const [allWorkspaces, setAllWorkspaces] = useState<Workspace[]>([]);
  const [loading, setLoading] = useState(true);
  const [reparsing, setReparsing] = useState(false);
  const [pageError, setPageError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [viewMode, setViewMode] = useState<"table" | "cards">("table");

  const allRelations = useMemo(
    () => [...outgoing, ...incoming],
    [outgoing, incoming],
  );

  const load = async () => {
    setLoading(true);
    setPageError(null);
    try {
      const [ws, relData, allWs] = await Promise.all([
        getWorkspace(workspaceId),
        getWorkspaceRelations(workspaceId),
        listWorkspaces(),
      ]);
      setWorkspace(ws);
      setOutgoing(relData.outgoing);
      setIncoming(relData.incoming);
      // 子组件：root_path 以当前 workspace 的 root_path + "/" 开头（排除自身）
      const prefix = ws.root_path + "/";
      setAllWorkspaces(allWs.items);
      setChildren(
        allWs.items.filter(
          (w: Workspace) => w.root_path.startsWith(prefix) && w.id !== ws.id,
        ),
      );
    } catch (err) {
      setPageError(err instanceof ApiError ? err.message : "加载关系失败");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId]);

  const handleRescan = async () => {
    setReparsing(true);
    setPageError(null);
    try {
      await reparseWorkspace(workspaceId);
      // Reload relations after reparse
      const relData = await getWorkspaceRelations(workspaceId);
      setOutgoing(relData.outgoing);
      setIncoming(relData.incoming);
      // Also reload workspace metadata
      const ws = await getWorkspace(workspaceId);
      setWorkspace(ws);
    } catch (err) {
      setPageError(err instanceof ApiError ? err.message : "重新扫描失败");
    } finally {
      setReparsing(false);
    }
  };

  // For the detail drawer — build a map of related workspaces (nodes)
  // In the relation context, the "nodes" are the workspace itself and its peers.
  // We collect unique workspace ids from the relations for display.
  const wsMap = useMemo(() => {
    const m = new Map<string, Workspace>();
    for (const ws of allWorkspaces) m.set(ws.id, ws);
    return m;
  }, [allWorkspaces]);

  const relatedWorkspaceIds = useMemo(() => {
    const ids = new Set<string>();
    for (const r of allRelations) {
      ids.add(r.source_id);
      ids.add(r.target_id);
    }
    return ids;
  }, [allRelations]);

  const filteredOutgoing = useMemo(() => {
    if (!searchQuery.trim()) return outgoing;
    const q = searchQuery.toLowerCase();
    return outgoing.filter((r) => {
      const targetName = wsMap.get(r.target_id)?.name ?? "";
      return (
        targetName.toLowerCase().includes(q) ||
        r.relation_type.toLowerCase().includes(q) ||
        (r.description ?? "").toLowerCase().includes(q)
      );
    });
  }, [outgoing, searchQuery, wsMap]);

  const outgoingColumns: TableProps<WorkspaceRelation>["columns"] = [
    {
      title: "目标工作区",
      dataIndex: "target_id",
      key: "target_id",
      render: (id: string) => {
        const name = wsMap.get(id)?.name ?? id.slice(0, 8);
        const ck = wsMap.get(id)?.component_key;
        return (
          <Link
            href={`/workspaces/${id}`}
            className="text-xs text-primary hover:underline"
          >
            {name}
            {ck ? (
              <span className="ml-1 text-muted-foreground">({ck})</span>
            ) : null}
          </Link>
        );
      },
    },
    {
      title: "关系类型",
      dataIndex: "relation_type",
      key: "relation_type",
      render: (v: string) => (
        <StatusBadge kind="neutral">{v}</StatusBadge>
      ),
    },
    {
      title: "描述",
      dataIndex: "description",
      key: "description",
      render: (v: string | null) => (
        <span className="text-xs text-muted-foreground">{v ?? "—"}</span>
      ),
    },
  ];

  const incomingColumns: TableProps<WorkspaceRelation>["columns"] = [
    {
      title: "源工作区",
      dataIndex: "source_id",
      key: "source_id",
      render: (id: string) => {
        const name = wsMap.get(id)?.name ?? id.slice(0, 8);
        const ck = wsMap.get(id)?.component_key;
        return (
          <Link
            href={`/workspaces/${id}`}
            className="text-xs text-primary hover:underline"
          >
            {name}
            {ck ? (
              <span className="ml-1 text-muted-foreground">({ck})</span>
            ) : null}
          </Link>
        );
      },
    },
    {
      title: "关系类型",
      dataIndex: "relation_type",
      key: "relation_type",
      render: (v: string) => (
        <StatusBadge kind="neutral">{v}</StatusBadge>
      ),
    },
    {
      title: "描述",
      dataIndex: "description",
      key: "description",
      render: (v: string | null) => (
        <span className="text-xs text-muted-foreground">{v ?? "—"}</span>
      ),
    },
  ];

  return (
    <PageContainer>
      <PageHeader
        title={
          <span className="flex flex-col gap-0.5">
            <span>工作区关系</span>
            <Link
              href="/workspaces"
              className="text-[11px] font-normal text-muted-foreground hover:underline"
            >
              ← 工作区
            </Link>
          </span>
        }
        subtitle="查看工作区与其他工作区之间的依赖关系"
        actions={
          <div className="flex flex-wrap items-center gap-1.5">
            {NAV_ITEMS.map((item) => (
              <Link
                key={item.href}
                href={
                  "absolute" in item && item.absolute
                    ? item.href
                    : `/workspaces/${workspaceId}/${item.href}`
                }
                className="inline-flex h-7 items-center rounded border border-border px-2 text-[11px] text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                {item.label}
              </Link>
            ))}
            <input
              className="h-7 rounded border border-input bg-background px-2 text-xs focus:border-ring focus:outline-none"
              placeholder="搜索关系..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
            <Button size="sm" onClick={handleRescan} disabled={reparsing}>
              {reparsing ? "扫描中…" : "重新扫描"}
            </Button>
          </div>
        }
      />

      {pageError && (
        <div className="rounded border border-destructive/30 bg-red-50 px-3 py-2 text-xs text-destructive">
          {pageError}
        </div>
      )}

      {/* Workspace metadata card */}
      {workspace && (
        <SectionCard>
          <div className="mb-2 flex items-center gap-2">
            <span className="text-sm font-semibold">{workspace.name}</span>
            <StatusBadge kind={workspace.status === "active" ? "success" : "neutral"}>
              {workspace.status}
            </StatusBadge>
            {workspace.type && (
              <StatusBadge kind="neutral">{workspace.type}</StatusBadge>
            )}
          </div>
          <dl className="grid grid-cols-[5.5rem_1fr] gap-y-1 text-xs">
            <dt className="text-muted-foreground">slug</dt>
            <dd className="font-mono">{workspace.slug}</dd>
            {workspace.component_key && (
              <>
                <dt className="text-muted-foreground">component_key</dt>
                <dd className="font-mono">{workspace.component_key}</dd>
              </>
            )}
            {workspace.role && (
              <>
                <dt className="text-muted-foreground">role</dt>
                <dd>{workspace.role}</dd>
              </>
            )}
            {workspace.tech_stack.length > 0 && (
              <>
                <dt className="text-muted-foreground">技术栈</dt>
                <dd className="flex flex-wrap gap-1">
                  {workspace.tech_stack.map((t) => (
                    <StatusBadge key={t} kind="neutral">
                      {t}
                    </StatusBadge>
                  ))}
                </dd>
              </>
            )}
          </dl>
        </SectionCard>
      )}

      {/* 子组件列表 */}
      <SectionCard title={`子组件 · ${children.length} 个`} bodyPadding="p-0">
        {children.length === 0 ? (
          <p className="py-6 text-center text-xs text-muted-foreground">
            无子组件
          </p>
        ) : (
          <div className="divide-y">
            {children.map((child) => (
              <div
                key={child.id}
                className="flex items-center justify-between px-3 py-2"
              >
                <div className="flex items-center gap-2">
                  <StatusBadge
                    kind={child.status === "active" ? "success" : "neutral"}
                  >
                    {child.status}
                  </StatusBadge>
                  <Link
                    href={`/workspaces/${child.id}/components`}
                    className="text-sm font-medium text-primary hover:underline"
                  >
                    {child.name}
                  </Link>
                  {child.component_key && (
                    <span className="font-mono text-[11px] text-muted-foreground">
                      {child.component_key}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  {child.role && (
                    <span className="text-xs text-muted-foreground">
                      {child.role}
                    </span>
                  )}
                  {child.tech_stack.length > 0 && (
                    <div className="flex gap-1">
                      {child.tech_stack.map((t) => (
                        <StatusBadge key={t} kind="neutral">
                          {t}
                        </StatusBadge>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </SectionCard>

      {/* Outgoing relations */}
      <SectionCard
        title={`出边（当前 → 目标） · ${outgoing.length} 条`}
        bodyPadding="p-0"
      >
        <DataTable<WorkspaceRelation>
          rowKey="id"
          columns={outgoingColumns}
          dataSource={filteredOutgoing}
          loading={loading}
          size="small"
          pagination={false}
          emptyText="无出边关系"
        />
      </SectionCard>

      {/* Incoming relations */}
      <SectionCard
        title={`入边（源 → 当前） · ${incoming.length} 条`}
        bodyPadding="p-0"
      >
        <DataTable<WorkspaceRelation>
          rowKey="id"
          columns={incomingColumns}
          dataSource={incoming}
          loading={loading}
          size="small"
          pagination={false}
          emptyText="无入边关系"
        />
      </SectionCard>
    </PageContainer>
  );
}
