"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { FolderGit2 } from "lucide-react";

import {
  PageContainer,
  PageHeader,
  SectionCard,
} from "@/components/layout";
import { buttonVariants } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorBanner } from "@/components/ui/error-banner";
import { Input } from "@/components/ui/input";
import { StatusBadge } from "@/components/ui/status-badge";
import { ApiError } from "@/lib/api";
import { cn } from "@/lib/utils";
import {
  getWorkspace,
  getWorkspaceComponents,
  type Component,
  type Workspace,
} from "@/lib/workspaces";

interface Props {
  params: { id: string };
}

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
    <PageContainer size="full">
      <PageHeader
        title="项目组件"
        subtitle="查看项目组的内部组件（只读，来自 projects/*.yaml）"
        actions={
          <div className="flex flex-wrap items-center gap-1.5">
            <Link
              href={`/workspaces/${workspaceId}`}
              className="text-xs text-muted-foreground hover:text-foreground"
            >
              ← 工作区
            </Link>
            <Input
              className="h-8 w-40 px-2.5 text-xs"
              placeholder="搜索组件..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
        }
      />

      {pageError && <ErrorBanner message={pageError} />}

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
          <EmptyState
            icon={<FolderGit2 className="h-5 w-5" />}
            title="暂无组件"
            description="若未生成，可在变更中运行 generate_projects 重建 projects/*.yaml。"
          />
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
