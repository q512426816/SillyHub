/**
 * Thin fetch wrapper used by all API calls.
 *
 * - Always sends `x-request-id` so server-side logs can be correlated.
 * - Throws `ApiError` (with `code` / `details`) instead of plain `Error`.
 */
import { useSession } from "@/stores/session";
import { ensureFreshAccessToken } from "@/lib/token-refresh";

/** Absolute backend URL — used only for SSR / direct server-side fetches. */
const SERVER_API_BASE_URL = (
  process.env.INTERNAL_API_BASE_URL ??
  process.env.NEXT_PUBLIC_API_BASE_URL ??
  "http://localhost:8000"
).replace(/\/$/, "");

/**
 * When running in the browser, use a relative URL so requests go through
 * the Next.js rewrite proxy (/api/* → backend).  This keeps the app
 * accessible from any origin (frp tunnel, LAN, localhost) without
 * hard-coding the backend address in the client bundle.
 */
function resolveUrl(path: string): URL {
  if (path.startsWith("http")) return new URL(path);
  if (typeof window !== "undefined") return new URL(path, window.location.origin);
  return new URL(path, SERVER_API_BASE_URL);
}

/** Public getter so other modules (e.g. EventSource helpers) can resolve the backend origin. */
export function getApiBaseUrl(): string {
  if (typeof window !== "undefined") return window.location.origin;
  return SERVER_API_BASE_URL;
}

function isAuthEndpoint(pathname: string): boolean {
  return pathname.startsWith("/api/auth/");
}

export interface ApiErrorPayload {
  code: string;
  message: string;
  request_id: string | null;
  details: unknown;
}

export class ApiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly requestId: string | null;
  readonly details: unknown;

  constructor(status: number, payload: ApiErrorPayload) {
    super(payload.message);
    this.name = "ApiError";
    this.status = status;
    this.code = payload.code;
    this.requestId = payload.request_id;
    this.details = payload.details;
  }
}

