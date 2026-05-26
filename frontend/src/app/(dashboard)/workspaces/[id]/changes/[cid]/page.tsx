"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { ApiError } from "@/lib/api";
import {
  getChange,
  getChangeDocumentContent,
  getChangeDocuments,
  type ChangeDocContent,
  type ChangeDocMatrix,
  type ChangeRead,
} from "@/lib/changes";

interface Props {
  params: { id: string; cid: string };
}

const DOC_TABS = [
  "MASTER",
  "proposal",
  "requirements",
  "design",
  "plan",
  "tasks",
  "verification",
  "prototypes",
  "references",
] as const;

const STATUS_COLORS: Record<string, "success" | "outline" | "destructive" | "default"> = {
  in_progress: "success",
  draft: "outline",
  completed: "success",
  archived: "default",
  unknown: "destructive",
};

export default function ChangeDetailPage({ params }: Props) {
  const workspaceId = params.id;
  const changeId = params.cid;
  const [change, setChange] = useState<ChangeRead | null>(null);
  const [matrix, setMatrix] = useState<ChangeDocMatrix | null>(null);
  const [activeDoc, setActiveDoc] = useState<string>("MASTER");
  const [docContent, setDocContent] = useState<ChangeDocContent | null>(null);
  const [loadingDoc, setLoadingDoc] = useState(false);
  const [pageError, setPageError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      setPageError(null);
      try {
        const [c, m] = await Promise.all([
          getChange(workspaceId, changeId),
          getChangeDocuments(workspaceId, changeId),
        ]);
        setChange(c);
        setMatrix(m);
      } catch (err) {
        setPageError(err instanceof ApiError ? err.message : "加载变更详情失败");
      } finally {
        setLoading(false);
      }
    };
    void load();
  }, [workspaceId, changeId]);

  const handleDocSelect = async (docType: string) => {
    setActiveDoc(docType);
    setLoadingDoc(true);
    setDocContent(null);
    try {
      if (docType === "prototypes" || docType === "references") {
        setDocContent(null);
      } else {
        const content = await getChangeDocumentContent(
          workspaceId,
          changeId,
          docType,
        );
        setDocContent(content);
      }
    } catch {
      setDocContent(null);
    } finally {
      setLoadingDoc(false);
    }
  };

  const docExistsMap = new Map(
    matrix?.documents.map((d) => [d.doc_type, d]) ?? [],
  );

  if (loading) {
    return (
      <div className="mx-auto max-w-6xl px-6 py-8">
        <p className="text-sm text-muted-foreground">加载中…</p>
      </div>
    );
  }

  if (pageError || !change) {
    return (
      <div className="mx-auto max-w-6xl px-6 py-8">
        <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
          {pageError ?? "变更未找到"}
        </div>
        <Link
          href={`/workspaces/${workspaceId}/changes`}
          className="mt-4 inline-block text-sm text-primary hover:underline"
        >
          &larr; 回到变更列表
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6 px-6 py-8">
      <header className="space-y-1">
        <p className="text-xs text-muted-foreground">
          <Link href={`/workspaces/${workspaceId}/changes`} className="hover:underline">
            &larr; 回到变更列表
          </Link>
        </p>
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">
            {change.title ?? change.change_key}
          </h1>
          <Badge variant={STATUS_COLORS[change.status] ?? "outline"}>
            {change.status}
          </Badge>
        </div>
        <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm text-muted-foreground">
          <span>
            <strong className="text-foreground">Key:</strong>{" "}
            <code className="text-xs">{change.change_key}</code>
          </span>
          <span>
            <strong className="text-foreground">类型:</strong> {change.change_type ?? "—"}
          </span>
          <span>
            <strong className="text-foreground">位置:</strong> {change.location}
          </span>
          <span>
            <strong className="text-foreground">影响组件:</strong>{" "}
            {change.affected_components.length > 0
              ? change.affected_components.join(", ")
              : "—"}
          </span>
        </div>
      </header>

      <div className="flex items-center gap-3">
        <Link
          href={`/workspaces/${workspaceId}/changes/${changeId}/tasks`}
          className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          任务看板
        </Link>
      </div>

      <section className="rounded-md border bg-card">
        <div className="flex flex-wrap gap-1 border-b px-3 pt-3">
          {DOC_TABS.map((dt) => {
            const doc = docExistsMap.get(dt);
            const isSpecial = dt === "prototypes" || dt === "references";
            const count = isSpecial
              ? dt === "prototypes"
                ? (matrix?.prototypes.length ?? 0)
                : (matrix?.references.length ?? 0)
              : 0;
            const exists = isSpecial ? count > 0 : (doc?.exists ?? false);

            return (
              <button
                key={dt}
                onClick={() => handleDocSelect(dt)}
                className={`rounded-t-md px-3 py-1.5 text-xs font-medium transition-colors ${
                  activeDoc === dt
                    ? "bg-muted text-foreground"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {dt === "MASTER" ? "MASTER" : dt}
                {!isSpecial && !exists && (
                  <span className="ml-1 text-muted-foreground/50">∅</span>
                )}
                {isSpecial && count > 0 && (
                  <span className="ml-1 rounded-full bg-muted px-1.5 text-[10px]">
                    {count}
                  </span>
                )}
              </button>
            );
          })}
        </div>
        <div className="p-4">
          {loadingDoc ? (
            <p className="text-sm text-muted-foreground">加载中…</p>
          ) : activeDoc === "prototypes" ? (
            matrix && matrix.prototypes.length > 0 ? (
              <ul className="space-y-1 text-sm">
                {matrix.prototypes.map((p) => (
                  <li key={p} className="font-mono text-xs">
                    {p}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">无 prototype 文件。</p>
            )
          ) : activeDoc === "references" ? (
            matrix && matrix.references.length > 0 ? (
              <ul className="space-y-1 text-sm">
                {matrix.references.map((r) => (
                  <li key={r} className="font-mono text-xs">
                    {r}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">无 reference 文件。</p>
            )
          ) : docContent ? (
            docContent.exists ? (
              <pre className="max-h-[600px] overflow-auto whitespace-pre-wrap text-xs leading-relaxed">
                {docContent.content}
              </pre>
            ) : (
              <p className="text-sm text-muted-foreground">
                文档 <code>{activeDoc}</code> 尚未创建。
              </p>
            )
          ) : (
            <p className="text-sm text-muted-foreground">选择一个文档 Tab 查看内容。</p>
          )}
        </div>
      </section>
    </div>
  );
}
