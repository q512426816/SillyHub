"use client";

import Link from "next/link";
import dynamic from "next/dynamic";
import { useEffect, useRef, useState, useCallback } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PageContainer, PageHeader, SectionCard } from "@/components/layout";
import { ApiError } from "@/lib/api";
import "@uiw/react-markdown-preview/markdown.css";

const MarkdownPreview = dynamic(() => import("@uiw/react-markdown-preview"), { ssr: false });
import {
  listScanDocs,
  reparseScanDocs,
  getScanDoc,
  STALE_THRESHOLD_MS,
  type ScanDocSummary,
  type ScanDocReparseResponse,
  type ScanDocRead,
} from "@/lib/scan-docs";
import { buildTree, type TreeNode } from "@/lib/scan-docs-tree";

interface Props { params: { id: string }; }

function FolderIcon({ open }: { open?: boolean }) {
  return open ? (
    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-amber-500"><path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/><path d="M12 10h6"/></svg>
  ) : (
    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-amber-500"><path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/></svg>
  );
}

function FileIcon() {
  return <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-muted-foreground"><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/></svg>;
}

function TreeView({ nodes, workspaceId, onSelect, selectedDoc, depth = 0 }: {
  nodes: TreeNode[]; workspaceId: string; onSelect: (_doc: ScanDocRead) => void; selectedDoc: ScanDocRead | null; depth?: number;
}) {
  const [expanded, setExpanded] = useState<Set<string>>(() => {
    const dirs = new Set<string>();
    const collectDirs = (ns: TreeNode[]) => { for (const n of ns) { if (n.children.length > 0) { dirs.add(n.path); collectDirs(n.children); } } };
    collectDirs(nodes);
    return dirs;
  });
  const toggleDir = (p: string) => { setExpanded((prev) => { const next = new Set(prev); if (next.has(p)) next.delete(p); else next.add(p); return next; }); };
  return (
    <div className="text-sm">
      {nodes.map((node) => {
        const isDir = node.children.length > 0;
        const isOpen = expanded.has(node.path);
        if (isDir) {
          return (<div key={node.path}>
            <button className="flex w-full items-center gap-1.5 rounded px-2 py-1 hover:bg-muted/50"
              style={{ paddingLeft: (depth * 16 + 8) + "px" }}
              onClick={() => toggleDir(node.path)}>
              <FolderIcon open={isOpen} />
              <span className="truncate font-medium">{node.name}</span>
            </button>
            {isOpen && (<TreeView nodes={node.children} workspaceId={workspaceId} onSelect={onSelect} selectedDoc={selectedDoc} depth={depth + 1} />)}
          </div>);
        }
        const doc = node.doc;
        if (!doc) return null;
        return (
          <button key={doc.id} className="flex w-full items-center gap-1.5 rounded px-2 py-1 hover:bg-muted/50"
            style={{ paddingLeft: (depth * 16 + 8) + "px" }}
            onClick={async () => { try { const detail = await getScanDoc(workspaceId, doc.id); onSelect(detail); } catch {} }}
          >
            <FileIcon />
            <span className="truncate">{doc.title ?? node.name}</span>
            <span className="ml-auto flex items-center gap-1">
              {doc.source_member_id && (
                <Badge variant="info" className="text-[10px] px-1.5">
                  👤 {doc.source_member_id.slice(0, 8)}
                </Badge>
              )}
              {doc.conflict_count > 0 && (
                <Badge variant="destructive" className="text-[10px] px-1.5">
                  ⚠ 冲突{doc.conflict_count}
                </Badge>
              )}
              <Badge variant={doc.exists ? "success" : "outline"} className="text-[10px] px-1.5">{doc.doc_type}</Badge>
            </span>
          </button>
        );
      })}
    </div>
  );
}

