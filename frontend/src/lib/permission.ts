import type { SessionUser } from "@/stores/session";

const ADMIN_PERMISSION_PREFIXES = ["user:", "organization:", "role:"] as const;

export function hasAdminPermission(user: SessionUser | null): boolean {
  if (!user) return false;
  if (user.is_platform_admin) return true;
  const perms = user.permissions ?? [];
  return perms.some((p) =>
    ADMIN_PERMISSION_PREFIXES.some((prefix) => p.startsWith(prefix)),
  );
}
