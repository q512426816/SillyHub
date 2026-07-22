"use client";

/**
 * 工作区选择 · 移动视图（task-11 / FR-07 / D-001 / D-003 / D-006 / D-008）。
 *
 * 桌面 antd WorkspaceCard 网格 + 顶部 grid 搜索区 + alias Modal + WorkspaceScanDialog，
 * 在手机重排为 **MobileCardList 卡片列表 + 页内内联筛选 + MobileDetailSheet(创建/别名)
 * + WorkspaceBindingDialog(复用)**，列表功能与桌面对齐（创建/别名/绑定全做，D-008）。
 *
 * 数据层 100% 复用 @/lib（D-003，禁止自写请求）：
 *   - listWorkspaces / updateWorkspace(display_alias) / createWorkspace @/lib/workspaces
 *   - useDaemonStatusMap @/lib/workspace-daemon-status（task-03 单数据源，daemon 徽标三态）
 *   - listDaemonInstances / PROVIDER_META @/lib/daemon（创建表单守护进程下拉）
 *   - listUsers @/lib/admin（平台管理员人员筛选）
 *   - useSession @/stores/session；useNotify / errMessage @/lib/errors
 *
 * 渲染层独立（D-001）：卡片 / 筛选 / 创建/别名表单自绘，不复用桌面
 * (dashboard)/workspaces/** 组件（桌面零回归硬约束）。仅复用纯控件 / 容器：
 *   - WorkspacePathPicker（远程目录选择，无桌面布局依赖）
 *   - WorkspaceBindingDialog（daemon 绑定弹窗，首次绑定逻辑不复制）
 *   - STATUS_LABELS / labelOf @/lib/status-labels（UI 无关文案表）
 *   - normalizeClientPath @/lib/client-path（路径规范化，与桌面创建同源）
 *
 * D-006：工作区详情及之后功能手机端不渲染——点卡片不 router.push('/workspaces/[id]')：
 *   - 已绑定（daemon_id 非空）→ message.info('请在电脑端打开')，不导航
 *   - 未绑定（daemon_id null）→ 唤起 WorkspaceBindingDialog
 *
 * 桌面对照：app/(dashboard)/workspaces/page.tsx（列表/筛选/创建/别名/绑定/daemon 徽标）。
 * 设计依据：.sillyspec/changes/2026-07-22-mobile-app-ui/design.md §5.3 / FR-07 / D-003 / D-006 / D-008。
 *
 * 触摸热区 ≥ 44×44px、正文 ≥ 14px（R-04）。
 * 容器由 task-05 MobileLayoutShell（app/m/layout.tsx）自动包裹。
 */
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { App, Input } from "antd";

import { MobileCardList, type MobileAction } from "@/components/mobile/mobile-card-list";
import { MobileDetailSheet } from "@/components/mobile/mobile-detail-sheet";
import { WorkspaceBindingDialog } from "@/components/workspace-binding-dialog";
import { WorkspacePathPicker } from "@/components/workspace-path-picker";
import { ApiError } from "@/lib/api";
import { normalizeClientPath } from "@/lib/client-path";
import { errMessage, useNotify } from "@/lib/errors";
import {
  listDaemonInstances,
  PROVIDER_META,
  type DaemonInstanceRead,
} from "@/lib/daemon";
import { listUsers, type UserRead } from "@/lib/admin";
import {
  createWorkspace,
  listWorkspaces,
  updateWorkspace,
  type Workspace,
} from "@/lib/workspaces";
import { useDaemonStatusMap } from "@/lib/workspace-daemon-status";
import { STATUS_LABELS, labelOf } from "@/lib/status-labels";
import { useSession } from "@/stores/session";
import { cn } from "@/lib/utils";

// task-11 / FR-07：服务端分页页大小（与桌面 page.tsx PAGE_SIZE 一致）。
const PAGE_SIZE = 12;

