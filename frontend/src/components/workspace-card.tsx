"use client";

import Link from "next/link";
import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ApiError } from "@/lib/api";
import {
  deleteWorkspace,
  rescanWorkspace,
  type Workspace,
} from "@/lib/workspaces";

interface Props {
  workspace: Workspace;
  onChanged: () => void;
}

export function WorkspaceCard({ workspace, onChanged }: Props) {
  const [busy, setBusy] = useState<"rescan" | "delete" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const formatTs = (raw: string | null) =>
    raw ? new Date(raw).toLocaleString() : "—";

  const handleRescan = async () => {
    setError(null);
    setBusy("rescan");
    try {
      await rescanWorkspace(workspace.id);
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "重新扫描失败");
    } finally {
      setBusy(null);
    }
  };

  const handleDelete = async () => {
    if (!window.confirm(`确认删除 Workspace "${workspace.name}"？源文件不会被改动。`)) {
      return;
    }
    setError(null);
    setBusy("delete");
    try {
      await deleteWorkspace(workspace.id);
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "删除失败");
    } finally {
      setBusy(null);
    }
  };

  return (
    <article className="flex flex-col gap-3 rounded-lg border bg-card p-5 shadow-sm">
      <header className="flex items-start justify-between gap-2">
        <div>
          <h3 className="text-base font-semibold tracking-tight">{workspace.name}</h3>
          <p className="font-mono text-xs text-muted-foreground">{workspace.slug}</p>
        </div>
        <Badge variant={workspace.status === "active" ? "success" : "outline"}>
          {workspace.status}
        </Badge>
      </header>

      <dl className="grid grid-cols-[6rem_1fr] gap-y-1 text-xs">
        <dt className="text-muted-foreground">root_path</dt>
        <dd className="break-all font-mono">{workspace.root_path}</dd>
        <dt className="text-muted-foreground">最后扫描</dt>
        <dd>{formatTs(workspace.last_scanned_at)}</dd>
        <dt className="text-muted-foreground">创建于</dt>
        <dd>{formatTs(workspace.created_at)}</dd>
      </dl>

      {error && <p className="text-xs text-destructive">{error}</p>}

      <footer className="flex flex-wrap justify-end gap-2 pt-1">
        <Link
          href={`/workspaces/${workspace.id}/components`}
          className="inline-flex h-8 items-center justify-center rounded-md border border-input bg-background px-3 text-xs font-medium transition-colors hover:bg-muted"
        >
          项目组件
        </Link>
        <Button size="sm" variant="outline" onClick={handleRescan} disabled={busy !== null}>
          {busy === "rescan" ? "扫描中…" : "Re-scan"}
        </Button>
        <Button
          size="sm"
          variant="destructive"
          onClick={handleDelete}
          disabled={busy !== null}
        >
          {busy === "delete" ? "删除中…" : "删除"}
        </Button>
      </footer>
    </article>
  );
}
