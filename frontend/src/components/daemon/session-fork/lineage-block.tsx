"use client";

/**
 * LineageBlock — 谱系溯源块 + 多跳面包屑（2026-09-22-session-fork-continuation
 * task-08 / FR-02 / FR-05 / D-002@v1）。视觉与文案基准 = 原型
 * prototype-session-fork.html 的 .lineage 溯源块节 + .crumbs 面包屑节。
 *
 * 职责切分（task-08 边界）：
 *   - 本组件：纯展示 + 谱系数据按需拉取（源会话标题 / 祖先链 / 分叉轮序号），
 *     数据面 = AgentSessionRead fork 三字段（fork_of_session_id / fork_at_run_id /
 *     engine_fork_anchor，task-05 透出）——不依赖消息内容渲染（constraints：
 *     溯源块零复制流渲染逻辑，浮层归 WorkerSessionOverlay 泛化）；
 *   - 挂载方（session-panel page/dialog）：B 会话顶部常驻挂载 + 点击回调开
 *     原会话浮层（onOpenSource 上抛源会话 id，本组件不路由）。
 *
 * 数据派生：
 *   - 源标题 / 多跳祖先链：沿 fork_of_session_id 逐跳 getAgentSession（环防御
 *     上限 5 跳——谱系是用户逐次显式分叉产物，正常深度 1~2）；任一跳失败
 *     降级为短 id 标题，不阻断块渲染（溯源信息 best-effort，非关键面）。
 *   - 「第 N 轮后」序号：listSessionRuns(源) 按 created_at desc 快照定位
 *     fork_at_run_id 反推升序位（runs 端点 200 条帽外 / 历史 run 删除 → null，
 *     如实显示「某轮」不伪造）。
 *   - 引擎档标注：getProviderCaps(provider).sessionFork 单源（task-03 第 16 键），
 *     native/seed 两档文案与 fork-confirm-modal 的 FORK_TIER_META 同语义
 *     （验收断言点措辞一致）；none（caps 表回退值）不渲染档位 pill。
 *
 * 样式（双主题铁律）：brand 语义阶 + 主题 token（border-border / text-muted-
 * foreground），档位 pill 沿用 modal 的 emerald/amber 状态点色系，不硬编码 hex。
 */

import { useEffect, useState } from "react";

import { getAgentSession, listSessionRuns } from "@/lib/daemon";
import type { AgentSessionRead } from "@/lib/daemon";
import { getProviderCaps } from "@/lib/provider-caps";
import { cn } from "@/lib/utils";

/** 谱系祖先链防御上限（环 / 脏数据兜底；正常用户分叉深度 1~2 跳）。 */
const LINEAGE_MAX_HOPS = 5;

/** 档位 pill 文案（与 fork-confirm-modal FORK_TIER_META 措辞同源，验收断言点）。 */
const LINEAGE_TIER_META: Record<"native" | "seed", { label: string; cls: string }> = {
  native: { label: "原生分叉·真截断", cls: "bg-emerald-600/15 text-emerald-700" },
  seed: { label: "种子分叉·前情转述（非原生上下文）", cls: "bg-amber-500/15 text-amber-700" },
};

/** 谱系链节点（祖先方向：源头在前）。 */
interface LineageNode {
  sessionId: string;
  title: string;
}

/** 谱系派生结果（effect 拉取产物）。 */
interface LineageInfo {
  /** 祖先链（源头→直接源，仅 fork 跳；不含当前会话）。 */
  nodes: LineageNode[];
  /** 直接源的分叉轮序号（@第 N 轮后；runs 帽外/未命中 null → 「某轮」）。 */
  atRunSeq: number | null;
}

const LINEAGE_INITIAL: LineageInfo = { nodes: [], atRunSeq: null };

/** 会话显示标题（null → 短 id 占位，对齐 fork.py _source_display_title 兜底口径）。 */
function displayTitleOf(session: { id: string; title: string | null }): string {
  return session.title?.trim() || `会话 ${session.id.slice(0, 8)}`;
}

/** ISO → 中文相对时间（刚分叉场景；空/非法 → —）。 */
function formatForkTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "—";
  const diffMin = Math.floor((Date.now() - t) / 60_000);
  if (diffMin < 1) return "刚刚";
  if (diffMin < 60) return `${diffMin} 分钟前`;
  const hours = Math.floor(diffMin / 60);
  if (hours < 24) return `${hours} 小时前`;
  const days = Math.floor(hours / 24);
  return days < 7 ? `${days} 天前` : `${days} 天前`;
}

export interface LineageBlockProps {
  /** 当前会话（B，origin='fork'；挂载方已判 origin，本组件防御性再判 fork_of）。 */
  session: AgentSessionRead;
  /** 点击溯源块/面包屑祖先节点 → 上抛该会话 id（挂载方开 WorkerSessionOverlay）。 */
  onOpenSource: (_sessionId: string) => void;
}

/**
 * 溯源块（B 顶部常驻）：分叉自「源标题」第 N 轮后 · 相对时间 + 引擎档 pill +
 * 继承说明 + 「查看原会话 ⟶」；下方谱系面包屑（A → B → 当前，逐节点可点开
 * 对应浮层）。fork_of_session_id 为空（非分叉会话误挂载）渲染 null 零占位。
 */
