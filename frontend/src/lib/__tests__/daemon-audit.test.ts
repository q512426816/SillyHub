/**
 * task-19 / D-006@v1: fetchPolicyAudit GET URL + 筛选/分页参数 + 类型映射单测。
 *
 * 依据文档:
 *   - .sillyspec/changes/2026-07-02-daemon-filesystem-policy/tasks/task-19.md
 *     (frontend lib/daemon-audit.ts API client)
 *   - design.md §7.3(GET policy-audit 端点)+ §7.4(AuditLogRead 字段)
 *   - backend/app/modules/daemon/audit/schema.py(AuditLogRead / AuditPageResponse)
 *
 * 关键偏差(task-10 已记录,task-19 必须遵循):
 *   实际 GET 路径含 /daemon 段 ——
 *   /api/daemon/workspaces/{wid}/runtimes/{rid}/policy-audit
 *   (design §7.3 原写 /api/workspaces/...,audit router 挂在 daemon router 下
 *   继承 /daemon prefix,无法在不动 main.py 的前提下挂到根)。
 *
 * 参数名对齐后端实际 Query(def:since/until/limit/offset,而非 design 文案的
 * startTime/endTime/page/pageSize)。返回分页字段为 total/limit/offset。
 *
 * 覆盖:
 *   1. fetch URL 含正确 /daemon 段 + path 段 (wid/rid)
 *   2. 筛选参数(decision/provider/tool/path)透传为 query
 *   3. 时间范围(since/until)透传
 *   4. 分页参数(limit/offset)透传 + 默认省略
 *   5. 返回类型 AuditPageResponse 字段映射(items/total/limit/offset)
 *   6. AuditLogRead 字段映射(id/runtime_id/workspace_id/decision/...)
 *   7. 非 2xx 抛 ApiError
 *
 * 测试模式:用真实 apiFetch(不 mock @/lib/api),仅 stub global fetch,
 * 断言收到的 URL + Response body 映射。对齐 lib/__tests__/daemon-usage.test.ts。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@/lib/api";
import { useSession } from "@/stores/session";
import {
  fetchPolicyAudit,
  type AuditLogRead,
  type AuditPageResponse,
} from "@/lib/daemon-audit";

// ── fetch harness ────────────────────────────────────────────────────────────

function mockFetchOk(body: unknown): {
  fetchMock: ReturnType<typeof vi.fn>;
  lastUrl: () => string;
} {
  const fetchMock = vi.fn();
  let lastUrl = "";
  const bodyStr = JSON.stringify(body);
  fetchMock.mockImplementation(async (url: string, _init?: RequestInit) => {
    lastUrl = url;
    return new Response(bodyStr, {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });
  vi.stubGlobal("fetch", fetchMock);
  return { fetchMock, lastUrl: () => lastUrl };
}

function mockFetchStatus(status: number, body: unknown): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn();
  const bodyStr = JSON.stringify(body);
  fetchMock.mockImplementation(async (url: string) => {
    void url;
    return new Response(bodyStr, {
      status,
      headers: { "content-type": "application/json" },
    });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function makeLog(over: Partial<AuditLogRead> = {}): AuditLogRead {
  return {
    id: "00000000-0000-0000-0000-000000000001",
    runtime_id: "rt-001",
    workspace_id: "ws-001",
    decision: "DENY",
    provider: "claude",
    tool: "Bash",
    path: "/etc/passwd",
    reason: "outside allowed_roots",
    created_at: "2026-07-02T10:00:00Z",
    ...over,
  };
}

beforeEach(() => {
  useSession.setState({ accessToken: "tok-audit", hydrated: true } as never);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// ── Tests ────────────────────────────────────────────────────────────────────

describe("task-19 fetchPolicyAudit: GET URL(含 /daemon 段)", () => {
  it("GET 路径含 /api/daemon/workspaces/{wid}/runtimes/{rid}/policy-audit", async () => {
    const h = mockFetchOk({ items: [], total: 0, limit: 50, offset: 0 });
    await fetchPolicyAudit("ws-001", "rt-001", {});
    const url = new URL(h.lastUrl());
    expect(url.pathname).toBe(
      "/api/daemon/workspaces/ws-001/runtimes/rt-001/policy-audit",
    );
  });

  it("wid / rid 被编码(含特殊字符)", async () => {
    const h = mockFetchOk({ items: [], total: 0, limit: 50, offset: 0 });
    await fetchPolicyAudit("ws 1", "rt/1", {});
    const url = new URL(h.lastUrl());
    expect(url.pathname).toBe(
      "/api/daemon/workspaces/ws%201/runtimes/rt%2F1/policy-audit",
    );
  });

  it("GET 方法(无 body)", async () => {
    const fetchMock = vi.fn();
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ items: [], total: 0, limit: 50, offset: 0 }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    await fetchPolicyAudit("ws-001", "rt-001", {});
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined;
    expect(init?.method ?? "GET").toBe("GET");
  });
});

describe("task-19 fetchPolicyAudit: 筛选参数透传", () => {
  it("decision 透传(ALLOW / DENY)", async () => {
    const h = mockFetchOk({ items: [], total: 0, limit: 50, offset: 0 });
    await fetchPolicyAudit("ws-001", "rt-001", { decision: "DENY" });
    const url = new URL(h.lastUrl());
    expect(url.searchParams.get("decision")).toBe("DENY");
  });

  it("provider / tool / path 透传", async () => {
    const h = mockFetchOk({ items: [], total: 0, limit: 50, offset: 0 });
    await fetchPolicyAudit("ws-001", "rt-001", {
      provider: "claude",
      tool: "Bash",
      path: "/etc/passwd",
    });
    const url = new URL(h.lastUrl());
    expect(url.searchParams.get("provider")).toBe("claude");
    expect(url.searchParams.get("tool")).toBe("Bash");
    expect(url.searchParams.get("path")).toBe("/etc/passwd");
  });

  it("全部筛选参数同时透传", async () => {
    const h = mockFetchOk({ items: [], total: 0, limit: 50, offset: 0 });
    await fetchPolicyAudit("ws-001", "rt-001", {
      decision: "ALLOW",
      provider: "codex",
      tool: "Write",
      path: "C:/proj",
    });
    const url = new URL(h.lastUrl());
    expect(url.searchParams.get("decision")).toBe("ALLOW");
    expect(url.searchParams.get("provider")).toBe("codex");
    expect(url.searchParams.get("tool")).toBe("Write");
    expect(url.searchParams.get("path")).toBe("C:/proj");
  });
});

describe("task-19 fetchPolicyAudit: 时间范围 + 分页", () => {
  it("since / until 透传", async () => {
    const h = mockFetchOk({ items: [], total: 0, limit: 50, offset: 0 });
    await fetchPolicyAudit("ws-001", "rt-001", {
      since: "2026-07-01T00:00:00Z",
      until: "2026-07-02T00:00:00Z",
    });
    const url = new URL(h.lastUrl());
    expect(url.searchParams.get("since")).toBe("2026-07-01T00:00:00Z");
    expect(url.searchParams.get("until")).toBe("2026-07-02T00:00:00Z");
  });

  it("limit / offset 透传", async () => {
    const h = mockFetchOk({ items: [], total: 0, limit: 100, offset: 200 });
    await fetchPolicyAudit("ws-001", "rt-001", { limit: 100, offset: 200 });
    const url = new URL(h.lastUrl());
    expect(url.searchParams.get("limit")).toBe("100");
    expect(url.searchParams.get("offset")).toBe("200");
  });

  it("省略所有筛选/分页参数时 URL 无 query", async () => {
    const h = mockFetchOk({ items: [], total: 0, limit: 50, offset: 0 });
    await fetchPolicyAudit("ws-001", "rt-001", {});
    const url = new URL(h.lastUrl());
    expect(url.search).toBe("");
  });

  it("decision=undefined 不写入 query", async () => {
    const h = mockFetchOk({ items: [], total: 0, limit: 50, offset: 0 });
    await fetchPolicyAudit("ws-001", "rt-001", { decision: undefined });
    const url = new URL(h.lastUrl());
    expect(url.searchParams.has("decision")).toBe(false);
  });
});

describe("task-19 fetchPolicyAudit: AuditPageResponse 字段映射", () => {
  it("items/total/limit/offset 完整映射", async () => {
    const body: AuditPageResponse = {
      items: [makeLog(), makeLog({ id: "00000000-0000-0000-0000-000000000002" })],
      total: 2,
      limit: 50,
      offset: 0,
    };
    mockFetchOk(body);
    const result = await fetchPolicyAudit("ws-001", "rt-001", {});
    expect(result.total).toBe(2);
    expect(result.limit).toBe(50);
    expect(result.offset).toBe(0);
    expect(result.items).toHaveLength(2);
  });

  it("AuditLogRead 字段映射(decision D-006 / provider / tool / path / reason / created_at)", async () => {
    const body: AuditPageResponse = {
      items: [
        makeLog({
          decision: "ALLOW",
          provider: "codex",
          tool: "Read",
          path: "/home/user/.bashrc",
          reason: "",
          created_at: "2026-07-02T12:30:00Z",
        }),
      ],
      total: 1,
      limit: 50,
      offset: 0,
    };
    mockFetchOk(body);
    const result = await fetchPolicyAudit("ws-001", "rt-001", {});
    const item = result.items[0];
    expect(item?.id).toBe("00000000-0000-0000-0000-000000000001");
    expect(item?.runtime_id).toBe("rt-001");
    expect(item?.workspace_id).toBe("ws-001");
    expect(item?.decision).toBe("ALLOW");
    expect(item?.provider).toBe("codex");
    expect(item?.tool).toBe("Read");
    expect(item?.path).toBe("/home/user/.bashrc");
    expect(item?.reason).toBe("");
    expect(item?.created_at).toBe("2026-07-02T12:30:00Z");
  });

  it("workspace_id 可空(daemon 上报无 workspace 的运行时)", async () => {
    const body: AuditPageResponse = {
      items: [makeLog({ workspace_id: null })],
      total: 1,
      limit: 50,
      offset: 0,
    };
    mockFetchOk(body);
    const result = await fetchPolicyAudit("ws-001", "rt-001", {});
    expect(result.items[0]?.workspace_id).toBeNull();
  });

  it("items 空数组(无审计记录)", async () => {
    const body: AuditPageResponse = {
      items: [],
      total: 0,
      limit: 50,
      offset: 0,
    };
    mockFetchOk(body);
    const result = await fetchPolicyAudit("ws-001", "rt-001", {});
    expect(result.items).toEqual([]);
    expect(result.total).toBe(0);
  });
});

describe("task-19 fetchPolicyAudit: 错误透传", () => {
  it("422 非法参数 → ApiError", async () => {
    mockFetchStatus(422, {
      code: "HTTP_422",
      message: "limit must be between 1 and 200",
      request_id: null,
      details: null,
    });
    await expect(
      fetchPolicyAudit("ws-001", "rt-001", { limit: 99999 }),
    ).rejects.toBeInstanceOf(ApiError);
  });

  it("403 无 RUNTIME_ADMIN 权限 → ApiError", async () => {
    mockFetchStatus(403, {
      code: "HTTP_403",
      message: "forbidden",
      request_id: null,
      details: null,
    });
    await expect(fetchPolicyAudit("ws-001", "rt-001", {})).rejects.toBeInstanceOf(
      ApiError,
    );
  });

  it("401 未登录 → ApiError", async () => {
    mockFetchStatus(401, {
      code: "HTTP_401",
      message: "unauthorized",
      request_id: null,
      details: null,
    });
    await expect(fetchPolicyAudit("ws-001", "rt-001", {})).rejects.toBeInstanceOf(
      ApiError,
    );
  });
});
