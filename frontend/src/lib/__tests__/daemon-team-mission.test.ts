// task-12（2026-08-22-team-session-unify / FR-07 / D-001@v1）：会话团队 mission
// REST 客户端单测（对齐 task-03 后端契约 design §7）。
//
// 覆盖：
//   - triggerSessionTeamMission：POST /api/daemon/sessions/{id}/team-mission +
//     JSON body（objective/scope_workspace_ids/budget_usd）+ 编码 session id + 201 响应透传；
//   - listSessionTeamMissions：GET /api/daemon/sessions/{id}/team-missions +
//     TeamMissionSummary[] 透传；
//   - cancelTeamMission：POST /api/missions/{id}/cancel（保留端点，D-011）+ no body；
//   - ApiError 透传（409 活跃冲突 / 422 无工作区）。
//
// 测试纪律同 daemon-session.test.ts：mock stores/session + spy globalThis.fetch。

import { describe, it, expect, beforeEach, vi } from "vitest";

import {
  triggerSessionTeamMission,
  listSessionTeamMissions,
  cancelTeamMission,
  type TeamMissionSummary,
} from "../daemon";

vi.mock("../../stores/session", () => ({
  useSession: {
    getState: () => ({ accessToken: "test-token" }),
  },
}));

function mockFetch(payload: unknown, status = 200) {
  return vi.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response(JSON.stringify(payload), { status }),
  );
}

/** 取 mock fetch 的第 N 次调用 [url, init]。 */
function fetchCall(
  fetchMock: { mock: { calls: Array<[unknown, RequestInit?]> } },
  n = 0,
): { url: string; init: RequestInit } {
  const call = fetchMock.mock.calls[n]!;
  return { url: String(call[0]), init: (call[1] ?? {}) as RequestInit };
}

const SUMMARY: TeamMissionSummary = {
  mission_id: "m-1",
  status: "planning",
  objective: null,
  scope_workspace_ids: ["ws-1"],
  budget_usd: 5,
  workers: [
    { run_id: "r-1", role: "impl", status: "pending", objective: "修按钮" },
  ],
};

describe("triggerSessionTeamMission", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("POST /api/daemon/sessions/{id}/team-mission，body 携带触发参数，响应透传", async () => {
    const fetchMock = mockFetch(SUMMARY, 201);

    const result = await triggerSessionTeamMission("sess a/b", {
      objective: "修复登录页移动端问题",
      scope_workspace_ids: ["ws-1", "ws-2"],
      budget_usd: 5,
    });

    expect(result).toEqual(SUMMARY);
    const { url, init } = fetchCall(fetchMock);
    expect(url).toContain("/api/daemon/sessions/sess%20a%2Fb/team-mission");
    expect(init.method).toBe("POST");
    const body = JSON.parse(init.body as string);
    expect(body.objective).toBe("修复登录页移动端问题");
    expect(body.scope_workspace_ids).toEqual(["ws-1", "ws-2"]);
    expect(body.budget_usd).toBe(5);
  });

  it("可选字段缺省不下发（body 只含显式传入键）", async () => {
    const fetchMock = mockFetch(SUMMARY, 201);
    await triggerSessionTeamMission("sess-1", { budget_usd: 3 });
    const body = JSON.parse(fetchCall(fetchMock).init.body as string);
    expect(body).toEqual({ budget_usd: 3 });
    expect(body).not.toHaveProperty("objective");
    expect(body).not.toHaveProperty("scope_workspace_ids");
    expect(body).not.toHaveProperty("project_id");
  });

  it("409 活跃冲突抛 ApiError（R-07 单活跃约束）", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          code: "MISSION_ACTIVE_CONFLICT",
          message: "该会话已有进行中的团队任务。",
          request_id: null,
          details: null,
        }),
        { status: 409 },
      ),
    );
    await expect(
      triggerSessionTeamMission("sess-1", { objective: "x" }),
    ).rejects.toMatchObject({ name: "ApiError", status: 409 });
  });
});

describe("listSessionTeamMissions", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("GET /api/daemon/sessions/{id}/team-missions，返回 TeamMissionSummary[]", async () => {
    const fetchMock = mockFetch([SUMMARY]);

    const result = await listSessionTeamMissions("sess-1");

    expect(result).toEqual([SUMMARY]);
    const { url, init } = fetchCall(fetchMock);
    expect(url).toContain("/api/daemon/sessions/sess-1/team-missions");
    expect(url).not.toContain("team-mission?"); // 列表端点带 s，不与触发端点混淆
    expect(init.method).toBeUndefined(); // GET 缺省
    expect(init.body).toBeUndefined();
  });

  it("空列表正常返回 []", async () => {
    mockFetch([]);
    const result = await listSessionTeamMissions("sess-1");
    expect(result).toEqual([]);
  });

  it("422 无工作区抛 ApiError（CC-10）", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          code: "VALIDATION_ERROR",
          message: "该会话未绑定工作区，请用派团队弹层显式选择范围。",
          request_id: null,
          details: null,
        }),
        { status: 422 },
      ),
    );
    await expect(listSessionTeamMissions("sess-1")).rejects.toMatchObject({
      name: "ApiError",
      status: 422,
    });
  });
});

describe("cancelTeamMission", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("POST /api/missions/{id}/cancel（保留端点，无 body）", async () => {
    const fetchMock = mockFetch({ id: "m-1", status: "cancelled" });

    await cancelTeamMission("m 1/x");

    const { url, init } = fetchCall(fetchMock);
    expect(url).toContain("/api/missions/m%201%2Fx/cancel");
    expect(init.method).toBe("POST");
    expect(init.body).toBeUndefined();
  });

  it("403 归属校验失败抛 ApiError", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          code: "PERMISSION_DENIED",
          message: "无权操作该团队任务。",
          request_id: null,
          details: null,
        }),
        { status: 403 },
      ),
    );
    await expect(cancelTeamMission("m-1")).rejects.toMatchObject({
      name: "ApiError",
      status: 403,
    });
  });
});
