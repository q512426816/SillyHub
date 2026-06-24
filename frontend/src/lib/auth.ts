import { apiFetch } from "@/lib/api";
import { ensureFreshAccessToken } from "@/lib/token-refresh";
import { useSession, type SessionTokens } from "@/stores/session";

export interface TokenPair {
  access_token: string;
  refresh_token: string;
  token_type: "bearer";
  access_expires_in: number;
  refresh_expires_in: number;
}

export interface MeResponse {
  user: {
    id: string;
    email: string;
    display_name: string | null;
    is_platform_admin?: boolean;
  };
  workspaces: Array<{
    workspace_id: string;
    role_key: string;
    role_name: string;
  }>;
  permissions?: string[];
}

export async function fetchMe(): Promise<MeResponse> {
  const me = await apiFetch<MeResponse>("/api/auth/me");
  useSession.getState().setUser({
    id: me.user.id,
    email: me.user.email,
    displayName: me.user.display_name ?? me.user.email,
    is_platform_admin: me.user.is_platform_admin ?? false,
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

export async function refreshTokens(): Promise<SessionTokens> {
  const { refreshToken } = useSession.getState();
  if (!refreshToken) {
    throw new Error("Missing refresh token");
  }

  // 复用 token-refresh 模块级 inflight,与 apiFetch / ppm-export 三处共用同一次刷新,
  // 避免本函数与并发 401 各发一次 refresh 触发 reuse-attack。
  const newAccess = await ensureFreshAccessToken();
  if (!newAccess) {
    throw new Error("刷新失败:请重新登录");
  }

  // 单飞成功已写回 store,从 store 读回完整 token 对,保持 SessionTokens 返回契约。
  const { accessToken, refreshToken: newRefresh } = useSession.getState();
  return { accessToken, refreshToken: newRefresh };
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

