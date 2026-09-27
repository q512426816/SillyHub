"use client";

import Link from "next/link";
import { useState } from "react";

import { Modal } from "antd";

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

/**
 * task-08 / 2026-09-14-workspace-drag-sort / FR-04：拖拽手柄注入属性——
 * 父级 useSortable 的 attributes/listeners（+ ref 指向 setActivatorNodeRef，
 * HTMLAttributes 不含 ref，显式放宽）。className 由本组件与注入方 cn 合并
 * （禁用态注入 cursor-not-allowed / !opacity-40 覆盖默认手柄观感）。
 */
export type WorkspaceCardDragHandleProps = React.HTMLAttributes<HTMLElement> & {
  ref?: React.Ref<HTMLElement>;
};

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
  /**
   * ql-20260918-012：Git 远程仓库地址（probe 实时识别，DB repo_url 兜底）。
   * 为空不渲染行；http(s) 形态在路径区渲染为可点外链。
   */
  repoUrl?: string | null;
  /**
   * ql-20260920-007（D-004）：当前用户本人 binding 的本地项目路径。
   * string=本人路径；null=未绑定（显示引导文案）；不传=兼容旧行为（全局路径）。
   */
  myRootPath?: string | null;
  onChanged: () => void;
  // task-08 / FR-03：别名编辑入口（由 WorkspacesPage 弹 modal）。
  onEditAlias: (workspace: Workspace) => void;
  /**
   * task-07 / CB-1：整卡点击（卡片体，非 footer 按钮区）回调。
   * 父级据此分流：已绑定→进详情；未绑定→弹绑定弹窗。
   * 不传时卡片不可点击（兼容旧调用方）。
   */
  onActivate?: () => void;
  /**
   * task-08 / 2026-09-14-workspace-drag-sort / FR-04 / R-06：可选拖拽手柄挂点。
   * dragHandleProps 携带父级 useSortable 的 attributes/listeners（ref→
   * setActivatorNodeRef）时，卡片左缘悬浮位渲染默认 ⠿ 手柄（仅手柄承载拖拽，
   * 卡体点击行为零改动）；dragHandleNode 提供时渲染于同一挂点手柄下方
   * （如「移动到…」入口，task-09 接线）。两者缺省时挂点整体不渲染，
   * 其它调用方零改动。
   */
  dragHandleProps?: WorkspaceCardDragHandleProps;
  dragHandleNode?: React.ReactNode;
}

