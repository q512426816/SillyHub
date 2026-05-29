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
    <div className="mx-auto flex max-w-6xl flex-col gap-5 px-6 py-6">
      <header className="flex items-center justify-between">
        <div>
          <p className="text-[11px] text-muted-foreground">
            <Link href={`/workspaces/${workspaceId}/components`} className="hover:underline">
              ← 组件列表
            </Link>
          </p>
          <h1 className="mt-0.5">扫描文档</h1>
        </div>
        <Button size="sm" onClick={handleReparse} disabled={reparsing}>
          {reparsing ? "解析中…" : "重新扫描"}
        </Button>
      </header>

      {pageError && (
        <div className="rounded border border-destructive/30 bg-red-50 px-3 py-2 text-xs text-destructive">
          {pageError}
        </div>
      )}

      {reparseResult && (
        <div className="rounded border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
          扫描完成：解析 {reparseResult.stats.parsed} 个文档，
          新增 {reparseResult.stats.created} · 更新 {reparseResult.stats.updated} · 删除{" "}
          {reparseResult.stats.deleted}。
          {reparseResult.warnings.length > 0 &&
            ` ${reparseResult.warnings.length} 个警告。`}
        </div>
      )}

      {reparseResult && reparseResult.warnings.length > 0 && (
        <section className="rounded-md border bg-card p-3">
          <h3 className="mb-1.5">扫描警告</h3>
          <ul className="list-disc space-y-0.5 pl-4 text-xs text-amber-600">
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
        <p className="py-12 text-center text-xs text-muted-foreground">加载中…</p>
      ) : components.length === 0 ? (
        <div className="py-12 text-center text-xs text-muted-foreground">
          当前 Workspace 还没有解析过组件。请先前往{" "}
          <Link href={`/workspaces/${workspaceId}/components`} className="underline">
            组件列表
          </Link>{" "}
          进行组件解析。
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[220px_1fr]">
          <nav className="space-y-px rounded-md border bg-card">
            {components.map((c) => {
              const docs = docMap.get(c.id) ?? [];
              const existsCount = docs.filter((d) => d.exists).length;
              return (
                <button
                  key={c.id}
                  className={`w-full px-3 py-2 text-left text-xs transition-colors ${
                    selectedComp === c.id
                      ? "bg-primary/8 font-medium text-primary"
                      : "hover:bg-muted/50"
                  } ${components.indexOf(c) === 0 ? "rounded-t-md" : ""} ${components.indexOf(c) === components.length - 1 ? "rounded-b-md" : ""}`}
                  onClick={() => setSelectedComp(c.id)}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate font-mono">{c.component_key}</span>
                    <Badge variant={existsCount > 0 ? "success" : "outline"}>
                      {existsCount}/{docs.length}
                    </Badge>
                  </div>
                </button>
              );
            })}
          </nav>

          <section className="rounded-md border bg-card">
            <div className="border-b px-3 py-2">
              <h2 className="text-xs font-medium">
                {selectedCompObj?.component_key ?? "选择组件"}
              </h2>
            </div>
            {selectedDocs.length === 0 ? (
              <p className="p-6 text-center text-xs text-muted-foreground">
                暂无扫描文档。
              </p>
            ) : (
              <table>
                <thead>
                  <tr>
                    <th>类型</th>
                    <th>标题</th>
                    <th>路径</th>
                    <th>状态</th>
                    <th>最后修改</th>
                  </tr>
                </thead>
                <tbody>
                  {selectedDocs.map((doc) => (
                    <tr key={doc.id}>
                      <td className="font-mono text-[11px]">{doc.doc_type}</td>
                      <td>{doc.title ?? "—"}</td>
                      <td className="max-w-[180px] truncate font-mono text-[11px]" title={doc.path}>
                        {doc.path}
                      </td>
                      <td>
                        <Badge variant={doc.exists ? "success" : "outline"}>
                          {doc.exists ? "存在" : "缺失"}
                        </Badge>
                      </td>
                      <td className="text-[11px] text-muted-foreground">
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