// 类型筛选 + 展示标签（对齐桌面 page.tsx 类型筛选项）。
const TYPE_FILTER_OPTIONS = [
  { label: "全部类型", value: "" },
  { label: "Daemon 客户端", value: "daemon-client" },
];
const TYPE_LABELS: Record<string, string> = {
  "daemon-client": "Daemon 客户端",
};

// 状态筛选（对齐桌面 page.tsx 状态筛选项）。
const STATUS_FILTER_OPTIONS = [
  { label: "全部状态", value: "" },
  { label: "活跃", value: "active" },
  { label: "已归档", value: "archived" },
  { label: "已删除", value: "deleted" },
];

// spec 同步策略选项（对齐桌面 WorkspaceScanDialog，源项目已有 .sillyspec 如何进入平台）。
const SPEC_STRATEGY_OPTIONS: Array<{
  value: "platform-managed" | "repo-mirrored" | "repo-native";
  label: string;
}> = [
  { value: "platform-managed", label: "平台托管（默认，不碰源项目，从零扫描）" },
  { value: "repo-mirrored", label: "单次导入（复制源项目 .sillyspec 快照，不污染源项目）" },
  { value: "repo-native", label: "源项目即真理（软链接，扫描直接写源项目）" },
];

// 页内内联筛选控件统一样式（≥44px 触摸热区、≥14px 正文，R-04）。
const FILTER_CONTROL_CLASS =
  "h-11 w-full rounded-[var(--radius-md)] border border-border bg-card px-3 text-[14px] text-foreground";

