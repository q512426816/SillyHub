"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ApiError } from "@/lib/api";
import {
  createRelease,
  deployRelease,
  listReleases,
  rollbackRelease,
  type Release,
} from "@/lib/releases";

interface Props {
  params: { id: string };
}

const STATUS_COLORS: Record<string, "default" | "success" | "warning" | "destructive" | "outline"> = {
  draft: "outline",
  staging: "warning",
  approved: "success",
  deploying: "warning",
  deployed: "success",
  rolled_back: "destructive",
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

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-5 px-6 py-6">
      <header className="flex items-center justify-between">
        <div>
          <p className="text-[11px] text-muted-foreground">
            <Link href={`/workspaces/${workspaceId}/changes`} className="hover:underline">
              ← 变更中心
            </Link>
          </p>
          <h1 className="mt-0.5">发布管理</h1>
        </div>
        {!showCreate && (
          <Button size="sm" onClick={() => setShowCreate(true)}>+ 创建发布</Button>
        )}
      </header>

      {showCreate && (
        <section className="space-y-3 rounded-md border bg-card p-4">
          <h3 className="text-xs font-medium text-muted-foreground">新建发布</h3>
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
              onChange={(e) => setEnv(e.target.value as "staging" | "production")}
            >
              <option value="staging">Staging</option>
              <option value="production">Production</option>
            </select>
          </div>
          <div className="flex gap-2">
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
        </section>
      )}

      {error && (
        <div className="rounded border border-destructive/30 bg-red-50 px-3 py-2 text-xs text-destructive">
          {error}
        </div>
      )}

      <section className="rounded-md border bg-card">
        {items === null ? (
          <p className="py-12 text-center text-xs text-muted-foreground">加载中…</p>
        ) : items.length === 0 ? (
          <div className="py-12 text-center text-xs text-muted-foreground">
            暂无发布记录。点击右上角&ldquo;创建发布&rdquo;开始。
          </div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>版本</th>
                <th>标题</th>
                <th>环境</th>
                <th>状态</th>
                <th className="text-right">更新时间</th>
                <th className="text-right">操作</th>
              </tr>
            </thead>
            <tbody>
              {items.map((r) => (
                <tr key={r.id}>
                  <td className="font-mono text-[11px]">{r.version}</td>
                  <td className="text-xs">{r.title ?? "—"}</td>
                  <td className="text-xs">{r.target_environment}</td>
                  <td>
                    <Badge variant={STATUS_COLORS[r.status] ?? "outline"}>
                      {STATUS_LABELS[r.status] ?? r.status}
                    </Badge>
                  </td>
                  <td className="text-right text-[11px] text-muted-foreground">
                    {new Date(r.updated_at).toLocaleDateString()}
                  </td>
                  <td className="text-right">
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
