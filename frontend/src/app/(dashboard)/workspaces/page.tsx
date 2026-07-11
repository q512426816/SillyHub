"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { Input, Modal } from "antd";

import { Button, buttonVariants } from "@/components/ui/button";
import { PageContainer, PageHeader } from "@/components/layout";
import { WorkspaceCard, type DaemonBadgeStatus } from "@/components/workspace-card";
import { WorkspaceScanDialog } from "@/components/workspace-scan-dialog";
// task-07 / CB-1：未绑定工作区点击弹窗（task-06 产物，容器化 AccessGuide）。
import { WorkspaceBindingDialog } from "@/components/workspace-binding-dialog";
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
  // task-07 / CB-1：被点击的未绑定工作区，驱动 WorkspaceBindingDialog（task-06）。
  const [bindingTarget, setBindingTarget] = useState<Workspace | null>(null);
  // task-08 / FR-04 / FR-05 / D-003@v1：筛选分页 + 平台管理员人员搜索 + 别名编辑。
  const isPlatformAdmin = useSession((s) => s.user?.is_platform_admin === true);
  const [query, setQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
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
          q: query.trim() || undefined,
          type: typeFilter || undefined,
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
    } catch (err) {
      setItems([]);
      setTotal(0);
      setRuntimesById(new Map());
      setInstancesById(new Map());
      setBindingsByWs(new Map());
      setError(err instanceof ApiError ? err.message : "加载列表失败");
    }
  }, [query, typeFilter, statusFilter, ownerUserId, page, isPlatformAdmin]);

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

  // task-07 / CB-1：卡片整张点击分流。已绑定（daemon_id 非空）→ 进详情；
  // 未绑定（daemon_id null）→ 弹 WorkspaceBindingDialog（task-06）。daemon 离线
  // 仅显示状态不阻断进入（D-005），故只按 daemon_id 是否存在判定，与 online 无关。
  const handleActivate = useCallback(
    (w: Workspace) => {
      const entry = statusMap[w.id];
      const bound = !!entry?.daemon_id;
      if (bound) {
        router.push(`/workspaces/${w.id}`);
      } else {
        setBindingTarget(w);
      }
    },
    [statusMap, router],
  );

  return (
    <PageContainer>
      <PageHeader
        title="选择工作区"
        subtitle="选择一个工作区开始，或在右上角进入平台后台"
        actions={
          <>
            {/* task-07 / D-001：后台旁路入口，任何人可不选工作区直接进（守卫 task-05 白名单放行） */}
            <Link
              href="/admin"
              className={cn(
                buttonVariants({ variant: "ghost", size: "sm" }),
                "text-muted-foreground",
              )}
            >
              平台管理
            </Link>
            <Link
              href="/settings"
              className={cn(
                buttonVariants({ variant: "ghost", size: "sm" }),
                "text-muted-foreground",
              )}
            >
              系统设置
            </Link>
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

      {error && (
        <div className="rounded border border-destructive/30 bg-red-50 px-3 py-2 text-xs text-destructive">
          {error}
        </div>
      )}

      {/* task-08 / FR-04 / FR-05：服务端筛选条 + 平台管理员人员搜索 */}
      {items !== null && (
        <div className="flex flex-wrap items-center gap-2">
          <input
            aria-label="搜索资源"
            placeholder="搜索别名/名称/slug/路径"
            value={query}
            onChange={(e) => updateFilter(setQuery)(e.target.value)}
            className="h-8 min-w-[12rem] flex-1 rounded border bg-card px-2 text-xs"
          />
          <select
            aria-label="筛选类型"
            value={typeFilter}
            onChange={(e) => updateFilter(setTypeFilter)(e.target.value)}
            className="h-8 rounded border bg-card px-2 text-xs"
          >
            <option value="">全部类型</option>
            <option value="daemon-client">Daemon 客户端</option>
          </select>
          <select
            aria-label="筛选状态"
            value={statusFilter}
            onChange={(e) => updateFilter(setStatusFilter)(e.target.value)}
            className="h-8 rounded border bg-card px-2 text-xs"
          >
            <option value="">全部状态</option>
            <option value="active">活跃</option>
            <option value="archived">已归档</option>
            <option value="deleted">已删除</option>
          </select>
          {isPlatformAdmin ? (
            <select
              aria-label="筛选人员"
              value={ownerUserId ?? ""}
              onChange={(e) => updateFilter(setOwnerUserId)(e.target.value || null)}
              className="h-8 rounded border bg-card px-2 text-xs"
            >
              <option value="">全部人员</option>
              {userOptions.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.display_name ?? u.email ?? u.username}
                </option>
              ))}
            </select>
          ) : null}
        </div>
      )}

      {items === null ? (
        <p className="py-8 text-center text-xs text-muted-foreground">加载中…</p>
      ) : items.length === 0 ? (
        // task-07 / D-004 / AC-3：空状态创建引导（虚线框 + 主色「创建工作区」按钮）。
        <div className="flex flex-col items-center gap-2 rounded-md border border-dashed py-14 text-center">
          <div className="text-4xl" aria-hidden>
            📂
          </div>
          <p className="text-sm text-foreground">你还没有任何工作区</p>
          <p className="text-xs text-muted-foreground">
            创建一个工作区开始使用平台，绑定项目仓库后即可进入。
          </p>
          <Button size="sm" onClick={() => setShowDialog(true)} className="mt-1">
            ＋ 创建工作区
          </Button>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {items.map((w) => {
              // 遗留 1：优先按 daemon 实体展示（runtime 绑定下沉到 member binding）。
              const bindingDaemonId = bindingsByWs.get(w.id)?.daemon_id;
              const boundDaemon = bindingDaemonId
                ? instancesById.get(bindingDaemonId) ?? null
                : null;
              return (
                <WorkspaceCard
                  key={w.id}
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

      {/* task-07 / CB-1：未绑定工作区点击 → 弹 daemon 绑定弹窗（task-06 容器化 AccessGuide）。
          绑定成功 onBound → 关窗 + reload 刷新徽标状态（AC-5 / D-003）。 */}
      <WorkspaceBindingDialog
        workspaceId={bindingTarget?.id ?? ""}
        open={bindingTarget !== null}
        onBound={() => {
          setBindingTarget(null);
          void reload();
        }}
        onClose={() => setBindingTarget(null)}
      />
    </PageContainer>
  );
}
