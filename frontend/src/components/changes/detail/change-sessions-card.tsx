"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";

import { formatRelativeTime } from "@/components/sessions/session-list-panel";
import { buttonVariants } from "@/components/ui/button";
import { listChangeSessions } from "@/lib/daemon";
import { cn } from "@/lib/utils";
import { useSession } from "@/stores/session";

/**
 * 会话入口卡（变更详情次线侧栏；2026-08-11-change-detail-layout-rework 建卡，
 * ql-20260811-002 改 Dialog 承载，task-06（2026-08-22-workspace-sessions-portal）
 * 改入口形态）。
 *
 * 依据：
 *   - tasks/task-06.md（allowed_paths / implementation / acceptance / constraints）
 *   - design.md §4.D（入口卡：listChangeSessions 仅本人过滤取前 3 条预览，
 *     条目经 ?session= 深链直达变更级门户选中态，卡尾按钮跳专属路由）、
 *     D-002@v1（变更详情承载 = 方案A 专属路由门户）、D-003@v1（仅本人过滤）、
 *     D-004@v1（?session= 门户统一深链能力，task-01 提供）
 *
 * 入口形态（原 Dialog 内嵌 ChangeSessionSection 装配移除，组件文件退役归
 * task-07）：窄卡只做预览与跳转——
 *   - 数据源 listChangeSessions(workspaceId, changeId)（跨成员可见端点），
 *     客户端按 author 仅本人过滤（author 缺失视为本人保留，同旧
 *     workspace-session-section 过滤口径：logs/stream owner-only，他人会话
 *     attach 必 404，展示只会误导点击）→ last_active_at 倒序 → 前 3 条；
 *   - 每条渲染 id 短码（# + slice(0,8)，同 session-panel 面板头口径）/状态
 *     中文/相对时间（复用 session-list-panel 导出的 formatRelativeTime）；
 *   - 卡尾「打开会话工作台」Link 至变更级门户路由（task-03 新建，不带参数）。
 */

/** 会话状态中文标签（同 change-stage-actions.tsx:62 只读展示口径）。 */
const SESSION_STATUS_LABELS: Record<string, string> = {
  pending: "等待中",
  active: "进行中",
  reconnecting: "重连中",
  ended: "已结束",
  failed: "已失败",
};

/** 预览条数上限（design §4.D：仅本人过滤后取前 3）。 */
const PREVIEW_LIMIT = 3;

export interface ChangeSessionsCardProps {
  workspaceId: string;
  changeId: string;
}

export function ChangeSessionsCard({
  workspaceId,
  changeId,
}: ChangeSessionsCardProps) {
  // task-06（D-003@v1）：当前用户 id——仅本人过滤依据。
  const currentUserId = useSession((s) => s.user?.id ?? null);

  // task-06（D-002@v1）：数据源显式为变更级列表端点（Grill P2），过滤在客户端。
  const sessionsQ = useQuery({
    queryKey: ["agentSessions", "changeSessionsCard", workspaceId, changeId],
    queryFn: () => listChangeSessions(workspaceId, changeId),
  });

  // 仅本人 → last_active_at 倒序（后端不保证顺序，同旧 section 口径）→ 前 3 条。
  const previews = (sessionsQ.data ?? [])
    .filter((s) => s.author?.user_id == null || s.author.user_id === currentUserId)
    .sort((a, b) => (b.last_active_at ?? "").localeCompare(a.last_active_at ?? ""))
    .slice(0, PREVIEW_LIMIT);

  // 变更级门户专属路由（task-03）：条目带 ?session= 深链直达选中态（D-004@v1，
  // 门户挂载时解析恢复；无效 id 静默忽略）；卡尾按钮同路由不带参。
  const portalHref = `/workspaces/${workspaceId}/changes/${changeId}/sessions`;

  return (
    <section className="rounded-md border bg-card px-3 py-2.5">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <h2 className="text-xs font-medium">会话调试</h2>
          <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
            本变更的最近会话（仅本人，点击直达选中）
          </p>
        </div>
      </div>

      {/* 最近会话预览：id 短码 / 状态中文 / 相对时间 */}
      <ul className="mt-2 space-y-0.5" data-testid="change-session-previews">
        {previews.map((s) => (
          <li key={s.id}>
            <Link
              href={`${portalHref}?session=${encodeURIComponent(s.id)}`}
              className="flex items-center justify-between gap-2 rounded-sm px-1.5 py-1 text-[11px] hover:bg-muted"
            >
              <span className="font-mono">#{s.id.slice(0, 8)}</span>
              <span className="flex min-w-0 items-center gap-1.5 text-muted-foreground">
                <span className="shrink-0">
                  {SESSION_STATUS_LABELS[s.status] ?? s.status}
                </span>
                <span className="shrink-0">{formatRelativeTime(s.last_active_at)}</span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
      {sessionsQ.isPending ? (
        <p className="px-1.5 py-1 text-[11px] text-muted-foreground">加载中…</p>
      ) : previews.length === 0 ? (
        <p className="px-1.5 py-1 text-[11px] text-muted-foreground">
          暂无本人会话，可打开工作台新建
        </p>
      ) : null}

      {/* 卡尾入口：打开会话工作台（变更级门户，不带 session 参数） */}
      <div className="mt-2.5">
        <Link
          href={portalHref}
          className={cn(buttonVariants({ variant: "outline", size: "sm" }), "w-full")}
        >
          打开会话工作台
        </Link>
      </div>
    </section>
  );
}
