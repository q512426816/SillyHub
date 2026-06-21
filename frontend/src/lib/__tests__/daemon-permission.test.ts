// tests/lib/__tests__/daemon-permission.test.ts
// task-08：前端 permission approval lib 函数单测。
//
// 覆盖：
//   - respondSessionPermission 构造正确 POST payload + URL + method；
//   - respondSessionPermission 带 message 时 payload 含 message；
//   - parseSessionPermissionEvent 解析 permission_request / permission_resolved；
//   - 非 permission 事件返回 null。

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  respondSessionPermission,
  parseSessionPermissionEvent,
  fetchPendingDialogs,
  type SessionPermissionRequest,
  type SessionPermissionResolved,
} from "../daemon";

// mock api 模块的 fetch 链路：拦截 useSession.getState + global fetch。
vi.mock("../../stores/session", () => ({
  useSession: {
    getState: () => ({ accessToken: "test-token" }),
  },
}));

describe("respondSessionPermission", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("构造 POST 请求到正确 URL，body 含 decision", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        new Response(JSON.stringify({ accepted: true }), { status: 200 }),
      );

    const result = await respondSessionPermission(
      "sess-1",
      "req-1",
      "allow",
    );
    expect(result.accepted).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toContain(
      "/api/daemon/sessions/sess-1/permissions/req-1/response",
    );
    expect(init?.method).toBe("POST");
    const body = JSON.parse(init?.body as string);
    expect(body.decision).toBe("allow");
    expect(body.message).toBeUndefined();
  });

  it("带 message 时 body 含 message", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        new Response(JSON.stringify({ accepted: true }), { status: 200 }),
      );
    await respondSessionPermission("s", "r", "deny", "no way");
    const init = fetchMock.mock.calls[0]![1];
    const body = JSON.parse(init?.body as string);
    expect(body.decision).toBe("deny");
    expect(body.message).toBe("no way");
  });

  it("带 dialog_result 时 body 含 dialog_result（AskUserQuestion 对话）", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        new Response(JSON.stringify({ accepted: true }), { status: 200 }),
      );
    const dialogResult = {
      answers: [{ question: "选哪个？", answer: "选项A" }],
    };
    await respondSessionPermission("s", "r", "allow", undefined, dialogResult);
    const init = fetchMock.mock.calls[0]![1];
    const body = JSON.parse(init?.body as string);
    expect(body.decision).toBe("allow");
    expect(body.message).toBeUndefined();
    expect(body.dialog_result).toEqual(dialogResult);
  });
});

describe("fetchPendingDialogs", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("GET /sessions/{id}/dialogs 返回 SessionPermissionRequest[]", async () => {
    const dialogs = [
      {
        session_id: "sess-1",
        run_id: "run-1",
        request_id: "req-1",
        tool_name: "AskUserQuestion",
        input: {},
        dialog_kind: "ask_user",
        dialog_payload: { questions: [] },
      },
    ];
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        new Response(JSON.stringify(dialogs), { status: 200 }),
      );

    const result = await fetchPendingDialogs("sess-1");
    expect(result).toHaveLength(1);
    expect(result[0]?.dialog_kind).toBe("ask_user");
    expect(result[0]?.dialog_payload).toEqual({ questions: [] });

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toContain("/api/daemon/sessions/sess-1/dialogs");
    expect(init?.method ?? "GET").toBe("GET");
  });

  it("对含特殊字符的 sessionId 做 URL 编码", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        new Response(JSON.stringify([]), { status: 200 }),
      );
    await fetchPendingDialogs("sess a/b");
    const [url] = fetchMock.mock.calls[0]!;
    expect(String(url)).toContain("/api/daemon/sessions/sess%20a%2Fb/dialogs");
  });
});

describe("parseSessionPermissionEvent", () => {
  it("permission_request 事件 → SessionPermissionRequest", () => {
    const data = {
      event: "permission_request",
      session_id: "sess-1",
      run_id: "run-1",
      request_id: "req-1",
      tool_name: "Bash",
      input: { command: "ls -la" },
      tool_use_id: "tu-1",
    };
    const parsed = parseSessionPermissionEvent(data);
    expect(parsed).not.toBeNull();
    expect((parsed as SessionPermissionRequest).tool_name).toBe("Bash");
    expect((parsed as SessionPermissionRequest).input).toEqual({
      command: "ls -la",
    });
    expect((parsed as SessionPermissionRequest).tool_use_id).toBe("tu-1");
  });

  it("permission_request 无 tool_use_id → 不含 tool_use_id 字段", () => {
    const parsed = parseSessionPermissionEvent({
      event: "permission_request",
      session_id: "s",
      run_id: "r",
      request_id: "rq",
      tool_name: "Write",
      input: { path: "/x" },
    }) as SessionPermissionRequest;
    expect(parsed.tool_use_id).toBeUndefined();
  });

  it("permission_request 带 dialog_kind/dialog_payload → AskUserQuestion 对话变体", () => {
    const payload = { questions: [{ question: "选哪个？", options: [] }] };
    const parsed = parseSessionPermissionEvent({
      event: "permission_request",
      session_id: "s",
      run_id: "r",
      request_id: "rq",
      tool_name: "AskUserQuestion",
      input: {},
      dialog_kind: "ask_user",
      dialog_payload: payload,
    }) as SessionPermissionRequest;
    expect(parsed.dialog_kind).toBe("ask_user");
    expect(parsed.dialog_payload).toEqual(payload);
  });

  it("permission_request 无 dialog_kind → dialog 字段 undefined（普通审批）", () => {
    const parsed = parseSessionPermissionEvent({
      event: "permission_request",
      session_id: "s",
      run_id: "r",
      request_id: "rq",
      tool_name: "Bash",
      input: {},
    }) as SessionPermissionRequest;
    expect(parsed.dialog_kind).toBeUndefined();
    expect(parsed.dialog_payload).toBeUndefined();
  });

  it("permission_request dialog_kind 非 string → 忽略（防御）", () => {
    const parsed = parseSessionPermissionEvent({
      event: "permission_request",
      session_id: "s",
      run_id: "r",
      request_id: "rq",
      tool_name: "Bash",
      input: {},
      dialog_kind: 123,
      dialog_payload: "not-an-object",
    }) as SessionPermissionRequest;
    expect(parsed.dialog_kind).toBeUndefined();
    expect(parsed.dialog_payload).toBeUndefined();
  });

  it("permission_resolved 事件 → SessionPermissionResolved", () => {
    const parsed = parseSessionPermissionEvent({
      event: "permission_resolved",
      session_id: "s",
      request_id: "rq",
      decision: "deny",
      reason: "timeout",
    }) as SessionPermissionResolved;
    expect(parsed.decision).toBe("deny");
    expect(parsed.reason).toBe("timeout");
  });

  it("permission_resolved decision 非 allow → deny（防御）", () => {
    const parsed = parseSessionPermissionEvent({
      event: "permission_resolved",
      session_id: "s",
      request_id: "rq",
      decision: "garbage",
    }) as SessionPermissionResolved;
    expect(parsed.decision).toBe("deny");
  });

  it("session_ended / 其它事件 → null", () => {
    expect(parseSessionPermissionEvent({ event: "session_ended" })).toBeNull();
    expect(parseSessionPermissionEvent({ event: "log" })).toBeNull();
    expect(parseSessionPermissionEvent(null)).toBeNull();
    expect(parseSessionPermissionEvent("string")).toBeNull();
  });
});