export default function WorkspacesMobilePage() {
  const notify = useNotify();
  const { message } = App.useApp();
  const isPlatformAdmin = useSession((s) => s.user?.is_platform_admin === true);

  // 列表 + 分页（page 0-based，与桌面同 offset=page*PAGE_SIZE）。
  const [items, setItems] = useState<Workspace[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // 筛选状态（对齐桌面 page.tsx）。
  const [query, setQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [ownerUserId, setOwnerUserId] = useState<string | null>(null);
  const [userOptions, setUserOptions] = useState<UserRead[]>([]);

  // task-07 / FR-06 / R-02：daemon 在线状态聚合（task-03 单数据源），徽标三态消费。
  // statusMap[ws_id] → {daemon_id, online, status}；徽标据此映射 online/offline/unbound。
  const { statusMap } = useDaemonStatusMap();

  // 创建 Sheet。
  const [createOpen, setCreateOpen] = useState(false);
  // 别名 Sheet。
  const [aliasTarget, setAliasTarget] = useState<Workspace | null>(null);
  const [aliasValue, setAliasValue] = useState("");
  const [aliasSaving, setAliasSaving] = useState(false);
  // task-07 / CB-1：未绑定工作区点击 → 唤起 daemon 绑定弹窗（复用桌面 WorkspaceBindingDialog）。
  const [bindingTarget, setBindingTarget] = useState<Workspace | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { items: list, total: count } = await listWorkspaces({
        q: query.trim() || undefined,
        type: typeFilter || undefined,
        status: statusFilter || undefined,
        user_id: isPlatformAdmin ? ownerUserId ?? undefined : undefined,
        limit: PAGE_SIZE,
        offset: page * PAGE_SIZE,
      });
      setItems(list);
      setTotal(count);
    } catch (err) {
      setItems([]);
      setTotal(0);
      setError(err instanceof ApiError ? err.message : "加载列表失败");
    } finally {
      setLoading(false);
    }
  }, [query, typeFilter, statusFilter, ownerUserId, page, isPlatformAdmin]);

  useEffect(() => {
    void reload();
  }, [reload]);

  // task-08 / D-003@v1：平台管理员人员搜索选项；失败降级为空（对齐桌面 page.tsx）。
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

  // 改任一筛选 → 回到第 1 页（对齐桌面 updateFilter）。
  const updateFilter = useCallback(
    <T,>(setter: (v: T) => void) => (v: T) => {
      setter(v);
      setPage(0);
    },
    [],
  );

  // task-07 / FR-06 / R-02：workspace → daemon 徽标三态映射（对齐桌面 daemonStatusOf）。
  // daemon_id=null 或缺失 → 未绑定；否则 online ? online : offline。
  const daemonStatusOf = useCallback(
    (wsId: string): DaemonBadgeStatus => {
      const entry = statusMap[wsId];
      if (!entry || entry.daemon_id === null) return "unbound";
      return entry.online ? "online" : "offline";
    },
    [statusMap],
  );

  // D-006：点卡片分流（禁 router.push('/workspaces/[id]')）。
  //   已绑定（daemon_id 非空）→ message.info('请在电脑端打开')，不导航；
  //   未绑定（daemon_id null）→ 唤起绑定弹窗。
  // daemon 离线仅显示状态不阻断（D-005），故只按 daemon_id 是否存在判定，与 online 无关。
  const handleActivate = useCallback(
    (w: Workspace) => {
      const entry = statusMap[w.id];
      const bound = !!entry?.daemon_id;
      if (bound) {
        message.info("请在电脑端打开");
      } else {
        setBindingTarget(w);
      }
    },
    [statusMap, message],
  );

  // ── 别名编辑（对齐桌面 handleOpenAlias / handleSaveAlias）──
  const openAlias = useCallback((w: Workspace) => {
    setAliasTarget(w);
    setAliasValue(w.display_alias ?? "");
  }, []);

  const handleSaveAlias = useCallback(async () => {
    if (!aliasTarget) return;
    setAliasSaving(true);
    try {
      await updateWorkspace(aliasTarget.id, {
        display_alias: aliasValue.trim() || null,
      });
      notify.success("别名已更新");
      setAliasTarget(null);
      await reload();
    } catch (err) {
      notify.error(err, "更新别名失败");
    } finally {
      setAliasSaving(false);
    }
  }, [aliasTarget, aliasValue, notify, reload]);

  // ── 卡片动作集（D-008：别名编辑进 ActionMenu）──
  const buildActions = useCallback(
    (w: Workspace): MobileAction[] => [
      { key: "alias", label: "编辑别名", onPress: () => openAlias(w) },
    ],
    [openAlias],
  );

  return (
    <div className="flex flex-col gap-3">
      <header className="px-1 pb-1">
        <h1 className="text-[18px] font-semibold text-foreground">选择工作区</h1>
        <p className="text-[12px] text-muted-foreground">
          选择一个工作区开始，或新建并绑定守护进程
        </p>
      </header>

      {error ? (
        <div className="rounded-[var(--radius-md)] border border-destructive/30 bg-red-50 px-3 py-2 text-[13px] text-destructive">
          {error}
          <button
            type="button"
            onClick={() => void reload()}
            className="ml-3 inline-flex min-h-[44px] items-center rounded-[var(--radius-sm)] px-2 text-[14px] font-medium text-blue-600 hover:underline"
          >
            重新加载
          </button>
        </div>
      ) : null}

      <MobileCardList<Workspace>
        items={items}
        itemKey={(w) => w.id}
        emptyText={loading ? "加载中…" : "暂无工作区"}
        onItemPress={handleActivate}
        actions={buildActions}
        pagination={{
          page: page + 1, // 0-based 内部 → 1-based 展示
          pageSize: PAGE_SIZE,
          total,
          onChange: (p) => setPage(Math.max(0, p - 1)),
        }}
        headerActions={
          <>
            <button
              type="button"
              data-testid="mobile-workspace-create"
              onClick={() => setCreateOpen(true)}
              className="inline-flex min-h-[44px] w-full items-center justify-center rounded-[var(--radius-md)] bg-primary px-3 text-[14px] font-medium text-primary-foreground transition-colors hover:opacity-90"
            >
              + 创建工作区
            </button>
            {/* 筛选 q/type/status/owner（页内内联控件，对齐桌面 page.tsx） */}
            <input
              aria-label="搜索工作区"
              placeholder="搜索别名/名称/slug/路径"
              value={query}
              onChange={(e) => updateFilter(setQuery)(e.target.value)}
              className={FILTER_CONTROL_CLASS}
            />
            <div className="grid w-full grid-cols-2 gap-2">
              <select
                aria-label="筛选类型"
                value={typeFilter}
                onChange={(e) => updateFilter(setTypeFilter)(e.target.value)}
                className={cn(FILTER_CONTROL_CLASS, "px-2")}
              >
                {TYPE_FILTER_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
              <select
                aria-label="筛选状态"
                value={statusFilter}
                onChange={(e) => updateFilter(setStatusFilter)(e.target.value)}
                className={cn(FILTER_CONTROL_CLASS, "px-2")}
              >
                {STATUS_FILTER_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
            {isPlatformAdmin ? (
              <select
                aria-label="筛选人员"
                value={ownerUserId ?? ""}
                onChange={(e) => updateFilter(setOwnerUserId)(e.target.value || null)}
                className={cn(FILTER_CONTROL_CLASS, "px-2")}
              >
                <option value="">全部人员</option>
                {userOptions.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.display_name ?? u.email ?? u.username}
                  </option>
                ))}
              </select>
            ) : null}
          </>
        }
        renderCard={(w) => (
          <WorkspaceMobileCard
            workspace={w}
            daemonStatus={daemonStatusOf(w.id)}
          />
        )}
      />

      {/* 创建工作区 Sheet（对齐桌面 WorkspaceScanDialog → createWorkspace） */}
      <WorkspaceCreateSheet
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={() => {
          setCreateOpen(false);
          void reload();
        }}
      />

      {/* 别名编辑 Sheet（对齐桌面 alias Modal → updateWorkspace(id,{display_alias})） */}
      <MobileDetailSheet
        open={aliasTarget !== null}
        title="编辑展示别名"
        onClose={() => setAliasTarget(null)}
        onSubmit={() => void handleSaveAlias()}
        loading={aliasSaving}
        submitText="保存"
      >
        <Input
          value={aliasValue}
          onChange={(e) => setAliasValue(e.target.value)}
          placeholder="留空清除别名，回退原始名称"
          maxLength={200}
          onPressEnter={() => void handleSaveAlias()}
          aria-label="别名输入"
        />
        {aliasTarget?.name ? (
          <p className="mt-2 text-[13px] text-muted-foreground">
            原始名称：{aliasTarget.name}
          </p>
        ) : null}
      </MobileDetailSheet>

      {/* 未绑定工作区 daemon 绑定弹窗（复用桌面 WorkspaceBindingDialog；
          绑定成功 onBound → reload 刷徽标三态，AC-5 / D-003）。 */}
      <WorkspaceBindingDialog
        workspaceId={bindingTarget?.id ?? ""}
        open={bindingTarget !== null}
        onBound={() => {
          setBindingTarget(null);
          void reload();
        }}
        onClose={() => setBindingTarget(null)}
      />
    </div>
  );
}

