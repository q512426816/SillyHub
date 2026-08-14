import { NextRequest } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * run 级 SSE 代理（task-12 改 header 转传）：
 * 浏览器侧入站 query token 保留（本路由是 Next 自有路由面，非 backend 访问日志），
 * 但转发 backend 时 token 改放 ``Authorization: Bearer`` header，不再拼
 * backend URL query——backend URL 会进 backend access log，query token 即明文泄漏
 * （backend auth_deps 已 header-only）。对齐 sessions/[sessionId]/stream 同型改造。
 */

const BACKEND_URL = (
  process.env.INTERNAL_API_BASE_URL ??
  process.env.NEXT_PUBLIC_API_BASE_URL ??
  "http://localhost:8000"
).replace(/\/$/, "");

export async function GET(
  request: NextRequest,
  { params }: { params: { runId: string } },
) {
  const { runId } = params;
  const sp = request.nextUrl.searchParams;
  const token = sp.get("token");
  // task-12：优先透传入站 Authorization header（fetch-sse 客户端）；query token
  // 兜底保留（旧客户端兼容）。
  const inboundAuth = request.headers.get("authorization");

  const backendUrl = new URL(`${BACKEND_URL}/api/daemon-chat/${runId}/stream`);

  const headers: Record<string, string> = { Accept: "text/event-stream" };
  if (inboundAuth) {
    headers.Authorization = inboundAuth;
  } else if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const backendResp = await fetch(backendUrl.toString(), { headers });

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
