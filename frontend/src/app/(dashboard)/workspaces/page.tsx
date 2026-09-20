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
// task-09：WorkspaceCard 本体已由 WorkspaceDragGrid 内部渲染（cardPropsOf
// 仅组装 props），此处只留徽标状态类型（daemonStatusOf 返回值）。
import type { DaemonBadgeStatus } from "@/components/workspace-card";
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
  moveWorkspace,
  probeWorkspaces,
  updateWorkspace,
  WORKSPACE_PAGE_SIZE,
  type Workspace,
} from "@/lib/workspaces";
// task-09 / FR-04 / FR-06：拖拽排序网格（task-08 产物）+「移动到…」弹窗。
import { WorkspaceDragGrid, type WorkspaceCardSlotProps } from "@/components/workspace-drag-grid";
import {
  WorkspaceMoveDialog,
  type WorkspaceMoveTarget,
} from "@/components/workspace-move-dialog";
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
  const [bindingsByWs, setBindingsByWs] = useState<Map<string, { daemon_id: string | null; root_path: string | null }>>(
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
  // ql-20260829-008：默认只展示活跃工作区（archived 归档行不再默认入列）；
  // 筛选器可选「全部状态」查看归档/删除等非活跃行。
  const [statusFilter, setStatusFilter] = useState("active");
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

  // ql-20260918-012：Git 地址识别——列表加载后补一发批量 probe（实时读
  // daemon 侧 git remote 并回填 DB），失败/403 静默——展示性信息，卡片回退
  // DB repo_url（对齐逐卡关联项目的异步补数模式）。
  const [repoUrlByWs, setRepoUrlByWs] = useState<Map<string, string>>(new Map());
  useEffect(() => {
    if (!items || items.length === 0) return;
    let cancelled = false;
    probeWorkspaces(items.map((w) => w.id))
      .then((probed) => {
        if (!cancelled) {
          setRepoUrlByWs(
            new Map(
              probed
                .filter((p) => p.repo_url)
                .map((p) => [p.workspace_id, p.repo_url as string]),
            ),
          );
        }
      })
      .catch(() => {
        /* 无 WORKSPACE_WRITE 权限（403）或探测失败——静默，不渲染地址行 */
      });
    return () => {
      cancelled = true;
    };
  }, [items]);

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
          // task-09 / R-08：分页大小换 task-07 单一源常量（与后端 move
          // page_size 默认值同源），本地 PAGE_SIZE 已删。
          limit: WORKSPACE_PAGE_SIZE,
          offset: page * WORKSPACE_PAGE_SIZE,
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
          bindings.map((b) => [
            b.workspace_id,
            // ql-20260920-007：一并保留 root_path 供卡片「客户端路径」显示本人路径（D-004）。
            { daemon_id: b.daemon_id ?? null, root_path: b.root_path ?? null },
          ]),
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

  // task-09 / D-005@v2 / FR-07：筛选禁拖判定——与 reload 同源的筛选状态派生
  // （debouncedQuery 非空 / 类型筛选含「未分类」/ 状态非 active / 平台管理员
  // 人员筛选）。管理员 include_deleted=true（含删除视图）同属非默认视图：
  // 当前页未单独暴露该参量（删除行走 status="deleted" 已被下方 status 判断
  // 覆盖），未来单独暴露时在此同一表达式补判。
  const filtersActive =
    debouncedQuery.trim() !== "" ||
    typeFilter !== null ||
    statusFilter !== "active" ||
    (isPlatformAdmin && ownerUserId !== null);

  // task-09 / FR-06：「移动到…」弹窗状态（被移动工作区 + 提交中标记）。
  const [moveTargetWs, setMoveTargetWs] = useState<Workspace | null>(null);
  const [moveSubmitting, setMoveSubmitting] = useState(false);

  // task-09 / FR-04：网格卡片 props 组装器——原 items.map 内的 WorkspaceCard
  // 接线整体下沉（workspace 与拖拽手柄挂点由 WorkspaceDragGrid 注入）。
  // 遗留 1：优先按 daemon 实体展示（runtime 绑定下沉到 member binding）。
  const cardPropsOf = useCallback(
    (w: Workspace): WorkspaceCardSlotProps => {
      const bindingDaemonId = bindingsByWs.get(w.id)?.daemon_id;
      const boundDaemon = bindingDaemonId
        ? instancesById.get(bindingDaemonId) ?? null
        : null;
      return {
        linkedProjects: projectsByWs.get(w.id) ?? [],
        // task-11 / 2026-07-10-remove-server-local-workspace-mode：runtime 维度
        // 已下沉到 per-member binding，透 null 安全。
        boundRuntime: null,
        boundDaemon,
        daemonStatus: daemonStatusOf(w.id),
        // ql-20260918-012：probe 实时识别值优先，DB repo_url 兜底。
        repoUrl: repoUrlByWs.get(w.id) ?? w.repo_url ?? null,
        // ql-20260920-007：客户端路径显示本人 binding 路径（未绑定→引导文案）。
        myRootPath: bindingsByWs.get(w.id)?.root_path ?? null,
        onChanged: reload,
        onEditAlias: handleOpenAlias,
        onActivate: () => handleActivate(w),
      };
    },
    [
      bindingsByWs,
      instancesById,
      projectsByWs,
      repoUrlByWs,
      daemonStatusOf,
      reload,
      handleOpenAlias,
      handleActivate,
    ],
  );

  // task-09 / FR-04 / FR-06：拖拽/弹窗移动成功闭环——按响应 rank 换算目标页
  // 自动翻页（reload 依赖 page，setPage 触发 effect 重拉）；同页时 setPage
  // 同值不触发 effect，手动 reload 收敛服务端真序。
  const handleMoved = useCallback(
    ({ page: targetPage }: { page: number }) => {
      if (targetPage !== page) setPage(targetPage);
      else void reload();
    },
    [page, reload],
  );

  // task-09 / FR-07 / D-005@v2：「移动到…」入口——筛选态拦截（不弹窗不发出
  // move 请求，中文提示），默认视图直接打开弹窗。
  const handleRequestMove = useCallback(
    (w: Workspace) => {
      if (filtersActive) {
        notify.warning("筛选状态下不可拖拽排序，请先清除筛选");
        return;
      }
      setMoveTargetWs(w);
    },
    [filtersActive, notify],
  );

  // task-09 / FR-06 / D-009@v2：弹窗提交流程——先拉目标页默认视图（不带任何
  // 筛选参数）算边界锚点，再按方向规则四象限发 move：
  //   页首——向上 before_id=目标页第一张 / 向下 after_id=目标页第一张；
  //   页尾对偶（最后一张）；目标页=当前页时页首走 before、页尾走 after
  //   （统一为「向上（含同页页首）before / 向下（含同页页尾）after」）；
  //   锚点=被移动卡自身时跳过请求（自锚服务端 422 的前置兜底）。
  const handleMoveConfirm = useCallback(
    async (target: WorkspaceMoveTarget) => {
      if (!moveTargetWs) return;
      setMoveSubmitting(true);
      try {
        const { items: targetItems } = await listWorkspaces({
          status: "active",
          limit: WORKSPACE_PAGE_SIZE,
          offset: target.page * WORKSPACE_PAGE_SIZE,
        });
        const anchor =
          target.position === "first"
            ? targetItems[0]
            : targetItems[targetItems.length - 1];
        if (!anchor) {
          // 防御：目标页为空（分页总数失配等）——不给锚点就不发 move。
          notify.error(new Error("目标页不存在工作区"), "移动工作区失败");
          return;
        }
        if (anchor.id === moveTargetWs.id) {
          // 自锚：工作区已在目标位置，跳过请求直接提示成功。
          notify.success("工作区已在该位置");
          setMoveTargetWs(null);
          return;
        }
        const useBefore =
          target.page === page ? target.position === "first" : target.page < page;
        const resp = await moveWorkspace(moveTargetWs.id, {
          ...(useBefore ? { before_id: anchor.id } : { after_id: anchor.id }),
          page_size: WORKSPACE_PAGE_SIZE,
        });
        setMoveTargetWs(null);
        notify.success("已移动到目标页");
        handleMoved({ page: Math.floor(resp.rank / WORKSPACE_PAGE_SIZE) });
      } catch (err) {
        notify.error(err, "移动工作区失败");
      } finally {
        setMoveSubmitting(false);
      }
    },
    [moveTargetWs, notify, page, handleMoved],
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
          {/* task-09 / D-005@v2 / FR-07：筛选禁拖提示（对照原型 .drag-disabled-tip，
              warning 语义阶不硬编码 hex）——任一筛选激活即显示。 */}
          {filtersActive ? (
            <div className="w-full pt-0.5 text-xs text-warning" role="note">
              ⚠ 筛选状态下不可拖拽排序——清除筛选后恢复拖拽手柄
            </div>
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
          {/* task-09 / FR-04 / FR-06：items.map 卡片网格换 WorkspaceDragGrid
              （task-08 产物）——卡片 props 经 cardPropsOf 透传，筛选态禁拖
              （D-005@v2），移动成功翻页重拉、失败刷新收敛服务端真序。 */}
          <WorkspaceDragGrid
            items={items}
            page={page}
            total={total}
            cardProps={cardPropsOf}
            dragDisabled={filtersActive}
            onRequestMove={handleRequestMove}
            onMoved={handleMoved}
            onMoveFailed={() => void reload()}
          />
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
                disabled={(page + 1) * WORKSPACE_PAGE_SIZE >= total}
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

      {/* task-09 / FR-06 / D-009@v2：「移动到…」弹窗（目标页按默认视图分页
          N=ceil(total/WORKSPACE_PAGE_SIZE)；筛选态确认禁用兜底）。 */}
      <WorkspaceMoveDialog
        open={moveTargetWs !== null}
        workspace={moveTargetWs}
        currentPage={page}
        totalPages={Math.max(1, Math.ceil(total / WORKSPACE_PAGE_SIZE))}
        disabled={filtersActive}
        confirmLoading={moveSubmitting}
        onConfirm={handleMoveConfirm}
        onCancel={() => setMoveTargetWs(null)}
      />

    </PageContainer>
  );
}
