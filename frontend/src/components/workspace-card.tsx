"use client";

import Link from "next/link";
import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
import type { PpmProjectBrief } from "@/lib/workspace";
// task-06 / 2026-08-18-workspace-role-type / FR-04：卡片名区渲染工作区类型徽标
// （NULL→「未分类」灰、已知值→中文标签、未知非空→原值灰，统一走 badge helper）。
import { workspaceTypeBadge } from "@/lib/workspace-types";
import { STATUS_LABELS, labelOf } from "@/lib/status-labels";
import { cn } from "@/lib/utils";

/**
 * task-07（2026-07-09-workspace-prioritization / FR-03 / D-001 / CB-1）：
 * 列表页改造为工作区选择器后，每张卡片需展示 daemon 在线状态徽标
 * （绿守护在线 / 红守护离线 / 黄未绑定），并支持整卡点击分流：
 *   - 已绑定 → 父级 router.push('/workspaces/{id}')
 *   - 未绑定 → 父级走 daemon-client 统一绑定流程
 * 分流由父级（page.tsx）依据 statusMap 判定后传 `onActivate` 回调；
 * 本组件不直接路由，保持纯展示 + 事件上抛。
 *
 * ql-20260821-007 排版重排（用户反馈五点）：
 * - 头部右侧只留「状态 + 守护」两徽标（绑定守护进程行的在线徽标已去重）；
 * - 新增「关联项目」行（PpmProjectBrief 名称 tag，无则不渲染行）；
 * - footer 删「详情/关系」（整卡可点即详情入口），保留 别名/重新扫描/删除 并统一按钮规格。
 */
export type DaemonBadgeStatus = "online" | "offline" | "unbound";

interface Props {
  workspace: Workspace;
  boundRuntime?: DaemonRuntimeRead | null;
  /**
   * 遗留 1（daemon-entity-binding）：按 daemon 实体展示绑定。
   * 绑定存 member binding 行，列表卡片优先用 daemon 实体渲染守护进程信息。
   */
  boundDaemon?: DaemonInstanceRead | null;
  /**
   * task-07：daemon 状态徽标（消费 task-03 useDaemonStatusMap）。
   * online→绿「守护在线」/ offline→红「守护离线」/ unbound→黄「未绑定」。
   * 不传时不渲染徽标（兼容旧调用方）。
   */
  daemonStatus?: DaemonBadgeStatus;
  /** ql-20260821-007：关联 PPM 项目（名称 tag 展示，空数组/不传不渲染行）。 */
  linkedProjects?: PpmProjectBrief[];
  onChanged: () => void;
  // task-08 / FR-03：别名编辑入口（由 WorkspacesPage 弹 modal）。
  onEditAlias: (workspace: Workspace) => void;
  /**
   * task-07 / CB-1：整卡点击（卡片体，非 footer 按钮区）回调。
   * 父级据此分流：已绑定→进详情；未绑定→弹绑定弹窗。
   * 不传时卡片不可点击（兼容旧调用方）。
   */
  onActivate?: () => void;
}

