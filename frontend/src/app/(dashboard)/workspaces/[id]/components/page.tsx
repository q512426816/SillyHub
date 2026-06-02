"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { ComponentDetailDrawer } from "@/components/component-detail-drawer";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ApiError } from "@/lib/api";
import {
  getWorkspaceRelations,
  getWorkspace,
  listWorkspaces,
  rescanWorkspace,
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
  { href: "agent", label: "Agent" },
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
      setPageError(
        err instanceof ApiError ? err.message : "加载关系失败",
      );
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
      setPageError(
        err instanceof ApiError ? err.message : "重新扫描失败",
      );
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

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-5 px-6 py-6">
      <header className="flex items-start justify-between gap-4">
        <div>
          <p className="text-[11px] text-muted-foreground">
            <Link href="/workspaces" className="hover:underline">← Workspaces</Link>
          </p>
          <h1 className="mt-0.5">Workspace 关系</h1>
          <p className="text-xs text-muted-foreground">
            查看 Workspace 与其他 Workspace 之间的依赖关系
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {NAV_ITEMS.map((item) => (
            <Link
              key={item.href}
              href={"absolute" in item && item.absolute ? item.href : `/workspaces/${workspaceId}/${item.href}`}
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
      </header>

      {pageError && (
        <div className="rounded border border-destructive/30 bg-red-50 px-3 py-2 text-xs text-destructive">
          {pageError}
        </div>
      )}

      {/* Workspace metadata card */}
      {workspace && (
        <section className="rounded-md border bg-card p-3">
          <div className="mb-2 flex items-center gap-2">
            <span className="text-sm font-semibold">{workspace.name}</span>
            <Badge variant={workspace.status === "active" ? "success" : "outline"}>
              {workspace.status}
            </Badge>
            {workspace.type && (
              <Badge variant="outline">{workspace.type}</Badge>
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
                    <Badge key={t} variant="outline" className="text-[10px]">{t}</Badge>
                  ))}
                </dd>
              </>
            )}
          </dl>
        </section>
      )}

      {/* 子组件列表 */}
      <section className="rounded-md border bg-card">
        <div className="border-b px-3 py-2">
          <h3 className="text-sm font-medium">
            子组件 · {children.length} 个
          </h3>
        </div>
        {children.length === 0 ? (
          <p className="py-6 text-center text-xs text-muted-foreground">无子组件</p>
        ) : (
          <div className="divide-y">
            {children.map((child) => (
              <div key={child.id} className="flex items-center justify-between px-3 py-2">
                <div className="flex items-center gap-2">
                  <Badge variant={child.status === "active" ? "success" : "outline"}>
                    {child.status}
                  </Badge>
                  <Link href={`/workspaces/${child.id}/components`} className="text-sm font-medium text-primary hover:underline">
                    {child.name}
                  </Link>
                  {child.component_key && (
                    <span className="font-mono text-[11px] text-muted-foreground">{child.component_key}</span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  {child.role && <span className="text-xs text-muted-foreground">{child.role}</span>}
                  {child.tech_stack.length > 0 && (
                    <div className="flex gap-1">
                      {child.tech_stack.map((t) => (
                        <Badge key={t} variant="outline" className="text-[10px]">{t}</Badge>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Outgoing relations */}
      <section className="rounded-md border bg-card">
        <div className="border-b px-3 py-2">
          <h3 className="text-sm font-medium">
            出边（当前 → 目标） · {outgoing.length} 条
          </h3>
        </div>
        {outgoing.length === 0 ? (
          <p className="py-6 text-center text-xs text-muted-foreground">无出边关系</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>目标 Workspace</th>
                <th>关系类型</th>
                <th>描述</th>
              </tr>
            </thead>
            <tbody>
              {outgoing.map((r) => (
                <tr key={r.id}>
                  <td className="text-xs">
                    <Link
                      href={`/workspaces/${r.target_id}`}
                      className="text-primary hover:underline"
                    >
                      {wsMap.get(r.target_id)?.name ?? r.target_id.slice(0, 8)}
                      {wsMap.get(r.target_id)?.component_key ? (
                        <span className="ml-1 text-muted-foreground">({wsMap.get(r.target_id)!.component_key})</span>
                      ) : null}
                    </Link>
                  </td>
                  <td>
                    <Badge variant="outline">{r.relation_type}</Badge>
                  </td>
                  <td className="text-xs text-muted-foreground">
                    {r.description ?? "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {/* Incoming relations */}
      <section className="rounded-md border bg-card">
        <div className="border-b px-3 py-2">
          <h3 className="text-sm font-medium">
            入边（源 → 当前） · {incoming.length} 条
          </h3>
        </div>
        {incoming.length === 0 ? (
          <p className="py-6 text-center text-xs text-muted-foreground">无入边关系</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>源 Workspace</th>
                <th>关系类型</th>
                <th>描述</th>
              </tr>
            </thead>
            <tbody>
              {incoming.map((r) => (
                <tr key={r.id}>
                  <td className="text-xs">
                    <Link
                      href={`/workspaces/${r.source_id}`}
                      className="text-primary hover:underline"
                    >
                      {wsMap.get(r.source_id)?.name ?? r.source_id.slice(0, 8)}
                      {wsMap.get(r.source_id)?.component_key ? (
                        <span className="ml-1 text-muted-foreground">({wsMap.get(r.source_id)!.component_key})</span>
                      ) : null}
                    </Link>
                  </td>
                  <td>
                    <Badge variant="outline">{r.relation_type}</Badge>
                  </td>
                  <td className="text-xs text-muted-foreground">
                    {r.description ?? "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
