"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { listLinkedProjects, type PpmProjectBrief } from "@/lib/workspace";
import { Input, Modal, Select } from "antd";

import { Button, buttonVariants } from "@/components/ui/button";
import { PageContainer, PageHeader, SectionCard } from "@/components/layout";
import { ErrorBanner } from "@/components/ui/error-banner";
import { EmptyState } from "@/components/ui/empty-state";
import { FolderGit2 } from "lucide-react";
import { WorkspaceCard, type DaemonBadgeStatus } from "@/components/workspace-card";
import { WorkspaceScanDialog } from "@/components/workspace-scan-dialog";
import { ApiError } from "@/lib/api";
import {
  listDaemonInstances,
  listDaemonRuntimes,
  type DaemonInstanceRead,
  type DaemonRuntimeRead,
} from "@/lib/daemon";
import { listUsers, type UserRead } from "@/lib/admin";
import {
  listWorkspaces,
  updateWorkspace,
  type Workspace,
} from "@/lib/workspaces";
// task-06 / 2026-08-18-workspace-role-type / FR-04 / D-005@v1：
// 筛选下拉接 8 值受控词表 + 「未分类」项（null → ?unclassified=true 谓词）。
import {
  UNCLASSIFIED_OPTION,
  WORKSPACE_TYPE_OPTIONS,
  type WorkspaceType,
} from "@/lib/workspace-types";
import { fetchMyBindings } from "@/lib/workspace-binding";
// task-07 / FR-06 / R-02：daemon 在线状态聚合（task-03 产物），单数据源供徽标消费。
import { useDaemonStatusMap } from "@/lib/workspace-daemon-status";
import { useNotify } from "@/lib/errors";
import { useSession } from "@/stores/session";
import { cn } from "@/lib/utils";

// task-08 / FR-04：服务端分页页大小。
const PAGE_SIZE = 12;

