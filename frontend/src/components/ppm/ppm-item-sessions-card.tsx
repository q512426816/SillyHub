"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";

import { formatRelativeTime } from "@/components/sessions/session-list-panel";
import { listItemSessions, type PpmItemKind } from "@/lib/daemon";
import { useFloatingSessionStore } from "@/stores/floating-session";
import { useSession } from "@/stores/session";

/**
 * PPM 条目关联会话卡（2026-08-28-session-ppm-task-binding task-05 / FR-04 /
 * D-001@v1）：任务（plan_task）/问题（problem）通用——kind+itemId 泛化。
 *
 * 依据：
 *   - tasks/task-05.md（implementation/acceptance：listItemSessions、本人前 3
 *     条预览、「+ 新会话」走同入口发起流程、?session= 深链）
 *   - design.md §5 Phase 3（入口挂载与触发通道）、§7（GET /api/ppm/item-sessions
 *     与 change sessions 响应同构）
 *   - 结构/主题 token 对齐 change-sessions-card.tsx（2026-08-22-workspace-
 *     sessions-portal task-06 先例）：
 *     - 数据源 listItemSessions(kind, itemId)（平台级端点，跨成员可见），
 *       客户端按 author 仅本人过滤（author 缺失视为本人保留，同 change 卡
 *       口径：logs/stream owner-only，他人会话展示只会误导点击）→
 *       last_active_at 倒序 → 前 3 条；
 *     - 条目渲染 标题（回退 id 短码 #slice(0,8)，同 session-panel 面板头
 *       口径）/状态中文/相对时间（复用 session-list-panel 导出的
 *       formatRelativeTime）；
 *     - 深链：PPM 条目无专属门户路由，走全局门户 /sessions?session= 深链
 *       直达选中态（sessions-portal 深链恢复契约，同悬浮宿主「全屏」按钮
 *       先例；无效 id 静默忽略）；
 *     - 卡尾「+ 新会话」：写 store pendingPpmItem 挂起位 + requestNewSession
 *       （与三入口「发起会话」同通道——requestNewSession 清 preContext，绑定
 *       经挂起位由宿主构造 preContext.ppmItem 并解析项目第一个关联工作区）。
 */

/** 会话状态中文标签（同 change-sessions-card.tsx 只读展示口径）。 */
const SESSION_STATUS_LABELS: Record<string, string> = {
  pending: "等待中",
  active: "进行中",
  reconnecting: "重连中",
  ended: "已结束",
  failed: "已失败",
};

/** 预览条数上限（design §5 Phase 3：仅本人过滤后取前 3）。 */
const PREVIEW_LIMIT = 3;

/** kind 中文名（预会话上下文行 chip 同款口径）。 */
const KIND_LABEL: Record<PpmItemKind, string> = {
  plan_task: "任务",
  problem: "问题",
};

export interface PpmItemSessionsCardProps {
  /** 条目类型（plan_task=个人计划任务 / problem=问题清单）。 */
  kind: PpmItemKind;
  /** 条目 id（PlanTask.id / ProblemList.id）。 */
  itemId: string;
  /** 所属项目 id（「+ 新会话」经挂起位供宿主解析工作区；null 不解析）。 */
  projectId: string | null;
  /** 条目标题（任务 content / 问题 pro_desc；「+ 新会话」预会话 chip 展示用）。 */
  title: string | null;
}

export function PpmItemSessionsCard({
  kind,
  itemId,
  projectId,
  title,
}: PpmItemSessionsCardProps) {
  // D-003 同源口径：当前用户 id——仅本人过滤依据。
  const currentUserId = useSession((s) => s.user?.id ?? null);
  // 触发通道（task-05）：与三入口「发起会话」完全同构。
  const setPendingPpmItem = useFloatingSessionStore((s) => s.setPendingPpmItem);
  const requestNewSession = useFloatingSessionStore((s) => s.requestNewSession);

  const sessionsQ = useQuery({
    queryKey: ["agentSessions", "ppmItemSessionsCard", kind, itemId],
    queryFn: () => listItemSessions(kind, itemId),
  });

  // 仅本人 → last_active_at 倒序（后端不保证顺序，同 change 卡口径）→ 前 3 条。
  const previews = (sessionsQ.data ?? [])
    .filter((s) => s.author?.user_id == null || s.author.user_id === currentUserId)
    .sort((a, b) => (b.last_active_at ?? "").localeCompare(a.last_active_at ?? ""))
    .slice(0, PREVIEW_LIMIT);

  const handleNewSession = () => {
    setPendingPpmItem({ kind, id: itemId, projectId, title });
    requestNewSession(null);
  };

  return (
    <section
      className="rounded-md border bg-card px-3 py-2.5"
      data-testid="ppm-item-sessions-card"
    >
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <h2 className="text-xs font-medium">关联会话</h2>
          <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
            本{KIND_LABEL[kind]}的最近会话（仅本人，点击直达选中）
          </p>
        </div>
        {/* 卡尾入口：+ 新会话（写挂起位 + requestNewSession，同「发起会话」通道） */}
        <button
          type="button"
          onClick={handleNewSession}
          data-testid="ppm-item-sessions-new"
          className="inline-flex h-7 shrink-0 items-center gap-1 rounded-full border border-border bg-card px-3 text-xs font-medium text-muted-foreground transition-colors hover:border-brand-400 hover:text-brand-700"
        >
          + 新会话
        </button>
      </div>

      {/* 最近会话预览：标题（回退 id 短码）/ 状态中文 / 相对时间 */}
      <ul className="mt-2 space-y-0.5" data-testid="ppm-item-session-previews">
        {previews.map((s) => (
          <li key={s.id}>
            <Link
              href={`/sessions?session=${encodeURIComponent(s.id)}`}
              className="flex items-center justify-between gap-2 rounded-sm px-1.5 py-1 text-[11px] hover:bg-muted"
            >
              <span className="min-w-0 truncate">
                {s.title?.trim() || `#${s.id.slice(0, 8)}`}
              </span>
              <span className="flex min-w-0 shrink-0 items-center gap-1.5 text-muted-foreground">
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
          暂无本人会话，可点「+ 新会话」发起
        </p>
      ) : null}
    </section>
  );
}
