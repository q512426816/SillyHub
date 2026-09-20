"use client";

/**
 * 菜单管理页 /admin/menus（2026-09-18-web-menu-management task-11，FR-02/FR-03）。
 *
 * 设计依据（逐条对照）：
 * - tasks/task-11.md implementation——antd Table 按 MENU_SECTION_ORDER 分组
 *   （组前插 section 标题行，原型 prototype-menu-admin.html 的 section-row 语义）、
 *   rowKey=menuKey、不分页（全量 38 行）、行级即时 PUT 保存（无整页保存按钮）；
 * - design.md「总体方案 Phase 3」——列 = 排序（组内上移/下移）/ 菜单（默认名+路由
 *   小字）/ 显示名（行内编辑+「已改名」+恢复默认）/ 全局隐藏（Switch，menus 行
 *   disabled+🔒 自身不可隐藏，R-03）/ 挂载权限（前 2 个 key 摘要+展开行明细）；
 * - D-002（覆盖全局生效，页面不做角色维度过滤）、D-003（权限区只读——持有角色由
 *   既有 GET /api/admin/roles 的 RoleRead.permissions 客户端反查，无新聚合端点、
 *   无任何修改权限的交互）；
 * - R-05（页头说明条明示「隐藏=全局下架（含平台管理员），按角色开关请前往角色
 *   管理页」）、R-08（listRoles 403 时角色 chips 区降级「需 role:read 查看角色
 *   分布」，不阻塞改名/排序/隐藏主功能）；
 * - 样式遵守 .sillyspec/docs/SillyHub/scan/FRONTEND_PAGE_STYLE.md（§1 骨架四件套 /
 *   §4 DataTable / §5 antd Button / §9 antd message；多主题走 brand-* 阶与
 *   ConfigProvider token，零硬编码 hex），页面骨架对齐 /admin/roles。
 *
 * 保存语义（蓝图「每次操作一次 PUT /api/menu-overrides/{menu_key}」）：
 * 后端 upsert 是整行覆盖写（menu_overrides_service.upsert_override 三维度整体
 * 落库，缺省字段回默认），故每次 PUT 都带该行当前全量三字段（label/sort_order/
 * hidden），仅把本次操作的目标维度改成新值、清除项传 null——既满足蓝图
 * 「清除项传 null 回默认」，又避免改名把已有排序/隐藏覆盖冲掉。成功后失效
 * MENU_OVERRIDES_QUERY_KEY（导航侧 useMenuOverrides 同步重拉，导航即时生效）
 * + antd message 行内 toast；失败中文提示，控件保持可点即为重试入口。
 *
 * 排序算法（蓝图权威）：组内相邻交换——上移/下移 = 目标行与相邻可见行交换生效
 * sort_order，两行各 PUT 一次各自的新值；sort_order 未覆盖行以「注册表声明序
 * 索引」为当前值参与交换（与 mergeMenus 规则 3 的 fallback 同源，整表索引保证
 * 与导航合并层一致）；组首上移/组尾下移按钮 disabled。交换只移动既有值，
 * 值集合不变，多次移动稳定收敛。
 *
 * 本页不改 menu-permissions.ts / menu-overrides.ts / permission.ts / app-shell
 * （归 task-08/09/10），仅只读消费；页面交互测试归 task-12。
 */
import { useCallback, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, Button, Input, Switch, Tag, Tooltip, type TableProps } from "antd";
import { DownOutlined, UpOutlined } from "@ant-design/icons";

import {
  DataTable,
  PageContainer,
  PageHeader,
  SectionCard,
} from "@/components/layout";
import { ApiError, apiFetch } from "@/lib/api";
import { useNotify } from "@/lib/errors";
import { listRoles, type RoleRead } from "@/lib/admin";
import { useSession } from "@/stores/session";
import type { components } from "@/lib/api-types";
import {
  MENU_PERMISSION_GROUPS,
  MENU_SECTION_LABEL,
  MENU_SECTION_ORDER,
  type MenuPermissionGroup,
  type MenuSection,
} from "@/lib/menu-permissions";
import {
  MENU_OVERRIDES_QUERY_KEY,
  useMenuOverrides,
  type MenuOverrideRead,
} from "@/lib/menu-overrides";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

/** PUT body（api-types 生成物；三字段全可空，null = 清除该维度回默认）。 */
type MenuOverrideUpsertBody = components["schemas"]["MenuOverrideUpsert"];

