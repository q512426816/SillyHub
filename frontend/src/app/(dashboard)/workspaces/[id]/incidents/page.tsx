"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ApiError } from "@/lib/api";
import {
  createIncident,
  listIncidents,
  updateIncident,
  type Incident,
  type IncidentSeverity,
} from "@/lib/incidents";

interface Props {
  params: { id: string };
}

const STATUS_COLORS: Record<string, "default" | "success" | "warning" | "destructive" | "outline"> = {
  open: "destructive",
  investigating: "warning",
  mitigated: "warning",
  resolved: "success",
};

const STATUS_LABELS: Record<string, string> = {
  open: "待处理",
  investigating: "调查中",
  mitigated: "已缓解",
  resolved: "已解决",
};

const SEVERITY_COLORS: Record<string, "default" | "success" | "warning" | "destructive" | "outline"> = {
  low: "outline",
  medium: "warning",
  high: "destructive",
  critical: "destructive",
};

const SEVERITY_LABELS: Record<string, string> = {
  low: "低",
  medium: "中",
  high: "高",
  critical: "严重",
};

export default function IncidentsPage({ params }: Props) {
  const workspaceId = params.id;
  const [items, setItems] = useState<Incident[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [showCreate, setShowCreate] = useState(false);
  const [title, setTitle] = useState("");
  const [severity, setSeverity] = useState<IncidentSeverity>("medium");
  const [description, setDescription] = useState("");
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setError(null);
    try {
      const list = await listIncidents(workspaceId, statusFilter || undefined);
      setItems(list);
    } catch (err) {
      setItems([]);
      setError(err instanceof ApiError ? err.message : "加载事件列表失败");
    }
  }, [workspaceId, statusFilter]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const handleCreate = async () => {
    if (!title.trim()) return;
    setActionLoading("create");
    setError(null);
    try {
      await createIncident(workspaceId, {
        title: title.trim(),
        severity,
        description: description.trim() || undefined,
      });
      setShowCreate(false);
      setTitle("");
      setSeverity("medium");
      setDescription("");
      await reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "创建事件失败");
    } finally {
      setActionLoading(null);
    }
  };

  const handleTransition = async (
    incidentId: string,
    targetStatus: "investigating" | "mitigated" | "resolved",
  ) => {
    setActionLoading(incidentId);
    setError(null);
    try {
      await updateIncident(incidentId, { status: targetStatus });
      await reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "状态变更失败");
    } finally {
      setActionLoading(null);
    }
  };

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-5 px-6 py-6">
      <header className="flex items-center justify-between">
        <div>
          <p className="text-[11px] text-muted-foreground">
            <Link href={`/workspaces/${workspaceId}/changes`} className="hover:underline">
              ← 变更中心
            </Link>
          </p>
          <h1 className="mt-0.5">事件管理</h1>
        </div>
        {!showCreate && (
          <Button size="sm" onClick={() => setShowCreate(true)}>+ 报告事件</Button>
        )}
      </header>

      {showCreate && (
        <section className="space-y-3 rounded-md border bg-card p-4">
          <h3 className="text-xs font-medium text-muted-foreground">报告新事件</h3>
          <div className="flex flex-col gap-2">
            <input
              className="h-8 rounded border border-input bg-background px-2.5 text-sm focus:border-ring focus:outline-none"
              placeholder="事件标题"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
            <div className="flex gap-2">
              <select
                className="h-8 rounded border border-input bg-background px-2.5 text-sm focus:border-ring focus:outline-none"
                value={severity}
                onChange={(e) => setSeverity(e.target.value as IncidentSeverity)}
              >
                <option value="low">低</option>
                <option value="medium">中</option>
                <option value="high">高</option>
                <option value="critical">严重</option>
              </select>
            </div>
            <textarea
              className="rounded border border-input bg-background px-2.5 py-1.5 text-sm focus:border-ring focus:outline-none"
              rows={3}
              placeholder="事件描述 (可选)"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
          <div className="flex gap-2">
            <Button
              size="sm"
              onClick={handleCreate}
              disabled={actionLoading === "create" || !title.trim()}
            >
              {actionLoading === "create" ? "创建中…" : "确认"}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setShowCreate(false)}>
              取消
            </Button>
          </div>
        </section>
      )}

      {error && (
        <div className="rounded border border-destructive/30 bg-red-50 px-3 py-2 text-xs text-destructive">
          {error}
        </div>
      )}

      <div className="flex gap-1.5">
        {["", "open", "investigating", "mitigated", "resolved"].map((s) => (
          <button
            key={s}
            onClick={() => setStatusFilter(s)}
            className={`rounded px-2 py-1 text-[11px] font-medium transition-colors ${
              statusFilter === s
                ? "bg-primary text-primary-foreground"
                : "bg-muted/60 text-muted-foreground hover:text-foreground"
            }`}
          >
            {s === "" ? "全部" : STATUS_LABELS[s]}
          </button>
        ))}
      </div>

      <section className="rounded-md border bg-card">
        {items === null ? (
          <p className="py-12 text-center text-xs text-muted-foreground">加载中…</p>
        ) : items.length === 0 ? (
          <div className="py-12 text-center text-xs text-muted-foreground">
            暂无事件记录。
          </div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>标题</th>
                <th>严重度</th>
                <th>状态</th>
                <th className="text-right">创建时间</th>
                <th className="text-right">操作</th>
              </tr>
            </thead>
            <tbody>
              {items.map((inc) => (
                <tr key={inc.id}>
                  <td>
                    <Link
                      href={`/workspaces/${workspaceId}/incidents/${inc.id}`}
                      className="text-xs font-medium hover:underline"
                    >
                      {inc.title}
                    </Link>
                  </td>
                  <td>
                    <Badge variant={SEVERITY_COLORS[inc.severity] ?? "outline"}>
                      {SEVERITY_LABELS[inc.severity] ?? inc.severity}
                    </Badge>
                  </td>
                  <td>
                    <Badge variant={STATUS_COLORS[inc.status] ?? "outline"}>
                      {STATUS_LABELS[inc.status] ?? inc.status}
                    </Badge>
                  </td>
                  <td className="text-right text-[11px] text-muted-foreground">
                    {new Date(inc.created_at).toLocaleDateString()}
                  </td>
                  <td className="text-right space-x-1">
                    {inc.status === "open" && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleTransition(inc.id, "investigating")}
                        disabled={actionLoading !== null}
                      >
                        开始调查
                      </Button>
                    )}
                    {inc.status === "investigating" && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleTransition(inc.id, "mitigated")}
                        disabled={actionLoading !== null}
                      >
                        已缓解
                      </Button>
                    )}
                    {inc.status === "mitigated" && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleTransition(inc.id, "resolved")}
                        disabled={actionLoading !== null}
                      >
                        已解决
                      </Button>
                    )}
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
