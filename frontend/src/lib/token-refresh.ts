/**
 * Single-flight access-token refresh.
 *
 * 多个并发调用者(如同时收到 401 的 N 个请求、AppShell 主动续期、auth.ts)共享同一次
 * `/api/auth/refresh` 的结果,避免并发刷新命中后端 reuse-attack 导致误吊销全部 session。
 *
 * 仅负责"发起一次刷新 + 写回 store";具体哪个调用点触发由 task-08(三处 401 收口)与
 * task-09(AppShell 主动刷新)决定。
 */
import { useSession, type SessionTokens } from "@/stores/session";
import { ApiError, getApiBaseUrl } from "@/lib/api";

/** 模块级单飞 Promise:存在时所有新调用复用它,而非发起新请求。 */
let inflight: Promise<SessionTokens | null> | null = null;

/**
 * 刷新请求超时（ql-20260917-005）：apiFetch 的 30s GET 超时只覆盖原请求、
 * 不覆盖这里的刷新等待——连接僵死（挂起不回包）时 inflight 永久挂起，
 * 401 收口 await 它的调用方（变更文件树等）会永久停在加载态。
 * 超时抛 ApiError(timeout) 交既有调用方 catch 链展示错误；不清会话、
 * 不强制跳登录（区别于 refresh 失败的 clear+redirect），用户可重试自愈。
 */
const REFRESH_TIMEOUT_MS = 15_000;

/**
 * 确保拿到一个"尽可能新鲜"的 access token:若当前没有进行中的刷新则发起一次,
 * 否则等待已进行中的刷新完成。并发调用只触发 **1 次** `POST /api/auth/refresh`。
 *
 * @returns 新的 access token;无法刷新(未登录 / 未 hydrate / refresh 失败)时返回 null。
 */
export async function ensureFreshAccessToken(): Promise<string | null> {
  const { refreshToken, hydrated } = useSession.getState();
  // 未登录或 store 尚未 hydrate(persist 异步):不猜测 refresh token,直接放行给上层处理。
  if (!refreshToken || !hydrated) return null;

  // 已有进行中的刷新:复用,不再发起新请求(单飞核心)。
  if (inflight) {
    const shared = await inflight;
    return shared?.accessToken ?? null;
  }

  // 没有进行中的刷新:发起一次。
  inflight = doRefresh();
  try {
    const tokens = await inflight;
    if (tokens) {
      useSession.getState().setTokens(tokens);
    }
    return tokens?.accessToken ?? null;
  } finally {
    // 无论成功/失败/异常,都清空 inflight,避免后续调用永远 await 一个已 settle 的 Promise。
    inflight = null;
  }
}

/** 实际发起 refresh 请求。返回新 token 对,失败返回 null(不抛,交由调用方判定);
 * 超时抛 ApiError(timeout)(ql-20260917-005,防僵死挂起)。 */
async function doRefresh(): Promise<SessionTokens | null> {
  const { refreshToken } = useSession.getState();
  if (!refreshToken) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REFRESH_TIMEOUT_MS);
  let resp: Response;
  try {
    resp = await fetch(`${getApiBaseUrl()}/api/auth/refresh`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ refresh_token: refreshToken }),
      signal: controller.signal,
    });
  } catch (err) {
    // 仅超时转 ApiError；其余网络异常保持既有传播行为（调用方 catch 展示，会话不清）
    if (controller.signal.aborted) {
      throw new ApiError(0, {
        code: "timeout",
        message: "登录状态续期超时，请重试",
        request_id: null,
        details: null,
      });
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
  if (!resp.ok) return null;

  const pair = (await resp.json()) as {
    access_token: string;
    refresh_token: string;
  };
  return {
    accessToken: pair.access_token,
    refreshToken: pair.refresh_token,
  };
}

/**
 * 解析 JWT 的 exp / iat(仅读 payload,**不验签**)。前端只用于推算剩余 TTL。
 *
 * @returns `{ exp, iat }`(均为秒级 Unix 时间戳);token 格式非法时返回 null(不抛)。
 */
export function decodeJwtExp(
  token: string,
): { exp: number; iat: number } | null {
  try {
    const parts = token.split(".");
    if (parts.length < 2) return null;
    // JWT payload 是 base64url:补齐 padding,把 -_ 还原成 +/ 后用 atob 解。
    // parts.length>=2 已保证 parts[1] 存在,但 noUncheckedIndexedAccess 下需显式断言。
    const payloadB64url = parts[1]!;
    const payloadB64 = payloadB64url.replace(/-/g, "+").replace(/_/g, "/");
    const pad = payloadB64.length % 4 === 0 ? "" : "=".repeat(4 - (payloadB64.length % 4));
    // atob 在所有现代浏览器 + Node 16+ 均可用,跨平台(AC-08)。
    const json =
      typeof atob === "function"
        ? atob(payloadB64 + pad)
        : Buffer.from(payloadB64 + pad, "base64").toString("utf-8");
    const claims = JSON.parse(json) as { exp?: number; iat?: number };
    if (typeof claims.exp !== "number" || typeof claims.iat !== "number") {
      return null;
    }
    return { exp: claims.exp, iat: claims.iat };
  } catch {
    // 格式异常 / 非 JWT / base64 损坏:静默返回 null,调用方(task-09)跳过主动刷新。
    return null;
  }
}