/* ============================== daemon 徽标三态类型 ============================== */

// 复用桌面 WorkspaceCard 三态语义（online/offline/unbound），就地定义避免跨组件依赖。
type DaemonBadgeStatus = "online" | "offline" | "unbound";

/* ============================== 工作区卡片 ============================== */

/**
 * 工作区卡片主体（替代表格/桌面 WorkspaceCard 一行）。
 *
 * 字段对齐 task-11 验收：别名/名称、slug、类型、工作区状态、daemon 徽标三态
 * （online 绿「守护在线」/ offline 红「守护离线」/ unbound 黄「未绑定」）。
 */
function WorkspaceMobileCard({
  workspace: w,
  daemonStatus,
}: {
  workspace: Workspace;
  daemonStatus: DaemonBadgeStatus;
}) {
  const hasAlias = !!w.display_alias && w.display_alias !== w.name;
  const ownerName = w.owner
    ? (w.owner.display_name ?? w.owner.email ?? null)
    : null;
  const typeLabel = w.type ? (TYPE_LABELS[w.type] ?? w.type) : null;

  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      {/* 行 1：标题（别名/名称） + daemon 徽标三态 */}
      <div className="flex min-w-0 items-center gap-1.5">
        <span
          className="min-w-0 flex-1 truncate text-[15px] font-semibold text-foreground"
          title={w.display_alias ?? w.name}
        >
          {w.display_alias ?? w.name}
        </span>
        <DaemonBadge status={daemonStatus} />
      </div>

      {/* 行 2：原名（有别名校验） + 工作区状态 + 类型 */}
      <div className="flex flex-wrap items-center gap-1.5 text-[12px]">
        {hasAlias ? (
          <span className="truncate text-muted-foreground">原名 {w.name}</span>
        ) : null}
        <span className="rounded bg-muted/60 px-1.5 py-0.5 text-muted-foreground">
          {labelOf(STATUS_LABELS, w.status)}
        </span>
        {typeLabel ? (
          <span className="rounded bg-muted/60 px-1.5 py-0.5 text-muted-foreground">
            {typeLabel}
          </span>
        ) : null}
      </div>

      {/* 行 3：slug（等宽） */}
      <p
        className="truncate font-mono text-[12px] text-muted-foreground"
        title={w.slug}
      >
        {w.slug}
      </p>

      {/* 行 4：负责人 + 未绑定引导（对齐桌面 WorkspaceCard 未绑定提示） */}
      {ownerName ? (
        <p className="text-[12px] text-muted-foreground">负责人：{ownerName}</p>
      ) : null}
      {daemonStatus === "unbound" ? (
        <p className="text-[12px] text-warning">需先配置守护进程，点击配置</p>
      ) : null}
    </div>
  );
}

