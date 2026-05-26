"use client";

import { useCallback, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { WorkspaceCard } from "@/components/workspace-card";
import { WorkspaceScanDialog } from "@/components/workspace-scan-dialog";
import { ApiError } from "@/lib/api";
import { listWorkspaces, type Workspace } from "@/lib/workspaces";

export default function WorkspacesPage() {
  const [items, setItems] = useState<Workspace[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showDialog, setShowDialog] = useState(false);

  const reload = useCallback(async () => {
    setError(null);
    try {
      const { items: list } = await listWorkspaces();
      setItems(list);
    } catch (err) {
      setItems([]);
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
    <main className="container mx-auto flex max-w-5xl flex-col gap-6 px-4 py-12">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Workspaces</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            管理已注册的 SillySpec 仓库。任务 / 变更 / 组件全部归属在 Workspace 之下。
          </p>
        </div>
        {!showDialog && (
          <Button onClick={() => setShowDialog(true)}>添加 Workspace</Button>
        )}
      </header>

      {showDialog && (
        <WorkspaceScanDialog
          onCreated={handleCreated}
          onCancel={() => setShowDialog(false)}
        />
      )}

      {error && (
        <p className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </p>
      )}

      {items === null ? (
        <p className="text-sm text-muted-foreground">加载中…</p>
      ) : items.length === 0 ? (
        <section className="rounded-lg border border-dashed bg-muted/30 p-8 text-center text-sm text-muted-foreground">
          还没有 Workspace。点击右上角“添加 Workspace”绑定一个 SillySpec 仓库。
        </section>
      ) : (
        <section className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {items.map((w) => (
            <WorkspaceCard key={w.id} workspace={w} onChanged={reload} />
          ))}
        </section>
      )}
    </main>
  );
}
