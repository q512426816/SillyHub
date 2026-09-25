"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";

import { getChangeAssets } from "@/lib/changes";

interface ChangeAssetsCardProps {
  workspaceId: string;
  changeId: string;
}

/**
 * 变更详情页 aside「沉淀资产」折叠卡（2026-09-25-change-precipitated-assets /
 * D-001@v1 方案 a）。
 *
 * 本变更经归档沉淀的项目资产只读聚合：FR 索引条目 / 决策蒸馏条目 / 测试绑定
 * 行 / patch 留档统计 / delta 摘要。useQuery 自取数（ChangeEventsCard 同款
 * 范式）+ 失败静默隐藏；四组逐组「有数据才渲染」（design fail-open）；
 * 在途变更（archived=false）显示引导空态（design R-03 对应展示面）。
 * 纯展示零业务逻辑——FR/决策行点击跳知识库页（?file= 前向参数，页面暂不
 * 消费，深锚点后续演进），无 mutation。
 */
export function ChangeAssetsCard({ workspaceId, changeId }: ChangeAssetsCardProps) {
  const query = useQuery({
    queryKey: ["changeAssets", workspaceId, changeId],
    queryFn: () => getChangeAssets(workspaceId, changeId),
    retry: false,
    refetchOnWindowFocus: false,
  });

  const [open, setOpen] = useState(false);

  // 失败静默：区块隐藏（不影响详情主内容）。
  if (query.isError) return null;

  const data = query.data;
  const frCount = data?.fr_entries.length ?? 0;
  const decCount = data?.decisions.length ?? 0;
  const rowCount = data?.test_rows.length ?? 0;
  const hasAudit = Boolean(data?.patch || data?.delta);
  const total = frCount + decCount + rowCount + (hasAudit ? 1 : 0);

  return (
    <section
      data-testid="change-assets-card"
      className="rounded-md border bg-card"
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        data-state={open ? "open" : "closed"}
        className="flex w-full items-center justify-between gap-2 border-b px-3 py-2 text-left"
      >
        <h2 className="flex items-center gap-1.5 text-xs font-medium">
          📦 沉淀资产
          {total > 0 && (
            <span className="rounded-full border border-brand-300 bg-brand-50 px-2 py-px text-[10px] font-medium text-brand-700">
              FR {frCount} · 决策 {decCount}
            </span>
          )}
        </h2>
        <span className="text-[10px] text-muted-foreground">
          {open ? "收起 ▲" : "展开 ▼"}
        </span>
      </button>

      {open && (
        <div className="flex flex-col gap-2 px-3 py-2">
          {data && !data.archived && total === 0 ? (
            <p
              data-testid="change-assets-inflight"
              className="py-3 text-center text-[11px] text-muted-foreground"
            >
              变更归档后，此处会汇总其沉淀的 FR / 决策 / 测试绑定与留档。
            </p>
          ) : null}

          {data && data.archived && total === 0 ? (
            <p className="py-3 text-center text-[11px] text-muted-foreground">
              本变更暂无沉淀资产记录。
            </p>
          ) : null}

          {frCount > 0 ? (
            <div className="rounded border-border/60 border p-2" data-testid="change-assets-fr">
              <div className="mb-1 flex items-center justify-between text-[11px] font-medium text-muted-foreground">
                <span>需求规则（FR 索引）</span>
                <span className="text-[10px] text-muted-foreground/70">knowledge/fr</span>
              </div>
              {data?.fr_entries.map((e) => (
                <Link
                  key={e.id}
                  href={`/workspaces/${workspaceId}/knowledge?file=${encodeURIComponent(e.file)}`}
                  className="flex items-baseline gap-2 border-b border-dashed py-1 text-xs last:border-b-0 hover:underline"
                >
                  <span className="font-mono text-[10px] text-brand-700">{e.id}</span>
                  <span className="min-w-0 flex-1 truncate">{e.title}</span>
                  {e.status ? (
                    <span className="rounded-full bg-emerald-50 px-1.5 text-[10px] text-emerald-700">
                      {e.status}
                    </span>
                  ) : null}
                </Link>
              ))}
            </div>
          ) : null}

          {decCount > 0 ? (
            <div className="rounded border-border/60 border p-2" data-testid="change-assets-decisions">
              <div className="mb-1 flex items-center justify-between text-[11px] font-medium text-muted-foreground">
                <span>决策蒸馏</span>
                <span className="text-[10px] text-muted-foreground/70">
                  knowledge/decisions
                </span>
              </div>
              {data?.decisions.map((d) => (
                <Link
                  key={d.id}
                  href={`/workspaces/${workspaceId}/knowledge?file=${encodeURIComponent(d.file)}`}
                  className="flex items-baseline gap-2 border-b border-dashed py-1 text-xs last:border-b-0 hover:underline"
                >
                  <span className="font-mono text-[10px] text-cyan-700">{d.id}</span>
                  <span className="min-w-0 flex-1 truncate">{d.title}</span>
                  {d.status ? (
                    <span className="rounded-full bg-emerald-50 px-1.5 text-[10px] text-emerald-700">
                      {d.status}
                    </span>
                  ) : null}
                </Link>
              ))}
            </div>
          ) : null}

          {rowCount > 0 ? (
            <div className="rounded border-border/60 border p-2" data-testid="change-assets-tests">
              <div className="mb-1 flex items-center justify-between text-[11px] font-medium text-muted-foreground">
                <span>测试绑定</span>
                <span className="text-[10px] text-muted-foreground/70">test-trace</span>
              </div>
              {data?.test_rows.map((r) => (
                <div
                  key={r.row_id}
                  className="flex items-baseline gap-2 border-b border-dashed py-1 text-xs last:border-b-0"
                >
                  <span className="font-mono text-[10px] text-muted-foreground">
                    {r.row_id.split(":").slice(1, 3).join(":") || r.row_id}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-muted-foreground">
                    {r.tests.join(" ｜ ")}
                  </span>
                  {r.state ? (
                    <span className="rounded-full bg-amber-50 px-1.5 text-[10px] text-amber-700">
                      {r.state}
                    </span>
                  ) : null}
                </div>
              ))}
            </div>
          ) : null}

          {hasAudit && data ? (
            <div className="rounded border-border/60 border p-2 text-[11px] text-muted-foreground" data-testid="change-assets-audit">
              <div className="mb-1 text-[11px] font-medium">归档留档</div>
              <div className="flex flex-wrap gap-x-3 gap-y-1">
                {data.patch ? (
                  <span>
                    patch{" "}
                    <b className="text-foreground">
                      {data.patch.files ?? "?"} 文件 +{data.patch.additions ?? "?"}/−
                      {data.patch.deletions ?? "?"}
                    </b>
                  </span>
                ) : null}
                {data.delta ? (
                  <span>
                    delta{" "}
                    <b className="text-foreground">
                      Before {data.delta.before_lines ?? "?"} 行 / Delta{" "}
                      {data.delta.delta_lines ?? "?"} 行
                    </b>
                  </span>
                ) : null}
              </div>
            </div>
          ) : null}
        </div>
      )}
    </section>
  );
}
