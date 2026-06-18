/**
 * task-11（FR-10 / D-006@v1）：session SSE 代理路由。
 *
 * 前端 EventSource 无法自定义 header（token 走 query）。Next route handler 作为
 * 无缓冲代理转发 backend GET /api/daemon/sessions/{id}/stream，解决跨域/鉴权，
 * 并透传 cursor / Last-Event-ID / abort。
 *
 * P0-2（2026-06-18 安全修复）：从 query 取出 `token` 后**不透传到 backend URL**
 * （避免 token 进入 backend access log），改放 `Authorization: Bearer <token>`
 * header。backend URL 只保留 cursor / lastEventId 等业务参数。
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
  const token = sp.get("token");
  // 只透传业务参数（cursor / lastEventId），不透传 token。
  const forwardParams = ["cursor", "lastEventId", "Last-Event-ID"];
  for (const key of forwardParams) {
    const val = sp.get(key);
    if (val) backendUrl.searchParams.set(key, val);
  }

  const headers: Record<string, string> = { Accept: "text/event-stream" };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const backendResp = await fetch(backendUrl.toString(), {
    headers,
    // 透传客户端中断
    signal: request.signal,
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
