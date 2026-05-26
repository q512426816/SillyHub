/**
 * Thin fetch wrapper used by all API calls.
 *
 * - Always sends `x-request-id` so server-side logs can be correlated.
 * - Throws `ApiError` (with `code` / `details`) instead of plain `Error`.
 */

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL?.replace(/\/$/, "") ?? "http://localhost:8000";

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

function generateRequestId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `web-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export interface ApiRequestOptions extends Omit<RequestInit, "headers" | "body"> {
  headers?: Record<string, string>;
  json?: unknown;
  query?: Record<string, string | number | boolean | undefined | null>;
}

export async function apiFetch<T = unknown>(
  path: string,
  options: ApiRequestOptions = {},
): Promise<T> {
  const { json, query, headers = {}, ...rest } = options;

  const url = new URL(path.startsWith("http") ? path : `${API_BASE_URL}${path}`);
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v === undefined || v === null) continue;
      url.searchParams.set(k, String(v));
    }
  }

  const finalHeaders: Record<string, string> = {
    accept: "application/json",
    "x-request-id": headers["x-request-id"] ?? generateRequestId(),
    ...headers,
  };

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
