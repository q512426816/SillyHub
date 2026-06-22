/**
 * Thin fetch wrapper used by all API calls.
 *
 * - Always sends `x-request-id` so server-side logs can be correlated.
 * - Throws `ApiError` (with `code` / `details`) instead of plain `Error`.
 */
import { useSession } from "@/stores/session";

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

/**
 * Direct backend URL — bypasses the Next.js rewrite proxy.
 * Used for SSE connections where proxy buffering breaks real-time streaming.
 * Requires NEXT_PUBLIC_API_BASE_URL to be set for browser usage.
 */
export function getDirectApiBaseUrl(): string {
  if (
    typeof window !== "undefined" &&
    process.env.NEXT_PUBLIC_API_BASE_URL
  ) {
    return process.env.NEXT_PUBLIC_API_BASE_URL.replace(/\/$/, "");
  }
  return getApiBaseUrl();
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

export interface ApiRequestOptions extends Omit<RequestInit, "headers" | "body"> {
  headers?: Record<string, string>;
  json?: unknown;
  query?: Record<string, string | number | boolean | undefined | null | string[]>;
}

export async function apiFetch<T = unknown>(
  path: string,
  options: ApiRequestOptions = {},
): Promise<T> {
  const { json, query, headers = {}, ...rest } = options;

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

  let resp: Response;
  try {
    resp = await fetch(url.toString(), init);
  } catch (err) {
    throw new ApiError(0, {
      code: "network_error",
      message: err instanceof Error ? err.message : "Network error",
      request_id: finalHeaders["x-request-id"] ?? null,
      details: null,
    });
  }

  const text = await resp.text();
  const payload: unknown = text ? safeJsonParse(text) : null;

  if (!resp.ok) {
    const errorPayload: ApiErrorPayload =
      isApiErrorPayload(payload)
        ? payload
        : {
            code: `http_${resp.status}`,
            message: resp.statusText || "Request failed",
            request_id: resp.headers.get("x-request-id"),
            details: payload,
          };
    // Token expired? Try refresh+retry once.
    if (
      resp.status === 401 &&
      !String(finalHeaders["x-auth-retry"] ?? "").includes("1") &&
      !isAuthEndpoint(url.pathname)
    ) {
      try {
        const {
          refreshToken,
          setTokens,
          hydrated,
        } = useSession.getState();
        if (refreshToken && hydrated) {
          const refreshResp = await fetch(`${url.origin}/api/auth/refresh`, {
            method: "POST",
            headers: {
              "content-type": "application/json",
              "x-request-id": String(finalHeaders["x-request-id"]),
            },
            body: JSON.stringify({ refresh_token: refreshToken }),
          });
          const refreshText = await refreshResp.text();
          const refreshPayload = refreshText ? safeJsonParse(refreshText) : null;

          if (refreshResp.ok && refreshPayload && typeof refreshPayload === "object") {
            const pair = refreshPayload as any;
            setTokens({
              accessToken: pair.access_token ?? null,
              refreshToken: pair.refresh_token ?? null,
            });
            // Retry original call with new access token.
            return apiFetch<T>(path, {
              ...options,
              headers: { ...headers, "x-auth-retry": "1" },
              json,
              query,
            });
          }
        } else if (!hydrated) {
          // Not hydrated yet; don't guess refresh token.
        }
      } catch {
        // fallthrough to original error throw
      }

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
