"use client";

import Link from "next/link";
import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { WorkspacePathFields } from "@/components/workspace-path-fields";
import { ApiError } from "@/lib/api";
import type {
  DaemonInstanceRead,
  DaemonRuntimeRead,
} from "@/lib/daemon";
import {
  deleteWorkspace,
  rescanWorkspace,
  type Workspace,
} from "@/lib/workspaces";
import { STATUS_LABELS, labelOf } from "@/lib/status-labels";
import { cn } from "@/lib/utils";

interface Props {
  workspace: Workspace;
  boundRuntime?: DaemonRuntimeRead | null;
  /**
   * 遗留 1（daemon-entity-binding）：按 daemon 实体展示绑定。
   * 新工作区 ``workspace.daemon_runtime_id`` 为 NULL（绑定存 member binding 行），
   * 列表卡片优先用 daemon 实体渲染守护进程信息。
   */
  boundDaemon?: DaemonInstanceRead | null;
  onChanged: () => void;
  // task-08 / FR-03：别名编辑入口（由 WorkspacesPage 弹 modal）。
  onEditAlias: (workspace: Workspace) => void;
}

export function WorkspaceCard({
  workspace,
  boundRuntime,
  boundDaemon,
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

  // ql-20260702：别名与原名不同时才补显原名，二者同行排版（标题 + 原名）。
  const hasAlias =
    !!workspace.display_alias && workspace.display_alias !== workspace.name;
  const ownerName = workspace.owner
    ? (workspace.owner.display_name ??
      workspace.owner.email ??
      "未记录")
    : null;

  return (
    <article className="flex flex-col rounded-lg border bg-card shadow-sm transition-shadow hover:shadow-md">
      <header className="flex items-start justify-between gap-2 border-b px-4 py-3">
        <div className="min-w-0">
          <div className="flex items-baseline gap-2">
            <h3 className="truncate text-sm font-semibold text-foreground">
              {workspace.display_alias ?? workspace.name}
            </h3>
            {hasAlias ? (
              <span className="truncate text-[11px] text-muted-foreground">
                原名 {workspace.name}
              </span>
            ) : null}
          </div>
          <p className="truncate font-mono text-[11px] text-muted-foreground">
            {workspace.slug}
          </p>
          {ownerName ? (
            <p className="truncate text-[11px] text-muted-foreground">
              负责人：{ownerName}
            </p>
          ) : null}
        </div>
        <Badge
          variant={workspace.status === "active" ? "success" : "outline"}
          className="shrink-0"
        >
          {labelOf(STATUS_LABELS, workspace.status)}
        </Badge>
      </header>

      <dl className="grid grid-cols-[5.5rem_1fr] gap-y-1 px-4 py-3 text-xs">
        <WorkspacePathFields
          workspace={workspace}
          runtime={boundRuntime}
          daemon={boundDaemon}
          linkRuntime
        />
        {/* ql-20260702：最后扫描与创建于合并为一行，节省纵向空间。 */}
        <dt className="col-span-2 mt-1 flex flex-wrap items-center gap-x-3 text-[11px] text-muted-foreground">
          <span>创建于 {formatTs(workspace.created_at)}</span>
          <span>最后扫描 {formatTs(workspace.last_scanned_at)}</span>
        </dt>
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

      <footer className="mt-auto flex flex-wrap items-center justify-end gap-1.5 border-t px-4 py-2.5">
        <Link
          href={`/workspaces/${workspace.id}`}
          className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
        >
          详情
        </Link>
        <Link
          href={`/workspaces/${workspace.id}/components`}
          className={cn(buttonVariants({ variant: "ghost", size: "sm" }))}
        >
          关系
        </Link>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => onEditAlias(workspace)}
          disabled={busy !== null}
        >
          别名
        </Button>
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