/** Safe UUID generator — crypto.randomUUID is only available in secure contexts (HTTPS/localhost). */
export function safeUUID(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `id-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function generateRequestId(): string {
  return safeUUID();
}

/**
 * 非 JSON 错误体（典型：后端重启窗口网关返回的 502/504 HTML）的中文兜底文案。
 * resp.statusText 是英文技术串（"Bad Gateway"），不能透给用户（errMessage D-006 铁律）。
 */
const HTTP_STATUS_FALLBACK_MESSAGES: Record<number, string> = {
  502: "网关错误（服务可能正在重启），请稍后重试",
  503: "服务暂不可用，请稍后重试",
  504: "网关超时，请稍后重试",
};

export interface ApiRequestOptions extends Omit<RequestInit, "headers" | "body"> {
  headers?: Record<string, string>;
  json?: unknown;
  query?: Record<string, string | number | boolean | undefined | null | string[]>;
  /**
   * 请求超时（毫秒）。到时 abort 底层 fetch 并抛 `code="timeout"` 的
   * ApiError（status=0）。ql-20260831-006-6d67：inject 等写操作专用——防
   * 后端劣化/网络挂起时请求无限 pending、前端占位轮永远「排队中」无兜底；
   * 缺省不设（读操作沿用无超时语义零回归）。调用方自带 `signal` 的外部
   * abort 仍走原 network_error 映射（streamSession resync 静默依赖它）。
   *
   * quick 群聊卡加载修复（2026-09-03）：读请求（GET/HEAD，method 缺省即 GET）
   * 缺省套 30s 默认超时——后端容器重建期前端代理连接可能长时间挂起（无
   * HTTP 响应也无网络错误），查询 isLoading 恒真导致「加载中」永不退出；
   * 超时后抛 status=0 ApiError，交由 query-client retry（status=0 可重试）
   * 自愈或落失败态。写请求仍需调用方显式传 timeoutMs（防慢写被误杀重发）。
   */
  timeoutMs?: number;
  /** 超时 ApiError 的用户可见文案（错误横幅直接展示 message；缺省通用文案）。 */
  timeoutMessage?: string;
}

export async function apiFetch<T = unknown>(
  path: string,
  options: ApiRequestOptions = {},
): Promise<T> {
  const { json, query, headers = {}, timeoutMs, timeoutMessage, ...rest } = options;

  const url = resolveUrl(path);
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v === undefined || v === null || v === "") continue;
      if (Array.isArray(v)) {
        // 数组用重复 key 编码:?k=a&k=b (FastAPI Query(list[...]) 默认接收)
        if (v.length === 0) continue;
        url.searchParams.delete(k);
        for (const item of v) url.searchParams.append(k, String(item));
      } else {
        url.searchParams.set(k, String(v));
      }
    }
  }

  const finalHeaders: Record<string, string> = {
    accept: "application/json",
    "x-request-id": headers["x-request-id"] ?? generateRequestId(),
    ...headers,
  };

  // Attach bearer token if the client has one.
  const { accessToken } = useSession.getState();
  if (accessToken) finalHeaders.Authorization = `Bearer ${accessToken}`;

  const init: RequestInit = { ...rest, headers: finalHeaders };
  if (json !== undefined) {
    finalHeaders["content-type"] = "application/json";
    init.body = JSON.stringify(json);
  }

  // ql-20260831-006-6d67：可选超时。合并调用方自带 signal——外部 abort 走原
  // network_error 语义（abort 原因区分：timedOut 只由超时计时器置位）。
  // quick 群聊卡加载修复：读请求缺省 30s 超时（见 ApiRequestOptions.timeoutMs 注释）。
  const method = String(rest.method ?? "GET").toUpperCase();
  const effectiveTimeoutMs =
    timeoutMs ?? (method === "GET" || method === "HEAD" ? 30_000 : undefined);
  const timeoutController = new AbortController();
  let timedOut = false;
  const externalSignal = rest.signal;
  const onExternalAbort = (): void => {
    timeoutController.abort();
  };
  if (externalSignal) {
    if (externalSignal.aborted) onExternalAbort();
    else externalSignal.addEventListener("abort", onExternalAbort, { once: true });
  }
  const timeoutTimer =
    effectiveTimeoutMs != null
      ? setTimeout(() => {
          timedOut = true;
          timeoutController.abort();
        }, effectiveTimeoutMs)
      : null;
  init.signal = timeoutController.signal;

  let resp: Response;
  try {
    resp = await fetch(url.toString(), init);
  } catch (err) {
    if (timedOut) {
      throw new ApiError(0, {
        code: "timeout",
        message: timeoutMessage ?? "请求超时，请重试",
        request_id: finalHeaders["x-request-id"] ?? null,
        details: null,
      });
    }
    throw new ApiError(0, {
      code: "network_error",
      message: err instanceof Error ? err.message : "Network error",
      request_id: finalHeaders["x-request-id"] ?? null,
      details: null,
    });
  } finally {
    if (timeoutTimer !== null) clearTimeout(timeoutTimer);
    if (externalSignal) externalSignal.removeEventListener("abort", onExternalAbort);
  }

  const text = await resp.text();
  const payload: unknown = text ? safeJsonParse(text) : null;

  if (!resp.ok) {
    const errorPayload: ApiErrorPayload =
      isApiErrorPayload(payload)
        ? payload
        : {
            code: `http_${resp.status}`,
            message:
              HTTP_STATUS_FALLBACK_MESSAGES[resp.status] ??
              `请求失败（HTTP ${resp.status}）`,
            request_id: resp.headers.get("x-request-id"),
            details: payload,
          };
    // Token expired? Try refresh+retry once.
    if (
      resp.status === 401 &&
      !String(finalHeaders["x-auth-retry"] ?? "").includes("1") &&
      !isAuthEndpoint(url.pathname)
    ) {
      // 单飞刷新:并发 401 风暴由 token-refresh 模块级 inflight 保证只发 1 次
      // POST /api/auth/refresh 并写回 store;未登录/未 hydrate/refresh 失败均返回 null。
      const newToken = await ensureFreshAccessToken();
      if (newToken) {
        // 拿到新 access token,带 x-auth-retry:1 重试一次(防单请求无限重试)。
        // 新 token 已由 ensureFreshAccessToken() 写回 store,重试时 apiFetch 内部从 store
        // 读取并组装 Authorization 头(与原内联 refresh 后 setTokens 再重试的行为一致)。
        return apiFetch<T>(path, {
          ...options,
          headers: { ...headers, "x-auth-retry": "1" },
          json,
          query,
        });
      }
      // 单飞失败(未登录 / refresh 失败 / 未 hydrate):清 session + 跳 login,行为与原实现一致。
      useSession.getState().clear();
      if (typeof window !== "undefined") {
        window.location.href = "/login";
      }
    }

    throw new ApiError(resp.status, errorPayload);
  }

  return payload as T;
}

function safeJsonParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function isApiErrorPayload(v: unknown): v is ApiErrorPayload {
  return (
    typeof v === "object" &&
    v !== null &&
    "code" in v &&
    "message" in v &&
    typeof (v as Record<string, unknown>).code === "string"
  );
}
