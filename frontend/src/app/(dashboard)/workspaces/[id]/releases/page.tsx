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
  createRelease,
  deployRelease,
  listReleases,
  promoteRelease,
  rollbackRelease,
  type Release,
} from "@/lib/releases";

interface Props {
  params: { id: string };
}

const STATUS_KIND: Record<
  string,
  "neutral" | "success" | "warning" | "error"
> = {
  draft: "neutral",
  staging: "warning",
  approved: "success",
  deploying: "warning",
  deployed: "success",
  rolled_back: "error",
};

const STATUS_LABELS: Record<string, string> = {
  draft: "草稿",
  staging: "预发布",
  approved: "已审批",
  deploying: "部署中",
  deployed: "已上线",
  rolled_back: "已回滚",
};

export default function ReleasesPage({ params }: Props) {
  const workspaceId = params.id;
  const [items, setItems] = useState<Release[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [version, setVersion] = useState("");
  const [title, setTitle] = useState("");
  const [env, setEnv] = useState<"staging" | "production">("staging");
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setError(null);
    try {
      const list = await listReleases(workspaceId);
      setItems(list);
    } catch (err) {
      setItems([]);
      setError(err instanceof ApiError ? err.message : "加载发布列表失败");
    }
  }, [workspaceId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const handleCreate = async () => {
    if (!version.trim()) return;
    setActionLoading("create");
    setError(null);
    try {
      await createRelease(workspaceId, {
        version: version.trim(),
        title: title.trim() || undefined,
        target_environment: env,
      });
      setShowCreate(false);
      setVersion("");
      setTitle("");
      setEnv("staging");
      await reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "创建发布失败");
    } finally {
      setActionLoading(null);
    }
  };

  const handleDeploy = async (releaseId: string) => {
    setActionLoading(releaseId);
    setError(null);
    try {
      await deployRelease(releaseId);
      await reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "部署失败");
    } finally {
      setActionLoading(null);
    }
  };

  const handlePromote = async (releaseId: string) => {
    setActionLoading(releaseId);
    setError(null);
    try {
      await promoteRelease(releaseId);
      await reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "提交到预发布失败");
    } finally {
      setActionLoading(null);
    }
  };

  const handleRollback = async (releaseId: string) => {
    setActionLoading(releaseId);
    setError(null);
    try {
      await rollbackRelease(releaseId);
      await reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "回滚失败");
    } finally {
      setActionLoading(null);
    }
  };

  const columns: TableProps<Release>["columns"] = [
    {
      title: "版本",
      dataIndex: "version",
      key: "version",
      render: (v: string) => <span className="font-mono text-[11px]">{v}</span>,
    },
    {
      title: "标题",
      dataIndex: "title",
      key: "title",
      render: (v: string | null) => (
        <span className="text-xs">{v ?? "—"}</span>
      ),
    },
    {
      title: "环境",
      dataIndex: "target_environment",
      key: "target_environment",
      render: (v: string) => <span className="text-xs">{v}</span>,
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
      title: "更新时间",
      dataIndex: "updated_at",
      key: "updated_at",
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
      render: (_v: unknown, r: Release) => (
        <span className="inline-flex justify-end">
          {r.status === "draft" && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => handlePromote(r.id)}
              disabled={actionLoading !== null}
            >
              {actionLoading === r.id ? "…" : "提交到预发布"}
            </Button>
          )}
          {(r.status === "staging" || r.status === "approved") && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => handleDeploy(r.id)}
              disabled={actionLoading !== null}
            >
              {actionLoading === r.id ? "…" : "部署"}
            </Button>
          )}
          {r.status === "deployed" && (
            <Button
              size="sm"
              variant="destructive"
              onClick={() => handleRollback(r.id)}
              disabled={actionLoading !== null}
            >
              {actionLoading === r.id ? "…" : "回滚"}
            </Button>
          )}
        </span>
      ),
    },
  ];

  return (
    <PageContainer>
      <PageHeader
        title="发布管理"
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
              + 创建发布
            </Button>
          ) : undefined
        }
      />

      {showCreate && (
        <SectionCard title="新建发布">
          <div className="flex flex-wrap gap-2">
            <input
              className="h-8 rounded border border-input bg-background px-2.5 text-sm focus:border-ring focus:outline-none"
              placeholder="版本号 (如 v1.0.0)"
              value={version}
              onChange={(e) => setVersion(e.target.value)}
            />
            <input
              className="h-8 rounded border border-input bg-background px-2.5 text-sm focus:border-ring focus:outline-none"
              placeholder="标题 (可选)"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
            <select
              className="h-8 rounded border border-input bg-background px-2.5 text-sm focus:border-ring focus:outline-none"
              value={env}
              onChange={(e) =>
                setEnv(e.target.value as "staging" | "production")
              }
            >
              <option value="staging">Staging</option>
              <option value="production">Production</option>
            </select>
          </div>
          <div className="mt-3 flex gap-2">
            <Button
              size="sm"
              onClick={handleCreate}
              disabled={actionLoading === "create" || !version.trim()}
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
        <DataTable<Release>
          rowKey="id"
          columns={columns}
          dataSource={items ?? []}
          loading={items === null}
          size="small"
          pagination={false}
          emptyText='暂无发布记录。点击右上角"创建发布"开始。'
        />
      </SectionCard>
    </PageContainer>
  );
}