export function WorkspaceCard({
  workspace,
  boundRuntime,
  boundDaemon,
  daemonStatus,
  linkedProjects,
  onChanged,
  onEditAlias,
  onActivate,
}: Props) {
  const [busy, setBusy] = useState<"rescan" | "delete" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const formatTs = (raw: string | null) =>
    raw ? new Date(raw).toLocaleString("zh-CN") : "—";

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
  // task-06 / FR-04：类型徽标（布局类 + badgeClass 组合，参照 agent-log-viewer 的
  // tool-kind 徽标消费惯例——badgeClass 只含配色，布局类由本组件叠加）。
  const typeBadgeView = workspaceTypeBadge(workspace.type);

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
        // ql-20260820-010 对照原型 .ws-card:hover 三件套:
        // 抬升 -4px + 紫调大阴影(shadow-lg 主题 token) + 边框加深(brand-300)
        "flex flex-col rounded-lg border bg-card shadow-sm transition-[box-shadow,transform,border-color] duration-200 hover:-translate-y-1 hover:border-brand-300 hover:shadow-lg",
        onActivate && "cursor-pointer",
      )}
    >
      <header className="flex items-start justify-between gap-2 px-4 pt-3.5">
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
          {workspace.owner ? (
            <p className="truncate text-[11px] text-muted-foreground">
              负责人：{workspace.owner.display_name ?? workspace.owner.email ?? "未记录"}
            </p>
          ) : null}
        </div>
        {/* 头部右侧徽标组：工作区状态 + 类型 + 守护（ql-20260821-007 收敛为竖排右对齐） */}
        <div className="flex shrink-0 flex-col items-end gap-1">
          <div className="flex items-center gap-1">
            <span
              className={cn(
                "inline-flex h-5 shrink-0 items-center rounded border px-1.5 text-[10px] font-semibold",
                typeBadgeView.className,
              )}
              title={`工作区类型：${typeBadgeView.label}`}
            >
              {typeBadgeView.label}
            </span>
            <Badge
              variant={workspace.status === "active" ? "success" : "outline"}
            >
              {labelOf(STATUS_LABELS, workspace.status)}
            </Badge>
          </div>
          {daemonBadge}
        </div>
      </header>

      <div className="min-w-0 px-4 pt-2">
        <dl className="grid grid-cols-[5.5rem_1fr] gap-y-1 text-xs">
          <WorkspacePathFields
            workspace={workspace}
            runtime={boundRuntime}
            daemon={boundDaemon}
            linkRuntime
          />
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
        {/* ql-20260821-007：关联项目行（名称 tag；无关联不渲染整行） */}
        {linkedProjects && linkedProjects.length > 0 && (
          <div className="flex flex-wrap items-center gap-1 pt-1 text-[11px]">
            <span className="text-muted-foreground">关联项目</span>
            {linkedProjects.map((proj) => (
              <span
                key={proj.project_id}
                title={proj.project_id}
                className="inline-flex h-5 items-center rounded border border-brand-200 bg-brand-50 px-1.5 text-[10px] font-semibold text-brand-700"
              >
                {proj.project_name ?? proj.project_id}
              </span>
            ))}
          </div>
        )}
        {/* task-07：未绑定提示行（原型画面①），引导点击配置 */}
        {daemonStatus === "unbound" ? (
          <p className="pt-1 text-[11px] text-warning">
            需先配置守护进程，点击配置
          </p>
        ) : null}
        {/* ql-20260702：时间行（创建/最后扫描合并一行，弱化）。 */}
        <p className="flex flex-wrap items-center gap-x-3 pt-1.5 pb-3 text-[11px] text-muted-foreground">
          <span>创建于 {formatTs(workspace.created_at)}</span>
          <span>最后扫描 {formatTs(workspace.last_scanned_at)}</span>
        </p>
      </div>

      {error && (
        <p className="px-4 pb-2 text-xs text-destructive">{error}</p>
      )}

      {/* ql-20260821-007：footer 删「详情/关系」（整卡可点即详情），
          剩余操作统一 shadcn 规格：别名/重新扫描 ghost sm，删除 destructive ghost sm 右置。 */}
      <footer
        onClick={stopFooter}
        className="mt-auto flex items-center gap-1 border-t bg-muted/30 px-3 py-2"
      >
        <Button
          size="sm"
          variant="ghost"
          className="h-7 px-2 text-xs"
          onClick={() => onEditAlias(workspace)}
          disabled={busy !== null}
        >
          别名
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="h-7 px-2 text-xs"
          onClick={handleRescan}
          disabled={busy !== null}
        >
          {busy === "rescan" ? "扫描中…" : "重新扫描"}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="ml-auto h-7 px-2 text-xs text-destructive hover:bg-destructive/10 hover:text-destructive"
          onClick={handleDelete}
          disabled={busy !== null}
        >
          {busy === "delete" ? "删除中…" : "删除"}
        </Button>
      </footer>
    </article>
  );
}
