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
  {
    params,
  }: {
    params: { workspaceId: string; runId: string };
  },
) {
  const { workspaceId, runId } = params;
  const sp = request.nextUrl.searchParams;
  const token = sp.get("token");
  const after = sp.get("after");

  const backendUrl = new URL(
    `${BACKEND_URL}/api/workspaces/${workspaceId}/agent/runs/${runId}/stream`,
  );
  if (after) backendUrl.searchParams.set("after", after);
  if (token) backendUrl.searchParams.set("token", token);

  const backendResp = await fetch(backendUrl.toString(), {
    headers: { Accept: "text/event-stream" },
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
