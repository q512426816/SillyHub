"use client";

/**
 * 活动徽标（task-12 / 2026-08-29-change-delete-closure-and-spec-pull / FR-09 /
 * D-007@v1，design §8.1 Layer 1 前端半）：纯 CLI 变更的「进行中」可感知性。
 *
 * 真值表 f(current_step_status, last_pushed_at 年龄)（round 3 钉死；
 * current_step_status 由后端「第一个非 completed 步 + wait_reason」推导
 * （service.py:2122-2130），仅 active/waiting/null 三值，不区分 pending 与
 * in-progress，态 1/态 2 实际仅由 30min 阈值区分——Layer 1 启发式固有边界，R-12 受理）：
 *   - active 且最后信号 ≤ 30min  → 「进行中 · x 分钟前」（brand 脉动点从纯动画
 *     变为真实信号驱动）；
 *   - active 但最后信号 > 30min  → 灰「停滞 · 最后信号 x 分钟前」（只陈述事实，
 *     不断言挂死——强判定需心跳，Non-Goal §8.3）；
 *   - waiting / null（step_progress 缺失）→ 空闲态，显示最后活动时间。
 *
 * last_pushed_at 为客户端 ISO 原文 String（无服务端校验，task-11 契约），本模块
 * 防御式解析：ISO_LIKE_RE 正则白名单 + 回退（复用 change-step-timeline.tsx
 * formatStepTime :75-102 范式——先正则归一再 new Date，不匹配 / Invalid Date
 * 一律回退原文，畸形串不炸组件）。
 *
 * 阈值 ACTIVITY_STALE_MS = 30min 为展示层关注点（不进后端 DTO）；列表页
 * page.tsx 在 CHANGES_POLL_INTERVAL_MS 旁同点重导出（30s 轮询已就绪，零新增请求）。
 */

/** 停滞阈值（design §8.1）：active 状态最后信号超过该年龄 → 灰「停滞」。 */
export const ACTIVITY_STALE_MS = 30 * 60_000;

// ── ISO 白名单防御解析（对齐 change-step-timeline.tsx :75-102 范式）──────────
// 后端透传客户端 ISO 原文（无校验），先正则校验 + 重写成 ECMAScript 保证兼容的
// 格式（T 分隔 / 补秒 / 微秒截到毫秒 / 偏移规范化）再 new Date；任何不匹配 /
// Invalid Date → null，不炸不猜（Grill #18「不裸解析」精神保留在这一层）。
const ISO_LIKE_RE =
  /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?(?:\.(\d+))?(Z|[+-]\d{2}:?\d{2})?$/;

/** ISO 原文 → epoch ms；非 ISO 形状 / Invalid Date → null（畸形串防御）。 */
export function parseIsoLikeMs(raw: string): number | null {
  const m = ISO_LIKE_RE.exec(raw.trim());
  if (!m) return null;
  const [, y, mo, d, h, mi, s = "00", frac, tz] = m;
  const ms = frac ? `.${frac.slice(0, 3).padEnd(3, "0")}` : "";
  const offset =
    !tz || tz === "Z"
      ? "Z"
      : tz.length === 6
        ? tz
        : `${tz.slice(0, 3)}:${tz.slice(3)}`;
  const t = new Date(`${y}-${mo}-${d}T${h}:${mi}:${s}${ms}${offset}`).getTime();
  return Number.isNaN(t) ? null : t;
}

// ── 真值表纯函数（导出供单测：三态 + 边界 + 防御分支零渲染依赖）──────────────

export type ActivityState = "active" | "stale" | "idle";

export interface ActivityResolution {
  state: ActivityState;
  /** 最后信号年龄（ms）；无法解析（null / 畸形串）→ null（不陈述时间事实）。 */
  ageMs: number | null;
  /** last_pushed_at 原文（title 悬停 / 回退展示）；无信号 → null。 */
  raw: string | null;
}

/**
 * 真值表 f(current_step_status, last_pushed_at 年龄)（design §8.1）。
 * 阈值含边界：age ≤ ACTIVITY_STALE_MS 为进行中，严格大于才判停滞。
 */
export function resolveActivity(
  currentStepStatus: string | null | undefined,
  lastPushedAt: string | null | undefined,
  now: number,
): ActivityResolution {
  const raw = lastPushedAt ?? null;
  const t = raw !== null ? parseIsoLikeMs(raw) : null;
  if (currentStepStatus !== "active") {
    // waiting / null（step_progress 缺失或全完成）→ 空闲态。
    return { state: "idle", ageMs: t !== null ? now - t : null, raw };
  }
  if (t === null) {
    // active 但无 / 畸形信号：保持「进行中」视觉，不断言停滞也不给年龄
    //（畸形原文进 title，回退可见文案归空闲分支）。
    return { state: "active", ageMs: null, raw };
  }
  const ageMs = now - t;
  return { state: ageMs <= ACTIVITY_STALE_MS ? "active" : "stale", ageMs, raw };
}

/** 年龄分档文案：刚刚 / x 分钟前 / x 小时前 / x 天前（负值钳「刚刚」，时钟偏移防御）。 */
export function formatAge(ageMs: number): string {
  const clamped = Math.max(0, ageMs);
  if (clamped < 60_000) return "刚刚";
  if (clamped < 3_600_000) return `${Math.floor(clamped / 60_000)} 分钟前`;
  if (clamped < 86_400_000) return `${Math.floor(clamped / 3_600_000)} 小时前`;
  return `${Math.floor(clamped / 86_400_000)} 天前`;
}

