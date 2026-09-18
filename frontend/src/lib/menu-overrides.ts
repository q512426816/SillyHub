/**
 * menu-overrides — 菜单显示覆盖合并层（2026-09-18-web-menu-management task-09，FR-05）。
 *
 * 三层管线定位（本文件是第三层，前两层代码一律不动）：
 *   1. 注册表（menu-permissions.ts，task-08 / D-001 单一数据源）——菜单目录、
 *      默认显示名、权限映射的唯一事实来源；
 *   2. 权限过滤（permission.ts，W1 产物）——canSeeMenu / visibleMenusBySection
 *      按用户权限决定显隐，与覆盖合并是两个独立维度；
 *   3. 本文件——拉取全局显示覆盖（GET /api/menu-overrides，仅需认证 R-06），
 *      用纯函数 mergeMenus 把覆盖叠加到注册表之上（label 改名 / hidden 剔除 /
 *      组内排序），不改前两层任何代码。
 *
 * 数据流：导航 = 注册表（menu-permissions.ts） × 权限过滤（permission.ts）
 * × 覆盖合并（本文件 mergeMenus）。app-shell（task-10）渲染前把注册表（或权限
 * 过滤后的子集）经 mergeMenus 叠加覆盖；菜单管理页（task-11）复用
 * useMenuOverrides 展示覆盖现状、写成功后按 MENU_OVERRIDES_QUERY_KEY
 * invalidate 刷新导航。
 *
 * 降级铁律（NFR-02 / FR-05）：覆盖接口 5xx / 网络错误 / 首帧加载中，overrides
 * 一律回退空数组——mergeMenus 空覆盖直通，导航渲染与未配置覆盖时逐项一致，
 * 渲染层永不因覆盖接口故障抛错或空白。
 *
 * 类型全部取 api-types.ts 生成物（task-07 gen:types 产出），禁手写重复接口；
 * 注意 MenuOverrideRead 对外字段名为 label（schema 层映射模型列
 * label_override，见 api-types.ts schema 描述）。
 */
import { useQuery } from "@tanstack/react-query";
import { ApiError, apiFetch } from "@/lib/api";
import type { components } from "@/lib/api-types";
import type { MenuPermissionGroup, MenuSection } from "@/lib/menu-permissions";

/* ------------------------------------------------------------------ */
/*  Types（api-types 生成物单一来源，再导出供 task-10/11/12 消费）        */
/* ------------------------------------------------------------------ */

/** 单条菜单覆盖：menu_key / label（= 模型列 label_override）/ sort_order / hidden。 */
export type MenuOverrideRead = components["schemas"]["MenuOverrideRead"];

/** GET 列表响应包装 { items }（仓库 list 响应惯例）。 */
export type MenuOverrideListResponse =
  components["schemas"]["MenuOverrideListResponse"];

/* ------------------------------------------------------------------ */
/*  Query key + fetch（管理页写后据此 invalidate）                       */
/* ------------------------------------------------------------------ */

/**
 * 覆盖查询 key。本文件内联声明、不进 lib/query-keys.ts 集中工厂——保持
 * task-09 单文件交付面（allowed_paths 仅本文件）。菜单管理页（task-11）
 * PUT/DELETE 成功后据此 invalidate，导航侧 useMenuOverrides 随之重拉刷新。
 */
export const MENU_OVERRIDES_QUERY_KEY = ["menuOverrides"] as const;

/**
 * 拉全量菜单覆盖（menu_key 升序），返回 items。
 * GET /api/menu-overrides 仅需认证（R-06：内容为全局显示配置，无敏感信息）；
 * 只拉差异覆盖，不引入后端菜单目录拉取或本地持久化（D-001）。
 */
export async function fetchMenuOverrides(): Promise<MenuOverrideRead[]> {
  const resp = await apiFetch<MenuOverrideListResponse>("/api/menu-overrides");
  return resp.items;
}

/* ------------------------------------------------------------------ */
/*  Hook（导航侧与管理页共用）                                          */
/* ------------------------------------------------------------------ */

/**
 * 菜单覆盖查询（导航侧 app-shell 与菜单管理页共用）。
 *
 * - staleTime 30s：显示配置低频变更，导航多组件挂载共享一次拉取，不反复打接口；
 * - 降级语义（NFR-02 / FR-05）：queryFn 抛错（5xx / 网络错误 / 超时）或首帧
 *   isLoading 时 data 为 undefined，overrides 回退空数组——渲染层永不因覆盖
 *   接口故障抛错或空白；空覆盖经 mergeMenus 直通 = 注册表默认渲染。
 */
