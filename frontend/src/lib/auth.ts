import { apiFetch } from "@/lib/api";
import { ensureFreshAccessToken } from "@/lib/token-refresh";
import { useSession, type SessionTokens } from "@/stores/session";
import type { components } from "@/lib/api-types";

// 类型从 OpenAPI 自动生成（@/lib/api-types，由 scripts/gen-api-types.mjs 产出），
// 消除手写类型漂移。后端 schema 来源：backend/app/modules/auth/schema.py。
export type TokenPair = components["schemas"]["TokenPair"];
export type MeResponse = components["schemas"]["MeResponse"];

export async function fetchMe(): Promise<MeResponse> {
  const me = await apiFetch<MeResponse>("/api/auth/me");
  // schema 的 UserRead 中 email/username/display_name 均可空（登录允许 username-only），
  // 而 SessionUser 的 email/displayName 为非空 string，这里做降级合并保证类型诚实。
  useSession.getState().setUser({
    id: me.user.id,
    email: me.user.email ?? me.user.username ?? "",
    displayName:
      me.user.display_name ?? me.user.email ?? me.user.username ?? "",
    is_platform_admin: me.user.is_platform_admin,
    permissions: me.permissions ?? [],
  });
  return me;
}

export async function login(account: string, password: string) {
  const pair = await apiFetch<TokenPair>("/api/auth/login", {
    method: "POST",
    json: { account, password },
  });

  useSession.getState().setTokens({
    accessToken: pair.access_token,
    refreshToken: pair.refresh_token,
  });

  await fetchMe();

  return pair;
}

export async function logout(): Promise<void> {
  const { refreshToken, accessToken } = useSession.getState();
  if (!refreshToken) {
    useSession.getState().clear();
    return;
  }

  try {
    // We still call logout with current tokens; auth endpoints require access.
    await fetch(`/api/auth/logout`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        Authorization: accessToken ? `Bearer ${accessToken}` : "",
      },
      body: JSON.stringify({ refresh_token: refreshToken }),
    });
  } finally {
    useSession.getState().clear();
  }
}

/**
 * 用户自助修改密码：验证旧密码后更新，并撤销该用户其他设备的登录会话。
 * 改密成功后当前 access_token 在有效期内仍可用，其他设备需重新登录。
 */
export async function changePassword(
  oldPassword: string,
  newPassword: string,
): Promise<void> {
  await apiFetch<void>("/api/auth/change-password", {
    method: "POST",
    json: { old_password: oldPassword, new_password: newPassword },
  });
}
