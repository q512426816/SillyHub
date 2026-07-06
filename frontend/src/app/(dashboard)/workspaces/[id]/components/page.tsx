"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import {
  PageContainer,
  PageHeader,
  SectionCard,
} from "@/components/layout";
import { StatusBadge } from "@/components/ui/status-badge";
import { ApiError } from "@/lib/api";
import {
  getWorkspace,
  getWorkspaceComponents,
  type Component,
  type Workspace,
} from "@/lib/workspaces";

interface Props {
  params: { id: string };
}

const NAV_ITEMS = [
  { href: "changes", label: "变更中心" },
  { href: "scan-docs", label: "扫描文档" },
  { href: "components/topology", label: "拓扑图" },
  { href: "runtime", label: "运行时" },
  { href: "knowledge", label: "知识 & 日志" },
  { href: "releases", label: "发布" },
  { href: "approvals", label: "审批中心" },
  { href: "audit", label: "审计日志" },
  { href: "agent", label: "智能体" },
  { href: "incidents", label: "事件" },
  { href: "/settings", label: "设置", absolute: true },
] as const;

export default function ComponentsPage({ params }: Props) {
  const workspaceId = params.id;
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [components, setComponents] = useState<Component[]>([]);
  const [loading, setLoading] = useState(true);
  const [pageError, setPageError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");

  const load = async () => {
    setLoading(true);
    setPageError(null);
    try {
      const [ws, compData] = await Promise.all([
        getWorkspace(workspaceId),
        getWorkspaceComponents(workspaceId),
      ]);
      setWorkspace(ws);
      setComponents(compData.items);
    } catch (err) {
      setPageError(err instanceof ApiError ? err.message : "加载组件失败");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId]);

  // D-007@V1：组件只读，无出入边/重新扫描（关系层已砍，组件来自 projects/*.yaml）。
  const filtered = searchQuery.trim()
    ? components.filter((c) => {
        const q = searchQuery.toLowerCase();
        return (
          c.name.toLowerCase().includes(q) ||
          c.component_key.toLowerCase().includes(q) ||
          (c.role ?? "").toLowerCase().includes(q)
        );
      })
    : components;

  return (
    <PageContainer>
      <PageHeader
        title={
          <span className="flex flex-col gap-0.5">
            <span>项目组件</span>
            <Link
              href="/workspaces"
              className="text-[11px] font-normal text-muted-foreground hover:underline"
            >
              ← 工作区
            </Link>
          </span>
        }
        subtitle="查看项目组的内部组件（只读，来自 projects/*.yaml）"
        actions={
          <div className="flex flex-wrap items-center gap-1.5">
            {NAV_ITEMS.map((item) => (
              <Link
                key={item.href}
                href={
                  "absolute" in item && item.absolute
                    ? item.href
                    : `/workspaces/${workspaceId}/${item.href}`
                }
                className="inline-flex h-7 items-center rounded border border-border px-2 text-[11px] text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                {item.label}
              </Link>
            ))}
            <input
              className="h-7 rounded border border-input bg-background px-2 text-xs focus:border-ring focus:outline-none"
              placeholder="搜索组件..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
        }
      />

      {pageError && (
        <div className="rounded border border-destructive/30 bg-red-50 px-3 py-2 text-xs text-destructive">
          {pageError}
        </div>
      )}

      {/* Workspace metadata card */}
      {workspace && (
        <SectionCard>
          <div className="mb-2 flex items-center gap-2">
            <span className="text-sm font-semibold">{workspace.name}</span>
            <StatusBadge kind={workspace.status === "active" ? "success" : "neutral"}>
              {workspace.status}
            </StatusBadge>
            {workspace.type && (
              <StatusBadge kind="neutral">{workspace.type}</StatusBadge>
            )}
          </div>
          <dl className="grid grid-cols-[5.5rem_1fr] gap-y-1 text-xs">
            <dt className="text-muted-foreground">slug</dt>
            <dd className="font-mono">{workspace.slug}</dd>
            {workspace.component_key && (
              <>
                <dt className="text-muted-foreground">component_key</dt>
                <dd className="font-mono">{workspace.component_key}</dd>
              </>
            )}
            {workspace.role && (
              <>
                <dt className="text-muted-foreground">role</dt>
                <dd>{workspace.role}</dd>
              </>
            )}
            {workspace.tech_stack.length > 0 && (
              <>
                <dt className="text-muted-foreground">技术栈</dt>
                <dd className="flex flex-wrap gap-1">
                  {workspace.tech_stack.map((t) => (
                    <StatusBadge key={t} kind="neutral">
                      {t}
                    </StatusBadge>
                  ))}
                </dd>
              </>
            )}
          </dl>
        </SectionCard>
      )}

      {/* 一级子项目组件列表（只读） */}
      <SectionCard title={`一级子项目组件 · ${filtered.length} 个`} bodyPadding="p-0">
        {loading ? (
          <p className="py-6 text-center text-xs text-muted-foreground">加载中…</p>
        ) : filtered.length === 0 ? (
          <p className="py-6 text-center text-xs text-muted-foreground">
            暂无组件。若未生成，可在变更中运行 generate_projects 重建 projects/*.yaml。
          </p>
        ) : (
          <div className="divide-y">
            {filtered.map((c) => (
              <div
                key={c.component_key}
                className="flex items-center justify-between px-3 py-2"
              >
                <div className="flex items-center gap-2">
                  <StatusBadge kind={c.status === "active" ? "success" : "neutral"}>
                    {c.status}
                  </StatusBadge>
                  <span className="text-sm font-medium">{c.name}</span>
                  <span className="font-mono text-[11px] text-muted-foreground">
                    {c.component_key}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  {c.role && (
                    <span className="text-xs text-muted-foreground">{c.role}</span>
                  )}
                  {c.tech_stack.length > 0 && (
                    <div className="flex gap-1">
                      {c.tech_stack.map((t) => (
                        <StatusBadge key={t} kind="neutral">
                          {t}
                        </StatusBadge>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </SectionCard>
    </PageContainer>
  );
}