export default function WorkspacesPage() {
  const router = useRouter();
  const [items, setItems] = useState<Workspace[] | null>(null);
  // ql-20260821-007：逐卡关联项目（并行拉取，失败静默空——展示性信息）
  const [projectsByWs, setProjectsByWs] = useState<Map<string, PpmProjectBrief[]>>(new Map());
  const [runtimesById, setRuntimesById] = useState<Map<string, DaemonRuntimeRead>>(
    () => new Map(),
  );
  // 遗留 1（daemon-entity-binding）：按 daemon 实体展示。新工作区 runtime 绑定
  // 在 member binding 行；instancesById 提供 daemon 实体，bindingsByWs 提供 workspace→daemon_id。
  const [instancesById, setInstancesById] = useState<Map<string, DaemonInstanceRead>>(
    () => new Map(),
  );
  const [bindingsByWs, setBindingsByWs] = useState<Map<string, { daemon_id: string | null }>>(
    () => new Map(),
  );
  const [error, setError] = useState<string | null>(null);
  const [showDialog, setShowDialog] = useState(false);
  // task-08 / FR-04 / FR-05 / D-003@v1：筛选分页 + 平台管理员人员搜索 + 别名编辑。
  const isPlatformAdmin = useSession((s) => s.user?.is_platform_admin === true);
  const [query, setQuery] = useState("");
  // 第六批：搜索框防抖——输入即时回显(query)，reload 用 debouncedQuery，
  // 避免每次按键触发 4 路后端请求（"project" 8 键原本 32 次请求 → 现 4 次）。
  const [debouncedQuery, setDebouncedQuery] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(query), 300);
    return () => clearTimeout(t);
  }, [query]);
  // task-06 / FR-04 / D-005@v1：类型筛选换 8 值词表 + 「未分类」（UNCLASSIFIED 语义）。
  // null=全部 / "unclassified"=type IS NULL（走 ?unclassified=true，不传 type）/
  // 8 值词表之一=?type= 等值匹配（后端 Literal 校验）。旧值 daemon-client 已废弃删除。
  const [typeFilter, setTypeFilter] = useState<WorkspaceType | "unclassified" | null>(null);
  const [statusFilter, setStatusFilter] = useState("");
  const [ownerUserId, setOwnerUserId] = useState<string | null>(null);
  const [userOptions, setUserOptions] = useState<UserRead[]>([]);
  const [page, setPage] = useState(0);
  const [total, setTotal] = useState(0);
  const [aliasEditing, setAliasEditing] = useState<Workspace | null>(null);
  const [aliasValue, setAliasValue] = useState("");
  const [aliasSaving, setAliasSaving] = useState(false);
  const notify = useNotify();

  // task-07 / FR-06 / R-02：daemon 在线状态聚合（task-03 单数据源），
  // statusMap[ws_id] → {daemon_id, online, status}。徽标据此映射三态。
  const { statusMap } = useDaemonStatusMap();

  const reload = useCallback(async () => {
    setError(null);
    try {
      const [
        { items: list, total: count },
        runtimes,
        instances,
        bindings,
      ] = await Promise.all([
        listWorkspaces({
          q: debouncedQuery.trim() || undefined,
          // task-06 / D-005@v1：未分类走 unclassified 谓词且不传 type（互斥，同传 422）；
          // 具体类型走 type 等值匹配；null=全部（两参都不传）。
          type: typeFilter && typeFilter !== "unclassified" ? typeFilter : undefined,
          unclassified: typeFilter === "unclassified" ? true : undefined,
          status: statusFilter || undefined,
          user_id: isPlatformAdmin ? ownerUserId ?? undefined : undefined,
          limit: PAGE_SIZE,
          offset: page * PAGE_SIZE,
        }),
        listDaemonRuntimes().catch(() => [] as DaemonRuntimeRead[]),
        listDaemonInstances().catch(() => [] as DaemonInstanceRead[]),
        fetchMyBindings(),
      ]);
      setItems(list);
      setTotal(count);
      setRuntimesById(new Map(runtimes.map((runtime) => [runtime.id, runtime])));
      setInstancesById(new Map(instances.map((inst) => [inst.id, inst])));
      setBindingsByWs(
        new Map(
          bindings.map((b) => [b.workspace_id, { daemon_id: b.daemon_id ?? null }]),
        ),
      );
      // ql-20260821-007：卡片关联项目 tag（并行，单卡失败不拖累整页）
      void Promise.all(
        list.map((w) =>
          listLinkedProjects(w.id).catch(() => [] as PpmProjectBrief[]),
        ),
      ).then((perWs) => {
        setProjectsByWs(new Map(list.map((w, i) => [w.id, perWs[i]!])));
      });
    } catch (err) {
      setItems([]);
      setProjectsByWs(new Map());
      setTotal(0);
      setRuntimesById(new Map());
      setInstancesById(new Map());
      setBindingsByWs(new Map());
      setError(err instanceof ApiError ? err.message : "加载列表失败");
    }
  }, [debouncedQuery, typeFilter, statusFilter, ownerUserId, page, isPlatformAdmin]);

  useEffect(() => {
    void reload();
  }, [reload]);

  // task-08 / D-003@v1：平台管理员人员搜索选项；失败降级为空。
  useEffect(() => {
    if (!isPlatformAdmin) return;
    let cancelled = false;
    listUsers({ limit: 50 })
      .then((resp) => {
        if (!cancelled) setUserOptions(resp.items);
      })
      .catch(() => {
        if (!cancelled) setUserOptions([]);
      });
    return () => {
      cancelled = true;
    };
  }, [isPlatformAdmin]);

  const updateFilter = useCallback(
    <T,>(setter: (v: T) => void) => (v: T) => {
      setter(v);
      setPage(0);
    },
    [],
  );

  const handleCreated = async () => {
    setShowDialog(false);
    await reload();
  };

  const handleOpenAlias = useCallback((workspace: Workspace) => {
    setAliasEditing(workspace);
    setAliasValue(workspace.display_alias ?? "");
  }, []);

  const handleSaveAlias = useCallback(async () => {
    if (!aliasEditing) return;
    setAliasSaving(true);
    try {
      await updateWorkspace(aliasEditing.id, {
        display_alias: aliasValue.trim() || null,
      });
      notify.success("别名已更新");
      setAliasEditing(null);
      await reload();
    } catch (err) {
      notify.error(err, "更新别名失败");
    } finally {
      setAliasSaving(false);
    }
  }, [aliasEditing, aliasValue, notify, reload]);

  // task-07 / FR-06 / R-02：workspace → daemon 徽标三态映射。
  // statusMap 由 useDaemonStatusMap 聚合（task-03），daemon_id=null 或缺失→未绑定。
  const daemonStatusOf = useCallback(
    (wsId: string): DaemonBadgeStatus => {
      const entry = statusMap[wsId];
      if (!entry || entry.daemon_id === null) return "unbound";
      return entry.online ? "online" : "offline";
    },
    [statusMap],
  );

  // 2026-07-26-ungate-workspace-entry / FR-01 / D-001：门禁后移，卡片点击一律进详情，
  // 不再按 daemon 绑定状态分流。daemon 绑定降级为概览页可选配置（WorkspaceConfigCard），
  // daemon 依赖功能（runtime/scan-docs/components）在各自页面内联空态引导。
  const handleActivate = useCallback(
    (w: Workspace) => {
      router.push(`/workspaces/${w.id}`);
    },
    [router],
  );

  return (
    <PageContainer size="full">
      <PageHeader
        title="选择工作区"
        subtitle="选择一个工作区开始，或在右上角进入平台后台"
        actions={
          <>
            {/* ql-20260821-007：平台管理/系统设置入口已删（用户反馈无用，顶部菜单另有入口）。 */}
            {!showDialog && (
              <Button size="sm" onClick={() => setShowDialog(true)}>
                + 添加工作区
              </Button>
            )}
          </>
        }
      />

      {showDialog && (
        <WorkspaceScanDialog
          onCreated={handleCreated}
          onCancel={() => setShowDialog(false)}
        />
      )}

      {error && <ErrorBanner message={error} />}

      {/* task-08 / FR-04 / FR-05：服务端筛选条 + 平台管理员人员搜索 */}
      {items !== null && (
        // ql-20260821-007：筛选控件换 antd（原生 select 观感差，antd 主题统一）。
        <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-card p-2 shadow-sm">
          <Input
            allowClear
            aria-label="搜索资源"
            placeholder="搜索别名/名称/slug/路径"
            value={query}
            onChange={(e) => updateFilter(setQuery)(e.target.value)}
            className="min-w-[12rem] flex-1"
            size="small"
          />
          <Select
            aria-label="筛选类型"
            value={typeFilter ?? ""}
            onChange={(v) =>
              updateFilter(setTypeFilter)(
                v === ""
                  ? null
                  : v === "unclassified"
                    ? "unclassified"
                    : (v as WorkspaceType),
              )
            }
            className="min-w-[7.5rem]"
            size="small"
            options={[
              { value: "", label: "全部类型" },
              ...WORKSPACE_TYPE_OPTIONS.map((o) => ({ value: o.value, label: o.label })),
              { value: "unclassified", label: UNCLASSIFIED_OPTION.label },
            ]}
          />
          <Select
            aria-label="筛选状态"
            value={statusFilter}
            onChange={(v) => updateFilter(setStatusFilter)(v)}
            className="min-w-[7rem]"
            size="small"
            options={[
              { value: "", label: "全部状态" },
              { value: "active", label: "活跃" },
              { value: "archived", label: "已归档" },
              { value: "deleted", label: "已删除" },
            ]}
          />
          {isPlatformAdmin ? (
            <Select
              aria-label="筛选人员"
              value={ownerUserId ?? ""}
              onChange={(v) => updateFilter(setOwnerUserId)(v || null)}
              className="min-w-[7.5rem]"
              size="small"
              options={[
                { value: "", label: "全部人员" },
                ...userOptions.map((u) => ({
                  value: u.id,
                  label: u.display_name ?? u.email ?? u.username,
                }))
              ]}
            />
          ) : null}
        </div>
      )}

      {items === null ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3" aria-busy="true" aria-label="加载中">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-44 rounded-lg border bg-card shadow-sm">
              <div className="border-b px-4 py-3"><div className="sh-skeleton h-4 w-1/2" /></div>
              <div className="space-y-2 p-4">
                <div className="sh-skeleton h-3 w-3/4" />
                <div className="sh-skeleton h-3 w-2/3" />
                <div className="sh-skeleton h-3 w-1/2" />
              </div>
            </div>
          ))}
        </div>
      ) : items.length === 0 ? (
        // task-07 / D-004 / AC-3：空状态创建引导（虚线框 + 主色「创建工作区」按钮）。
        <SectionCard bodyPadding="p-0">
          <EmptyState
            icon={<FolderGit2 className="h-6 w-6" />}
            title="你还没有任何工作区"
            description="创建一个工作区开始使用平台，绑定项目仓库后即可进入。"
            action={
              <Button size="sm" onClick={() => setShowDialog(true)}>
                ＋ 创建工作区
              </Button>
            }
          />
        </SectionCard>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
            {items.map((w) => {
              // 遗留 1：优先按 daemon 实体展示（runtime 绑定下沉到 member binding）。
              const bindingDaemonId = bindingsByWs.get(w.id)?.daemon_id;
              const boundDaemon = bindingDaemonId
                ? instancesById.get(bindingDaemonId) ?? null
                : null;
              return (
                <WorkspaceCard
                  key={w.id}
                  linkedProjects={projectsByWs.get(w.id) ?? []}
                  workspace={w}
                  /* task-11 / 2026-07-10-remove-server-local-workspace-mode：
                   * 平台统一 daemon-client 语义后，WorkspaceCard 的 runtime 维度
                   * 已下沉到 per-member binding，此处透 null 安全（prop 是否由
                   * task-10 组件群移除待协调）。 */
                  boundRuntime={null}
                  boundDaemon={boundDaemon}
                  daemonStatus={daemonStatusOf(w.id)}
                  onChanged={reload}
                  onEditAlias={handleOpenAlias}
                  onActivate={() => handleActivate(w)}
                />
              );
            })}
          </div>
          {/* task-08 / FR-04：服务端分页器 */}
          <div className="flex items-center justify-between gap-2 pt-1">
            <span className="text-[11px] text-muted-foreground">
              共 {total} 条 · 第 {page + 1} 页
            </span>
            <div className="flex items-center gap-1.5">
              <Button
                size="sm"
                variant="outline"
                disabled={page === 0}
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                aria-label="上一页"
              >
                上一页
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={(page + 1) * PAGE_SIZE >= total}
                onClick={() => setPage((p) => p + 1)}
                aria-label="下一页"
              >
                下一页
              </Button>
            </div>
          </div>
        </>
      )}

      {/* task-08 / FR-03：别名编辑 modal */}
      <Modal
        title="编辑展示别名"
        open={aliasEditing !== null}
        onOk={handleSaveAlias}
        onCancel={() => setAliasEditing(null)}
        okText="保存"
        cancelText="取消"
        confirmLoading={aliasSaving}
        okButtonProps={{ disabled: aliasSaving }}
        destroyOnClose
      >
        <Input
          value={aliasValue}
          onChange={(e) => setAliasValue(e.target.value)}
          placeholder="留空清除别名，回退原始名称"
          maxLength={200}
          onPressEnter={handleSaveAlias}
          aria-label="别名输入"
        />
        {aliasEditing?.name ? (
          <p className="mt-2 text-xs text-muted-foreground">原始名称：{aliasEditing.name}</p>
        ) : null}
      </Modal>

    </PageContainer>
  );
}
