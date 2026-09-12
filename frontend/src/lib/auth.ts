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
    // 头像（2026-09-10-account-avatar-upload）：UserRead.avatar 本就可空可选，原样透传。
    avatar: me.user.avatar,
  });
  return me;
}

export async function login(account: string, password: string, captchaToken?: string) {
  const pair = await apiFetch<TokenPair>("/api/auth/login", {
    method: "POST",
    json: { account, password, captcha_token: captchaToken },
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

/**
 * 用户自助更新头像（PATCH /api/auth/me/avatar，2026-09-10-account-avatar-upload）。
 *
 * 前端契约：avatar 传新 URL（设置）或 null（清除）。后端 body 三态语义为
 * 值=设置、空串 ''=清除置 NULL、null/缺省=不改——因此清除时映射为空串下发，
 * 发字面 null 会被后端当「不改」静默忽略。
 *
 * 成功后 best-effort 重跑 fetchMe() 写回 store（复用其 snake→camel 降级合并，
 * 防映射逻辑双份漂移）。刷新失败**不上抛**：PATCH 已成功（新头像已绑定），
 * 若把刷新失败当保存失败抛出，调用方 catch 会误回收刚绑定成功的新文件
 * （桌面/移动账号页的孤儿兜底删除，H-3）；store 短暂滞后由下次任意
 * fetchMe/页面加载自然收敛。
 */
export async function updateMyAvatar(avatar: string | null): Promise<void> {
  await apiFetch<void>("/api/auth/me/avatar", {
    method: "PATCH",
    json: { avatar: avatar ?? "" },
  });
  try {
    await fetchMe();
  } catch (err) {
    console.warn("[auth] 头像保存成功但 fetchMe 刷新失败（store 可能短暂滞后）", err);
  }
}

// 点按式人机确认(登录爆破防护;原拖拉滑块已下线)。类型复用 OpenAPI 生成类型
// (backend/app/modules/auth/schema.py 的 ConfirmCaptchaResponse / CaptchaVerifyResponse)。
export type ConfirmCaptchaData = components["schemas"]["ConfirmCaptchaResponse"];
export type CaptchaVerifyResult = components["schemas"]["CaptchaVerifyResponse"];

export async function fetchConfirmCaptcha(): Promise<ConfirmCaptchaData> {
  return apiFetch<ConfirmCaptchaData>("/api/auth/captcha/confirm");
}

export async function verifyConfirmCaptcha(
  captchaId: string,
): Promise<CaptchaVerifyResult> {
  return apiFetch<CaptchaVerifyResult>("/api/auth/captcha/verify", {
    method: "POST",
    json: { captcha_id: captchaId },
  });
}
