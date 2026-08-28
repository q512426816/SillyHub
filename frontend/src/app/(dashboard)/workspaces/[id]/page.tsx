"use client";

import { useEffect, useState } from "react";

import { AgentModelInput } from "@/components/AgentModelInput";
import { SharedDaemonToggle } from "@/components/workspace/shared-daemon-toggle";
import { LinkedProjectsSection } from "@/components/workspace/LinkedProjectsSection";
import { WorkspaceConfigCard } from "@/components/workspace-config-card";
import { Button } from "@/components/ui/button";
import { PageContainer, SectionCard } from "@/components/layout";
import { ErrorBanner } from "@/components/ui/error-banner";
import { WorkspaceDaemonSwitcher } from "@/components/workspace-daemon-switcher";
import { WorkspacePathFields } from "@/components/workspace-path-fields";
import { WorkspaceHeroHeader } from "@/components/workspace/hero-header";
import { WorkspaceStatsRow } from "@/components/workspace/stats-row";
import { ApiError } from "@/lib/api";
import { cn } from "@/lib/utils";
import {
  WORKSPACE_TYPE_OPTIONS,
  workspaceTypeBadge,
  type WorkspaceType,
} from "@/lib/workspace-types";
import { listDaemonInstances, listDaemonRuntimes, PROVIDER_META, type DaemonInstanceRead, type DaemonRuntimeRead } from "@/lib/daemon";
import { useDaemonMachines } from "@/lib/use-daemon-machines";
import { listComponents } from "@/lib/components";
import { listChanges } from "@/lib/changes";
import { listQuicklogEntries } from "@/lib/quicklog";
import {
  getSpecWorkspace,
  type SpecWorkspace,
} from "@/lib/spec-workspaces";
import {
  getWorkspace,
  updateWorkspace,
  type Workspace,
} from "@/lib/workspaces";
import { fetchMyBinding, type MemberBindingView } from "@/lib/workspace-binding";
import { listLinkedProjects } from "@/lib/workspace";
import {
  WorkspaceAccessGuide,
  type AccessGuideInitial,
} from "@/components/workspace-access-guide";
import { Modal } from "antd";
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
  // ql-20260820-013：统计第四卡由"运行时阶段"改为快速修复条数（用户反馈）
  const [quickTotal, setQuickTotal] = useState<number>(0);
  const [myBinding, setMyBinding] = useState<MemberBindingView | null>(null);
  // ql-20260821-003：接入配置编辑态（原 layout 的 WorkspaceBindingGuard 入口吸收进 hero slot）
  const [accessEditing, setAccessEditing] = useState(false);
  // ql-20260821-003：关联 PPM 项目由平铺卡改为按钮+弹层
  const [projectsOpen, setProjectsOpen] = useState(false);
  // ql-20260821-004：基本信息展示关联项目简要（名称列表，弹层内管理）
  const [linkedProjectNames, setLinkedProjectNames] = useState<string[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [pageError, setPageError] = useState<string | null>(null);
  // workspace 级默认 agent provider 编辑态（FR-01/FR-02，2026-06-14-agent-runtime-selection）
  const [defaultAgent, setDefaultAgent] = useState<string | null>(null);
  const [defaultModel, setDefaultModel] = useState<string | null>(null);
  const [savingDefaultAgent, setSavingDefaultAgent] = useState(false);
  // task-11 / daemon-entity-binding：当前绑定守护进程的在线 provider 列表
  const [boundDaemonProviders, setBoundDaemonProviders] = useState<string[]>([]);
  const [boundDaemon, setBoundDaemon] = useState<DaemonInstanceRead | null>(null);
  // quick-4a55e2dc：绑定 daemon 是否本人自有（listDaemonInstances 命中）——借用
  // 绑定（quick-18951370 放宽后可绑他人共享 daemon）不渲染「共享」开关（防共享
  // 的共享；后端 set_my_binding_shared 同步加了归属校验双保险）。null=未解析。
  const [boundDaemonOwned, setBoundDaemonOwned] = useState<boolean | null>(null);
  // quick-18951370：共享绑定的 daemon 展示回退——listDaemonInstances 仅自有，
  // 绑定共享 daemon 时从融合候选（自有+共享）解析显示名与在线态。
  const { machineCandidates } = useDaemonMachines({ limit: 100 });
  // task-08 / D-003@V2：owner 门禁
  const isOwner = (() => {
    const ownerId = workspace?.owner?.user_id;
    const currentUserId = useSession.getState().user?.id;
    if (!ownerId || !currentUserId) return true; // 无 owner / 无会话时放行
    return ownerId === currentUserId;
  })();

  // task-07 / 2026-08-18-workspace-role-type / FR-05：基本信息编辑态
  // （type/role/description，PATCH 保存）。加载回填模式与 default_agent 一致——
  // load() 成功后从 ws 回填草稿，保存成功 setWorkspace(updated) 刷新本地状态。
  // typeDraft 存原始 string（WorkspaceRead.type 读路径不校验存量，design §9——
  // 存量未知旧值要能在下拉里原样显示，词表外值渲染追加「存量值」选项，
  // 形态对齐本页 default_agent 的离线 provider 追加选项模式）。
  // role/description 空串即 null（显式清空语义，D-005@v1：omit=不改 / null=清空）。
  const [typeDraft, setTypeDraft] = useState<string | null>(null);
  const [roleDraft, setRoleDraft] = useState("");
  const [descriptionDraft, setDescriptionDraft] = useState("");
  const [savingInfo, setSavingInfo] = useState(false);
  // 基本信息编辑态展开开关（默认收起只读展示，点「编辑」展开表单；贴
  // WorkspaceConfigCard 内联展开的交互形态，页面无独立编辑路由）。
  const [editingInfo, setEditingInfo] = useState(false);

  const handleSaveBasicInfo = async () => {
    if (!workspace) return;
    setSavingInfo(true);
    setPageError(null);
    try {
      const updated = await updateWorkspace(workspaceId, {
        // type 未变化时省略不发（D-005 omit=不改）——存量未知旧值原样回传会被
        // 后端 WorkspaceUpdate.type 的 Literal 校验 422 拒收（读不校验/写校验，
        // design §9），"只改角色/用途"的保存不能被旧 type 拖炸。
        ...(typeDraft !== (workspace.type ?? null)
          ? { type: typeDraft as WorkspaceType | null }
          : {}),
        role: roleDraft.trim() === "" ? null : roleDraft.trim(),
        description: descriptionDraft.trim() === "" ? null : descriptionDraft.trim(),
      });
      setWorkspace(updated);
      setEditingInfo(false);
    } catch (err) {
      setPageError(err instanceof ApiError ? err.message : "保存基本信息失败");
    } finally {
      setSavingInfo(false);
    }
  };

  const infoDirty =
    typeDraft !== (workspace?.type ?? null) ||
    roleDraft !== (workspace?.role ?? "") ||
    descriptionDraft !== (workspace?.description ?? "");

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
      // 第六批：fetchMyBinding 仅依赖 workspaceId，与上 6 路相互独立，并入
      // Promise.all 并行（原串行排在 6 路之后，白多一个 RTT）。各路已有 .catch 降级。
      const [ws, sw, comps, active, archived, ql, binding] = await Promise.all([
        getWorkspace(workspaceId),
        getSpecWorkspace(workspaceId).catch(() => null),
        listComponents(workspaceId).catch(() => ({ items: [], total: 0 })),
        // ql-20260821-004 口径对齐变更中心 tab 徽标（pageSize=1 取 total +
        // quicklog 含空壳占位 include_placeholder，与 tabTotalsQuery 同参）
        listChanges(workspaceId, { location: "active", pageSize: 1 }).catch(() => ({ items: [], total: 0 })),
        listChanges(workspaceId, { location: "archive", pageSize: 1 }).catch(() => ({ items: [], total: 0 })),
        listQuicklogEntries(workspaceId, { include_placeholder: true, page_size: 1 }).catch(() => ({ items: [], total: 0 })),
        fetchMyBinding(workspaceId).catch(() => null),
      ]);
      setWorkspace(ws);
      setDefaultAgent(ws.default_agent);
      setDefaultModel(ws.default_model);
      // task-07 / FR-05：基本信息编辑草稿回填（保存后 reload 同样走这里收敛）。
      setTypeDraft(ws.type ?? null);
      setRoleDraft(ws.role ?? "");
      setDescriptionDraft(ws.description ?? "");
      // task-11 / 2026-07-10-remove-server-local-workspace-mode：平台统一
      // daemon-client 语义后，runtime 维度已下沉到 per-member binding，此处
      // boundRuntime 恒 null；runtime 展示由 boundDaemon state 承担
      // （WorkspacePathFields 的 daemon prop）。
      setBoundRuntime(null);
      setSpecWs(sw);
      setComponentCount(comps.total ?? comps.items?.length ?? 0);
      setActiveChanges(active.total ?? active.items?.length ?? 0);
      setArchivedChanges(archived.total ?? archived.items?.length ?? 0);
      setQuickTotal(ql.total ?? ql.items?.length ?? 0);

      // task-08 / D-002：获取当前成员 binding 以判定 init 状态
      setMyBinding(binding);
      // ql-20260821-004：关联项目简要（独立拉取失败静默——展示性信息不阻断页面）
      refreshLinkedProjects();
    } catch (err) {
      setPageError(err instanceof ApiError ? err.message : "加载工作区失败");
    } finally {
      setLoading(false);
    }
  };

  // ql-20260824-005-aa13：关联项目简要重拉（load 内联逻辑收敛于此）。弹窗内
  // 绑定/解绑成功（onChanged）与关闭弹层时调用，基本信息行即时回显免手动刷新；
  // 单独轻拉这一路，不整页 load()（避免全页 loading 闪烁与其余 7 路重复请求）。
  const refreshLinkedProjects = () => {
    listLinkedProjects(workspaceId)
      .then((briefs) => setLinkedProjectNames(briefs.map((b) => b.project_name ?? b.project_id)))
      .catch(() => setLinkedProjectNames(null));
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
      setBoundDaemonOwned(null);
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
        const own = instances.find((i) => i.id === myBinding.daemon_id);
        // quick-4a55e2dc：own 命中=自有 daemon；仅共享候选命中=借用绑定。
        setBoundDaemonOwned(!!own);
        if (own) {
          setBoundDaemon(own);
        } else {
          const shared = (machineCandidates ?? []).find(
            (m) => m.id === myBinding.daemon_id,
          );
          setBoundDaemon(
            shared
              ? {
                  ...shared,
                  display_alias: shared.display_alias ?? shared.hostname,
                  providers:
                    providers.map((p) => ({ provider: p })) as DaemonInstanceRead["providers"],
                }
              : null,
          );
        }
      })
      .catch(() => {
        if (active) {
          setBoundDaemonProviders([]);
          setBoundDaemon(null);
          setBoundDaemonOwned(null);
        }
      });
    return () => {
      active = false;
    };
  }, [myBinding?.daemon_id]);

  const formatTs = (raw: string | null) =>
    raw ? new Date(raw).toLocaleString("zh-CN") : "---";

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

  const basicInfoExtra = editingInfo ? (
    <div className="flex gap-2">
      <Button
        size="sm"
        variant="outline"
        onClick={() => {
          // 取消 = 丢弃草稿回填当前值，退回只读态
          setTypeDraft(workspace.type ?? null);
          setRoleDraft(workspace.role ?? "");
          setDescriptionDraft(workspace.description ?? "");
          setEditingInfo(false);
        }}
        disabled={savingInfo}
      >
        取消
      </Button>
      <Button
        size="sm"
        onClick={handleSaveBasicInfo}
        disabled={savingInfo || !infoDirty}
      >
        {savingInfo ? "保存中..." : "保存"}
      </Button>
    </div>
  ) : (
    <Button size="sm" variant="outline" onClick={() => setEditingInfo(true)}>
      编辑
    </Button>
  );

  // ql-20260820-013 用户反馈：信息区由 ghost Collapse 改回卡片形式（SectionCard
  // 平铺），编辑按钮与折叠头的事件冲突随之消失（原 bug：点"编辑"会同时触发展开收起）。
  const basicInfoBody = (
    <>
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
            {/* 类型/角色/用途：只读态徽标 + 单行截断（R-06），编辑态换下方表单 */}
            <dt className="text-muted-foreground">类型</dt>
            <dd>
              {(() => {
                const badge = workspaceTypeBadge(workspace.type);
                return (
                  <span
                    className={cn(
                      "inline-flex h-5 items-center rounded border px-1.5 text-[10px] font-semibold",
                      badge.className,
                    )}
                  >
                    {badge.label}
                  </span>
                );
              })()}
            </dd>
            <dt className="text-muted-foreground">角色</dt>
            <dd title={workspace.role ?? undefined} className="min-w-0 truncate">
              {workspace.role || "—"}
            </dd>
            <dt className="text-muted-foreground">用途</dt>
            <dd
              title={workspace.description ?? undefined}
              className="min-w-0 truncate"
            >
              {workspace.description || "—"}
            </dd>
          </dl>
          {editingInfo && (
            /* 编辑表单：布局类对齐「默认智能体提供方」卡片的 label+控件+保存按钮
               交互形态（直接可编辑小表单 + 保存，页面无独立编辑路由）。 */
            <div className="mt-3 space-y-2.5 border-t pt-2.5">
              <div className="space-y-1">
                <label className="text-[11px] text-muted-foreground">
                  工作区类型（不选即&ldquo;未分类&rdquo;）
                </label>
                <select
                  value={typeDraft ?? ""}
                  onChange={(e) => setTypeDraft(e.target.value === "" ? null : e.target.value)}
                  className="h-8 w-full rounded border border-input bg-background px-2.5 text-sm focus:border-ring focus:outline-none"
                >
                  <option value="">未分类</option>
                  {WORKSPACE_TYPE_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                  {/* 存量未知旧值：下拉值集合外的当前值,追加原值选项防止 React
                      select 失配回跳第一项（形态对齐 default_agent 离线追加选项）。 */}
                  {typeDraft && !WORKSPACE_TYPE_OPTIONS.some((o) => o.value === typeDraft) && (
                    <option value={typeDraft}>{typeDraft}（存量值）</option>
                  )}
                </select>
              </div>
              <div className="space-y-1">
                <label className="text-[11px] text-muted-foreground">
                  角色（如&ldquo;订单模块&rdquo;，≤100 字符）
                </label>
                <input
                  type="text"
                  value={roleDraft}
                  maxLength={100}
                  onChange={(e) => setRoleDraft(e.target.value)}
                  placeholder="描述这个工作区在项目中的角色"
                  className="h-8 w-full rounded border border-input bg-background px-2.5 text-sm focus:border-ring focus:outline-none"
                />
              </div>
              <div className="space-y-1">
                <label className="text-[11px] text-muted-foreground">
                  用途说明（≤2000 字符）
                </label>
                <textarea
                  value={descriptionDraft}
                  maxLength={2000}
                  rows={3}
                  onChange={(e) => setDescriptionDraft(e.target.value)}
                  placeholder="这个工作区的用途说明"
                  className="w-full resize-y rounded border border-input bg-background p-2.5 text-sm focus:border-ring focus:outline-none"
                />
              </div>
            </div>
          )}
          {/* ql-20260821-004：关联项目简要行（名称列表 + 管理入口开弹层） */}
          <div className="mt-3 flex items-center gap-2 border-t pt-2.5 text-xs">
            <dt className="text-muted-foreground">关联项目</dt>
            <dd className="min-w-0 flex-1 truncate">
              {linkedProjectNames === null ? (
                <span className="text-muted-foreground">—</span>
              ) : linkedProjectNames.length === 0 ? (
                <span className="text-muted-foreground">未关联</span>
              ) : (
                <span className="flex flex-wrap gap-1">
                  {linkedProjectNames.map((name) => (
                    <span
                      key={name}
                      className="inline-flex h-5 items-center rounded border border-brand-200 bg-brand-50 px-1.5 text-[10px] font-semibold text-brand-700"
                    >
                      {name}
                    </span>
                  ))}
                </span>
              )}
            </dd>
            <Button
              variant="outline"
              size="sm"
              className="h-6 shrink-0 px-2 text-xs"
              onClick={() => setProjectsOpen(true)}
            >
              关联 PPM 项目
            </Button>
          </div>
          {/* task-11 / 2026-07-10-remove-server-local-workspace-mode：所有工作区
              均为 daemon-client 语义，WorkspaceDaemonSwitcher 无条件渲染。 */}
          <div className="mt-3 border-t pt-2.5">
            <WorkspaceDaemonSwitcher
              workspaceId={workspaceId}
              currentBinding={myBinding}
              onChanged={() => void load()}
            />
          </div>
    </>
  );

  const defaultAgentBody = (
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
  );

  // 关联 PPM 项目 / 规范工作区配置：两组件自带 SectionCard 外观，直接平铺不套卡。

  return (
    <PageContainer size="full">
      <div className="space-y-4">
        {/* 段①：头部横幅 */}
        <WorkspaceHeroHeader
          workspace={workspace}
          extraActions={
            myBinding && !accessEditing ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setAccessEditing(true)}
                className="h-7 border-white/20 bg-white/10 text-xs text-white hover:bg-white/20 hover:text-white"
                data-testid="binding-edit-entry"
              >
                编辑我的接入配置
              </Button>
            ) : undefined
          }
        />

        {/* 接入配置编辑表单（原 BindingGuard 展开态，保存后收起并刷新） */}
        {accessEditing && myBinding && (
          <WorkspaceAccessGuide
            workspaceId={workspaceId}
            initial={{
              daemon_id: myBinding.daemon_id ?? null,
              root_path: myBinding.root_path,
            } satisfies AccessGuideInitial}
            onConfigured={() => {
              void load();
              setAccessEditing(false);
            }}
          />
        )}

        {pageError && <ErrorBanner message={pageError} />}

        {/* 段②：统计卡行（ql-20260820-013 第四卡=快速修复条数） */}
        <WorkspaceStatsRow
          workspaceId={workspaceId}
          componentCount={componentCount}
          activeChanges={activeChanges}
          archivedChanges={archivedChanges}
          quickTotal={quickTotal}
        />

        {/* 段③-1：基本信息卡片（编辑入口在卡头 extra） */}
        <SectionCard title="基本信息" extra={basicInfoExtra} bodyPadding="p-4">
          {basicInfoBody}
        </SectionCard>

        {/* 段③-2：规范工作区配置全宽（ql-20260821-003 用户指定整行展示） */}
        <WorkspaceConfigCard
          workspace={workspace}
          specWs={specWs}
          myBinding={myBinding}
          boundDaemon={boundDaemon}
          isOwner={isOwner}
          onRefresh={load}
          componentCount={componentCount}
        />

        {/* 段③-3：默认智能体提供方 | 守护进程共享 最下一行两块 */}
        <div className="grid items-start gap-4 lg:grid-cols-2">
          <SectionCard title="默认智能体提供方" bodyPadding="p-4">
            {defaultAgentBody}
          </SectionCard>
          {myBinding && (
            <SectionCard title="守护进程共享" bodyPadding="p-4">
              {/* quick-4a55e2dc：借用绑定（绑的是他人共享 daemon）不能开「共享的
                  共享」——渲染提示替代开关；未绑 daemon（daemon_id null）维持原
                  开关行为（服务端本就不为无 daemon binding 开 grant）。 */}
              {myBinding.daemon_id && boundDaemonOwned === false ? (
                <p className="text-[11px] text-muted-foreground">
                  当前绑定的是他人共享的守护进程（借用），仅自有守护进程可开启共享。
                </p>
              ) : (
                <SharedDaemonToggle
                  workspaceId={workspaceId}
                  shared={myBinding?.shared}
                  daemonLabel={
                    boundDaemon?.display_alias ?? boundDaemon?.hostname ?? null
                  }
                  onChanged={() => void load()}
                />
              )}
            </SectionCard>
          )}
        </div>

        {/* 关联 PPM 项目弹层（ql-20260821-004 入口收敛到基本信息行内按钮）。
            ql-20260824-005-aa13：onChanged 即时回显 + 关闭兜底重拉（覆盖弹层
            开启期间其它入口改动的边缘场景），基本信息「关联项目」行不再陈旧。 */}
        <Modal
          open={projectsOpen}
          title="关联 PPM 项目"
          onCancel={() => {
            setProjectsOpen(false);
            refreshLinkedProjects();
          }}
          footer={null}
          width={680}
          destroyOnHidden
        >
          <LinkedProjectsSection
            workspaceId={workspaceId}
            onChanged={refreshLinkedProjects}
          />
        </Modal>
      </div>
    </PageContainer>
  );
}
