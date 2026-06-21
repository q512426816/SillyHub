"use client";

import { useCallback, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { PageContainer, PageHeader } from "@/components/layout";
import { WorkspaceCard } from "@/components/workspace-card";
import { WorkspaceScanDialog } from "@/components/workspace-scan-dialog";
import { ApiError } from "@/lib/api";
import { listDaemonRuntimes, type DaemonRuntimeRead } from "@/lib/daemon";
import { listWorkspaces, type Workspace } from "@/lib/workspaces";

export default function WorkspacesPage() {
  const [items, setItems] = useState<Workspace[] | null>(null);
  const [runtimesById, setRuntimesById] = useState<Map<string, DaemonRuntimeRead>>(
    () => new Map(),
  );
  const [error, setError] = useState<string | null>(null);
  const [showDialog, setShowDialog] = useState(false);

  const reload = useCallback(async () => {
    setError(null);
    try {
      const [{ items: list }, runtimes] = await Promise.all([
        listWorkspaces(),
        listDaemonRuntimes().catch(() => [] as DaemonRuntimeRead[]),
      ]);
      setItems(list);
      setRuntimesById(new Map(runtimes.map((runtime) => [runtime.id, runtime])));
    } catch (err) {
      setItems([]);
      setRuntimesById(new Map());
      setError(err instanceof ApiError ? err.message : "加载列表失败");
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const handleCreated = async () => {
    setShowDialog(false);
    await reload();
  };

  return (
    <PageContainer>
      <PageHeader
        title="工作区"
        subtitle="管理已注册的项目工作区"
        actions={
          !showDialog && (
            <Button size="sm" onClick={() => setShowDialog(true)}>
              + 添加工作区
            </Button>
          )
        }
      />

      {showDialog && (
        <WorkspaceScanDialog
          onCreated={handleCreated}
          onCancel={() => setShowDialog(false)}
        />
      )}

      {error && (
        <div className="rounded border border-destructive/30 bg-red-50 px-3 py-2 text-xs text-destructive">
          {error}
        </div>
      )}

      {items === null ? (
        <p className="py-8 text-center text-xs text-muted-foreground">加载中…</p>
      ) : items.length === 0 ? (
        <div className="rounded-md border border-dashed py-12 text-center text-xs text-muted-foreground">
          还没有工作区。点击右上角&ldquo;添加工作区&rdquo;绑定一个项目仓库。
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {items.map((w) => (
            <WorkspaceCard
              key={w.id}
              workspace={w}
              boundRuntime={
                w.daemon_runtime_id ? runtimesById.get(w.daemon_runtime_id) : null
              }
              onChanged={reload}
            />
          ))}
        </div>
      )}
    </PageContainer>
  );
}