/**
 * daemon 徽标三态（对齐桌面 WorkspaceCard：online 绿 / offline 红 / unbound 黄 + 圆点）。
 */
function DaemonBadge({ status }: { status: DaemonBadgeStatus }) {
  const map: Record<DaemonBadgeStatus, { dot: string; cls: string; text: string }> = {
    online: {
      dot: "bg-success",
      cls: "border-success/30 bg-success/10 text-success",
      text: "守护在线",
    },
    offline: {
      dot: "bg-destructive",
      cls: "border-destructive/30 bg-destructive/10 text-destructive",
      text: "守护离线",
    },
    unbound: {
      dot: "bg-warning",
      cls: "border-warning/30 bg-warning/10 text-warning",
      text: "未绑定",
    },
  };
  const m = map[status];
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium",
        m.cls,
      )}
    >
      <span
        className={cn("inline-block h-1.5 w-1.5 rounded-full", m.dot)}
        aria-hidden
      />
      {m.text}
    </span>
  );
}

/* ============================== 创建工作区 Sheet ============================== */

/**
 * 创建工作区表单（对齐桌面 WorkspaceScanDialog → createWorkspace）。
 *
 * 字段逐字对齐桌面：daemon 实例下拉 + 项目根路径（WorkspacePathPicker 复用，远程浏览）
 * + 工作区名称（可选，留空取路径末段）+ spec 同步策略。外壳由 MobileDetailSheet 提供，
 * 顶栏「创建工作区」经 onSubmit 触发 handleCreate。
 */