/** PUT 实际发送形态：整行当前全量三字段（见文件头「保存语义」）。 */
interface OverrideRowState {
  label: string | null;
  sort_order: number | null;
  hidden: boolean;
}

/** 菜单数据行（TableRow 的 menu 分支）。 */
interface MenuRow {
  kind: "menu";
  rowKey: string;
  menu: MenuPermissionGroup;
  /** 在 MENU_PERMISSION_GROUPS 全表中的声明序索引（未覆盖行的 sortValue 来源）。 */
  declaredIndex: number;
  override: MenuOverrideRead | undefined;
  /** 生效排序值 = override.sort_order ?? declaredIndex（与 mergeMenus 规则 3 同源）。 */
  sortValue: number;
  /** 组内首位（上移 disabled）/ 组内末位（下移 disabled）。 */
  isFirst: boolean;
  isLast: boolean;
}

/** 分组标题行（TableRow 的 section 分支，colSpan=5 占满整行）。 */
interface SectionRow {
  kind: "section";
  rowKey: string;
  section: MenuSection;
  count: number;
}

type TableRow = SectionRow | MenuRow;

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

/** 菜单管理入口自身（mergeMenus 的 hidden 豁免键，R-03 防自锁）。 */
const MENUS_MENU_KEY = "menus";

/** 后端 list_roles 分页上限 Query(le=100)，反查持有角色需拉全量。 */
const ROLE_PAGE_SIZE = 100;

/** 持有角色反查的查询 key（本页局部；roles 页不走 react-query，无既有 key 可复用）。 */
const ROLES_QUERY_KEY = ["adminRoles", "menuAdminPage"] as const;

/** 路由小字：相对 href 在侧边栏拼 /workspaces/{id}/ 前缀（app-shell），此处省略展示。 */
function routeText(menu: MenuPermissionGroup): string {
  return menu.absolute ? menu.href : `…/${menu.href}`;
}

/** 当前生效显示名 = 覆盖 label ?? 代码默认名（mergeMenus 规则 1）。 */
function effectiveLabel(row: MenuRow): string {
  return row.override?.label ?? row.menu.menuLabel;
}

/** 该行当前全量覆盖状态（PUT 整行发送形态的基底，未覆盖维度取默认）。 */
function currentRowState(row: MenuRow): OverrideRowState {
  return {
    label: row.override?.label ?? null,
    sort_order: row.override?.sort_order ?? null,
    hidden: row.override?.hidden ?? false,
  };
}

/** 拉全量角色（分页 size≤100 翻页拼接；仅反查 permissions，D-003 只读）。 */
async function fetchAllRoles(): Promise<RoleRead[]> {
  const all: RoleRead[] = [];
  let page = 1;
  // 翻页上限 50 页（5000 角色）防御 total 异常时的死循环。
  while (page <= 50) {
    const resp = await listRoles({ page, size: ROLE_PAGE_SIZE });
    all.push(...resp.items);
    if (resp.items.length === 0 || all.length >= resp.total) break;
    page += 1;
  }
  return all;
}

/* ------------------------------------------------------------------ */
/*  页面                                                               */
/* ------------------------------------------------------------------ */

