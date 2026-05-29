"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { ApiError } from "@/lib/api";
import {
  getKnowledge,
  listKnowledge,
  type KnowledgeEntry,
} from "@/lib/knowledge";
import {
  getQuicklog,
  listQuicklog,
  type QuicklogEntry,
} from "@/lib/knowledge";

interface Props {
  params: { id: string };
}

type Tab = "knowledge" | "quicklog";

export default function KnowledgePage({ params }: Props) {
  const workspaceId = params.id;
  const [tab, setTab] = useState<Tab>("knowledge");
  const [knowledgeItems, setKnowledgeItems] = useState<KnowledgeEntry[]>([]);
  const [quicklogItems, setQuicklogItems] = useState<QuicklogEntry[]>([]);
  const [selectedContent, setSelectedContent] = useState<string | null>(null);
  const [selectedTitle, setSelectedTitle] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [pageError, setPageError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setPageError(null);
    try {
      const [kList, qList] = await Promise.all([
        listKnowledge(workspaceId),
        listQuicklog(workspaceId),
      ]);
      setKnowledgeItems(kList.items);
      setQuicklogItems(qList.items);
    } catch (err) {
      setPageError(err instanceof ApiError ? err.message : "加载知识库失败");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId]);

  const handleSelectKnowledge = async (filename: string) => {
    try {
      const entry = await getKnowledge(workspaceId, filename);
      setSelectedContent(entry.content ?? null);
      setSelectedTitle(entry.title ?? filename);
    } catch (err) {
      setPageError(err instanceof ApiError ? err.message : "加载文档失败");
    }
  };

  const handleSelectQuicklog = async (filename: string) => {
    try {
      const entry = await getQuicklog(workspaceId, filename);
      setSelectedContent(entry.content ?? null);
      setSelectedTitle(entry.title ?? filename);
    } catch (err) {
      setPageError(err instanceof ApiError ? err.message : "加载日志失败");
    }
  };

  const currentItems = tab === "knowledge" ? knowledgeItems : quicklogItems;

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-5 px-6 py-6">
      <header>
        <p className="text-[11px] text-muted-foreground">
          <Link href={`/workspaces/${workspaceId}/components`} className="hover:underline">
            ← 组件列表
          </Link>
        </p>
        <h1 className="mt-0.5">知识 & 日志</h1>
      </header>

      {pageError && (
        <div className="rounded border border-destructive/30 bg-red-50 px-3 py-2 text-xs text-destructive">
          {pageError}
        </div>
      )}

      <div className="flex gap-4 border-b">
        {(["knowledge", "quicklog"] as const).map((t) => (
          <button
            key={t}
            onClick={() => {
              setTab(t);
              setSelectedContent(null);
            }}
            className={`border-b-2 pb-1.5 text-xs font-medium transition-colors ${
              tab === t
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {t === "knowledge" ? "知识库" : "快速日志"}
          </button>
        ))}
      </div>

      {loading ? (
        <p className="py-12 text-center text-xs text-muted-foreground">加载中…</p>
      ) : currentItems.length === 0 ? (
        <div className="py-12 text-center text-xs text-muted-foreground">
          当前没有{tab === "knowledge" ? "知识文档" : "快速日志"}。
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[260px_1fr]">
          <nav className="space-y-0.5 rounded-md border bg-card p-2">
            {currentItems.map((item) => (
              <button
                key={item.filename}
                className="w-full rounded px-2.5 py-1.5 text-left text-xs transition-colors hover:bg-muted/60"
                onClick={() =>
                  tab === "knowledge"
                    ? void handleSelectKnowledge(item.filename)
                    : void handleSelectQuicklog(item.filename)
                }
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate font-mono text-[11px]">{item.filename}</span>
                  {item.last_modified_at && (
                    <span className="shrink-0 text-[10px] text-muted-foreground">
                      {new Date(item.last_modified_at).toLocaleDateString()}
                    </span>
                  )}
                </div>
                {item.title && (
                  <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
                    {item.title}
                  </p>
                )}
              </button>
            ))}
          </nav>

          <section className="rounded-md border bg-card">
            {selectedContent === null ? (
              <div className="py-12 text-center text-xs text-muted-foreground">
                选择左侧文档查看内容。
              </div>
            ) : (
              <div className="p-3">
                <h3 className="mb-2 text-xs font-medium">{selectedTitle}</h3>
                <pre className="max-h-[560px] overflow-auto whitespace-pre-wrap break-words rounded border bg-muted/30 p-3 text-[11px] leading-4">
                  {selectedContent}
                </pre>
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
