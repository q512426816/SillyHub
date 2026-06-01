"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ApiError } from "@/lib/api";
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
  const [docs, setDocs] = useState<ScanDocSummary[]>([]);
  const [reparseResult, setReparseResult] = useState<ScanDocReparseResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [reparsing, setReparsing] = useState(false);
  const [pageError, setPageError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setPageError(null);
    try {
      const resp = await listScanDocs(workspaceId);
      setDocs(resp.items);
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

  const existsCount = docs.filter((d) => d.exists).length;

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-5 px-6 py-6">
      <header className="flex items-center justify-between">
        <div>
          <p className="text-[11px] text-muted-foreground">
            <Link href={`/workspaces/${workspaceId}`} className="hover:underline">
              ← 工作空间
            </Link>
          </p>
          <h1 className="mt-0.5">
            扫描文档
            {!loading && docs.length > 0 && (
              <Badge variant={existsCount === docs.length ? "success" : "outline"} className="ml-2">
                {existsCount}/{docs.length}
              </Badge>
            )}
          </h1>
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
      ) : docs.length === 0 ? (
        <div className="py-12 text-center text-xs text-muted-foreground">
          暂无扫描文档。点击「重新扫描」从文件系统解析。
        </div>
      ) : (
        <section className="rounded-md border bg-card">
          <table className="w-full">
            <thead>
              <tr>
                <th className="px-3 py-2 text-left text-xs font-medium">类型</th>
                <th className="px-3 py-2 text-left text-xs font-medium">标题</th>
                <th className="px-3 py-2 text-left text-xs font-medium">路径</th>
                <th className="px-3 py-2 text-left text-xs font-medium">状态</th>
                <th className="px-3 py-2 text-left text-xs font-medium">最后修改</th>
              </tr>
            </thead>
            <tbody>
              {docs.map((doc) => (
                <tr key={doc.id} className="border-t last:border-b-0">
                  <td className="px-3 py-2 font-mono text-[11px]">{doc.doc_type}</td>
                  <td className="px-3 py-2">{doc.title ?? "—"}</td>
                  <td className="max-w-[240px] truncate px-3 py-2 font-mono text-[11px]" title={doc.path}>
                    {doc.path}
                  </td>
                  <td className="px-3 py-2">
                    <Badge variant={doc.exists ? "success" : "outline"}>
                      {doc.exists ? "存在" : "缺失"}
                    </Badge>
                  </td>
                  <td className="px-3 py-2 text-[11px] text-muted-foreground">
                    {doc.last_modified_at
                      ? new Date(doc.last_modified_at).toLocaleString()
                      : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </div>
  );
}
