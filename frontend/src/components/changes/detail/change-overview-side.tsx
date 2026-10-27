"use client";

/**
 * 概览右侧信息栏（2026-10-15-change-detail-redesign / FR-08 / D-006@v1 / D-016@v1）。
 *
 * primer `MetaPanel` 五组压缩承载元信息：基本信息 / 执行用量 / 会话 / 范围对账计数 /
 * 产出速览——原「执行用量全宽卡」与「会话卡」的位置由本栏承接，首屏不再被三行全宽
 * 弱信息占据（D-001）。
 *
 * 取数纪律（D-016@v1 Q-4）：用量走 `useChangeUsage`（与 `ChangeUsageCard` **同一实现**
 * 与同一 queryKey）；范围对账与产出计数**复用**各自卡片既有 queryKey（`["scope-audit-card",
 * "audit", …]` / `["changeAssets", …]`）——同 key 命中 react-query 缓存，零额外请求，
 * 也天然与卡片保持单一数据源。本文件 MUST NOT 另写取数/格式化实现。
 *
 * 归档态两处契约（Phase 4）：用量区标题改「执行用量（合计）」且 MUST NOT 提供「按模型
 * 明细」展开；范围对账入口改指「产出 · 归档留档」（MUST NOT 指向已隐藏的「文件与对账」tab）。
 */
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";

import { MetaPanel, MetaPanelSection } from "@/components/primer";
import { CommitTypeChip } from "@/components/changes/commit-type-chip";
import {
  cacheHitRate,
  formatCompactTime,
  formatDurationZh,
  formatHitRate,
  hasNoExecution,
  useChangeUsage,
} from "@/components/changes/detail/change-usage-card";
import { getChangeAssets, getScopeAudit, type ChangeRead } from "@/lib/changes";
import type { AgentSessionListItem } from "@/lib/daemon";

interface Row {
  k: string;
  v: string;
}

const DASH = "—";

// 2026-10-18-change-list-type-filter：类型标签抽公共件（列表行/详情侧栏同源），
// 本文件改从公共组件导入（样式与映射随组件走，两处渲染口径恒一致）。

/** 用量七项压缩行（与卡片同源口径，仅改排版密度）。 */
function usageRows(usage: NonNullable<ReturnType<typeof useChangeUsage>["data"]>): Row[] {
  const t = usage.totals;
  return [
    { k: "耗时", v: usage.duration_ms == null ? DASH : formatDurationZh(usage.duration_ms) },
    { k: "轮次", v: t.num_turns === 0 ? DASH : String(t.num_turns) },
    { k: "输入", v: t.input_tokens.toLocaleString("en-US") },
    { k: "输出", v: t.output_tokens.toLocaleString("en-US") },
    { k: "缓存读取", v: t.cache_read_tokens.toLocaleString("en-US") },
    { k: "请求次数", v: t.api_requests === 0 ? DASH : String(t.api_requests) },
    { k: "缓存命中率", v: formatHitRate(cacheHitRate(t)) },
  ];
}

function RowView({ k, v }: Row) {
  return (
    <div className="flex items-center justify-between gap-3 text-xs">
      <span className="text-muted-foreground">{k}</span>
      <span className="min-w-0 truncate text-right font-mono" title={v}>
        {v}
      </span>
    </div>
  );
}

export interface ChangeOverviewSideProps {
  change: ChangeRead;
  workspaceId: string;
  changeId: string;
  archived: boolean;
  /** 变更关联会话（页面层经 listChangeSessions 已取；本栏显示最近 3 条）。 */
  sessions: AgentSessionListItem[];
}

