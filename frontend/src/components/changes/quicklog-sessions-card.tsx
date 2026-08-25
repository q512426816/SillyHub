"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";

import { formatRelativeTime } from "@/components/sessions/session-list-panel";
import { buttonVariants } from "@/components/ui/button";
import { listQuicklogSessions } from "@/lib/daemon";
import { cn } from "@/lib/utils";
import { useSession } from "@/stores/session";

/**
 * 快速修复关联会话卡（task-12 / FR-04 / D-006@v1：快速修复详情抽屉底部
 * 挂载，镜像变更会话卡先例 detail/change-sessions-card.tsx）。
 *
 * 依据：
 *   - tasks/task-12.md（allowed_paths / implementation / acceptance / constraints）
 *   - design.md §5.W4.3（快速修复抽屉会话卡：调快速修复级端点取本人会话前
 *     3 条预览，条目 ?session= 深链直达门户选中态，卡尾「打开会话工作台」
 *     Link 到新路由）、FR-04（快速修复侧展示）、D-006@v1（快速修复门户走
 *     QuicklogScope 新路由 /workspaces/[id]/quicklog/[qlId]/sessions）
 *
 * 只做预览与跳转不做新建（新建入口在门户组头，归 task-10；路由页由 task-10
 * 落地，Link href 不依赖其运行时存在）：
 *   - 数据源 listQuicklogSessions(workspaceId, qlId)（task-09 合入，跨成员
 *     可见端点），客户端按 author 仅本人过滤（author 缺失视为本人保留，同
 *     变更卡口径：logs/stream owner-only，他人会话 attach 必 404，展示只会
 *     误导点击）→ last_active_at 倒序 → 前 3 条；
 *   - 每条渲染 id 短码（# + slice(0,8)，同 session-panel 面板头口径）/状态
 *     中文/相对时间（复用 session-list-panel 导出的 formatRelativeTime）；
 *   - 卡尾「打开会话工作台」Link 至快速修复门户路由（不带参数）。
 */

/** 会话状态中文标签（同 change-sessions-card.tsx:36 只读展示口径）。 */
const SESSION_STATUS_LABELS: Record<string, string> = {
  pending: "等待中",
  active: "进行中",
  reconnecting: "重连中",
  ended: "已结束",
  failed: "已失败",
};

/** 预览条数上限（design §5.W4.3：仅本人过滤后取前 3）。 */
const PREVIEW_LIMIT = 3;

export interface QuicklogSessionsCardProps {
  workspaceId: string;
  qlId: string;
}

export function QuicklogSessionsCard({
  workspaceId,
  qlId,
}: QuicklogSessionsCardProps) {
  // task-12（FR-04）：当前用户 id——仅本人过滤依据。
  const currentUserId = useSession((s) => s.user?.id ?? null);

  // task-12（§5.W4.3）：数据源为快速修复级会话列表端点（task-09 契约），
  // queryKey 沿 agentSessions 前缀——门户侧失效 invalidate 全覆盖。
  const sessionsQ = useQuery({
    queryKey: ["agentSessions", "quicklogSessionsCard", workspaceId, qlId],
    queryFn: () => listQuicklogSessions(workspaceId, qlId),
  });

  // 仅本人 → last_active_at 倒序（后端不保证顺序，同变更卡口径）→ 前 3 条。
  const previews = (sessionsQ.data ?? [])
    .filter((s) => s.author?.user_id == null || s.author.user_id === currentUserId)
    .sort((a, b) => (b.last_active_at ?? "").localeCompare(a.last_active_at ?? ""))
    .slice(0, PREVIEW_LIMIT);

  // 快速修复门户专属路由（D-006@v1，task-10 落地）：条目带 ?session= 深链
  // 直达选中态（无效 id 门户挂载时静默忽略）；卡尾按钮同路由不带参。
  const portalHref = `/workspaces/${workspaceId}/quicklog/${qlId}/sessions`;

  return (
    <section className="rounded-md border bg-card px-3 py-2.5">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <h2 className="text-xs font-medium">关联会话</h2>
          <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
            本快速修复的执行会话（自动绑定，点击直达选中）
          </p>
        </div>
      </div>

      {/* 最近会话预览：id 短码 / 状态中文 / 相对时间 */}
      <ul className="mt-2 space-y-0.5" data-testid="quicklog-session-previews">
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

      {/* 卡尾入口：打开会话工作台（快速修复门户，不带 session 参数） */}
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
