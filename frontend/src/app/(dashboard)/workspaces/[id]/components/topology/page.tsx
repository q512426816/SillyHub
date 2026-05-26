"use client";

import {
  Background,
  Controls,
  Handle,
  Position,
  ReactFlow,
  type Edge,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { ApiError } from "@/lib/api";
import { getTopology, type TopologyResponse } from "@/lib/components";

interface Props {
  params: { id: string };
}

const TYPE_COLORS: Record<string, string> = {
  frontend: "#a78bfa",
  backend: "#34d399",
  tooling: "#fbbf24",
  docs: "#60a5fa",
  test: "#f472b6",
};

type ComponentNodeData = {
  label: string;
  type: string | null;
  status: string;
};

function ComponentNode({ data }: NodeProps<Node<ComponentNodeData>>) {
  const bg = data.type ? TYPE_COLORS[data.type] ?? "#94a3b8" : "#94a3b8";
  return (
    <div
      className="rounded-md border bg-card px-3 py-2 text-xs shadow-sm"
      style={{ borderColor: bg }}
    >
      <Handle type="target" position={Position.Left} style={{ background: bg }} />
      <div className="font-semibold">{data.label}</div>
      <div className="flex items-center justify-between gap-2 text-[10px] text-muted-foreground">
        <span>{data.type ?? "—"}</span>
        <span
          className={
            data.status === "active"
              ? "text-emerald-600"
              : "text-destructive"
          }
        >
          {data.status}
        </span>
      </div>
      <Handle type="source" position={Position.Right} style={{ background: bg }} />
    </div>
  );
}

const nodeTypes = { component: ComponentNode };

export default function TopologyPage({ params }: Props) {
  const workspaceId = params.id;
  const [topology, setTopology] = useState<TopologyResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [pageError, setPageError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    getTopology(workspaceId)
      .then((data) => {
        if (!cancelled) setTopology(data);
      })
      .catch((err) => {
        if (!cancelled) {
          setPageError(err instanceof ApiError ? err.message : "加载拓扑失败");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [workspaceId]);

  const { nodes, edges } = useMemo(() => {
    if (!topology) return { nodes: [] as Node[], edges: [] as Edge[] };
    const cols = Math.max(1, Math.ceil(Math.sqrt(topology.nodes.length)));
    const nodes: Node[] = topology.nodes.map((n, idx) => ({
      id: n.id,
      type: "component",
      position: {
        x: 60 + (idx % cols) * 220,
        y: 60 + Math.floor(idx / cols) * 140,
      },
      data: {
        label: n.name,
        type: n.type,
        status: n.status,
      } satisfies ComponentNodeData,
    }));
    const edges: Edge[] = topology.edges.map((e, idx) => ({
      id: `edge-${idx}`,
      source: e.source,
      target: e.target,
      label: e.relation_type,
      animated: true,
      style: { stroke: "#94a3b8" },
      labelStyle: { fontSize: 10, fill: "#475569" },
    }));
    return { nodes, edges };
  }, [topology]);

  return (
    <div className="flex h-screen flex-col">
      <header className="flex items-center justify-between border-b bg-card px-6 py-3">
        <div>
          <p className="text-xs text-muted-foreground">
            <Link href={`/workspaces/${workspaceId}/components`} className="hover:underline">
              ← 回到组件列表
            </Link>
          </p>
          <h1 className="text-lg font-semibold tracking-tight">组件拓扑</h1>
        </div>
        <div className="text-xs text-muted-foreground">
          {topology
            ? `${topology.nodes.length} 节点 · ${topology.edges.length} 边`
            : ""}
        </div>
      </header>

      <div className="flex-1 bg-muted/20">
        {loading ? (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            加载中…
          </div>
        ) : pageError ? (
          <div className="flex h-full items-center justify-center text-sm text-destructive">
            {pageError}
          </div>
        ) : nodes.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-sm text-muted-foreground">
            <p>这个 Workspace 还没有组件。</p>
            <Link
              href={`/workspaces/${workspaceId}/components`}
              className="text-primary hover:underline"
            >
              去解析 .sillyspec/projects
            </Link>
          </div>
        ) : (
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            fitView
            proOptions={{ hideAttribution: true }}
          >
            <Background gap={16} size={1} />
            <Controls position="bottom-right" />
          </ReactFlow>
        )}
      </div>
    </div>
  );
}