export function ChangeOverviewSide({
  change,
  workspaceId,
  changeId,
  archived,
  sessions,
}: ChangeOverviewSideProps) {
  // 复用卡片既有 queryKey（零额外请求；同一数据源）。
  const changeKey = change.change_key;
  const usageQ = useChangeUsage("change", workspaceId, changeId);
  const auditQ = useQuery({
    queryKey: ["scope-audit-card", "audit", workspaceId, changeKey],
    queryFn: () => getScopeAudit(workspaceId, changeKey),
    refetchOnWindowFocus: false,
  });
  const assetsQ = useQuery({
    queryKey: ["changeAssets", workspaceId, changeId],
    queryFn: () => getChangeAssets(workspaceId, changeId),
    retry: false,
    refetchOnWindowFocus: false,
  });

  const usage = usageQ.data;
  const usageEmpty = usage == null || hasNoExecution(usage);

  // 范围对账计数：分组形态取信封 repos[].totals 合计（单一源）；单段形态按行 verdict 计数。
  const audit = auditQ.data;
  const auditCounts = (() => {
    if (!audit) return null;
    const repos = Array.isArray(audit.repos) ? audit.repos : [];
    if (repos.length > 0) {
      return repos.reduce(
        (acc, r) => {
          const t = (r.totals ?? {}) as Record<string, number>;
          acc.planned += t.planned ?? 0;
          acc.unplanned += t.unplanned ?? 0;
          acc.untouched += t.untouched ?? 0;
          return acc;
        },
        { planned: 0, unplanned: 0, untouched: 0 },
      );
    }
    const rows = audit.rows ?? [];
    if (rows.length === 0) return null;
    return rows.reduce(
      (acc, r) => {
        const v = audit.mode === "quick" ? r.attribution : r.verdict;
        if (v === "planned") acc.planned += 1;
        else if (v === "unplanned") acc.unplanned += 1;
        else if (v === "untouched") acc.untouched += 1;
        return acc;
      },
      { planned: 0, unplanned: 0, untouched: 0 },
    );
  })();

  const assets = assetsQ.data;
  const assetCounts = {
    fr: assets?.fr_entries?.length ?? 0,
    decisions: assets?.decisions?.length ?? 0,
    touch: assets?.knowledge_touch?.length ?? 0,
    files: assets?.patch?.files ?? 0,
  };

  const recentSessions = sessions.slice(0, 3);

  return (
    <div data-testid="change-overview-side">
      <MetaPanel className="w-full">
      <MetaPanelSection title="基本信息">
        <RowView k="变更 key" v={change.change_key} />
        {/* 类型行改 git conventional 彩色标签（2026-10-18-change-type-git-conventional） */}
        <div className="flex items-center justify-between gap-3 text-xs">
          <span className="text-muted-foreground">类型</span>
          {change.change_type ? (
            <CommitTypeChip type={change.change_type} />
          ) : (
            <span className="text-muted-foreground">{DASH}</span>
          )}
        </div>
        <RowView k="创建" v={change.created_at ? formatCompactTime(change.created_at) : DASH} />
        <RowView k="负责人" v={change.owner_name ?? DASH} />
      </MetaPanelSection>

      <MetaPanelSection title={archived ? "执行用量（合计）" : "执行用量"}>
        {usageQ.isPending ? (
          <p className="text-[11px] text-muted-foreground" data-testid="overview-side-usage-loading">
            用量加载中…
          </p>
        ) : usageEmpty ? (
          <p className="text-[11px] text-muted-foreground" data-testid="overview-side-usage-empty">
            暂无用量数据
          </p>
        ) : (
          <>
            {usageRows(usage).map((row) => (
              <RowView key={row.k} {...row} />
            ))}
            {/* 归档态 MUST NOT 提供按模型明细展开（Phase 4 契约）。 */}
            {archived ? null : (
              <div className="pt-1">
                <Link
                  href={`/workspaces/${workspaceId}/changes/${changeId}/sessions`}
                  className="text-xs text-muted-foreground hover:underline"
                >
                  按模型明细 →
                </Link>
              </div>
            )}
          </>
        )}
      </MetaPanelSection>

      <MetaPanelSection title="会话">
        {recentSessions.length === 0 ? (
          <p className="text-[11px] text-muted-foreground">暂无会话</p>
        ) : (
          recentSessions.map((s) => (
            <div key={s.id} className="flex items-center justify-between gap-2 text-xs">
              <Link
                href={`/workspaces/${workspaceId}/sessions?session=${s.id}`}
                className="truncate font-mono text-primary hover:underline"
                title={s.title ?? s.id}
              >
                {s.title?.trim() || s.id.slice(0, 8)}
              </Link>
              <span className="shrink-0 text-muted-foreground">{s.status}</span>
            </div>
          ))
        )}
        <div className="pt-1">
          <Link
            href={`/workspaces/${workspaceId}/sessions`}
            className="text-xs text-primary hover:underline"
          >
            打开会话工作台 →
          </Link>
        </div>
      </MetaPanelSection>

      <MetaPanelSection title="范围对账">
        {auditCounts === null ? (
          <p className="text-[11px] text-muted-foreground">暂无对账数据</p>
        ) : (
          <>
            <RowView k="计划内" v={String(auditCounts.planned)} />
            <RowView k="计划外" v={String(auditCounts.unplanned)} />
            <RowView k="计划未动" v={String(auditCounts.untouched)} />
          </>
        )}
        <div className="pt-1">
          {/* 2026-10-16-archived-files-tab / D-019@v1：归档态恢复「文件与对账」tab，
              两态入口同指该 tab（不再指路「产出 · 归档留档」）。 */}
          <span className="text-xs text-muted-foreground">明细见「文件与对账」</span>
        </div>
      </MetaPanelSection>

      <MetaPanelSection title="产出速览">
        <RowView k="需求规则" v={String(assetCounts.fr)} />
        <RowView k="决策蒸馏" v={String(assetCounts.decisions)} />
        <RowView k="知识触达" v={String(assetCounts.touch)} />
        <RowView k="改动文件" v={assetCounts.files === 0 ? DASH : String(assetCounts.files)} />
        <div className="pt-1">
          <span className="text-xs text-muted-foreground">明细见「产出」</span>
        </div>
      </MetaPanelSection>
      </MetaPanel>
    </div>
  );
}
