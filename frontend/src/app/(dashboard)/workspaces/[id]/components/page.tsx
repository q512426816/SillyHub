"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { ComponentDetailDrawer } from "@/components/component-detail-drawer";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ApiError } from "@/lib/api";
import {
  getTopology,
  listComponents,
  reparseComponents,
  type Component,
  type ParseIssue,
  type Relation,
  type ReparseStats,
} from "@/lib/components";

interface Props {
  params: { id: string };
}

const EMPTY_STATS: ReparseStats = {
  parsed: 0,
  created: 0,
  updated: 0,
  deleted: 0,
  relations_created: 0,
  relations_deleted: 0,
};

export default function ComponentsPage({ params }: Props) {
  const workspaceId = params.id;
  const [components, setComponents] = useState<Component[]>([]);
  const [relations, setRelations] = useState<Relation[]>([]);
  const [warnings, setWarnings] = useState<ParseIssue[]>([]);
  const [errors, setErrors] = useState<ParseIssue[]>([]);
  const [stats, setStats] = useState<ReparseStats>(EMPTY_STATS);
  const [lastReparseAt, setLastReparseAt] = useState<Date | null>(null);
  const [loading, setLoading] = useState(true);
  const [reparsing, setReparsing] = useState(false);
  const [pageError, setPageError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Component | null>(null);

  const componentsById = useMemo(
    () => new Map(components.map((c) => [c.id, c])),
    [components],
  );

  const load = async () => {
    setLoading(true);
    setPageError(null);
    try {
      const [list, topo] = await Promise.all([
        listComponents(workspaceId),
        getTopology(workspaceId),
      ]);
      setComponents(list.items);
      setRelations(
        topo.edges.map((e, idx) => ({
          id: `${e.source}-${e.target}-${e.relation_type}-${idx}`,
          workspace_id: workspaceId,
          source_component_id: e.source,
          target_component_id: e.target,
          relation_type: e.relation_type,
          description: e.description,
        })),
      );
    } catch (err) {
      setPageError(
        err instanceof ApiError ? err.message : "加载组件失败",
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId]);

  const handleReparse = async () => {
    setReparsing(true);
    setPageError(null);
    try {
      const resp = await reparseComponents(workspaceId);
      setComponents(resp.components);
      setRelations(resp.relations);
      setStats(resp.stats);
      setWarnings(resp.warnings);
      setErrors(resp.errors);
      setLastReparseAt(new Date());
    } catch (err) {
      setPageError(
        err instanceof ApiError ? err.message : "重新解析失败",
      );
    } finally {
      setReparsing(false);
    }
  };

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6 px-6 py-8">
      <header className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <p className="text-xs text-muted-foreground">
            <Link href="/workspaces" className="hover:underline">
              ← 回到 Workspaces
            </Link>
          </p>
          <h1 className="text-2xl font-semibold tracking-tight">项目组件</h1>
          <p className="text-sm text-muted-foreground">
            解析 <code>.sillyspec/projects/*.yaml</code> 并展示组件清单与组件之间的关联。
          </p>
        </div>
        <div className="flex gap-2">
          <Link
            href={`/workspaces/${workspaceId}/changes`}
            className="inline-flex h-9 items-center justify-center rounded-md border border-input bg-background px-4 text-sm font-medium transition-colors hover:bg-muted"
          >
            变更中心
          </Link>
          <Link
            href={`/workspaces/${workspaceId}/scan-docs`}
            className="inline-flex h-9 items-center justify-center rounded-md border border-input bg-background px-4 text-sm font-medium transition-colors hover:bg-muted"
          >
            扫描文档
          </Link>
          <Link
            href={`/workspaces/${workspaceId}/components/topology`}
            className="inline-flex h-9 items-center justify-center rounded-md border border-input bg-background px-4 text-sm font-medium transition-colors hover:bg-muted"
          >
            拓扑图
          </Link>
          <Button onClick={handleReparse} disabled={reparsing}>
            {reparsing ? "解析中…" : "重新解析"}
          </Button>
        </div>
      </header>

      {pageError && (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
          {pageError}
        </div>
      )}

      {lastReparseAt && (
        <div
          className={`rounded-md border p-3 text-sm ${
            errors.length > 0
              ? "border-destructive/30 bg-destructive/10 text-destructive"
              : warnings.length > 0
                ? "border-amber-500/30 bg-amber-50 text-amber-800"
                : "border-emerald-500/30 bg-emerald-50 text-emerald-800"
          }`}
        >
          <strong>已重新解析</strong>{" "}
          <span className="text-xs opacity-80">
            {lastReparseAt.toLocaleTimeString()}
          </span>
          ：解析 {stats.parsed} 个组件，新增 {stats.created} · 更新 {stats.updated} · 删除{" "}
          {stats.deleted}，关联 {stats.relations_created} 条。
          {errors.length === 0 && warnings.length === 0 && " 无 warning / error。"}
          {(errors.length > 0 || warnings.length > 0) &&
            ` 见下方 ${errors.length} 个 error / ${warnings.length} 个 warning。`}
        </div>
      )}

      {(warnings.length > 0 || errors.length > 0) && (
        <section className="space-y-2 rounded-md border bg-card p-4">
          <h2 className="text-sm font-medium">解析诊断</h2>
          {errors.length > 0 && (
            <ul className="list-disc space-y-1 pl-5 text-xs text-destructive">
              {errors.map((e, i) => (
                <li key={i}>
                  <span className="font-mono">[{e.code}]</span> {e.file ?? "—"}: {e.detail}
                </li>
              ))}
            </ul>
          )}
          {warnings.length > 0 && (
            <ul className="list-disc space-y-1 pl-5 text-xs text-amber-600">
              {warnings.map((w, i) => (
                <li key={i}>
                  <span className="font-mono">[{w.code}]</span> {w.file ?? "—"}: {w.detail}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {lastReparseAt && (
        <section className="grid grid-cols-2 gap-3 rounded-md border bg-card p-4 sm:grid-cols-3 lg:grid-cols-6">
          {(
            [
              ["parsed", "已解析"],
              ["created", "新增"],
              ["updated", "更新"],
              ["deleted", "删除"],
              ["relations_created", "新关联"],
              ["relations_deleted", "旧关联清理"],
            ] as const
          ).map(([key, label]) => (
            <div key={key} className="rounded-md bg-muted/50 p-3 text-center">
              <p className="text-xs text-muted-foreground">{label}</p>
              <p className="text-lg font-semibold">{stats[key]}</p>
            </div>
          ))}
        </section>
      )}

      <section className="rounded-md border bg-card">
        {loading ? (
          <p className="p-8 text-center text-sm text-muted-foreground">加载中…</p>
        ) : components.length === 0 ? (
          <div className="space-y-2 p-8 text-center text-sm text-muted-foreground">
            <p>当前 Workspace 还没有解析过组件。</p>
            <p>点击右上角“重新解析”从 .sillyspec/projects/ 读取。</p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="border-b text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-4 py-3">id</th>
                <th className="px-4 py-3">名称</th>
                <th className="px-4 py-3">type</th>
                <th className="px-4 py-3">role</th>
                <th className="px-4 py-3">path</th>
                <th className="px-4 py-3">状态</th>
                <th className="px-4 py-3">技术栈</th>
                <th className="px-4 py-3 text-right">关联数</th>
              </tr>
            </thead>
            <tbody>
              {components.map((c) => {
                const linkCount = relations.filter(
                  (r) =>
                    r.source_component_id === c.id || r.target_component_id === c.id,
                ).length;
                return (
                  <tr
                    key={c.id}
                    className="cursor-pointer border-b last:border-b-0 hover:bg-muted/40"
                    onClick={() => setSelected(c)}
                  >
                    <td className="px-4 py-3 font-mono text-xs">{c.component_key}</td>
                    <td className="px-4 py-3">{c.name}</td>
                    <td className="px-4 py-3">{c.type ?? "—"}</td>
                    <td className="px-4 py-3">{c.role ?? "—"}</td>
                    <td className="break-all px-4 py-3 font-mono text-xs">
                      {c.path ?? "—"}
                    </td>
                    <td className="px-4 py-3">
                      <Badge variant={c.status === "active" ? "success" : "destructive"}>
                        {c.status}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 text-xs">
                      {c.tech_stack.length > 0 ? c.tech_stack.join(", ") : "—"}
                    </td>
                    <td className="px-4 py-3 text-right font-mono">{linkCount}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>

      <ComponentDetailDrawer
        open={selected !== null}
        component={selected}
        relations={relations}
        componentsById={componentsById}
        onClose={() => setSelected(null)}
      />
    </div>
  );
}
