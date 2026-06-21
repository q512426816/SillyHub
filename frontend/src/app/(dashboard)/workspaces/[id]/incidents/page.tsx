"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { type TableProps } from "antd";

import {
  DataTable,
  PageContainer,
  PageHeader,
  SectionCard,
} from "@/components/layout";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
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

const STATUS_KIND: Record<
  string,
  "neutral" | "success" | "warning" | "error"
> = {
  open: "error",
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

const SEVERITY_KIND: Record<
  string,
  "neutral" | "success" | "warning" | "error"
> = {
  low: "neutral",
  medium: "warning",
  high: "error",
  critical: "error",
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

  const columns: TableProps<Incident>["columns"] = [
    {
      title: "标题",
      dataIndex: "title",
      key: "title",
      render: (v: string, inc: Incident) => (
        <Link
          href={`/workspaces/${workspaceId}/incidents/${inc.id}`}
          className="text-xs font-medium hover:underline"
        >
          {v}
        </Link>
      ),
    },
    {
      title: "严重度",
      dataIndex: "severity",
      key: "severity",
      render: (v: string) => (
        <StatusBadge kind={SEVERITY_KIND[v] ?? "neutral"}>
          {SEVERITY_LABELS[v] ?? v}
        </StatusBadge>
      ),
    },
    {
      title: "状态",
      dataIndex: "status",
      key: "status",
      render: (v: string) => (
        <StatusBadge kind={STATUS_KIND[v] ?? "neutral"}>
          {STATUS_LABELS[v] ?? v}
        </StatusBadge>
      ),
    },
    {
      title: "创建时间",
      dataIndex: "created_at",
      key: "created_at",
      align: "right",
      render: (v: string) => (
        <span className="text-[11px] text-muted-foreground">
          {new Date(v).toLocaleDateString()}
        </span>
      ),
    },
    {
      title: "操作",
      key: "actions",
      align: "right",
      render: (_v: unknown, inc: Incident) => (
        <span className="inline-flex justify-end">
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
        </span>
      ),
    },
  ];

  return (
    <PageContainer>
      <PageHeader
        title="事件管理"
        subtitle={
          <Link
            href={`/workspaces/${workspaceId}/changes`}
            className="hover:underline"
          >
            ← 变更中心
          </Link>
        }
        actions={
          !showCreate ? (
            <Button size="sm" onClick={() => setShowCreate(true)}>
              + 报告事件
            </Button>
          ) : undefined
        }
      />

      {showCreate && (
        <SectionCard title="报告新事件">
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
          <div className="mt-3 flex gap-2">
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
        </SectionCard>
      )}

      {error && (
        <div className="rounded border border-destructive/30 bg-red-50 px-3 py-2 text-xs text-destructive">
          {error}
        </div>
      )}

      <SectionCard bodyPadding="p-0">
        <div className="flex gap-1.5 border-b px-3 py-2">
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
        <DataTable<Incident>
          rowKey="id"
          columns={columns}
          dataSource={items ?? []}
          loading={items === null}
          size="small"
          pagination={false}
          emptyText="暂无事件记录。"
        />
      </SectionCard>
    </PageContainer>
  );
}
