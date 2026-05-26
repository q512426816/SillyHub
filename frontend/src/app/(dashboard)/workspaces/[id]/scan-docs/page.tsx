"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ApiError } from "@/lib/api";
import {
  listComponents,
  type Component,
} from "@/lib/components";
import {
  listScanDocs,
  reparseScanDocs,
  type ScanDocSummary,
  type ScanDocReparseResponse,
} from "@/lib/scan-docs";

interface Props {
  params: { id: string };
}

export default function ScanDocsPage({ params }: Props) {
  const workspaceId = params.id;
  const [components, setComponents] = useState<Component[]>([]);
  const [docMap, setDocMap] = useState<Map<string, ScanDocSummary[]>>(new Map());
  const [selectedComp, setSelectedComp] = useState<string | null>(null);
  const [reparseResult, setReparseResult] = useState<ScanDocReparseResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [reparsing, setReparsing] = useState(false);
  const [pageError, setPageError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setPageError(null);
    try {
      const list = await listComponents(workspaceId);
      setComponents(list.items);

      const map = new Map<string, ScanDocSummary[]>();
      await Promise.all(
        list.items.map(async (c) => {
          try {
            const docs = await listScanDocs(workspaceId, c.id);
            map.set(c.id, docs.items);
          } catch {
            map.set(c.id, []);
          }
        }),
      );
      setDocMap(map);
      if (list.items.length > 0 && !selectedComp && list.items[0]) {
        setSelectedComp(list.items[0].id);
      }
    } catch (err) {
      setPageError(
        err instanceof ApiError ? err.message : "加载扫描文档失败",
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
      const resp = await reparseScanDocs(workspaceId);
      setReparseResult(resp);
      await load();
    } catch (err) {
      setPageError(
        err instanceof ApiError ? err.message : "重新解析失败",
      );
    } finally {
      setReparsing(false);
    }
  };

  const selectedDocs = selectedComp ? (docMap.get(selectedComp) ?? []) : [];
  const selectedCompObj = components.find((c) => c.id === selectedComp);

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6 px-6 py-8">
      <header className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <p className="text-xs text-muted-foreground">
            <Link href={`/workspaces/${workspaceId}/components`} className="hover:underline">
              ← 回到组件列表
            </Link>
          </p>
          <h1 className="text-2xl font-semibold tracking-tight">扫描文档</h1>
          <p className="text-sm text-muted-foreground">
            浏览 <code>.sillyspec/docs/</code> 中各组件的扫描文档。
          </p>
        </div>
        <Button onClick={handleReparse} disabled={reparsing}>
          {reparsing ? "解析中…" : "重新扫描"}
        </Button>
      </header>

      {pageError && (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
          {pageError}
        </div>
      )}

      {reparseResult && (
        <div className="rounded-md border border-emerald-500/30 bg-emerald-50 p-3 text-sm text-emerald-800">
          <strong>扫描完成</strong>：解析 {reparseResult.stats.parsed} 个文档，
          新增 {reparseResult.stats.created} · 更新 {reparseResult.stats.updated} · 删除{" "}
          {reparseResult.stats.deleted}。
          {reparseResult.warnings.length > 0 &&
            ` ${reparseResult.warnings.length} 个警告。`}
        </div>
      )}

      {reparseResult && reparseResult.warnings.length > 0 && (
        <section className="space-y-2 rounded-md border bg-card p-4">
          <h2 className="text-sm font-medium">扫描警告</h2>
          <ul className="list-disc space-y-1 pl-5 text-xs text-amber-600">
            {reparseResult.warnings.map((w, i) => (
              <li key={i}>
                <span className="font-mono">[{w.code}]</span>{" "}
                {w.component_key ?? "—"}: {w.detail}
              </li>
            ))}
          </ul>
        </section>
      )}

      {loading ? (
        <p className="p-8 text-center text-sm text-muted-foreground">加载中…</p>
      ) : components.length === 0 ? (
        <div className="space-y-2 p-8 text-center text-sm text-muted-foreground">
          <p>当前 Workspace 还没有解析过组件。</p>
          <p>
            请先前往{" "}
            <Link href={`/workspaces/${workspaceId}/components`} className="underline">
              组件列表
            </Link>{" "}
            进行组件解析。
          </p>
        </div>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[240px_1fr]">
          {/* Component sidebar */}
          <nav className="space-y-1 rounded-md border bg-card p-2">
            {components.map((c) => {
              const docs = docMap.get(c.id) ?? [];
              const existsCount = docs.filter((d) => d.exists).length;
              return (
                <button
                  key={c.id}
                  className={`w-full rounded-md px-3 py-2 text-left text-sm transition-colors ${
                    selectedComp === c.id
                      ? "bg-primary/10 font-medium text-primary"
                      : "hover:bg-muted/60"
                  }`}
                  onClick={() => setSelectedComp(c.id)}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-xs">{c.component_key}</span>
                    <Badge variant={existsCount > 0 ? "success" : "outline"}>
                      {existsCount}/{docs.length}
                    </Badge>
                  </div>
                </button>
              );
            })}
          </nav>

          {/* Doc list for selected component */}
          <section className="rounded-md border bg-card">
            <div className="border-b px-4 py-3">
              <h2 className="text-sm font-medium">
                {selectedCompObj?.component_key ?? "选择组件"}
              </h2>
            </div>
            {selectedDocs.length === 0 ? (
              <p className="p-6 text-center text-sm text-muted-foreground">
                暂无扫描文档。
              </p>
            ) : (
              <table className="w-full text-sm">
                <thead className="border-b text-left text-xs text-muted-foreground">
                  <tr>
                    <th className="px-4 py-3">类型</th>
                    <th className="px-4 py-3">标题</th>
                    <th className="px-4 py-3">路径</th>
                    <th className="px-4 py-3">状态</th>
                    <th className="px-4 py-3">最后修改</th>
                  </tr>
                </thead>
                <tbody>
                  {selectedDocs.map((doc) => (
                    <tr
                      key={doc.id}
                      className="border-b last:border-b-0 hover:bg-muted/40"
                    >
                      <td className="px-4 py-3 font-mono text-xs">
                        {doc.doc_type}
                      </td>
                      <td className="px-4 py-3">
                        {doc.title ?? "—"}
                      </td>
                      <td className="max-w-[200px] break-all px-4 py-3 font-mono text-xs">
                        {doc.path}
                      </td>
                      <td className="px-4 py-3">
                        <Badge variant={doc.exists ? "success" : "outline"}>
                          {doc.exists ? "存在" : "缺失"}
                        </Badge>
                      </td>
                      <td className="px-4 py-3 text-xs text-muted-foreground">
                        {doc.last_modified_at
                          ? new Date(doc.last_modified_at).toLocaleString()
                          : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