/**
 * steps 明细派生「最后信号」（详情页数据源）：每步 --done 推送时点 =
 * steps[].completed_at 归一值（ChangeRead 无 last_pushed_at——task-11 只落
 * ChangeSummary，且详情页禁新增网络请求，故纯前端派生），取最大（最近）一条
 * 原文。全部无 completed_at → null；全部畸形 → 回退最后一条原文（不炸不猜）。
 */
export function lastSignalFromSteps(
  steps: readonly { completed_at?: string | null }[] | null | undefined,
): string | null {
  if (!steps) return null;
  let best: string | null = null;
  let bestT = Number.NEGATIVE_INFINITY;
  let lastRaw: string | null = null;
  for (const entry of steps) {
    const raw = entry.completed_at;
    if (!raw) continue;
    lastRaw = raw;
    const t = parseIsoLikeMs(raw);
    if (t !== null && t >= bestT) {
      bestT = t;
      best = raw;
    }
  }
  return best ?? lastRaw;
}

// ── 组件 ───────────────────────────────────────────────────────────────────

export interface ChangeActivityBadgeProps {
  /** 后端摘要三值 current_step_status：active | waiting | null（全完成/缺失）。
   *  契约外值按非 active 处理（空闲兜底，不炸）。 */
  currentStepStatus: string | null | undefined;
  /** 「最后信号」ISO 原文（task-11 ChangeSummary.last_pushed_at；可空可畸形）。 */
  lastPushedAt: string | null | undefined;
  /** 测试注入时钟（epoch ms）；缺省 Date.now()（客户端组件 + 轮询数据到达后
   *  才渲染，无 SSR 水合不一致窗口）。 */
  now?: number;
}

/**
 * 列表行内活动徽标（「待办状态」列旁，task-12）。纯展示组件：不拉数据不持状态，
 * 数据由列表页 useQuery（30s 智能轮询，零新增请求）与详情页 steps 派生提供。
 */
export function ChangeActivityBadge({
  currentStepStatus,
  lastPushedAt,
  now,
}: ChangeActivityBadgeProps) {
  const r = resolveActivity(currentStepStatus, lastPushedAt, now ?? Date.now());

  if (r.state === "active") {
    return (
      <span
        data-testid="activity-active"
        title={r.raw ?? undefined}
        className="inline-flex max-w-full items-center gap-1 text-[11px] leading-4"
      >
        {/* brand 脉动点（FRONTEND_PAGE_STYLE §0.5 brand-* 语义阶；真实信号驱动） */}
        <span
          aria-hidden
          className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-brand-600"
        />
        <span className="truncate font-medium text-brand-600">
          {r.ageMs !== null ? `进行中 · ${formatAge(r.ageMs)}` : "进行中"}
        </span>
      </span>
    );
  }

  if (r.state === "stale") {
    // R-12：只陈述「最后信号 x 分钟前」这一事实，不断言挂死/没在跑。
    return (
      <span
        data-testid="activity-stale"
        title={r.raw ?? undefined}
        className="inline-flex max-w-full items-center gap-1 text-[11px] leading-4"
      >
        <span
          aria-hidden
          className="h-2 w-2 shrink-0 rounded-full bg-muted-foreground/60"
        />
        <span className="truncate text-muted-foreground">
          停滞 · 最后信号 {formatAge(r.ageMs ?? 0)}
        </span>
      </span>
    );
  }

  // 空闲态（waiting / null）：显示最后活动时间；畸形串回退原文；null 无后缀。
  const idleSuffix =
    r.raw === null
      ? ""
      : r.ageMs !== null
        ? formatAge(r.ageMs)
        : r.raw;
  return (
    <span
      data-testid="activity-idle"
      title={r.raw ?? undefined}
      className="inline-flex max-w-full items-center gap-1 text-[11px] leading-4"
    >
      <span
        aria-hidden
        className="h-2 w-2 shrink-0 rounded-full bg-muted-foreground/40"
      />
      <span className="truncate text-muted-foreground">
        {idleSuffix ? `空闲 · 最后活动 ${idleSuffix}` : "空闲"}
      </span>
    </span>
  );
}

export interface ChangeLastSignalProps {
  /** 「最后信号」ISO 原文（列表=ChangeSummary.last_pushed_at；
   *  详情=lastSignalFromSteps(change.steps) 派生）。null / undefined 不渲染。 */
  lastPushedAt?: string | null;
  /** 测试注入时钟（epoch ms）；缺省 Date.now()。 */
  now?: number;
}

/**
 * 详情页头部「最后信号」行（task-12，[cid]/page.tsx ChangeStageHeader 区域）：
 * 「最后信号：x 分钟前」弱化文案，title 悬停保留 ISO 原文；畸形串回退原文，
 * 无信号整体不渲染（降级零噪音，D-03 精神）。
 */
export function ChangeLastSignal({ lastPushedAt, now }: ChangeLastSignalProps) {
  if (lastPushedAt === null || lastPushedAt === undefined) return null;
  const t = parseIsoLikeMs(lastPushedAt);
  const text =
    t !== null ? formatAge((now ?? Date.now()) - t) : lastPushedAt;
  return (
    <p
      data-testid="change-last-signal"
      title={lastPushedAt}
      className="px-3 text-[11px] leading-4 text-muted-foreground"
    >
      最后信号：{text}
    </p>
  );
}