function WorkspaceCreateSheet({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}) {
  const notify = useNotify();
  const [instances, setInstances] = useState<DaemonInstanceRead[]>([]);
  const [daemonId, setDaemonId] = useState("");
  const [rootPath, setRootPath] = useState("");
  const [name, setName] = useState("");
  const [specStrategy, setSpecStrategy] = useState<
    "platform-managed" | "repo-mirrored" | "repo-native"
  >("platform-managed");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 打开时拉守护进程实例列表（对齐桌面 WorkspaceScanDialog useEffect）。
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void listDaemonInstances()
      .then((list) => {
        if (!cancelled) setInstances(list);
      })
      .catch(() => {
        if (!cancelled) setInstances([]);
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  const reset = () => {
    setDaemonId("");
    setRootPath("");
    setName("");
    setSpecStrategy("platform-managed");
    setError(null);
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  const handleCreate = async () => {
    if (!daemonId || !rootPath) {
      setError("请选择守护进程并填写项目路径");
      return;
    }
    const normalizedRoot = normalizeClientPath(rootPath);
    // 对齐桌面：name 留空 → 取路径末段。
    const derivedName =
      name.trim() ||
      normalizedRoot.split(/[\\/]/).filter(Boolean).at(-1) ||
      normalizedRoot;
    setCreating(true);
    setError(null);
    try {
      await createWorkspace({
        name: derivedName,
        root_path: normalizedRoot,
        daemon_id: daemonId,
        spec_strategy: specStrategy,
      });
      notify.success("工作区已创建");
      reset();
      onCreated();
    } catch (err) {
      setError(errMessage(err, "创建失败"));
    } finally {
      setCreating(false);
    }
  };

  return (
    <MobileDetailSheet
      open={open}
      title="创建工作区"
      onClose={handleClose}
      onSubmit={() => void handleCreate()}
      loading={creating}
      submitText="创建工作区"
    >
      <div className="flex flex-col gap-4">
        <p className="text-[13px] text-muted-foreground">
          使用本机守护进程上的项目路径。
        </p>

        <CreateField label="在线守护进程">
          <select
            aria-label="选择守护进程"
            value={daemonId}
            onChange={(e) => setDaemonId(e.target.value)}
            disabled={creating}
            className={cn(FILTER_CONTROL_CLASS, "px-2")}
          >
            <option value="">— 请选择守护进程 —</option>
            {instances.map((inst) => {
              const label = inst.display_alias ?? inst.hostname;
              const providers = inst.providers
                .map((p) => PROVIDER_META[p.provider]?.label ?? p.provider)
                .join(" / ");
              const isOnline = inst.status === "online";
              return (
                <option key={inst.id} value={inst.id} disabled={!isOnline}>
                  {label} · {providers || "无 provider"} ·{" "}
                  {isOnline ? "在线" : "离线"}
                </option>
              );
            })}
          </select>
          {instances.length === 0 ? (
            <p className="mt-1 text-[12px] text-muted-foreground">
              无守护进程，请先启动 sillyhub-daemon。
            </p>
          ) : null}
        </CreateField>

        <CreateField label="项目根路径">
          <WorkspacePathPicker
            daemonId={daemonId}
            value={rootPath}
            onChange={(p) => setRootPath(normalizeClientPath(p))}
            placeholder="C:\\path\\to\\repo"
            disabled={creating}
          />
        </CreateField>

        <CreateField label="工作区名称（可选）">
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="留空使用路径末段"
            disabled={creating}
            aria-label="工作区名称"
          />
        </CreateField>

        <CreateField label="spec 同步策略（源项目已有 .sillyspec 如何进入平台）">
          <div className="flex flex-col gap-1">
            {SPEC_STRATEGY_OPTIONS.map((o) => (
              <label
                key={o.value}
                className="flex min-h-[44px] items-center gap-1.5 text-[13px] text-foreground"
              >
                <input
                  type="radio"
                  checked={specStrategy === o.value}
                  onChange={() => setSpecStrategy(o.value)}
                  disabled={creating}
                />
                {o.label}
              </label>
            ))}
          </div>
          {specStrategy === "repo-native" ? (
            <p className="mt-1 text-[12px] text-amber-600">
              ⚠ 扫描产出会写入源项目 .sillyspec（若被 git 跟踪需自行 commit）。
            </p>
          ) : null}
        </CreateField>

        {error ? <p className="text-[13px] text-destructive">{error}</p> : null}
      </div>
    </MobileDetailSheet>
  );
}

/** 创建表单项外壳：标题在上、控件在下（对齐桌面 Field）。 */
function CreateField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex w-full flex-col gap-1">
      <span className="text-[13px] leading-4 text-muted-foreground">{label}</span>
      {children}
    </div>
  );
}
