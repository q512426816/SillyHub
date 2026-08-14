/**
 * task-11（FR-10 / D-006@v1）：session SSE 代理路由。
 *
 * 前端 fetch-sse（task-12 前为 EventSource，无法自定义 header）经本 route
 * handler 无缓冲代理转发 backend GET /api/daemon/sessions/{id}/stream，解决
 * 跨域/鉴权，并透传 cursor / Last-Event-ID / abort。task-12 后前端 token 走
 * Authorization header，本路由透传该 header 到 backend。
 *
 * P0-2（2026-06-18 安全修复）：token 不透传到 backend URL query（会进 backend
 * access log 明文泄漏），改放 ``Authorization: Bearer <token>`` header。
 * backend URL 只保留 cursor / lastEventId 等业务参数。
 *
 * 与 daemon-chat/[runId]/stream/route.ts 同型（run 级 vs session 级）。
 */
import { NextRequest } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BACKEND_URL = (
  process.env.INTERNAL_API_BASE_URL ??
  process.env.NEXT_PUBLIC_API_BASE_URL ??
  "http://localhost:8000"
).replace(/\/$/, "");

export async function GET(
  request: NextRequest,
  { params }: { params: { sessionId: string } },
) {
  const { sessionId } = params;
  const sp = request.nextUrl.searchParams;

  const backendUrl = new URL(
    `${BACKEND_URL}/api/daemon/sessions/${encodeURIComponent(sessionId)}/stream`,
  );
  // P0-2：token 不进 URL（避免泄漏到 backend access log），改放 Authorization header。
  // task-12：前端 fetch-sse 已把 token 从 query 移到 Authorization header（不再有
  // query token），此处改为透传入站 Authorization header；query 入参兜底保留
  // （旧客户端兼容，浏览器→Next 段是 Next 自有路由面，非 backend 访问日志）。
  const token = sp.get("token");
  const inboundAuth = request.headers.get("authorization");
  // 只透传业务参数（cursor / lastEventId），不透传 token。
  const forwardParams = ["cursor", "lastEventId", "Last-Event-ID"];
  for (const key of forwardParams) {
    const val = sp.get(key);
    if (val) backendUrl.searchParams.set(key, val);
  }

  const headers: Record<string, string> = { Accept: "text/event-stream" };
  if (inboundAuth) {
    headers.Authorization = inboundAuth;
  } else if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const backendResp = await fetch(backendUrl.toString(), {
    headers: { ...headers, "Accept-Encoding": "identity" },
    // 透传客户端中断
    signal: request.signal,
    // 禁用 undici 自动解压缓冲——否则 SSE data 帧被攒在 buffer 里，
    // 浏览器看到 200 OK 但实时事件不到（刷新后 REST 兜底才看到）。
    // compress 是 undici 扩展属性（DOM RequestInit 无此字段），ts-expect-error 绕过。
    // @ts-expect-error undici compress 不在标准 RequestInit 类型
    compress: false,
  });

  if (!backendResp.ok || !backendResp.body) {
    return new Response(
      backendResp.body ?? `Backend error: ${backendResp.status}`,
      { status: backendResp.status },
    );
  }

  return new Response(backendResp.body, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