export default function AdminMenusPage() {
  const user = useSession((s) => s.user);
  // 写权限门控（PUT/DELETE 后端 require menu:admin；platform:admin 自动通过）。
  const canWrite = !!user?.is_platform_admin ||
    !!user?.permissions?.includes("menu:admin");

  const notify = useNotify();
  const queryClient = useQueryClient();

  // 覆盖数据（task-09）：导航与管理页共用同一 query，写后 invalidate 双端同步。
  const overridesQuery = useMenuOverrides();
  // 持有角色反查（FR-03/D-003）：403 等失败时 chips 区降级占位（R-08），不阻塞主功能。
  const rolesQuery = useQuery<RoleRead[], ApiError>({
    queryKey: ROLES_QUERY_KEY,
    queryFn: fetchAllRoles,
    staleTime: 60_000,
    retry: false,
  });

  /** 展开的权限明细行（menuKey 集合，受控展开）。 */
  const [expandedKeys, setExpandedKeys] = useState<string[]>([]);
  /** 正在保存的行（串行化写操作：保存中禁用该行控件与全部排序按钮）。 */
  const [savingKey, setSavingKey] = useState<string | null>(null);

  const overrideByKey = useMemo(
    () => new Map(overridesQuery.overrides.map((o) => [o.menu_key, o] as const)),
    [overridesQuery.overrides],
  );

  /** 权限 key → 持有角色名列表（roles[].permissions 客户端 invert，D-003）。 */
  const rolesByPermission = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const role of rolesQuery.data ?? []) {
      for (const perm of role.permissions) {
        const names = map.get(perm);
        if (names) names.push(role.name);
        else map.set(perm, [role.name]);
      }
    }
    return map;
  }, [rolesQuery.data]);

  /**
   * 平铺行数据：按 MENU_SECTION_ORDER 逐组插分组标题行 + 组内按生效排序值
   * 稳定排序的菜单行（与 mergeMenus 规则 3 同算法，页面展示顺序 = 导航合并顺序）。
   */
  const rows = useMemo<TableRow[]>(() => {
    const out: TableRow[] = [];
    for (const section of MENU_SECTION_ORDER) {
      const group: Omit<MenuRow, "kind" | "rowKey" | "isFirst" | "isLast">[] = [];
      MENU_PERMISSION_GROUPS.forEach((menu, declaredIndex) => {
        if (menu.section !== section) return;
        const override = overrideByKey.get(menu.menuKey);
        group.push({
          menu,
          declaredIndex,
          override,
          sortValue: override?.sort_order ?? declaredIndex,
        });
      });
      if (group.length === 0) continue;
      // 现代引擎 Array#sort 稳定，同值保声明序（对齐 mergeMenus）。
      group.sort((a, b) => a.sortValue - b.sortValue);
      out.push({
        kind: "section",
        rowKey: `section:${section}`,
        section,
        count: group.length,
      });
      group.forEach((r, i) => {
        out.push({
          ...r,
          kind: "menu",
          rowKey: r.menu.menuKey,
          isFirst: i === 0,
          isLast: i === group.length - 1,
        });
      });
    }
    return out;
  }, [overrideByKey]);

  /**
   * 行级保存：一次 PUT 整行全量三字段（见文件头「保存语义」），成功后失效
   * MENU_OVERRIDES_QUERY_KEY（导航即时生效）。
   */
  const putOverride = useCallback(
    async (menuKey: string, next: OverrideRowState): Promise<boolean> => {
      const body: MenuOverrideUpsertBody = next;
      setSavingKey(menuKey);
      try {
        await apiFetch<MenuOverrideRead>(
          `/api/menu-overrides/${encodeURIComponent(menuKey)}`,
          { method: "PUT", json: body },
        );
        await queryClient.invalidateQueries({ queryKey: MENU_OVERRIDES_QUERY_KEY });
        return true;
      } catch (err) {
        notify.error(err, "保存失败，请重试");
        return false;
      } finally {
        setSavingKey(null);
      }
    },
    [queryClient, notify],
  );

  /** 行内改名（回车/失焦提交；改回默认名等价清除 label 覆盖回 null）。 */
  const handleRename = useCallback(
    async (row: MenuRow, nextLabel: string) => {
      if (!canWrite) return;
      const trimmed = nextLabel.trim();
      if (!trimmed) {
        notify.warning("显示名不能为空，已取消修改");
        return;
      }
      if (trimmed === effectiveLabel(row)) return; // 无变化不发请求
      const label = trimmed === row.menu.menuLabel ? null : trimmed;
      const ok = await putOverride(row.rowKey, { ...currentRowState(row), label });
      if (ok) {
        notify.success(
          label === null
            ? `「${row.menu.menuLabel}」已恢复默认显示名`
            : `「${trimmed}」显示名已保存`,
        );
      }
    },
    [canWrite, notify, putOverride],
  );

  /** 恢复默认显示名（清 label 覆盖传 null，蓝图「清除项传 null 回默认」）。 */
  const handleResetLabel = useCallback(
    async (row: MenuRow) => {
      if (!canWrite) return;
      const ok = await putOverride(row.rowKey, {
        ...currentRowState(row),
        label: null,
      });
      if (ok) notify.success(`已恢复默认显示名「${row.menu.menuLabel}」`);
    },
    [canWrite, notify, putOverride],
  );

  /** 全局隐藏开关（D-002 全局生效：对所有用户含平台管理员下架）。 */
  const handleToggleHidden = useCallback(
    async (row: MenuRow, hidden: boolean) => {
      const ok = await putOverride(row.rowKey, {
        ...currentRowState(row),
        hidden,
      });
      if (ok) {
        notify.success(
          hidden
            ? `已全局隐藏「${effectiveLabel(row)}」（含平台管理员）`
            : `已恢复显示「${effectiveLabel(row)}」`,
        );
      }
    },
    [notify, putOverride],
  );

  /**
   * 组内相邻交换排序：目标行与相邻行交换生效 sort_order，两行各 PUT 一次各自的
   * 新值（蓝图「未覆盖行以组内声明序索引为当前值」参与交换）。首行 PUT 失败即
   * 中止（错误 toast 已出），成功后行状态经 invalidate 重拉收敛到服务端真值。
   */
  const handleMove = useCallback(
    async (row: MenuRow, dir: -1 | 1) => {
      if (!canWrite) return;
      const idx = rows.findIndex((r) => r.rowKey === row.rowKey);
      if (idx < 0) return;
      const neighbor = rows[idx + dir];
      if (!neighbor || neighbor.kind !== "menu") return; // 组首/组尾双保险
      const label = effectiveLabel(row);
      const okA = await putOverride(row.rowKey, {
        ...currentRowState(row),
        sort_order: neighbor.sortValue,
      });
      if (!okA) return;
      const okB = await putOverride(neighbor.rowKey, {
        ...currentRowState(neighbor),
        sort_order: row.sortValue,
      });
      if (okB) notify.success(`「${label}」组内排序已保存`);
    },
    [canWrite, notify, putOverride, rows],
  );

  const toggleExpanded = (key: string) => {
    setExpandedKeys((prev) =>
      prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key],
    );
  };

  /** 分组标题行占满 5 列：首列 colSpan=5，其余列 colSpan=0。 */
  const sectionCell =
    (span: 5 | 0) =>
    (record: TableRow): { colSpan: number } =>
      record.kind === "section" ? { colSpan: span } : { colSpan: 1 };

  const columns: TableProps<TableRow>["columns"] = [
    {
      title: "排序",
      key: "sort",
      width: 84,
      align: "center",
      onCell: sectionCell(5),
      render: (_v, record) =>
        record.kind === "section" ? (
          <div className="flex items-baseline gap-2 py-0.5">
            <span className="text-xs font-semibold tracking-wide text-foreground">
              {MENU_SECTION_LABEL[record.section]}
            </span>
            <span className="text-[11px] font-normal text-muted-foreground">
              {record.count} 个菜单
            </span>
          </div>
        ) : (
          <div className="flex items-center justify-center gap-0.5">
            <Button
              type="text"
              size="small"
              icon={<UpOutlined />}
              disabled={!canWrite || record.isFirst || savingKey !== null}
              title={
                !canWrite
                  ? "无 menu:admin 权限"
                  : record.isFirst
                    ? "已是组内第一位"
                    : "上移"
              }
              onClick={() => void handleMove(record, -1)}
            />
            <Button
              type="text"
              size="small"
              icon={<DownOutlined />}
              disabled={!canWrite || record.isLast || savingKey !== null}
              title={
                !canWrite
                  ? "无 menu:admin 权限"
                  : record.isLast
                    ? "已是组内最后一位"
                    : "下移"
              }
              onClick={() => void handleMove(record, 1)}
            />
          </div>
        ),
    },
    {
      title: "菜单",
      key: "menu",
      onCell: sectionCell(0),
      render: (_v, record) =>
        record.kind === "menu" && (
          <div className="min-w-0">
            <div className="font-medium text-foreground">
              {record.menu.menuLabel}
              {record.menu.navHidden && (
                <Tag className="ml-1.5">不在侧边栏</Tag>
              )}
            </div>
            <div className="mt-0.5 font-mono text-[11px] text-muted-foreground">
              {routeText(record.menu)}
            </div>
          </div>
        ),
    },
    {
      title: "显示名",
      key: "label",
      width: 240,
      onCell: sectionCell(0),
      render: (_v, record) =>
        record.kind === "menu" && (
          <LabelCell
            row={record}
            canWrite={canWrite}
            saving={savingKey === record.rowKey}
            onRename={(v) => void handleRename(record, v)}
            onReset={() => void handleResetLabel(record)}
          />
        ),
    },
    {
      title: "全局隐藏",
      key: "hidden",
      width: 150,
      align: "center",
      onCell: sectionCell(0),
      render: (_v, record) =>
        record.kind === "menu" &&
        (record.menu.menuKey === MENUS_MENU_KEY ? (
          <Tooltip title="菜单管理入口不可隐藏，防止误操作后无法再进入本页恢复">
            <span className="inline-flex items-center gap-1.5">
              <Switch size="small" checked={false} disabled />
              <span className="text-[11px] text-muted-foreground">
                🔒 自身不可隐藏
              </span>
            </span>
          </Tooltip>
        ) : (
          <Tooltip
            title={
              !canWrite
                ? "无 menu:admin 权限"
                : record.override?.hidden
                  ? "点击恢复显示"
                  : "点击全局隐藏（对所有用户生效，含平台管理员）"
            }
          >
            <Switch
              size="small"
              checked={!!record.override?.hidden}
              disabled={!canWrite || savingKey === record.rowKey}
              loading={savingKey === record.rowKey}
              onChange={(checked) => void handleToggleHidden(record, checked)}
            />
          </Tooltip>
        )),
    },
    {
      title: "挂载权限（只读）",
      key: "perms",
      width: 320,
      onCell: sectionCell(0),
      render: (_v, record) =>
        record.kind === "menu" &&
        (record.menu.permissions.length === 0 ? (
          <span className="text-xs text-muted-foreground">—</span>
        ) : (
          <div className="flex flex-wrap items-center gap-1">
            {record.menu.permissions.slice(0, 2).map((p) => (
              <span
                key={p.key}
                className="rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground"
              >
                {p.key}
              </span>
            ))}
            {record.menu.permissions.length > 2 && (
              <span className="text-[11px] text-muted-foreground">
                +{record.menu.permissions.length - 2}
              </span>
            )}
            <Button
              type="link"
              size="small"
              className="ml-1 h-auto p-0 text-xs"
              onClick={() => toggleExpanded(record.rowKey)}
            >
              {expandedKeys.includes(record.rowKey) ? "收起 ▴" : "展开权限 ▾"}
            </Button>
          </div>
        )),
    },
  ];

  return (
    <PageContainer size="full">
      <PageHeader
        title="菜单管理"
        subtitle="调整菜单显示名、组内排序与全局隐藏（全局生效，改动即时保存）"
      />
      {/* 说明条（R-05 边界）：全局 vs 按角色、即时保存、菜单增删随版本。 */}
      <Alert
        type="info"
        showIcon
        message={
          <span className="text-xs leading-5 text-muted-foreground">
            <span className="font-semibold text-foreground">改动即时保存</span>
            ：每项修改（改名 / 排序 / 隐藏）保存后立即对所有用户生效，无需发版。
            隐藏为<b>全局下架</b>：对所有用户（含平台管理员）生效；按角色开关菜单请前往
            「角色管理」页调整权限分配。菜单本身的新增与删除仍随版本发布（菜单对应页面是代码交付物）。
          </span>
        }
      />
      {/* 覆盖拉取失败（NFR-02 导航侧静默降级，管理页需如实告知，防在假默认值上误覆盖） */}
      {overridesQuery.isError && (
        <div className="rounded border border-destructive/30 bg-red-50 px-3 py-2 text-xs text-destructive">
          菜单覆盖配置加载失败，下方暂按代码默认值展示（保存仍会写入并即时生效）。
          <Button
            size="small"
            className="ml-3"
            onClick={() => void overridesQuery.refetch()}
          >
            重新加载
          </Button>
        </div>
      )}
      <SectionCard bodyPadding="p-2">
        <DataTable<TableRow>
          rowKey="rowKey"
          columns={columns}
          dataSource={rows}
          loading={overridesQuery.isLoading}
          size="small"
          bordered
          scroll={{ x: "max-content" }}
          pagination={false}
          rowClassName={(record) =>
            record.kind === "menu" &&
            !!record.override?.hidden &&
            record.menu.menuKey !== MENUS_MENU_KEY
              ? "opacity-60"
              : ""
          }
          expandable={{
            showExpandColumn: false,
            expandedRowKeys: expandedKeys,
            onExpandedRowsChange: (keys) =>
              setExpandedKeys(keys.map(String)),
            rowExpandable: (record) =>
              record.kind === "menu" && record.menu.permissions.length > 0,
            expandedRowRender: (record) =>
              record.kind === "menu" && (
                <PermissionDetail
                  menu={record.menu}
                  rolesByPermission={rolesByPermission}
                  rolesLoading={rolesQuery.isLoading}
                  rolesDegraded={rolesQuery.isError}
                />
              ),
          }}
          emptyText="菜单注册表为空"
        />
      </SectionCard>
    </PageContainer>
  );
}

