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

/**
 * task-07（2026-07-09-workspace-prioritization / FR-03 / D-001 / CB-1）：
 * 列表页改造为工作区选择器后，每张卡片需展示 daemon 在线状态徽标
 * （绿守护在线 / 红守护离线 / 黄未绑定），并支持整卡点击分流：
 *   - 已绑定 → 父级 router.push('/workspaces/{id}')
 *   - 未绑定 → 父级弹 WorkspaceBindingDialog（task-06）
 * 分流由父级（page.tsx）依据 statusMap 判定后传 `onActivate` 回调；
 * 本组件不直接路由，保持纯展示 + 事件上抛。
 *
 * daemon 徽标文案对齐原型画面①（守护在线 / 守护离线 / 未绑定），
 * 与工作区状态徽标（活跃/已归档）区分，避免歧义。
 */
export type DaemonBadgeStatus = "online" | "offline" | "unbound";

interface Props {
  workspace: Workspace;
  boundRuntime?: DaemonRuntimeRead | null;
  /**
   * 遗留 1（daemon-entity-binding）：按 daemon 实体展示绑定。
   * 新工作区 ``workspace.daemon_runtime_id`` 为 NULL（绑定存 member binding 行），
   * 列表卡片优先用 daemon 实体渲染守护进程信息。
   */
  boundDaemon?: DaemonInstanceRead | null;
  /**
   * task-07：daemon 状态徽标（消费 task-03 useDaemonStatusMap）。
   * online→绿「守护在线」/ offline→红「守护离线」/ unbound→黄「未绑定」。
   * 不传时不渲染徽标（兼容旧调用方）。
   */
  daemonStatus?: DaemonBadgeStatus;
  onChanged: () => void;
  // task-08 / FR-03：别名编辑入口（由 WorkspacesPage 弹 modal）。
  onEditAlias: (workspace: Workspace) => void;
  /**
   * task-07 / CB-1：整卡点击（卡片体，非 footer 按钮区）回调。
   * 父级据此分流：已绑定→进详情；未绑定→弹绑定弹窗。
   * 不传时卡片不可点击（兼容旧调用方，详情仍走 footer「详情」链接）。
   */
  onActivate?: () => void;
}

export function WorkspaceCard({
  workspace,
  boundRuntime,
  boundDaemon,
  daemonStatus,
  onChanged,
  onEditAlias,
  onActivate,
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

  // task-07：daemon 状态徽标渲染（对齐原型画面① 三态 + 圆点）。
  const daemonBadge =
    daemonStatus === "online" ? (
      <Badge variant="success" className="shrink-0">
        <span className="mr-1 inline-block h-1.5 w-1.5 rounded-full bg-success" />
        守护在线
      </Badge>
    ) : daemonStatus === "offline" ? (
      <Badge variant="destructive" className="shrink-0">
        <span className="mr-1 inline-block h-1.5 w-1.5 rounded-full bg-destructive" />
        守护离线
      </Badge>
    ) : daemonStatus === "unbound" ? (
      <Badge variant="warning" className="shrink-0">
        <span className="mr-1 inline-block h-1.5 w-1.5 rounded-full bg-warning" />
        未绑定
      </Badge>
    ) : null;

  // task-07 / CB-1：整卡可点击（卡片体）→ onActivate 分流；footer 按钮区
  // stopPropagation 避免误触。未传 onActivate 时退化为纯展示卡（cursor 不变）。
  const handleCardClick = () => {
    onActivate?.();
  };
  const stopFooter = (e: React.MouseEvent) => e.stopPropagation();

  return (
    <article
      onClick={onActivate ? handleCardClick : undefined}
      className={cn(
        "flex flex-col rounded-lg border bg-card shadow-sm transition-shadow hover:shadow-md",
        onActivate && "cursor-pointer",
      )}
    >
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
          {/* task-07：未绑定提示行（原型画面①），引导点击配置 */}
          {daemonStatus === "unbound" ? (
            <p className="mt-0.5 truncate text-[11px] text-warning">
              需先配置守护进程，点击配置
            </p>
          ) : null}
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <Badge
            variant={workspace.status === "active" ? "success" : "outline"}
          >
            {labelOf(STATUS_LABELS, workspace.status)}
          </Badge>
          {daemonBadge}
        </div>
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

      <footer
        onClick={stopFooter}
        className="mt-auto flex flex-wrap items-center justify-end gap-1.5 border-t px-4 py-2.5"
      >
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