export function LineageBlock({ session, onOpenSource }: LineageBlockProps) {
  const [info, setInfo] = useState<LineageInfo>(LINEAGE_INITIAL);

  // 谱系按需拉取：会话 id / fork 指针变化时重拉（B 本身指针恒定，effect 稳定）。
  useEffect(() => {
    const forkOf = session.fork_of_session_id;
    if (!forkOf) {
      setInfo(LINEAGE_INITIAL);
      return;
    }
    let cancelled = false;
    void (async () => {
      // ① 沿 fork_of 链逐跳拉祖先（含各自 fork 指针，供下一跳与多跳面包屑）。
      const nodes: LineageNode[] = [];
      let nextId: string | null = forkOf;
      const seen = new Set<string>([session.id]);
      while (nextId && nodes.length < LINEAGE_MAX_HOPS && !seen.has(nextId)) {
        // 窄化锚定：try/catch 内 TS 不保留 while 条件的 string 收窄，先落常量。
        const hopId: string = nextId;
        seen.add(hopId);
        try {
          const ancestor = await getAgentSession(hopId);
          nodes.push({ sessionId: ancestor.id, title: displayTitleOf(ancestor) });
          nextId = ancestor.fork_of_session_id ?? null;
        } catch {
          // 拉取失败（源已删/网络）：以短 id 占位收口本跳，不再深入。
          nodes.push({ sessionId: hopId, title: `会话 ${hopId.slice(0, 8)}` });
          nextId = null;
        }
      }
      // ② 直接源 runs 快照定位 fork_at_run_id 序号（desc 反推升序位）。
      let atRunSeq: number | null = null;
      const atRunId = session.fork_at_run_id;
      if (atRunId) {
        try {
          const runs = await listSessionRuns(forkOf);
          const idx = runs.findIndex((r) => r.id === atRunId);
          if (idx >= 0) atRunSeq = runs.length - idx;
        } catch {
          /* runs 拉取失败 → 某轮降级，不阻断块渲染 */
        }
      }
      if (!cancelled) setInfo({ nodes, atRunSeq });
    })();
    return () => {
      cancelled = true;
    };
  }, [session.id, session.fork_of_session_id, session.fork_at_run_id]);

  const forkOf = session.fork_of_session_id;
  if (!forkOf) return null;

  const tier = getProviderCaps(session.provider).sessionFork;
  const tierMeta = tier === "native" || tier === "seed" ? LINEAGE_TIER_META[tier] : null;
  const source = info.nodes[0] ?? { sessionId: forkOf, title: `会话 ${forkOf.slice(0, 8)}` };
  const seqAtText = info.atRunSeq != null ? `第 ${info.atRunSeq} 轮` : "某轮";
  const selfTitle = displayTitleOf(session);

  return (
    <div data-testid="fork-lineage-block" className="mx-5 mt-3 shrink-0">
      {/* 溯源块本体（原型 .lineage）：整块可点 → 开源会话浮层 */}
      <div
        role="button"
        tabIndex={0}
        aria-label={`查看原会话 ${source.title}`}
        onClick={() => onOpenSource(source.sessionId)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onOpenSource(source.sessionId);
          }
        }}
        className="flex cursor-pointer items-center gap-2.5 rounded-[10px] border border-brand-200 bg-brand-50 px-3.5 py-2.5 text-left transition-shadow hover:shadow-md"
      >
        <span
          aria-hidden
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-brand-600 text-sm text-primary-foreground"
        >
          ⑂
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] leading-5 text-foreground">
            分叉自 <b className="text-brand-700">「{source.title}」</b> {seqAtText}后 ·{" "}
            {formatForkTime(session.created_at)}
            {tierMeta && (
              <span
                data-testid="fork-lineage-tier"
                className={cn(
                  "ml-1.5 inline-flex items-center rounded-full px-2 py-px align-[1px] text-[10px] font-medium",
                  tierMeta.cls,
                )}
              >
                {tierMeta.label}
              </span>
            )}
          </p>
          <p className="mt-px text-xs leading-4 text-muted-foreground">
            新会话继承截至{seqAtText}的全部上下文，此后两侧独立
          </p>
        </div>
        <span className="shrink-0 text-xs font-medium text-brand-600">查看原会话 ⟶</span>
      </div>
      {/* 谱系面包屑（原型 .crumbs）：A → … → 当前；祖先节点逐个可点开浮层 */}
      <nav
        aria-label="会话谱系"
        data-testid="fork-lineage-crumbs"
        className="mt-2 flex flex-wrap items-center gap-1 text-xs text-muted-foreground"
      >
        <span className="shrink-0">谱系：</span>
        {info.nodes.map((node, i) => (
          <span key={node.sessionId} className="flex min-w-0 items-center gap-1">
            {i > 0 && <span aria-hidden className="text-muted-foreground/60">→</span>}
            <button
              type="button"
              title={`查看「${node.title}」`}
              onClick={() => onOpenSource(node.sessionId)}
              className="min-w-0 max-w-[12rem] truncate text-brand-600 hover:underline"
            >
              {node.title}
            </button>
          </span>
        ))}
        <span aria-hidden className="text-muted-foreground/60">→</span>
        <span className="min-w-0 max-w-[12rem] truncate font-semibold text-foreground">
          {selfTitle}（当前）
        </span>
      </nav>
    </div>
  );
}
