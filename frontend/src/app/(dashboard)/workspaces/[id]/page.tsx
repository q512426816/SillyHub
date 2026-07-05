"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { AgentModelInput } from "@/components/AgentModelInput";
import { WorkspaceConfigCard } from "@/components/workspace-config-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PageContainer, PageHeader, SectionCard } from "@/components/layout";
import { WorkspaceDaemonSwitcher } from "@/components/workspace-daemon-switcher";
import { WorkspacePathFields } from "@/components/workspace-path-fields";
import { ApiError } from "@/lib/api";
import { getDaemonRuntime, listDaemonInstances, listDaemonRuntimes, PROVIDER_META, type DaemonInstanceRead, type DaemonRuntimeRead } from "@/lib/daemon";
import { isDaemonClientWorkspace } from "@/lib/workspace-path";
import { listComponents } from "@/lib/components";
import { listChanges } from "@/lib/changes";
import {
  getSpecWorkspace,
  type SpecWorkspace,
} from "@/lib/spec-workspaces";
import { getRuntimeProgress } from "@/lib/runtime";
import {
  getWorkspace,
  updateWorkspace,
  type Workspace,
} from "@/lib/workspaces";
import { fetchMyBinding, type MemberBindingView } from "@/lib/workspace-binding";
import { useSession } from "@/stores/session";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface Props {
  params: { id: string };
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export default function WorkspaceDetailPage({ params }: Props) {
  const workspaceId = params.id;
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [boundRuntime, setBoundRuntime] = useState<DaemonRuntimeRead | null>(null);
  const [specWs, setSpecWs] = useState<SpecWorkspace | null>(null);
  const [componentCount, setComponentCount] = useState<number>(0);
  const [activeChanges, setActiveChanges] = useState<number>(0);
  const [archivedChanges, setArchivedChanges] = useState<number>(0);
  const [currentStage, setCurrentStage] = useState<string | null>(null);
  const [myBinding, setMyBinding] = useState<MemberBindingView | null>(null);
  const [loading, setLoading] = useState(true);
  const [pageError, setPageError] = useState<string | null>(null);
  // workspace 级默认 agent provider 编辑态（FR-01/FR-02，2026-06-14-agent-runtime-selection）
  const [defaultAgent, setDefaultAgent] = useState<string | null>(null);
  const [defaultModel, setDefaultModel] = useState<string | null>(null);
  const [savingDefaultAgent, setSavingDefaultAgent] = useState(false);
  // task-11 / daemon-entity-binding：当前绑定守护进程的在线 provider 列表
  const [boundDaemonProviders, setBoundDaemonProviders] = useState<string[]>([]);
  const [boundDaemon, setBoundDaemon] = useState<DaemonInstanceRead | null>(null);
  // task-08 / D-003@V2：owner 门禁
  const isOwner = (() => {
    const ownerId = workspace?.owner?.user_id;
    const currentUserId = useSession.getState().user?.id;
    if (!ownerId || !currentUserId) return true; // 无 owner / 无会话时放行
    return ownerId === currentUserId;
  })();

  const handleSaveDefaultAgent = async () => {
    if (!workspace) return;
    setSavingDefaultAgent(true);
    setPageError(null);
    try {
      const updated = await updateWorkspace(workspaceId, {
        default_agent: defaultAgent,
        default_model: defaultModel,
      });
      setWorkspace(updated);
    } catch (err) {
      setPageError(err instanceof ApiError ? err.message : "保存默认智能体失败");
    } finally {
      setSavingDefaultAgent(false);
    }
  };

  const load = async () => {
    setLoading(true);
    setPageError(null);
    try {
      const [ws, sw, comps, active, archived, rt] = await Promise.all([
        getWorkspace(workspaceId),
        getSpecWorkspace(workspaceId).catch(() => null),
        listComponents(workspaceId).catch(() => ({ items: [], total: 0 })),
        listChanges(workspaceId, { location: "active" }).catch(() => ({ items: [], total: 0 })),
        listChanges(workspaceId, { location: "archive" }).catch(() => ({ items: [], total: 0 })),
        getRuntimeProgress(workspaceId).catch(() => null),
      ]);
      setWorkspace(ws);
      setDefaultAgent(ws.default_agent);
      setDefaultModel(ws.default_model);
      if (ws.path_source === "daemon-client" && ws.daemon_runtime_id) {
        const runtime = await getDaemonRuntime(ws.daemon_runtime_id).catch(() => null);
        setBoundRuntime(runtime);
      } else {
        setBoundRuntime(null);
      }
      setSpecWs(sw);
      setComponentCount(comps.total ?? comps.items?.length ?? 0);
      setActiveChanges(active.total ?? active.items?.length ?? 0);
      setArchivedChanges(archived.total ?? archived.items?.length ?? 0);
      setCurrentStage(rt?.current_stage ?? null);

      // task-08 / D-002：获取当前成员 binding 以判定 init 状态
      const binding = await fetchMyBinding(workspaceId).catch(() => null);
      setMyBinding(binding);
    } catch (err) {
      setPageError(err instanceof ApiError ? err.message : "加载工作区失败");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId]);

  /* ----  task-11 / daemon-entity-binding：根据绑定 daemon 获取在线 provider 列表 ---- */
  useEffect(() => {
    if (!myBinding?.daemon_id) {
      setBoundDaemonProviders([]);
      setBoundDaemon(null);
      return;
    }
    let active = true;
    Promise.all([listDaemonRuntimes(), listDaemonInstances()])
      .then(([runtimes, instances]) => {
        if (!active) return;
        const filtered = runtimes.filter(
          (r) =>
            r.daemon_instance_id === myBinding.daemon_id &&
            r.status === "online" &&
            r.provider,
        );
        const providers = Array.from(
          new Set(filtered.map((r) => r.provider as string)),
        );
        setBoundDaemonProviders(providers);
        setBoundDaemon(
          instances.find((i) => i.id === myBinding.daemon_id) ?? null,
        );
      })
      .catch(() => {
        if (active) {
          setBoundDaemonProviders([]);
          setBoundDaemon(null);
        }
      });
    return () => {
      active = false;
    };
  }, [myBinding?.daemon_id]);

  const formatTs = (raw: string | null) =>
    raw ? new Date(raw).toLocaleString() : "---";

  if (loading) {
    return (
      <PageContainer size="full">
        <p className="py-12 text-center text-xs text-muted-foreground">加载中...</p>
      </PageContainer>
    );
  }

  if (!workspace) {
    return (
      <PageContainer size="full">
        <p className="py-12 text-center text-xs text-destructive">
          工作区不存在或加载失败。
        </p>
      </PageContainer>
    );
  }

  return (
    <PageContainer size="full">
      <PageHeader
        title={
          <span className="flex items-center gap-3">
            {workspace.name}
            <Badge variant={workspace.status === "active" ? "success" : "outline"}>
              {workspace.status}
            </Badge>
          </span>
        }
        subtitle={<span className="font-mono">{workspace.slug}</span>}
        actions={
          <Link href="/workspaces" className="text-[11px] text-muted-foreground hover:underline">
            &larr; 工作区
          </Link>
        }
      />

      {pageError && (
        <div className="rounded border border-destructive/30 bg-red-50 px-3 py-2 text-xs text-destructive">
          {pageError}
        </div>
      )}

      {/* Workspace basic info */}
      <SectionCard title="基本信息">
        <dl className="grid grid-cols-[6rem_1fr] gap-y-1 text-xs">
          <WorkspacePathFields
            workspace={workspace}
            runtime={boundRuntime}
            daemon={boundDaemon}
            linkRuntime
          />
          <dt className="text-muted-foreground">创建于</dt>
          <dd>{formatTs(workspace.created_at)}</dd>
          <dt className="text-muted-foreground">最后扫描</dt>
          <dd>{formatTs(workspace.last_scanned_at)}</dd>
        </dl>
        {/* ql-20260619-006：daemon-client workspace 改绑 daemon 入口 */}
        {isDaemonClientWorkspace(workspace) && (
          <div className="mt-3 border-t pt-2.5">
            <WorkspaceDaemonSwitcher
              workspaceId={workspaceId}
              currentBinding={myBinding}
              onChanged={() => void load()}
            />
          </div>
        )}
      </SectionCard>

      {/* Default Agent provider（FR-01/FR-02 / daemon-entity-binding task-11）*/}
      <SectionCard title="默认智能体提供方">
        <div className="space-y-2.5">
          <p className="text-xs text-muted-foreground">
            自动派发（阶段流转、scan-generate）且未显式指定 provider 时使用。留空则由守护进程默认决定。
          </p>
          {myBinding?.daemon_id ? (
            boundDaemonProviders.length > 0 ? (
              <div className="flex items-end gap-2">
                <div className="flex-1 space-y-1">
                  <label className="text-[11px] text-muted-foreground">智能体提供方</label>
                  <select
                    value={defaultAgent ?? ""}
                    onChange={(e) => setDefaultAgent(e.target.value === "" ? null : e.target.value)}
                    className="h-8 w-full rounded border border-input bg-background px-2.5 text-sm focus:border-ring focus:outline-none"
                  >
                    <option value="">未设置（由守护进程默认决定）</option>
                    {boundDaemonProviders.map((p) => (
                      <option key={p} value={p}>
                        {PROVIDER_META[p]?.label ?? p}
                      </option>
                    ))}
                    {defaultAgent && !boundDaemonProviders.includes(defaultAgent) && (
                      <option value={defaultAgent}>
                        {PROVIDER_META[defaultAgent]?.label ?? defaultAgent}（离线）
                      </option>
                    )}
                  </select>
                </div>
                <div className="flex-1 space-y-1">
                  <label className="text-[11px] text-muted-foreground">智能体模型</label>
                  <AgentModelInput
                    value={defaultModel}
                    onChange={setDefaultModel}
                    placeholder="提供方默认值"
                  />
                </div>
                <Button
                  size="sm"
                  onClick={handleSaveDefaultAgent}
                  disabled={
                    savingDefaultAgent ||
                    (defaultAgent === workspace.default_agent &&
                      defaultModel === workspace.default_model)
                  }
                >
                  {savingDefaultAgent ? "保存中..." : "保存"}
                </Button>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">
                当前绑定的守护进程无在线智能体提供方，请先确认守护进程已启用。
              </p>
            )
          ) : (
            <p className="text-xs text-muted-foreground">
              请先绑定守护进程。
            </p>
          )}
        </div>
      </SectionCard>

      {/* Overview cards */}
      <section className="grid grid-cols-2 gap-px rounded-md border bg-border lg:grid-cols-4">
        <Link href={`/workspaces/${workspaceId}/components`} className="bg-card px-3 py-2.5 hover:bg-muted/50 transition-colors">
          <p className="text-[11px] text-muted-foreground">项目组组件</p>
          <p className="text-sm font-semibold">{componentCount}</p>
        </Link>
        <Link href={`/workspaces/${workspaceId}/changes`} className="bg-card px-3 py-2.5 hover:bg-muted/50 transition-colors">
          <p className="text-[11px] text-muted-foreground">进行中变更</p>
          <p className="text-sm font-semibold">{activeChanges}</p>
        </Link>
        <div className="bg-card px-3 py-2.5">
          <p className="text-[11px] text-muted-foreground">已归档变更</p>
          <p className="text-sm font-semibold">{archivedChanges}</p>
        </div>
        <Link href={`/workspaces/${workspaceId}/runtime`} className="bg-card px-3 py-2.5 hover:bg-muted/50 transition-colors">
          <p className="text-[11px] text-muted-foreground">运行时阶段</p>
          <p className="text-sm font-semibold">{currentStage ?? "—"}</p>
        </Link>
      </section>

      {/* Spec workspace config card（task-07 / D-003@V1，原规范管理区迁入） */}
      <WorkspaceConfigCard
        workspace={workspace}
        specWs={specWs}
        myBinding={myBinding}
        boundDaemon={boundDaemon}
        isOwner={isOwner}
        onRefresh={load}
        componentCount={componentCount}
      />

      {/* Quick nav */}
      <section className="flex flex-wrap gap-2">
        {[
          { href: `/workspaces/${workspaceId}/components`, label: "项目组件" },
          { href: `/workspaces/${workspaceId}/changes`, label: "变更中心" },
          { href: `/workspaces/${workspaceId}/scan-docs`, label: "扫描文档" },
          { href: `/workspaces/${workspaceId}/runtime`, label: "运行时" },
          { href: `/workspaces/${workspaceId}/agent`, label: "智能体" },
        ].map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className="inline-flex h-7 items-center rounded border border-border px-2 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            {item.label}
          </Link>
        ))}
      </section>
    </PageContainer>
  );
}