export function WorkspaceCard({
  workspace,
  boundRuntime,
  boundDaemon,
  daemonStatus,
  linkedProjects,
  repoUrl,
  myRootPath,
  onChanged,
  onEditAlias,
  onActivate,
  dragHandleProps,
  dragHandleNode,
}: Props) {
  const [busy, setBusy] = useState<"rescan" | "delete" | null>(null);
  const [error, setError] = useState<string | null>(null);
  // 2026-09-26 重排 FR-05/FR-08：删除确认 window.confirm → antd Modal（受控）。
  const [confirmDelete, setConfirmDelete] = useState(false);

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
    // FR-08：确认走 antd Modal（onOk 进这里），不再 window.confirm。
    setError(null);
    setBusy("delete");
    try {
      await deleteWorkspace(workspace.id);
      setConfirmDelete(false);
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

  // task-08 / FR-04：手柄注入 props 拆解（ref/className 单列以便与默认手柄样式合并）。
  const { ref: handleRef, className: handleClassName, ...handleRest } =
    dragHandleProps ?? {};

  return (
    <>
    <article
      onClick={onActivate ? handleCardClick : undefined}
      className={cn(
        // 2026-09-27 visual-gap-fix：卡片重写为 GitHub Repositories 行式条目——
        // 单条目两段式（主行=名称+徽标；meta 行=slug/技术栈/时间），hover 显操作，
        // 守护徽标与操作右置；信息字段与行为（别名/重扫/删除/拖拽）零丢失。
        "flex items-start gap-3 rounded-md border bg-card px-3.5 py-2.5 transition-colors duration-100 hover:bg-muted",
        onActivate && "cursor-pointer",
        // 评审 low 修复：group/card 无条件——hover 操作组可见性不依赖手柄注入
        "group/card relative",
      )}
    >
      {(dragHandleProps || dragHandleNode) && (
        <div
          className="absolute -left-3 top-1/2 z-10 flex -translate-y-1/2 flex-col items-stretch"
          onClick={(e) => e.stopPropagation()}
        >
          {dragHandleProps && (
            <span
              ref={handleRef}
              {...handleRest}
              title="拖拽排序"
              className={cn(
                "flex h-8 w-5 cursor-grab select-none items-center justify-center rounded-l-md border border-r-0 border-border bg-card text-sm text-muted-foreground opacity-0 transition-opacity duration-100 group-hover/card:opacity-60 hover:!opacity-100 hover:text-brand-600 focus-visible:opacity-100 active:cursor-grabbing",
                handleClassName,
              )}
            >
              ⠿
            </span>
          )}
          {dragHandleNode}
        </div>
      )}

      {/* 左缘状态点（GitHub repos 列表语义：在线=绿/离线=灰/未绑定=琥珀） */}
      <span
        aria-hidden="true"
        className={cn(
          "mt-2 h-2 w-2 shrink-0 rounded-full",
          daemonStatus === "online"
            ? "bg-success"
            : daemonStatus === "offline"
              ? "bg-muted-foreground/50"
              : "bg-warning",
        )}
        title={daemonStatus === "online" ? "守护进程在线" : daemonStatus === "offline" ? "守护进程离线" : "未绑定守护进程"}
      />

      {/* 主区两段式 */}
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <header className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
          <h3 className="truncate text-sm font-semibold text-primary">
            {workspace.display_alias ?? workspace.name}
          </h3>
          {hasAlias ? (
            <span className="truncate text-[11px] text-muted-foreground">
              原名 {workspace.name}
            </span>
          ) : null}
          <span
            className={cn(
              "inline-flex h-5 shrink-0 items-center rounded border px-1.5 text-[11px] font-semibold",
              typeBadgeView.className,
            )}
            title={`工作区类型：${typeBadgeView.label}`}
          >
            {typeBadgeView.label}
          </span>
          <Badge
            variant={workspace.status === "active" ? "success" : "outline"}
            className="shrink-0"
          >
            {labelOf(STATUS_LABELS, workspace.status)}
          </Badge>
          <span className="truncate font-mono text-[11px] text-muted-foreground">
            {workspace.slug}
          </span>
          {workspace.owner ? (
            <span className="truncate text-[11px] text-muted-foreground">
              负责人 {workspace.owner.display_name ?? workspace.owner.email ?? "未记录"}
            </span>
          ) : null}
        </header>

        <div className="flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-1 text-[11px] text-muted-foreground">
          {workspace.tech_stack && workspace.tech_stack.length > 0 && (
            <span className="flex flex-wrap items-center gap-1">
              {workspace.tech_stack.map((t) => (
                <Badge key={t} variant="outline" className="text-[11px]">{t}</Badge>
              ))}
            </span>
          )}
          {linkedProjects && linkedProjects.length > 0 && (
            <span className="flex flex-wrap items-center gap-1">
              {linkedProjects.map((proj) => (
                <span
                  key={proj.project_id}
                  title={proj.project_id}
                  className="inline-flex h-5 items-center rounded border border-brand-200 bg-brand-50 px-1.5 text-[11px] font-semibold text-brand-700"
                >
                  {proj.project_name ?? proj.project_id}
                </span>
              ))}
            </span>
          )}
          <span>创建于 {formatTs(workspace.created_at)}</span>
          <span>最后扫描 {formatTs(workspace.last_scanned_at)}</span>
        </div>

        {/* 路径/Git 行（条件，紧凑第三行；dt/dd 语义保留） */}
        <dl className="grid grid-cols-[5.5rem_1fr] gap-y-0.5 text-[11px]">
          <WorkspacePathFields
            workspace={workspace}
            runtime={boundRuntime}
            daemon={boundDaemon}
            linkRuntime
            repoUrl={repoUrl}
            myRootPath={myRootPath}
          />
        </dl>

        {daemonStatus === "unbound" ? (
          <p className="text-[11px] text-warning">
            需先配置守护进程，点击配置
          </p>
        ) : null}
        {error && (
          <p className="text-xs text-destructive">{error}</p>
        )}
      </div>

      {/* 右侧固定区：守护徽标 + hover 操作组 */}
      <div
        onClick={stopFooter}
        className="flex shrink-0 flex-col items-end gap-1 pt-0.5"
      >
        {daemonBadge}
        <div className="flex items-center gap-0.5 opacity-0 transition-opacity duration-100 group-hover/card:opacity-100 focus-within:opacity-100">
          <Button
            size="sm"
            variant="ghost"
            className="h-6 px-1.5 text-xs"
            onClick={() => onEditAlias(workspace)}
            disabled={busy !== null}
          >
            别名
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-6 px-1.5 text-xs"
            onClick={handleRescan}
            disabled={busy !== null}
          >
            {busy === "rescan" ? "扫描中…" : "重新扫描"}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-6 px-1.5 text-xs text-destructive hover:bg-destructive/10 hover:text-destructive"
            onClick={() => setConfirmDelete(true)}
            disabled={busy !== null}
          >
            {busy === "delete" ? "删除中…" : "删除"}
          </Button>
        </div>
      </div>
    </article>

      {/* 2026-09-26 重排 FR-08：删除确认 Modal（替代 window.confirm，对齐
          FRONTEND_PAGE_STYLE §8 高危场景语义；源文件不受影响的文案保留）。 */}
      <Modal
        title={`确认删除工作区 "${workspace.name}"？`}
        open={confirmDelete}
        okText="删除"
        cancelText="取消"
        okButtonProps={{ danger: true, loading: busy === "delete" }}
        onOk={handleDelete}
        onCancel={() => setConfirmDelete(false)}
      >
        <p className="text-sm text-muted-foreground">源文件不会被改动。</p>
      </Modal>
    </>
  );
}
