"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

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

const STAGE_VARIANT: Record<string, "outline" | "default" | "warning" | "destructive" | "success"> = {
  draft: "outline",
  scan: "default",
  brainstorm: "warning",
  propose: "warning",
  plan: "default",
  execute: "default",
  verify: "success",
  rework_required: "destructive",
  accepted: "success",
  archive: "outline",
  quick: "default",
};

const STAGE_LABEL: Record<string, string> = {
  draft: "草稿",
  scan: "扫描",
  brainstorm: "需求分析",
  propose: "提案",
  plan: "规划",
  execute: "执行",
  verify: "验证",
  rework_required: "需返工",
  accepted: "已验收",
  archive: "归档",
  quick: "快速",
};

const STAGE_OPTIONS = [
  { value: "", label: "全部阶段" },
  { value: "draft", label: "草稿" },
  { value: "scan", label: "扫描" },
  { value: "brainstorm", label: "需求分析" },
  { value: "propose", label: "提案" },
  { value: "plan", label: "规划" },
  { value: "execute", label: "执行" },
  { value: "verify", label: "验证" },
  { value: "rework_required", label: "需返工" },
  { value: "accepted", label: "已验收" },
  { value: "archive", label: "归档" },
  { value: "quick", label: "快速" },
] as const;

export default function ChangesPage({ params }: Props) {
  const workspaceId = params.id;
  const [tab, setTab] = useState<"active" | "archive">("active");
  const [searchQuery, setSearchQuery] = useState("");
  const [stageFilter, setStageFilter] = useState("");
  const [activeItems, setActiveItems] = useState<ChangeSummary[]>([]);
  const [archiveItems, setArchiveItems] = useState<ChangeSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [reparsing, setReparsing] = useState(false);
  const [pageError, setPageError] = useState<string | null>(null);
  const [stats, setStats] = useState<ChangeReparseStats | null>(null);
  const [warnings, setWarnings] = useState<ChangeWarning[]>([]);

  const items = tab === "active" ? activeItems : archiveItems;

  const filtered = useMemo(() => {
    let result = items;
    if (stageFilter) {
      result = result.filter((c) => c.current_stage === stageFilter);
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter(
        (c) =>
          c.change_key.toLowerCase().includes(q) ||
          (c.title ?? "").toLowerCase().includes(q) ||
          c.affected_components.some((comp) => comp.toLowerCase().includes(q)),
      );
    }
    return result;
  }, [items, searchQuery, stageFilter]);

  const loadAll = async () => {
    setLoading(true);
    setPageError(null);
    try {
      const [active, archive] = await Promise.all([
        listChanges(workspaceId, { location: "active" }),
        listChanges(workspaceId, { location: "archive" }),
      ]);
      setActiveItems(active.items);
      setArchiveItems(archive.items);
    } catch (err) {
      setPageError(err instanceof ApiError ? err.message : "加载变更列表失败");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId]);

  const handleReparse = async () => {
    setReparsing(true);
    setPageError(null);
    try {
      const resp = await reparseChanges(workspaceId);
      setStats(resp.stats);
      setWarnings(resp.warnings);
      await loadAll();
    } catch (err) {
      setPageError(err instanceof ApiError ? err.message : "重新解析失败");
    } finally {
      setReparsing(false);
    }
  };

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-5 px-6 py-6">
      <header className="flex items-center justify-between">
        <div>
          <p className="text-[11px] text-muted-foreground">
            <Link href={`/workspaces/${workspaceId}/components`} className="hover:underline">
              ← 组件列表
            </Link>
          </p>
          <h1 className="mt-0.5">变更中心</h1>
        </div>
        <div className="flex items-center gap-2">
          <input
            type="text"
            placeholder="搜索 Key / 标题 / 组件…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="h-7 rounded border border-input bg-background px-2 text-xs focus:border-ring focus:outline-none"
          />
          <select
            value={stageFilter}
            onChange={(e) => setStageFilter(e.target.value)}
            className="h-7 rounded border border-input bg-background px-2 text-xs focus:border-ring focus:outline-none"
          >
            {STAGE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
          <Link
            href={`/workspaces/${workspaceId}/create-change`}
            className="inline-flex h-7 items-center rounded border border-border px-2 text-xs text-foreground hover:bg-muted"
          >
            + 新建变更
          </Link>
          <Button size="sm" onClick={handleReparse} disabled={reparsing}>
            {reparsing ? "解析中…" : "重新扫描"}
          </Button>
        </div>
      </header>

      {pageError && (
        <div className="rounded border border-destructive/30 bg-red-50 px-3 py-2 text-xs text-destructive">
          {pageError}
        </div>
      )}

      {stats && (
        <div className="rounded border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-700">
          已重新扫描：解析 {stats.parsed}，新增 {stats.created} · 更新{" "}
          {stats.updated} · 删除 {stats.deleted}。
          {warnings.length > 0 && ` ${warnings.length} 个 warning。`}
        </div>
      )}

      {warnings.length > 0 && (
        <section className="rounded-md border bg-card p-3">
          <h3 className="mb-1.5">解析警告</h3>
          <ul className="list-disc space-y-0.5 pl-4 text-xs text-amber-600">
            {warnings.map((w, i) => (
              <li key={i}>
                <span className="font-mono">[{w.code}]</span>{" "}
                {w.change_key ?? "—"}: {w.detail}
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="flex gap-4 border-b">
        {TABS.map((t) => {
          const count = t.key === "active" ? activeItems.length : archiveItems.length;
          return (
            <button
              key={t.key}
              onClick={() => setTab(t.key as "active" | "archive")}
              className={`border-b-2 pb-1.5 text-xs font-medium transition-colors ${
                tab === t.key
                  ? "border-primary text-primary"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              {t.label} ({count})
            </button>
          );
        })}
      </div>

      <section className="rounded-md border bg-card">
        {loading ? (
          <p className="py-12 text-center text-xs text-muted-foreground">加载中…</p>
        ) : filtered.length === 0 ? (
          <div className="py-12 text-center text-xs text-muted-foreground">
            {items.length === 0
              ? `当前没有${tab === "active" ? "进行中" : "已归档"}的变更。`
              : "没有匹配的变更。"}
          </div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>变更 Key</th>
                <th>标题</th>
                <th>类型</th>
                <th>状态</th>
                <th>阶段</th>
                <th>影响组件</th>
                <th className="text-right">更新时间</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((c) => (
                <tr key={c.id}>
                  <td>
                    <Link
                      href={`/workspaces/${workspaceId}/changes/${c.id}`}
                      className="font-mono text-[11px] text-primary hover:underline"
                    >
                      {c.change_key}
                    </Link>
                  </td>
                  <td className="font-medium">{c.title ?? "—"}</td>
                  <td className="text-xs">{c.change_type ?? "—"}</td>
                  <td>
                    <Badge variant={STATUS_COLORS[c.status] ?? "outline"}>
                      {c.status}
                    </Badge>
                  </td>
                  <td>
                    {c.current_stage && (
                      <Badge variant={STAGE_VARIANT[c.current_stage] ?? "outline"}>
                        {STAGE_LABEL[c.current_stage] ?? c.current_stage}
                      </Badge>
                    )}
                  </td>
                  <td className="max-w-[180px] truncate text-[11px]">
                    {c.affected_components.length > 0
                      ? c.affected_components.join(", ")
                      : "—"}
                  </td>
                  <td className="text-right text-[11px] text-muted-foreground">
                    {new Date(c.updated_at).toLocaleDateString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="rounded-md border bg-card px-6 py-4">
        <h3 className="mb-3 text-xs font-medium text-muted-foreground">变更生命周期</h3>
        <div className="flex items-center justify-center gap-0">
          {[
            "需求输入",
            "Change 创建",
            "Task 拆分",
            "执行",
            "验证",
            "归档",
          ].map((step, i) => (
            <div key={step} className="flex items-center">
              <div className="whitespace-nowrap rounded-md border border-border bg-muted/40 px-3 py-1.5 text-[11px] font-medium text-foreground">
                {step}
              </div>
              {i < 5 && (
                <span className="mx-2 text-muted-foreground">&rarr;</span>
              )}
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
