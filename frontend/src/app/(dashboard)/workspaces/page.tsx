"use client";

import { useCallback, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
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
    <main className="mx-auto flex max-w-5xl flex-col gap-5 px-6 py-8">
      <header className="flex items-center justify-between">
        <div>
          <h1>工作区</h1>
          <p className="mt-0.5 text-xs text-muted-foreground">
            管理已注册的项目工作区
          </p>
        </div>
        {!showDialog && (
          <Button size="sm" onClick={() => setShowDialog(true)}>
            + 添加工作区
          </Button>
        )}
      </header>

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
        <section className="rounded-md border border-dashed py-12 text-center text-xs text-muted-foreground">
          还没有工作区。点击右上角&ldquo;添加工作区&rdquo;绑定一个项目仓库。
        </section>
      ) : (
        <section className="grid grid-cols-1 gap-3 md:grid-cols-2">
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
        </section>
      )}
    </main>
  );
}