export function useMenuOverrides() {
  const q = useQuery<MenuOverrideRead[], ApiError>({
    queryKey: MENU_OVERRIDES_QUERY_KEY,
    queryFn: fetchMenuOverrides,
    staleTime: 30_000,
  });
  return {
    /** 覆盖列表；失败 / 加载中恒为空数组（直通降级，勿在此之上区分错误态渲染导航） */
    overrides: q.data ?? [],
    isLoading: q.isLoading,
    isFetching: q.isFetching,
    isError: q.isError,
    error: q.error,
    refetch: q.refetch,
  };
}

/* ------------------------------------------------------------------ */
/*  mergeMenus 纯函数                                                   */
/* ------------------------------------------------------------------ */

/**
 * R-03：菜单管理页自身的 menuKey——hidden 覆盖恒豁免。防自锁：管理入口若可被
 * 隐藏，一旦误操作将无人能再进管理页恢复（注册表条目由 task-08 登记）。
 */
const MENUS_MENU_KEY = "menus";

/**
 * 注册表 × 覆盖纯合并（design「接口定义」四规则，逐条对应实现）：
 *
 * 1. label = override.label ?? menuLabel——label 为 null 表示用代码默认名；
 *    后端校验 label 1–30 字符，非空字符串才可能覆盖到这里；
 * 2. hidden = true 的行剔除；menuKey === "menus" 恒豁免不剔除（R-03 防自锁，
 *    该行的 label / 排序覆盖仍正常生效）；
 * 3. 组内（同 section）按 sort_order ?? 声明序索引稳定排序——同值保持声明序；
 *    section 之间顺序不动；
 * 4. 孤儿 override（registry 无此 menuKey）在按 key 索引时天然查不到，
 *    自然忽略（后端不校验注册表存在性，R-01）。
 *
 * 纯函数边界：不 mutate 入参（覆盖 label 时浅拷贝新对象，未覆盖行复用原引用）、
 * 不触网络与 React 生命周期；navHidden 过滤仍归渲染管线（app-shell），
 * 本函数不重复处理；权限过滤（permission.ts）与覆盖合并两维度独立，
 * 本函数不做任何权限判断。
 *
 * 输入形态兼容：整表（MENU_PERMISSION_GROUPS，section 连续块）或单 section
 * 子集（visibleMenusBySection 输出）均可——分桶按 section 首次出现顺序拼接，
 * 对 section 连续输入即输入原顺序。
 */
export function mergeMenus(
  registry: MenuPermissionGroup[],
  overrides: MenuOverrideRead[],
): MenuPermissionGroup[] {
  // 按 menuKey 建覆盖索引（menu_overrides.menu_key 唯一；重复行理论上不存在，
  // 后行覆盖前行，无害）。规则 4：registry 无此 key 的覆盖永远不会被查询到。
  const overrideByKey = new Map(
    overrides.map((o) => [o.menu_key, o] as const),
  );

  /** 分桶中间结构：section → 带声明序索引的存活行（Map 保插入序）。 */
  const buckets = new Map<
    MenuSection,
    Array<{
      menu: MenuPermissionGroup;
      /** 在 registry 中的位置（过滤子集仍保有相对声明序，等价可用） */
      declaredIndex: number;
      override: MenuOverrideRead | undefined;
    }>
  >();

  registry.forEach((menu, declaredIndex) => {
    const override = overrideByKey.get(menu.menuKey);
    // 规则 2：hidden 剔除 + menus 恒豁免（R-03）
    if (override?.hidden && menu.menuKey !== MENUS_MENU_KEY) return;
    let bucket = buckets.get(menu.section);
    if (!bucket) {
      bucket = [];
      buckets.set(menu.section, bucket);
    }
    bucket.push({ menu, declaredIndex, override });
  });

  const merged: MenuPermissionGroup[] = [];
  for (const bucket of buckets.values()) {
    // 规则 3：sortValue = override.sort_order ?? 声明序索引。sort 作用于 map
    // 产生的新数组（不碰入参）；现代引擎 Array#sort 稳定，同值保声明序，
    // 未覆盖行 sortValue = 自身索引天然唯一、与覆盖值同号时也按声明序在前。
    bucket
      .map((entry) => ({
        entry,
        sortValue: entry.override?.sort_order ?? entry.declaredIndex,
      }))
      .sort((a, b) => a.sortValue - b.sortValue)
      .forEach(({ entry }) => {
        const { menu, override } = entry;
        // 规则 1：label 覆盖（null = 用默认名，复用原对象引用）
        merged.push(
          override?.label != null
            ? { ...menu, menuLabel: override.label }
            : menu,
        );
      });
  }
  return merged;
}
