"use client";

/**
 * ChangeAssetsGraph —— 沉淀资产卡内嵌知识图谱分区
 * （2026-10-15-change-assets-graph / FR-01，用户需求：图谱+右侧描述放进沉淀资产卡）。
 *
 * 本变更一跳邻域切片：getKnowledgeGraphQuery(workspaceId, "neighbors",
 * { anchor: changeKey })（与图谱页 neighbors 切片同端点，data 联合经
 * isGraphNeighborsData 守卫分型）+ GraphCanvas slice 模式画布 + 右侧节点详情栏
 * （图谱页 detail tab 的紧凑直译：类型中文标签 + 色点 + ID + 按边型分组的
 * 出入邻居行，行点击跳选）。
 *
 * fail-open（与资产卡逐组「有数据才渲染」同口径）：信封 available=false /
 * 请求失败（retry:false 不轰炸）/ 节点集为空 / 非 neighbors 分型（node_not_found
 * 降级等）→ 整区静默隐藏，不显示错误卡，不影响资产卡其余分组。
 *
 * 选中态：初始由锚点节点兜底（selectedId ?? data.anchor）——用户点击画布节点
 * 或邻居行后切换；点画布空白回退锚点（受控面板恒有内容，不设计空态）。
 */

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";

import {
  GraphCanvas,
  NODE_TYPE_LABELS,
  nodePalette,
  nodeTypeIndex,
} from "@/components/knowledge/graph-canvas";
import type { GraphEdge, GraphNodeRef } from "@/lib/knowledge";
import { getKnowledgeGraphQuery, isGraphNeighborsData } from "@/lib/knowledge";
import { useThemeStore } from "@/stores/theme";

interface ChangeAssetsGraphProps {
  workspaceId: string;
  /** 变更 key（neighbors 锚点；缺省不渲染——无锚点无切片）。 */
  changeKey: string;
}

function asArray<T>(v: unknown): T[] {
  return Array.isArray(v) ? (v as T[]) : [];
}

