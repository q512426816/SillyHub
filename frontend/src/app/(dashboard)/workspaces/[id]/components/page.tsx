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
  const [searchQuery, setSearchQuery] = useState("");
  const [viewMode, setViewMode] = useState<"table" | "cards">("table");

  const filtered = useMemo(() => {
    if (!searchQuery.trim()) return components;
    const q = searchQuery.toLowerCase();
    return components.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        c.component_key.toLowerCase().includes(q) ||
        (c.type ?? "").toLowerCase().includes(q) ||
        c.tech_stack.some((t) => t.toLowerCase().includes(q)),
    );
  }, [components, searchQuery]);

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
    <div className="mx-auto flex max-w-6xl flex-col gap-5 px-6 py-6">
      <header className="flex items-start justify-between gap-4">
        <div>
          <p className="text-[11px] text-muted-foreground">
            <Link href="/workspaces" className="hover:underline">← Workspaces</Link>
          </p>
          <h1 className="mt-0.5">项目组件</h1>
          <p className="text-xs text-muted-foreground">
            解析 <code>.sillyspec/projects/*.yaml</code> 的组件清单与关联
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
            placeholder="搜索组件..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
          <Button size="sm" onClick={handleReparse} disabled={reparsing}>
            {reparsing ? "解析中…" : "重新解析"}
          </Button>
        </div>
      </header>

      {pageError && (
        <div className="rounded border border-destructive/30 bg-red-50 px-3 py-2 text-xs text-destructive">
          {pageError}
        </div>
      )}

      {lastReparseAt && (
        <div
          className={`rounded border px-3 py-2 text-xs ${
            errors.length > 0
              ? "border-red-200 bg-red-50 text-red-700"
              : warnings.length > 0
                ? "border-amber-200 bg-amber-50 text-amber-700"
                : "border-emerald-200 bg-emerald-50 text-emerald-700"
          }`}
        >
          已重新解析（{lastReparseAt.toLocaleTimeString()}）：
          解析 {stats.parsed}，新增 {stats.created} · 更新 {stats.updated} · 删除{" "}
          {stats.deleted}，关联 {stats.relations_created} 条。
          {errors.length > 0 && ` ${errors.length} 个 error。`}
          {warnings.length > 0 && ` ${warnings.length} 个 warning。`}
        </div>
      )}

      {(warnings.length > 0 || errors.length > 0) && (
        <section className="rounded-md border bg-card p-3">
          <h3 className="mb-1.5">解析诊断</h3>
          {errors.length > 0 && (
            <ul className="list-disc space-y-0.5 pl-4 text-xs text-destructive">
              {errors.map((e, i) => (
                <li key={i}>
                  <span className="font-mono">[{e.code}]</span> {e.file ?? "—"}: {e.detail}
                </li>
              ))}
            </ul>
          )}
          {warnings.length > 0 && (
            <ul className="list-disc space-y-0.5 pl-4 text-xs text-amber-600">
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
        <section className="grid grid-cols-3 gap-2 sm:grid-cols-6">
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
            <div key={key} className="rounded-md border bg-card p-2.5 text-center">
              <p className="text-[11px] text-muted-foreground">{label}</p>
              <p className="text-base font-medium">{stats[key]}</p>
            </div>
          ))}
        </section>
      )}

      {/* View toggle + component list / cards */}
      <section className="rounded-md border bg-card">
        {loading ? (
          <p className="py-12 text-center text-xs text-muted-foreground">加载中…</p>
        ) : components.length === 0 ? (
          <div className="py-12 text-center text-xs text-muted-foreground">
            当前 Workspace 还没有解析过组件。点击右上角&ldquo;重新解析&rdquo;。
          </div>
        ) : (
          <>
            {/* View toggle */}
            <div className="flex items-center justify-between border-b px-3 py-2">
              <span className="text-xs text-muted-foreground">
                {filtered.length} / {components.length} 个组件
              </span>
              <div className="flex gap-1">
                <button
                  className={`rounded px-2 py-1 text-[11px] font-medium ${
                    viewMode === "table"
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted text-muted-foreground"
                  }`}
                  onClick={() => setViewMode("table")}
                >
                  表格
                </button>
                <button
                  className={`rounded px-2 py-1 text-[11px] font-medium ${
                    viewMode === "cards"
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted text-muted-foreground"
                  }`}
                  onClick={() => setViewMode("cards")}
                >
                  卡片
                </button>
              </div>
            </div>

            {viewMode === "table" ? (
              <table>
                <thead>
                  <tr>
                    <th>id</th>
                    <th>名称</th>
                    <th>type</th>
                    <th>role</th>
                    <th>path</th>
                    <th>状态</th>
                    <th>技术栈</th>
                    <th className="text-right">关联</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((c) => {
                    const linkCount = relations.filter(
                      (r) =>
                        r.source_component_id === c.id || r.target_component_id === c.id,
                    ).length;
                    return (
                      <tr
                        key={c.id}
                        className="cursor-pointer"
                        onClick={() => setSelected(c)}
                      >
                        <td className="font-mono text-[11px]">{c.component_key}</td>
                        <td className="font-medium">{c.name}</td>
                        <td>{c.type ?? "—"}</td>
                        <td>{c.role ?? "—"}</td>
                        <td className="max-w-[200px] truncate font-mono text-[11px]" title={c.path ?? ""}>
                          {c.path ?? "—"}
                        </td>
                        <td>
                          <Badge variant={c.status === "active" ? "success" : "destructive"}>
                            {c.status}
                          </Badge>
                        </td>
                        <td className="text-[11px]">
                          {c.tech_stack.length > 0 ? c.tech_stack.join(", ") : "—"}
                        </td>
                        <td className="text-right font-mono text-[11px]">{linkCount}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            ) : (
              <div className="grid grid-cols-1 gap-3 p-3 md:grid-cols-2 lg:grid-cols-3">
                {filtered.map((c) => (
                  <div
                    key={c.id}
                    className="cursor-pointer rounded-md border bg-card p-3 transition-colors hover:bg-muted/50"
                    onClick={() => setSelected(c)}
                  >
                    <div className="mb-2 flex items-center gap-2">
                      <span className="text-sm font-semibold">{c.name}</span>
                      {(c.type || c.role) && (
                        <Badge variant="outline">{c.type ?? c.role}</Badge>
                      )}
                      <Badge
                        variant={c.status === "active" ? "success" : "destructive"}
                        className="ml-auto"
                      >
                        {c.status === "active" ? "Active" : c.status}
                      </Badge>
                    </div>
                    {c.tech_stack.length > 0 && (
                      <p className="mb-2 text-xs text-muted-foreground">
                        {c.tech_stack.join(" + ")}
                      </p>
                    )}
                    <div className="flex flex-wrap gap-1">
                      {c.tech_stack.map((t) => (
                        <Badge key={t} variant="outline" className="text-[10px]">
                          {t}
                        </Badge>
                      ))}
                    </div>
                    {(c.build_command || c.test_command) && (
                      <div className="mt-2 space-y-0.5 text-[11px] text-muted-foreground">
                        {c.build_command && (
                          <div>
                            Build: <code className="font-mono">{c.build_command}</code>
                          </div>
                        )}
                        {c.test_command && (
                          <div>
                            Test: <code className="font-mono">{c.test_command}</code>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </section>

      {/* Component Relations */}
      {relations.length > 0 && (
        <section className="rounded-md border bg-card">
          <div className="border-b px-3 py-2">
            <h3 className="text-sm font-medium">组件依赖关系</h3>
          </div>
          <table>
            <thead>
              <tr>
                <th>源组件</th>
                <th>关系类型</th>
                <th>目标组件</th>
                <th>描述</th>
              </tr>
            </thead>
            <tbody>
              {relations.map((r) => {
                const source = componentsById.get(r.source_component_id);
                const target = componentsById.get(r.target_component_id);
                return (
                  <tr key={r.id}>
                    <td className="font-medium">{source?.name ?? r.source_component_id}</td>
                    <td>
                      <Badge variant="outline">{r.relation_type}</Badge>
                    </td>
                    <td className="font-medium">{target?.name ?? r.target_component_id}</td>
                    <td className="text-xs text-muted-foreground">
                      {r.description ?? "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
      )}

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
