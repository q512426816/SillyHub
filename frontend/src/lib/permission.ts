import type { SessionUser } from "@/stores/session";
import type { MenuPermissionGroup, MenuSection } from "@/lib/menu-permissions";
import { MENU_PERMISSION_GROUPS } from "@/lib/menu-permissions";

const ADMIN_PERMISSION_PREFIXES = ["user:", "organization:", "role:"] as const;

/**
 * @deprecated 按功能前缀（user:/organization:/role:）判断的旧 helper，
 * 已被 `canSeeMenu` / `visibleMenusBySection` 取代。新代码请勿调用，
 * 后续清理任务会移除所有引用。
 *
 * 替代方案：
 *   visibleMenusBySection(user, "admin").length > 0
 *   // 或对单个菜单精确判断
 *   canSeeMenu(user, usersMenuGroup)
 */
export function hasAdminPermission(user: SessionUser | null): boolean {
  if (!user) return false;
  if (user.is_platform_admin) return true;
  const perms = user.permissions ?? [];
  return perms.some((p) =>
    ADMIN_PERMISSION_PREFIXES.some((prefix) => p.startsWith(prefix)),
  );
}

/**
 * 判断用户是否拥有给定权限列表中的任意一项。
 *
 * - user 为 null → false
 * - user.is_platform_admin === true → true（短路，无视 perms）
 * - 否则：perms 与 user.permissions 有交集 → true
 */
export function hasAnyPermission(
  user: SessionUser | null,
  perms: string[],
): boolean {
  if (!user) return false;
  if (user.is_platform_admin) return true;
  const userPerms = user.permissions ?? [];
  if (userPerms.length === 0) return false;
  if (perms.length === 0) return false;
  const set = new Set(userPerms);
  return perms.some((p) => set.has(p));
}

/**
 * 判断用户是否能看到指定菜单。
 *
 * - user 为 null → false（未登录一律不可见）
 * - user.is_platform_admin === true → true（短路）
 * - 否则：group.permissions 中任一 key 在 user.permissions 中 → true
 */
export function canSeeMenu(
  user: SessionUser | null,
  group: MenuPermissionGroup,
): boolean {
  return hasAnyPermission(user, group.permissions.map((p) => p.key));
}

/**
 * 返回某 section 下用户可见的全部菜单（保持 MENU_PERMISSION_GROUPS 声明顺序）。
 *
 * - user.is_platform_admin === true → 该 section 全部菜单
 * - 否则：过滤后只保留 canSeeMenu 为 true 的菜单
 * - user 为 null → 空数组
 */
export function visibleMenusBySection(
  user: SessionUser | null,
  section: MenuSection,
): MenuPermissionGroup[] {
  return MENU_PERMISSION_GROUPS.filter((g) => g.section === section).filter(
    (g) => canSeeMenu(user, g),
  );
}