export function ChangeAssetsGraph({ workspaceId, changeKey }: ChangeAssetsGraphProps) {
  const theme = useThemeStore((s) => s.theme);
  const palette = useMemo(() => nodePalette(theme), [theme]);
  /** 用户显式选中（null = 未操作，详情栏回退锚点节点）。 */
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const q = useQuery({
    queryKey: ["changeAssetsGraph", workspaceId, changeKey],
    queryFn: () =>
      getKnowledgeGraphQuery(workspaceId, "neighbors", { anchor: changeKey }),
    retry: false,
    refetchOnWindowFocus: false,
  });

  const data = q.data?.available ? q.data.data ?? null : null;
  // neighbors 分型收窄（node_not_found 等降级形态缺 anchor 字段 → 隐藏）。用
  // 类型谓词守卫而非裸 `"anchor" in data`：后者对经 `?? null` 推断链产生的联合
  // 不收窄（TS2339 实证，见 isGraphNeighborsData 注释）。
  const nodes = isGraphNeighborsData(data) ? asArray<GraphNodeRef>(data.nodes) : [];
  const edges = isGraphNeighborsData(data) ? asArray<GraphEdge>(data.edges) : [];

  const nodeMap = useMemo(
    () => new Map(nodes.map((n) => [n.id, n] as const)),
    [nodes],
  );
  // 受控选中：显式选择优先，未操作时锚点兜底（锚点缺失（理论不发生）回退首节点）。
  const selectedNode =
    (selectedId ? nodeMap.get(selectedId) : undefined) ??
    nodeMap.get(changeKey) ??
    nodes[0] ??
    null;

  // 选中节点出入邻居（按边型分组；s→t 定方向，与图谱页 detail tab 同口径）。
  const neighborGroups = useMemo(() => {
    if (!selectedNode) return [];
    const groups = new Map<
      string,
      { type: string; rows: { other: string; dir: "出" | "入" }[] }
    >();
    for (const e of edges) {
      if (e.s === selectedNode.id || e.t === selectedNode.id) {
        const g = groups.get(e.type) ?? { type: e.type, rows: [] };
        if (e.s === selectedNode.id) g.rows.push({ other: e.t, dir: "出" });
        if (e.t === selectedNode.id) g.rows.push({ other: e.s, dir: "入" });
        groups.set(e.type, g);
      }
    }
    return [...groups.values()];
  }, [selectedNode, edges]);

  // fail-open：加载中给轻提示（信封不可用/失败/空 → 整区隐藏）。
  if (q.isPending) {
    return (
      <p
        data-testid="change-assets-graph-loading"
        className="rounded border border-border/60 px-2 py-2 text-center text-[11px] text-muted-foreground"
      >
        知识图谱加载中…
      </p>
    );
  }
  if (q.isError || !q.data?.available || nodes.length === 0) return null;

  return (
    <div
      data-testid="change-assets-graph"
      className="overflow-hidden rounded border border-border/60"
    >
      <div className="flex items-center justify-between gap-2 border-b border-dashed px-2 py-1.5">
        <span className="text-[11px] font-medium text-muted-foreground">
          🕸 知识图谱（本变更一跳邻域）
        </span>
        <span className="shrink-0 text-[10px] text-muted-foreground/70">
          {nodes.length} 节点 · {edges.length} 边 · 点击节点看详情
        </span>
      </div>
      <div className="flex flex-col gap-2 p-2 md:flex-row">
        <div className="relative h-[280px] min-w-0 flex-1 overflow-hidden rounded border border-border/40 bg-muted/20">
          <GraphCanvas
            className="absolute inset-0"
            nodes={nodes}
            edges={edges}
            mode="slice"
            selectedId={selectedNode?.id ?? null}
            onSelect={setSelectedId}
          />
        </div>
        <div
          data-testid="change-assets-graph-detail"
          className="w-full shrink-0 overflow-y-auto md:max-h-[280px] md:w-[250px]"
        >
          {selectedNode ? (
            <div className="text-xs">
              <div className="flex items-center gap-2">
                <span
                  aria-hidden
                  className="h-3 w-3 shrink-0 rounded-full"
                  style={{ backgroundColor: palette[nodeTypeIndex(selectedNode.type)] }}
                />
                <span className="min-w-0 break-all text-[12px] font-semibold">
                  {selectedNode.label || selectedNode.id}
                </span>
              </div>
              <div className="mt-1.5 flex items-baseline gap-2">
                <span className="shrink-0 rounded-full bg-brand-50 px-1.5 py-px text-[10px] font-bold text-brand-700">
                  {NODE_TYPE_LABELS[selectedNode.type] ?? (selectedNode.type || "未知")}
                </span>
                <span
                  className="min-w-0 break-all font-mono text-[10px] text-muted-foreground"
                  title={selectedNode.id}
                >
                  {selectedNode.id}
                </span>
              </div>
              {neighborGroups.length > 0 ? (
                <div className="mt-2 space-y-1.5">
                  {neighborGroups.map((g) => (
                    <div key={g.type}>
                      <div className="font-mono text-[10px] font-medium text-muted-foreground">
                        {g.type}
                      </div>
                      <div className="mt-0.5 space-y-0.5">
                        {g.rows.map((row, i) => {
                          const other = nodeMap.get(row.other);
                          return (
                            <button
                              key={`${row.other}:${row.dir}:${i}`}
                              type="button"
                              data-testid="change-assets-graph-neighbor"
                              disabled={!other}
                              onClick={() => other && setSelectedId(other.id)}
                              className="flex w-full items-center gap-1.5 rounded-sm border border-border/50 px-1.5 py-0.5 text-left text-[11px] transition-colors hover:border-brand-300 hover:bg-brand-50/50 disabled:cursor-default disabled:opacity-60"
                            >
                              <span
                                aria-hidden
                                className="h-2 w-2 shrink-0 rounded-full"
                                style={{
                                  backgroundColor: palette[nodeTypeIndex(other?.type ?? "")],
                                }}
                              />
                              <span className="min-w-0 flex-1 truncate" title={row.other}>
                                {other ? other.label || other.id : row.other}
                              </span>
                              <span className="shrink-0 text-[9.5px] text-muted-foreground">
                                {row.dir}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="mt-2 text-[10.5px] text-muted-foreground">
                  该节点在本切片内无邻接边。
                </p>
              )}
            </div>
          ) : (
            <p className="py-6 text-center text-[11px] text-muted-foreground">
              点击画布节点查看详情
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
