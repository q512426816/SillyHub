import { apiFetch } from "@/lib/api";
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

export async function login(email: string, password: string) {
  const pair = await apiFetch<TokenPair>("/api/auth/login", {
    method: "POST",
    json: { email, password },
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

  const pair = await apiFetch<TokenPair>("/api/auth/refresh", {
    method: "POST",
    json: { refresh_token: refreshToken },
  });

  const tokens = {
    accessToken: pair.access_token,
    refreshToken: pair.refresh_token,
  };
  useSession.getState().setTokens(tokens);
  return tokens;
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