/* ------------------------------------------------------------------ */
/*  显示名行内编辑单元格                                                */
/* ------------------------------------------------------------------ */

/**
 * 显示名列：点击当前名进入编辑（回车/失焦提交），已改名行展示「已改名」标记 +
 * 「恢复默认」入口。提交值交父级校验与保存（本组件无网络/通知副作用）。
 */
function LabelCell({
  row,
  canWrite,
  saving,
  onRename,
  onReset,
}: {
  row: MenuRow;
  canWrite: boolean;
  saving: boolean;
  onRename: (_value: string) => void;
  onReset: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  // 回车提交后组件卸载会再触发 onBlur，用 ref 防重复提交。
  const editingRef = useRef(false);

  const overridden = row.override?.label != null;
  const current = effectiveLabel(row);

  const start = () => {
    if (!canWrite || saving) return;
    editingRef.current = true;
    setDraft(current);
    setEditing(true);
  };

  const commit = () => {
    if (!editingRef.current) return;
    editingRef.current = false;
    setEditing(false);
    onRename(draft);
  };

  if (editing) {
    return (
      <Input
        size="small"
        autoFocus
        value={draft}
        maxLength={30}
        style={{ width: 180 }}
        placeholder="1–30 个字符，回车保存"
        onChange={(e) => setDraft(e.target.value)}
        onPressEnter={commit}
        onBlur={commit}
      />
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span
        className={
          canWrite
            ? "cursor-pointer font-medium text-foreground hover:text-brand-700 hover:underline"
            : "cursor-not-allowed font-medium text-foreground"
        }
        onClick={start}
        title={
          canWrite ? "点击修改显示名（回车或失焦保存）" : "无 menu:admin 权限"
        }
      >
        {current}
      </span>
      {overridden && (
        <>
          <Tag className="m-0 border-brand-200 bg-brand-50 text-brand-700">
            已改名
          </Tag>
          <Button
            type="link"
            size="small"
            className="h-auto p-0 text-xs text-muted-foreground"
            disabled={!canWrite || saving}
            title="清除改名覆盖，恢复代码默认名"
            onClick={onReset}
          >
            恢复默认
          </Button>
        </>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  权限明细展开行（D-003 只读铁律：零修改交互）                         */
/* ------------------------------------------------------------------ */

function PermissionDetail({
  menu,
  rolesByPermission,
  rolesLoading,
  rolesDegraded,
}: {
  menu: MenuPermissionGroup;
  rolesByPermission: Map<string, string[]>;
  rolesLoading: boolean;
  /** listRoles 失败（典型 403 无 role:read）→ chips 区降级占位（R-08）。 */
  rolesDegraded: boolean;
}) {
  return (
    <div className="py-1 pr-2">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <span className="text-[11px] text-muted-foreground">
          「{menu.menuLabel}」挂载权限与当前持有角色（只读）
        </span>
        <span className="text-[11px] text-muted-foreground">
          权限的分配与收回请前往「角色管理」页操作
        </span>
      </div>
      <table className="w-full border border-border text-center text-xs">
        <thead className="text-[11px] text-muted-foreground">
          <tr>
            <th className="w-60 border border-border px-2 py-1.5 font-semibold">权限标识</th>
            <th className="w-44 border border-border px-2 py-1.5 font-semibold">中文名</th>
            <th className="border border-border px-2 py-1.5 font-semibold">当前持有角色</th>
          </tr>
        </thead>
        <tbody>
          {menu.permissions.map((p) => {
            const roleNames = rolesByPermission.get(p.key) ?? [];
            return (
              <tr key={p.key}>
                <td className="border border-border/60 px-2 py-1.5">
                  <code className="rounded bg-brand-50 px-1.5 py-0.5 font-mono text-[11px] text-brand-700">
                    {p.key}
                  </code>
                </td>
                <td className="border border-border/60 px-2 py-1.5">{p.name}</td>
                <td className="border border-border/60 px-2 py-1.5">
                  {rolesDegraded ? (
                    <span className="text-[11px] text-muted-foreground">
                      需 role:read 查看角色分布
                    </span>
                  ) : rolesLoading ? (
                    <span className="text-[11px] text-muted-foreground">
                      角色分布加载中…
                    </span>
                  ) : roleNames.length === 0 ? (
                    <Tag className="m-0">暂无角色持有</Tag>
                  ) : (
                    <span className="flex flex-wrap justify-center gap-1">
                      {roleNames.map((name) => (
                        <Tag key={name} className="m-0">
                          {name}
                        </Tag>
                      ))}
                    </span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
