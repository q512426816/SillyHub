"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ApiError } from "@/lib/api";
import {
  listChanges,
  reparseChanges,
  type ChangeReparseStats,
  type ChangeSummary,
  type ChangeWarning,
} from "@/lib/changes";

interface Props {
  params: { id: string };
}

const TABS = [
  { key: "active", label: "进行中" },
  { key: "archive", label: "已归档" },
] as const;

const STATUS_COLORS: Record<string, "success" | "outline" | "destructive" | "default"> = {
  in_progress: "success",
  draft: "outline",
  completed: "success",
  archived: "default",
  unknown: "destructive",
};

export default function ChangesPage({ params }: Props) {
  const workspaceId = params.id;
  const [tab, setTab] = useState<"active" | "archive">("active");
  const [items, setItems] = useState<ChangeSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [reparsing, setReparsing] = useState(false);
  const [pageError, setPageError] = useState<string | null>(null);
  const [stats, setStats] = useState<ChangeReparseStats | null>(null);
  const [warnings, setWarnings] = useState<ChangeWarning[]>([]);

  const load = async (location: string) => {
    setLoading(true);
    setPageError(null);
    try {
      const list = await listChanges(workspaceId, { location });
      setItems(list.items);
    } catch (err) {
      setPageError(err instanceof ApiError ? err.message : "加载变更列表失败");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load(tab);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId, tab]);

  const handleReparse = async () => {
    setReparsing(true);
    setPageError(null);
    try {
      const resp = await reparseChanges(workspaceId);
      setStats(resp.stats);
      setWarnings(resp.warnings);
      await load(tab);
    } catch (err) {
      setPageError(err instanceof ApiError ? err.message : "重新解析失败");
    } finally {
      setReparsing(false);
    }
  };

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6 px-6 py-8">
      <header className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <p className="text-xs text-muted-foreground">
            <Link href={`/workspaces/${workspaceId}/components`} className="hover:underline">
              &larr; 回到组件
            </Link>
          </p>
          <h1 className="text-2xl font-semibold tracking-tight">变更中心</h1>
          <p className="text-sm text-muted-foreground">
            解析 <code>.sillyspec/changes/</code> 下的变更目录并展示变更清单。
          </p>
        </div>
        <div className="flex gap-2">
          <Button onClick={handleReparse} disabled={reparsing}>
            {reparsing ? "解析中…" : "重新扫描"}
          </Button>
        </div>
      </header>

      {pageError && (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
          {pageError}
        </div>
      )}

      {stats && (
        <div className="rounded-md border border-emerald-500/30 bg-emerald-50 p-3 text-sm text-emerald-800">
          <strong>已重新扫描</strong>：解析 {stats.parsed} 个变更，新增 {stats.created} · 更新{" "}
          {stats.updated} · 删除 {stats.deleted}。
          {warnings.length > 0 && ` ${warnings.length} 个 warning。`}
        </div>
      )}

      {warnings.length > 0 && (
        <section className="space-y-2 rounded-md border bg-card p-4">
          <h2 className="text-sm font-medium">解析警告</h2>
          <ul className="list-disc space-y-1 pl-5 text-xs text-amber-600">
            {warnings.map((w, i) => (
              <li key={i}>
                <span className="font-mono">[{w.code}]</span>{" "}
                {w.change_key ?? "—"}: {w.detail}
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="flex gap-2 border-b pb-0">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key as "active" | "archive")}
            className={`border-b-2 px-4 pb-2 text-sm font-medium transition-colors ${
              tab === t.key
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <section className="rounded-md border bg-card">
        {loading ? (
          <p className="p-8 text-center text-sm text-muted-foreground">加载中…</p>
        ) : items.length === 0 ? (
          <div className="space-y-2 p-8 text-center text-sm text-muted-foreground">
            <p>当前没有{tab === "active" ? "进行中" : "已归档"}的变更。</p>
            <p>点击右上角&ldquo;重新扫描&rdquo;从 .sillyspec/changes/ 读取。</p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="border-b text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-4 py-3">变更 Key</th>
                <th className="px-4 py-3">标题</th>
                <th className="px-4 py-3">类型</th>
                <th className="px-4 py-3">状态</th>
                <th className="px-4 py-3">影响组件</th>
                <th className="px-4 py-3 text-right">更新时间</th>
              </tr>
            </thead>
            <tbody>
              {items.map((c) => (
                <tr key={c.id} className="border-b last:border-b-0 hover:bg-muted/40">
                  <td className="px-4 py-3">
                    <Link
                      href={`/workspaces/${workspaceId}/changes/${c.id}`}
                      className="font-mono text-xs text-primary hover:underline"
                    >
                      {c.change_key}
                    </Link>
                  </td>
                  <td className="px-4 py-3">{c.title ?? "—"}</td>
                  <td className="px-4 py-3 text-xs">{c.change_type ?? "—"}</td>
                  <td className="px-4 py-3">
                    <Badge variant={STATUS_COLORS[c.status] ?? "outline"}>
                      {c.status}
                    </Badge>
                  </td>
                  <td className="max-w-[200px] truncate px-4 py-3 text-xs">
                    {c.affected_components.length > 0
                      ? c.affected_components.join(", ")
                      : "—"}
                  </td>
                  <td className="px-4 py-3 text-right text-xs text-muted-foreground">
                    {new Date(c.updated_at).toLocaleDateString()}
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