export default function ScanDocsPage({ params }: Props) {
  const workspaceId = params.id;
  const [docs, setDocs] = useState<ScanDocSummary[]>([]);
  const [selectedDoc, setSelectedDoc] = useState<ScanDocRead | null>(null);
  const [reparseResult, setReparseResult] = useState<ScanDocReparseResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [reparsing, setReparsing] = useState(false);
  const [pageError, setPageError] = useState<string | null>(null);
  const [searchInput, setSearchInput] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");

  // 仅拉文档列表（可选关键词过滤 path/title/content）。搜索时不触发 reparse，保证响应快。
  const fetchDocs = useCallback(async (q?: string) => {
    setLoading(true); setPageError(null);
    try {
      const resp = await listScanDocs(workspaceId, q ? { q } : undefined);
      setDocs(resp.items);
    } catch (err) { setPageError(err instanceof ApiError ? err.message : "加载扫描文档失败"); }
    finally { setLoading(false); }
  }, [workspaceId]);

  // 首次进入：reparse 同步平台存储 + 拉全量。
  const reparseAndLoad = useCallback(async () => {
    setLoading(true); setPageError(null);
    try {
      await reparseScanDocs(workspaceId);
      await fetchDocs();
    } catch (err) { setPageError(err instanceof ApiError ? err.message : "加载扫描文档失败"); }
    finally { setLoading(false); }
  }, [workspaceId, fetchDocs]);

  useEffect(() => { void reparseAndLoad(); }, [reparseAndLoad]);

  // 搜索框输入 debounce 300ms → debouncedQ。
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(searchInput.trim()), 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  // debouncedQ 变化触发过滤查询；跳过首次（首次由 reparseAndLoad 负责，避免重复请求）。
  const skipFirstSearchRef = useRef(true);
  useEffect(() => {
    if (skipFirstSearchRef.current) { skipFirstSearchRef.current = false; return; }
    void fetchDocs(debouncedQ || undefined);
  }, [debouncedQ, fetchDocs]);

  const handleReparse = async () => {
    setReparsing(true); setPageError(null); setSelectedDoc(null);
    try { const resp = await reparseScanDocs(workspaceId); setReparseResult(resp); await fetchDocs(debouncedQ || undefined); }
    catch (err) { setPageError(err instanceof ApiError ? err.message : "重新解析失败"); }
    finally { setReparsing(false); }
  };

  const tree = buildTree(docs);

  return (
    <PageContainer size="full">
      <PageHeader
        title={
          <span>
            <Link
              href={"/workspaces/" + workspaceId}
              className="text-[11px] font-normal text-muted-foreground hover:underline"
            >
              ← 工作空间
            </Link>
            <span className="mt-0.5 block">扫描文档</span>
          </span>
        }
        actions={
          <Button size="sm" onClick={handleReparse} disabled={reparsing}>
            {reparsing ? "解析中…" : "重新扫描"}
          </Button>
        }
      />

      {pageError && (
        <div className="rounded border border-destructive/30 bg-red-50 px-3 py-2 text-xs text-destructive">{pageError}</div>
      )}

      {reparseResult && (
        <div className="rounded border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
          扫描完成：解析 {reparseResult.stats.parsed} 个文档，新增 {reparseResult.stats.created} · 更新 {reparseResult.stats.updated} · 删除{" "}{reparseResult.stats.deleted}。
          {reparseResult.warnings.length > 0 &&
            " " + reparseResult.warnings.length + " 个警告。"}
        </div>
      )}

      {reparseResult && reparseResult.warnings.length > 0 && (
        <SectionCard title="扫描警告">
          <ul className="list-disc space-y-0.5 pl-4 text-xs text-amber-600">
            {reparseResult.warnings.map((w, i) => (<li key={i}><span className="font-mono">[{w.code}]</span>{" "}{w.detail}</li>))}
          </ul>
        </SectionCard>
      )}

      {loading ? (
        <p className="py-12 text-center text-xs text-muted-foreground">加载中…</p>
      ) : docs.length === 0 ? (
        <div className="py-12 text-center text-xs text-muted-foreground">
          {debouncedQ ? `没有匹配「${debouncedQ}」的文档` : "暂无扫描文档。点击「重新扫描」从文件系统解析。"}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[280px_1fr]">
          <SectionCard
            title="文档树"
            bodyPadding="p-2"
          >
            <div className="space-y-2">
              <input
                type="text"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                placeholder="搜索名称或内容"
                className="w-full rounded border border-input bg-background px-2.5 py-1.5 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              />
              <div className="max-h-[calc(100vh-260px)] overflow-auto">
                <TreeView nodes={tree} workspaceId={workspaceId} onSelect={setSelectedDoc} selectedDoc={selectedDoc} />
              </div>
            </div>
          </SectionCard>
          <SectionCard>
            {selectedDoc ? (
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <h3 className="text-base font-semibold">{selectedDoc.title ?? selectedDoc.path.split("/").pop()}</h3>
                  <Badge variant="outline" className="font-mono text-[10px]">{selectedDoc.doc_type}</Badge>
                </div>
                <p className="font-mono text-[11px] text-muted-foreground">{selectedDoc.path}</p>
                {selectedDoc.last_modified_at && (
                  <p className="text-[11px] text-muted-foreground">最后修改：{new Date(selectedDoc.last_modified_at).toLocaleString()}</p>
                )}
                {selectedDoc.content ? (
                  <div className="max-h-[60vh] overflow-auto rounded-md bg-muted/50 p-3">{selectedDoc.path.endsWith(".md") ? (<MarkdownPreview source={selectedDoc.content} />) : (<pre className="text-xs leading-relaxed whitespace-pre-wrap">{selectedDoc.content}</pre>)}</div>
                ) : (
                  <p className="text-xs text-muted-foreground">（无内容）</p>
                )}
              </div>
            ) : (
              <p className="py-8 text-center text-xs text-muted-foreground">点击左侧文件查看内容</p>
            )}
          </SectionCard>
        </div>
      )}
    </PageContainer>
  );
}