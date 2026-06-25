"use client";

import Link from "next/link";
import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { WorkspacePathFields } from "@/components/workspace-path-fields";
import { ApiError } from "@/lib/api";
import type { DaemonRuntimeRead } from "@/lib/daemon";
import {
  isDaemonClientWorkspace,
  workspacePathSourceLabel,
} from "@/lib/workspace-path";
import {
  deleteWorkspace,
  rescanWorkspace,
  type Workspace,
} from "@/lib/workspaces";
import { STATUS_LABELS, labelOf } from "@/lib/status-labels";

interface Props {
  workspace: Workspace;
  boundRuntime?: DaemonRuntimeRead | null;
  onChanged: () => void;
  // task-08 / FR-03：别名编辑入口（由 WorkspacesPage 弹 modal）。
  onEditAlias: (workspace: Workspace) => void;
}

export function WorkspaceCard({
  workspace,
  boundRuntime,
  onChanged,
  onEditAlias,
}: Props) {
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
    if (!window.confirm(`确认删除工作区 "${workspace.name}"？源文件不会被改动。`)) {
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
    <article className="flex flex-col rounded-md border bg-card">
      <header className="flex items-center justify-between border-b px-4 py-2.5">
        <div className="min-w-0">
          <h3 className="truncate text-sm font-medium">
            {workspace.display_alias ?? workspace.name}
          </h3>
          <p className="truncate font-mono text-[11px] text-muted-foreground">
            {workspace.slug}
          </p>
          {workspace.display_alias && workspace.display_alias !== workspace.name ? (
            <p className="truncate text-[10px] text-muted-foreground">原名：{workspace.name}</p>
          ) : null}
          {workspace.owner ? (
            <p className="truncate text-[10px] text-muted-foreground">
              负责人：{workspace.owner.display_name ?? workspace.owner.email ?? "未记录"}
            </p>
          ) : null}
          {isDaemonClientWorkspace(workspace) && (
            <Badge variant="outline" className="mt-1 text-[10px]">
              {workspacePathSourceLabel(workspace.path_source)}
            </Badge>
          )}
        </div>
        <Badge variant={workspace.status === "active" ? "success" : "outline"}>
          {labelOf(STATUS_LABELS, workspace.status)}
        </Badge>
      </header>

      <dl className="grid grid-cols-[5.5rem_1fr] gap-y-1 px-4 py-3 text-xs">
        <WorkspacePathFields
          workspace={workspace}
          runtime={boundRuntime}
          linkRuntime
        />
        <dt className="text-muted-foreground">最后扫描</dt>
        <dd>{formatTs(workspace.last_scanned_at)}</dd>
        <dt className="text-muted-foreground">创建于</dt>
        <dd>{formatTs(workspace.created_at)}</dd>
        {workspace.tech_stack && workspace.tech_stack.length > 0 && (
          <>
            <dt className="text-muted-foreground">技术栈</dt>
            <dd className="flex flex-wrap gap-1">
              {workspace.tech_stack.map((t) => (
                <Badge key={t} variant="outline" className="text-[10px]">{t}</Badge>
              ))}
            </dd>
          </>
        )}
      </dl>

      {error && (
        <p className="px-4 pb-2 text-xs text-destructive">{error}</p>
      )}

      <footer className="flex items-center justify-end gap-2 border-t px-4 py-2">
        <Button
          size="sm"
          variant="ghost"
          onClick={() => onEditAlias(workspace)}
          disabled={busy !== null}
        >
          别名
        </Button>
        <Link
          href={`/workspaces/${workspace.id}`}
          className="inline-flex h-7 items-center rounded border border-border px-2 text-xs text-foreground hover:bg-muted"
        >
          详情
        </Link>
        <Link
          href={`/workspaces/${workspace.id}/components`}
          className="inline-flex h-7 items-center rounded border border-border px-2 text-xs text-foreground hover:bg-muted"
        >
          关系
        </Link>
        <Button size="sm" variant="ghost" onClick={handleRescan} disabled={busy !== null}>
          {busy === "rescan" ? "扫描中…" : "重新扫描"}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="text-destructive hover:text-destructive"
          onClick={handleDelete}
          disabled={busy !== null}
        >
          {busy === "delete" ? "删除中…" : "删除"}
        </Button>
      </footer>
    </article>
  );
}
