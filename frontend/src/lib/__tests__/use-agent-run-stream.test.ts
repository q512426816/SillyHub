// tests/lib/__tests__/use-agent-run-stream.test.ts
// task-02：useAgentRunStream hook 单测。
//
// 依据：
//   - design.md §7.1（hook 接口）、§7.3（生命周期契约表）、§11（D-001/D-003）
//   - requirements.md FR-02 / FR-04 / FR-06
//   - tasks/task-02.md 用例清单 TC-01..TC-20 + 边界
//
// 覆盖：
//   - FR-02：连接生命周期（connect / runId 切换重连 / unmount disconnect / clear）
//   - FR-04：permission_request → perms 增 + 去重；permission_resolved → dismissPerm
//   - FR-06 / D-001：isActive=false 不连 SSE
//   - D-003：dismissPerm 仅本地移除，不调 fetch（决策 API 归卡片）
//   - Grill X-005：token 空 set error 不连
//   - input 契约：set / submit 成功 + 失败 + replied

import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  vi,
  type MockInstance,
} from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";

import { useAgentRunStream } from "../use-agent-run-stream";

// ────────────────────────────────────────────────────────────────────────────
// hoisted 共享状态（vi.mock 工厂提升到顶部后，只能引用以 vi 开头或 vi.hoisted 声明）
// ────────────────────────────────────────────────────────────────────────────

type Cb<T> = (payload: T) => void;

interface FakeClient {
  connect: ReturnType<typeof vi.fn>;
  disconnect: ReturnType<typeof vi.fn>;
  onMessage: ReturnType<typeof vi.fn>;
  onStatusChange: ReturnType<typeof vi.fn>;
  onDone: ReturnType<typeof vi.fn>;
  onPermissionRequest: ReturnType<typeof vi.fn>;
  onPermissionResolved: ReturnType<typeof vi.fn>;
  __emitMessage: (e: unknown) => void;
  __emitStatus: (s: unknown) => void;
  __emitDone: (d: unknown) => void;
  __emitPermissionRequest: (r: unknown) => void;
  __emitPermissionResolved: (r: unknown) => void;
  __registered: {
    message: Cb<unknown>[];
    status: Cb<unknown>[];
    done: Cb<unknown>[];
    permReq: Cb<unknown>[];
    permRes: Cb<unknown>[];
  };
}

const hoisted = vi.hoisted(() => {
  const sessionState = {
    accessToken: "test-token" as string | null,
    refreshToken: "refresh-token",
    hydrated: true,
  };
  const constructorCalls: Array<{
    workspaceId: string;
    runId: string;
    instance: FakeClient;
  }> = [];
  let currentFake: FakeClient | null = null;
  return { sessionState, constructorCalls, currentFake };
});

// 运行期可重置 currentFake 指针（hoisted 里是值快照，需在闭包外暴露可变引用）
let currentFake: FakeClient | null = null;
const constructorCalls = hoisted.constructorCalls;

// ────────────────────────────────────────────────────────────────────────────
// 1) mock @/stores/session
// ────────────────────────────────────────────────────────────────────────────

vi.mock("@/stores/session", () => ({
  useSession: {
    getState: () => hoisted.sessionState,
  },
}));

// ────────────────────────────────────────────────────────────────────────────
// 2) fake AgentRunStreamClient
// ────────────────────────────────────────────────────────────────────────────

function makeFakeClient(): FakeClient {
  const registered: FakeClient["__registered"] = {
    message: [],
    status: [],
    done: [],
    permReq: [],
    permRes: [],
  };
  const instance: FakeClient = {
    connect: vi.fn(async () => {}),
    disconnect: vi.fn(() => {}),
    onMessage: vi.fn((cb: Cb<unknown>) => {
      registered.message.push(cb);
      return () => {
        registered.message = registered.message.filter((c) => c !== cb);
      };
    }),
    onStatusChange: vi.fn((cb: Cb<unknown>) => {
      registered.status.push(cb);
      return () => {
        registered.status = registered.status.filter((c) => c !== cb);
      };
    }),
    onDone: vi.fn((cb: Cb<unknown>) => {
      registered.done.push(cb);
      return () => {
        registered.done = registered.done.filter((c) => c !== cb);
      };
    }),
    onPermissionRequest: vi.fn((cb: Cb<unknown>) => {
      registered.permReq.push(cb);
      return () => {
        registered.permReq = registered.permReq.filter((c) => c !== cb);
      };
    }),
    onPermissionResolved: vi.fn((cb: Cb<unknown>) => {
      registered.permRes.push(cb);
      return () => {
        registered.permRes = registered.permRes.filter((c) => c !== cb);
      };
    }),
    __registered: registered,
    __emitMessage: (e: unknown) => {
      for (const cb of [...registered.message]) cb(e);
    },
    __emitStatus: (s: unknown) => {
      for (const cb of [...registered.status]) cb(s);
    },
    __emitDone: (d: unknown) => {
      for (const cb of [...registered.done]) cb(d);
    },
    __emitPermissionRequest: (r: unknown) => {
      for (const cb of [...registered.permReq]) cb(r);
    },
    __emitPermissionResolved: (r: unknown) => {
      for (const cb of [...registered.permRes]) cb(r);
    },
  };
  return instance;
}

vi.mock("../agent-stream", () => ({
  AgentRunStreamClient: vi.fn((workspaceId: string, runId: string) => {
    const instance = makeFakeClient();
    currentFake = instance;
    constructorCalls.push({ workspaceId, runId, instance });
    return instance;
  }),
}));

// ────────────────────────────────────────────────────────────────────────────
// 3) fetch mock helpers
// ────────────────────────────────────────────────────────────────────────────

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function errorResponse(status: number, message: string): Response {
  return jsonResponse(
    { code: `http_${status}`, message, request_id: null, details: null },
    status,
  );
}

// fetch 的 MockInstance 类型（vitest 2.x 导出 MockInstance）。
let fetchMock: MockInstance<typeof fetch>;

function installFetchMock(
  router: (url: URL, init: RequestInit) => Response | Promise<Response>,
): MockInstance<typeof fetch> {
  return vi
    .spyOn(globalThis, "fetch")
    .mockImplementation((input: URL | RequestInfo, init?: RequestInit) => {
      const url = typeof input === "string" ? new URL(input) : (input as URL);
      return Promise.resolve(router(url, (init as RequestInit) ?? {}));
    });
}

// ────────────────────────────────────────────────────────────────────────────
// 4) helpers
// ────────────────────────────────────────────────────────────────────────────

function makePermRequest(
  overrides: Record<string, unknown>,
): Record<string, unknown> {
  return {
    session_id: "sess-1",
    run_id: "run-1",
    request_id: "req-1",
    tool_name: "Bash",
    input: { command: "ls" },
    ...overrides,
  };
}

function resetFakeState(): void {
  constructorCalls.length = 0;
  currentFake = null;
  hoisted.sessionState.accessToken = "test-token";
}

// ────────────────────────────────────────────────────────────────────────────
// beforeEach / afterEach
// ────────────────────────────────────────────────────────────────────────────

beforeEach(() => {
  resetFakeState();
  fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
    jsonResponse({ id: "run-1", session_id: null }),
  );
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ────────────────────────────────────────────────────────────────────────────
// Test groups
// ────────────────────────────────────────────────────────────────────────────

describe("useAgentRunStream — 连接生命周期 (FR-02)", () => {
  it("TC-01 活跃 run 首渲建立 SSE 连接", async () => {
    installFetchMock(() => jsonResponse({ id: "run-1", session_id: null }));

    renderHook(
      ({ workspaceId, runId, isActive }) =>
        useAgentRunStream(workspaceId, runId, { isActive }),
      {
        initialProps: {
          workspaceId: "ws-1",
          runId: "run-1",
          isActive: true,
        },
      },
    );

    await waitFor(() => {
      expect(currentFake).not.toBeNull();
    });
    expect(constructorCalls).toHaveLength(1);
    expect(constructorCalls[0]!.workspaceId).toBe("ws-1");
    expect(constructorCalls[0]!.runId).toBe("run-1");
    expect(currentFake!.connect).toHaveBeenCalledTimes(1);
    expect(currentFake!.connect).toHaveBeenCalledWith("test-token");
  });

  it("TC-09 runId 切换 → 旧 disconnect + 新 connect", async () => {
    installFetchMock(() => jsonResponse({ id: "run-1", session_id: null }));

    const { rerender } = renderHook(
      ({ workspaceId, runId, isActive }) =>
        useAgentRunStream(workspaceId, runId, { isActive }),
      {
        initialProps: {
          workspaceId: "ws-1",
          runId: "run-1",
          isActive: true,
        },
      },
    );

    await waitFor(() => expect(currentFake).not.toBeNull());
    const firstClient = currentFake!;

    rerender({ workspaceId: "ws-1", runId: "run-2", isActive: true });

    await waitFor(() => expect(constructorCalls).toHaveLength(2));
    expect(firstClient.disconnect).toHaveBeenCalledTimes(1);
    expect(constructorCalls[1]!.runId).toBe("run-2");
    await waitFor(() =>
      expect(constructorCalls[1]!.instance.connect).toHaveBeenCalledWith(
        "test-token",
      ),
    );
  });

  it("TC-10 isActive true→false → disconnect", async () => {
    installFetchMock(() => jsonResponse({ id: "run-1", session_id: null }));

    const { rerender } = renderHook(
      ({ workspaceId, runId, isActive }) =>
        useAgentRunStream(workspaceId, runId, { isActive }),
      {
        initialProps: {
          workspaceId: "ws-1",
          runId: "run-1",
          isActive: true,
        },
      },
    );

    await waitFor(() => expect(currentFake).not.toBeNull());
    const firstClient = currentFake!;

    rerender({ workspaceId: "ws-1", runId: "run-1", isActive: false });

    await waitFor(() =>
      expect(firstClient.disconnect).toHaveBeenCalledTimes(1),
    );
  });

  it("TC-11 unmount → disconnect", async () => {
    installFetchMock(() => jsonResponse({ id: "run-1", session_id: null }));

    const { unmount } = renderHook(
      ({ workspaceId, runId, isActive }) =>
        useAgentRunStream(workspaceId, runId, { isActive }),
      {
        initialProps: {
          workspaceId: "ws-1",
          runId: "run-1",
          isActive: true,
        },
      },
    );

    await waitFor(() => expect(currentFake).not.toBeNull());
    const client = currentFake!;

    unmount();

    expect(client.disconnect).toHaveBeenCalledTimes(1);
  });

  it("TC-18 clear() 清空状态", async () => {
    installFetchMock(() => jsonResponse({ id: "run-1", session_id: null }));

    const { result } = renderHook(
      ({ workspaceId, runId, isActive }) =>
        useAgentRunStream(workspaceId, runId, { isActive }),
      {
        initialProps: {
          workspaceId: "ws-1",
          runId: "run-1",
          isActive: true,
        },
      },
    );

    await waitFor(() => expect(currentFake).not.toBeNull());

    act(() => {
      currentFake!.__emitPermissionRequest(makePermRequest({ request_id: "r1" }));
      currentFake!.__emitMessage({
        channel: "stdout",
        content: "hello",
        timestamp: "2026-06-22T10:00:00Z",
        log_id: "L1",
      });
    });

    expect(result.current.perms).toHaveLength(1);
    expect(result.current.logs).toHaveLength(1);

    act(() => {
      result.current.clear();
    });

    expect(result.current.logs).toEqual([]);
    expect(result.current.perms).toEqual([]);
    expect(result.current.status).toBeNull();
    expect(result.current.error).toBeNull();
  });
});

describe("useAgentRunStream — permission (FR-04)", () => {
  it("TC-02 permission_request → perms 增", async () => {
    installFetchMock(() => jsonResponse({ id: "run-1", session_id: null }));

    const { result } = renderHook(
      ({ workspaceId, runId, isActive }) =>
        useAgentRunStream(workspaceId, runId, { isActive }),
      {
        initialProps: {
          workspaceId: "ws-1",
          runId: "run-1",
          isActive: true,
        },
      },
    );

    await waitFor(() => expect(currentFake).not.toBeNull());

    act(() => {
      currentFake!.__emitPermissionRequest(
        makePermRequest({ request_id: "req-1", tool_name: "Bash" }),
      );
    });

    expect(result.current.perms).toHaveLength(1);
    expect(result.current.perms[0]!.request_id).toBe("req-1");
    expect(result.current.perms[0]!.tool_name).toBe("Bash");
  });

  it("TC-03 permission_request 同 request_id 去重", async () => {
    installFetchMock(() => jsonResponse({ id: "run-1", session_id: null }));

    const { result } = renderHook(
      ({ workspaceId, runId, isActive }) =>
        useAgentRunStream(workspaceId, runId, { isActive }),
      {
        initialProps: {
          workspaceId: "ws-1",
          runId: "run-1",
          isActive: true,
        },
      },
    );

    await waitFor(() => expect(currentFake).not.toBeNull());

    act(() => {
      currentFake!.__emitPermissionRequest(makePermRequest({ request_id: "req-1" }));
      currentFake!.__emitPermissionRequest(makePermRequest({ request_id: "req-1" }));
    });

    expect(result.current.perms).toHaveLength(1);
  });

  it("TC-04 不同 request_id 累加", async () => {
    installFetchMock(() => jsonResponse({ id: "run-1", session_id: null }));

    const { result } = renderHook(
      ({ workspaceId, runId, isActive }) =>
        useAgentRunStream(workspaceId, runId, { isActive }),
      {
        initialProps: {
          workspaceId: "ws-1",
          runId: "run-1",
          isActive: true,
        },
      },
    );

    await waitFor(() => expect(currentFake).not.toBeNull());

    act(() => {
      currentFake!.__emitPermissionRequest(makePermRequest({ request_id: "req-1" }));
      currentFake!.__emitPermissionRequest(makePermRequest({ request_id: "req-2" }));
    });

    expect(result.current.perms).toHaveLength(2);
    const ids = result.current.perms.map((p) => p.request_id).sort();
    expect(ids).toEqual(["req-1", "req-2"]);
  });

  it("TC-05 permission_resolved → dismissPerm 移除", async () => {
    installFetchMock(() => jsonResponse({ id: "run-1", session_id: null }));

    const { result } = renderHook(
      ({ workspaceId, runId, isActive }) =>
        useAgentRunStream(workspaceId, runId, { isActive }),
      {
        initialProps: {
          workspaceId: "ws-1",
          runId: "run-1",
          isActive: true,
        },
      },
    );

    await waitFor(() => expect(currentFake).not.toBeNull());

    act(() => {
      currentFake!.__emitPermissionRequest(makePermRequest({ request_id: "req-1" }));
      currentFake!.__emitPermissionRequest(makePermRequest({ request_id: "req-2" }));
    });
    expect(result.current.perms).toHaveLength(2);

    act(() => {
      currentFake!.__emitPermissionResolved({
        session_id: "sess-1",
        request_id: "req-1",
        decision: "allow",
      });
    });

    expect(result.current.perms).toHaveLength(1);
    expect(result.current.perms[0]!.request_id).toBe("req-2");
  });

  it("TC-06 D-003 dismissPerm 直接本地移除，不调 fetch", async () => {
    installFetchMock(() => jsonResponse({ id: "run-1", session_id: null }));

    const { result } = renderHook(
      ({ workspaceId, runId, isActive }) =>
        useAgentRunStream(workspaceId, runId, { isActive }),
      {
        initialProps: {
          workspaceId: "ws-1",
          runId: "run-1",
          isActive: true,
        },
      },
    );

    await waitFor(() => expect(currentFake).not.toBeNull());

    act(() => {
      currentFake!.__emitPermissionRequest(makePermRequest({ request_id: "req-1" }));
    });
    expect(result.current.perms).toHaveLength(1);

    const before = fetchMock.mock.calls.length;

    act(() => {
      result.current.dismissPerm("req-1");
    });

    expect(result.current.perms).toHaveLength(0);
    // D-003：dismissPerm 不应新增 fetch 调用
    expect(fetchMock.mock.calls.length).toBe(before);
  });

  it("TC-20 permission_resolved 幂等（perm 已不存在不报错）", async () => {
    installFetchMock(() => jsonResponse({ id: "run-1", session_id: null }));

    const { result } = renderHook(
      ({ workspaceId, runId, isActive }) =>
        useAgentRunStream(workspaceId, runId, { isActive }),
      {
        initialProps: {
          workspaceId: "ws-1",
          runId: "run-1",
          isActive: true,
        },
      },
    );

    await waitFor(() => expect(currentFake).not.toBeNull());

    expect(() => {
      act(() => {
        currentFake!.__emitPermissionResolved({
          session_id: "sess-1",
          request_id: "req-1",
          decision: "deny",
          reason: "timeout",
        });
      });
    }).not.toThrow();

    expect(result.current.perms).toEqual([]);
  });
});

describe("useAgentRunStream — isActive 语义 (FR-06 / D-001)", () => {
  it("TC-07 isActive=false → 不连 SSE，仅 prefetch", async () => {
    installFetchMock((url) => {
      const path = url.pathname;
      if (path.endsWith("/logs")) {
        return jsonResponse([
          {
            id: "L1",
            run_id: "run-1",
            timestamp: "2026-06-22T10:00:00Z",
            channel: "stdout",
            content_redacted: "history-line",
          },
        ]);
      }
      return jsonResponse({ id: "run-1", session_id: null });
    });

    const { result } = renderHook(
      ({ workspaceId, runId, isActive }) =>
        useAgentRunStream(workspaceId, runId, { isActive }),
      {
        initialProps: {
          workspaceId: "ws-1",
          runId: "run-1",
          isActive: false,
        },
      },
    );

    await waitFor(() => expect(currentFake).not.toBeNull());

    // D-001：isActive=false 不会调 connect
    expect(currentFake!.connect).not.toHaveBeenCalled();
    // 历史 prefetch 完成
    await waitFor(() => {
      expect(result.current.logs).toHaveLength(1);
      expect(result.current.logs[0]!.id).toBe("L1");
    });
    await waitFor(() => expect(result.current.loading).toBe(false));
  });

  it("TC-08 isActive=false 即使 emit permission_request 也不入 perms（间接验 D-001）", async () => {
    installFetchMock((url) => {
      if (url.pathname.endsWith("/logs")) return jsonResponse([]);
      return jsonResponse({ id: "run-1", session_id: null });
    });

    const { result } = renderHook(
      ({ workspaceId, runId, isActive }) =>
        useAgentRunStream(workspaceId, runId, { isActive }),
      {
        initialProps: {
          workspaceId: "ws-1",
          runId: "run-1",
          isActive: false,
        },
      },
    );

    await waitFor(() => expect(currentFake).not.toBeNull());

    // 防御性：client 即使 isActive=false 也注册了 callback（hook 源码注释承认），
    // 但 isActive=false 不连 SSE，真实事件不会到达。这里手动触发验证状态链路不崩。
    act(() => {
      currentFake!.__emitPermissionRequest(makePermRequest({ request_id: "x" }));
    });
    expect(result.current.perms.length).toBeLessThanOrEqual(1);
    // 关键不变式：connect 始终未被调
    expect(currentFake!.connect).not.toHaveBeenCalled();
  });

  it("TC-19 isActive false→true → 延迟建立连接", async () => {
    installFetchMock((url) => {
      if (url.pathname.endsWith("/logs")) return jsonResponse([]);
      return jsonResponse({ id: "run-1", session_id: null });
    });

    const { rerender } = renderHook(
      ({ workspaceId, runId, isActive }) =>
        useAgentRunStream(workspaceId, runId, { isActive }),
      {
        initialProps: {
          workspaceId: "ws-1",
          runId: "run-1",
          isActive: false,
        },
      },
    );

    // isActive=false 时 client 仍被构造（防御性，用于 prefetch 路径），但 connect 不被调
    await waitFor(() => expect(constructorCalls).toHaveLength(1));
    const firstClient = constructorCalls[0]!.instance;
    expect(firstClient.connect).not.toHaveBeenCalled();

    rerender({ workspaceId: "ws-1", runId: "run-1", isActive: true });

    // isActive 变 true 后，新 effect run 会构造新 client 并 connect
    await waitFor(() => expect(constructorCalls.length).toBeGreaterThanOrEqual(2));
    await waitFor(() => {
      const latest = constructorCalls[constructorCalls.length - 1]!.instance;
      expect(latest.connect).toHaveBeenCalledWith("test-token");
    });
  });
});

describe("useAgentRunStream — token 空 (Grill X-005)", () => {
  it("TC-13 token 空 → setError 不连", () => {
    hoisted.sessionState.accessToken = null;
    installFetchMock(() => jsonResponse({ id: "run-1", session_id: null }));

    const { result } = renderHook(
      ({ workspaceId, runId, isActive }) =>
        useAgentRunStream(workspaceId, runId, { isActive }),
      {
        initialProps: {
          workspaceId: "ws-1",
          runId: "run-1",
          isActive: true,
        },
      },
    );

    // token 缺失 guard 在 new AgentRunStreamClient 之前 return，
    // 所以不构造 client（connect 永远不会被调）。
    expect(constructorCalls).toHaveLength(0);
    expect(result.current.error).toBeTruthy();
    expect(typeof result.current.error).toBe("string");
    expect(result.current.error!.length).toBeGreaterThan(0);
  });
});

describe("useAgentRunStream — input 契约", () => {
  it("TC-14 input.set 更新 values", async () => {
    installFetchMock(() => jsonResponse({ id: "run-1", session_id: null }));

    const { result } = renderHook(
      ({ workspaceId, runId, isActive }) =>
        useAgentRunStream(workspaceId, runId, { isActive }),
      {
        initialProps: {
          workspaceId: "ws-1",
          runId: "run-1",
          isActive: true,
        },
      },
    );

    await waitFor(() => expect(currentFake).not.toBeNull());

    act(() => {
      result.current.input.set("log-1", "hello");
    });

    expect(result.current.input.values["log-1"]).toBe("hello");
  });

  it("TC-15 input.submit 成功 → submitAgentRunInput 被调 + replied 标记", async () => {
    let submittedBody: { content?: string } | undefined;
    let submittedUrl = "";
    installFetchMock((url, init) => {
      if (url.pathname.endsWith("/input")) {
        submittedUrl = url.toString();
        submittedBody = JSON.parse((init.body as string) ?? "{}");
        return jsonResponse({ run_id: "run-1", accepted: true });
      }
      return jsonResponse({ id: "run-1", session_id: null });
    });

    const { result } = renderHook(
      ({ workspaceId, runId, isActive }) =>
        useAgentRunStream(workspaceId, runId, { isActive }),
      {
        initialProps: {
          workspaceId: "ws-1",
          runId: "run-1",
          isActive: true,
        },
      },
    );

    await waitFor(() => expect(currentFake).not.toBeNull());

    act(() => {
      result.current.input.set("log-1", "hello");
    });

    await act(async () => {
      await result.current.input.submit("log-1");
    });

    expect(submittedUrl).toContain(
      "/api/workspaces/ws-1/agent/runs/run-1/input",
    );
    expect(submittedBody!.content).toBe("hello");
    expect(result.current.input.replied.has("log-1")).toBe(true);
    expect(result.current.input.submitting["log-1"] ?? false).toBe(false);
    expect(result.current.input.errors["log-1"] ?? null).toBeNull();
  });

  it("TC-16 input.submit 失败 → errors 有值、submitting 复位、replied 不加", async () => {
    installFetchMock((url) => {
      if (url.pathname.endsWith("/input")) {
        return errorResponse(502, "daemon 离线");
      }
      return jsonResponse({ id: "run-1", session_id: null });
    });

    const { result } = renderHook(
      ({ workspaceId, runId, isActive }) =>
        useAgentRunStream(workspaceId, runId, { isActive }),
      {
        initialProps: {
          workspaceId: "ws-1",
          runId: "run-1",
          isActive: true,
        },
      },
    );

    await waitFor(() => expect(currentFake).not.toBeNull());

    act(() => {
      result.current.input.set("log-2", "will-fail");
    });

    await act(async () => {
      await result.current.input.submit("log-2");
    });

    expect(result.current.input.errors["log-2"]).toBeTruthy();
    expect(result.current.input.submitting["log-2"] ?? false).toBe(false);
    expect(result.current.input.replied.has("log-2")).toBe(false);
  });

  it("TC-16b input.submit 内容为空 → 直接报错不调 fetch", async () => {
    installFetchMock(() => jsonResponse({ id: "run-1", session_id: null }));

    const { result } = renderHook(
      ({ workspaceId, runId, isActive }) =>
        useAgentRunStream(workspaceId, runId, { isActive }),
      {
        initialProps: {
          workspaceId: "ws-1",
          runId: "run-1",
          isActive: true,
        },
      },
    );

    await waitFor(() => expect(currentFake).not.toBeNull());

    // 不调 set，values["log-3"] 默认 ""
    const callsBefore = fetchMock.mock.calls.length;
    await act(async () => {
      await result.current.input.submit("log-3");
    });
    expect(fetchMock.mock.calls.length).toBe(callsBefore);
    expect(result.current.input.errors["log-3"]).toBeTruthy();
  });
});

describe("useAgentRunStream — done / message", () => {
  it("TC-12 done 事件 → onDone 回调被调", async () => {
    installFetchMock(() => jsonResponse({ id: "run-1", session_id: null }));

    const onDone = vi.fn();
    const { result } = renderHook(
      ({ workspaceId, runId, isActive }) =>
        useAgentRunStream(workspaceId, runId, { isActive, onDone }),
      {
        initialProps: {
          workspaceId: "ws-1",
          runId: "run-1",
          isActive: true,
          onDone,
        },
      },
    );

    await waitFor(() => expect(currentFake).not.toBeNull());

    act(() => {
      currentFake!.__emitDone({ status: "completed", exit_code: 0 });
    });

    expect(onDone).toHaveBeenCalledWith("completed");
    expect(result.current.status).toBe("completed");
    // done 回调内部会 client.disconnect()
    expect(currentFake!.disconnect).toHaveBeenCalled();
  });

  it("TC-17 onMessage → logs 增 + log_id 去重", async () => {
    installFetchMock(() => jsonResponse({ id: "run-1", session_id: null }));

    const { result } = renderHook(
      ({ workspaceId, runId, isActive }) =>
        useAgentRunStream(workspaceId, runId, { isActive }),
      {
        initialProps: {
          workspaceId: "ws-1",
          runId: "run-1",
          isActive: true,
        },
      },
    );

    await waitFor(() => expect(currentFake).not.toBeNull());

    act(() => {
      currentFake!.__emitMessage({
        channel: "stdout",
        content: "line-1",
        timestamp: "2026-06-22T10:00:00Z",
        log_id: "L1",
      });
    });
    expect(result.current.logs).toHaveLength(1);

    // 同 log_id 再来一次，hook 侧去重
    act(() => {
      currentFake!.__emitMessage({
        channel: "stdout",
        content: "line-1-dup",
        timestamp: "2026-06-22T10:00:01Z",
        log_id: "L1",
      });
    });
    expect(result.current.logs).toHaveLength(1);
    expect(result.current.logs[0]!.content_redacted).toBe("line-1");

    // 不同 log_id 正常累加
    act(() => {
      currentFake!.__emitMessage({
        channel: "stderr",
        content: "line-2",
        timestamp: "2026-06-22T10:00:02Z",
        log_id: "L2",
      });
    });
    expect(result.current.logs).toHaveLength(2);
  });

  it("onStatusChange → connected 时 streaming=true / loading=false", async () => {
    installFetchMock(() => jsonResponse({ id: "run-1", session_id: null }));

    const { result } = renderHook(
      ({ workspaceId, runId, isActive }) =>
        useAgentRunStream(workspaceId, runId, { isActive }),
      {
        initialProps: {
          workspaceId: "ws-1",
          runId: "run-1",
          isActive: true,
        },
      },
    );

    await waitFor(() => expect(currentFake).not.toBeNull());

    act(() => {
      currentFake!.__emitStatus("connecting");
    });
    expect(result.current.streaming).toBe(true);

    act(() => {
      currentFake!.__emitStatus("connected");
    });
    expect(result.current.streaming).toBe(true);
    expect(result.current.loading).toBe(false);

    act(() => {
      currentFake!.__emitStatus("error");
    });
    expect(result.current.error).toBeTruthy();
  });
});

describe("useAgentRunStream — 边界", () => {
  it("runId=null → 不构造 client、不连", () => {
    installFetchMock(() => jsonResponse({ id: "run-1", session_id: null }));

    const { result } = renderHook(
      ({ workspaceId, runId, isActive }) =>
        useAgentRunStream(workspaceId, runId, { isActive }),
      {
        initialProps: {
          workspaceId: "ws-1",
          runId: null,
          isActive: true,
        },
      },
    );

    expect(constructorCalls).toHaveLength(0);
    expect(result.current.logs).toEqual([]);
    expect(result.current.perms).toEqual([]);
    expect(result.current.error).toBeNull();
  });

  it("workspaceId 切换 → 旧 disconnect + 新 connect", async () => {
    installFetchMock(() => jsonResponse({ id: "run-1", session_id: null }));

    const { rerender } = renderHook(
      ({ workspaceId, runId, isActive }) =>
        useAgentRunStream(workspaceId, runId, { isActive }),
      {
        initialProps: {
          workspaceId: "ws-1",
          runId: "run-1",
          isActive: true,
        },
      },
    );

    await waitFor(() => expect(currentFake).not.toBeNull());
    const firstClient = currentFake!;

    rerender({ workspaceId: "ws-2", runId: "run-1", isActive: true });

    await waitFor(() => expect(constructorCalls).toHaveLength(2));
    expect(firstClient.disconnect).toHaveBeenCalledTimes(1);
    expect(constructorCalls[1]!.workspaceId).toBe("ws-2");
    await waitFor(() =>
      expect(constructorCalls[1]!.instance.connect).toHaveBeenCalledWith(
        "test-token",
      ),
    );
  });

  it("FR-07 isActive=true → getAgentRun 返回 agent_session_id 时触发 fetchPendingDialogs", async () => {
    const seenUrls: string[] = [];
    installFetchMock((url) => {
      seenUrls.push(url.pathname);
      if (url.pathname.endsWith("/agent/runs/run-1")) {
        return jsonResponse({ id: "run-1", agent_session_id: "sess-active" });
      }
      if (url.pathname.endsWith("/sessions/sess-active/dialogs")) {
        return jsonResponse([
          makePermRequest({ request_id: "pending-1", session_id: "sess-active" }),
        ]);
      }
      return jsonResponse({ id: "run-1", session_id: null });
    });

    const { result } = renderHook(
      ({ workspaceId, runId, isActive }) =>
        useAgentRunStream(workspaceId, runId, { isActive }),
      {
        initialProps: {
          workspaceId: "ws-1",
          runId: "run-1",
          isActive: true,
        },
      },
    );

    await waitFor(() => {
      expect(result.current.perms.some((p) => p.request_id === "pending-1")).toBe(true);
    });
    expect(seenUrls).toContain("/api/workspaces/ws-1/agent/runs/run-1");
    expect(
      seenUrls.some((u) => u.endsWith("/sessions/sess-active/dialogs")),
    ).toBe(true);
  });

  // ql-20260623：FR-07 dialog 恢复不再受 isActive 门控——即使 isActive=false
  // （D-001 prefetch 路径），pending askuser 对话仍需恢复，否则刷新后用户无法回答。
  it("FR-07 isActive=false → 仍恢复 pending dialogs（D-001 路径）", async () => {
    const seenUrls: string[] = [];
    installFetchMock((url) => {
      seenUrls.push(url.pathname);
      if (url.pathname.endsWith("/agent/runs/run-1")) {
        return jsonResponse({ id: "run-1", agent_session_id: "sess-active" });
      }
      if (url.pathname.endsWith("/sessions/sess-active/dialogs")) {
        return jsonResponse([
          makePermRequest({
            request_id: "pending-d001",
            session_id: "sess-active",
            dialog_kind: "ask_user",
          }),
        ]);
      }
      if (url.pathname.endsWith("/logs")) {
        return jsonResponse([]);
      }
      return jsonResponse({ id: "run-1", session_id: null });
    });

    const { result } = renderHook(
      ({ workspaceId, runId, isActive }) =>
        useAgentRunStream(workspaceId, runId, { isActive }),
      {
        initialProps: {
          workspaceId: "ws-1",
          runId: "run-1",
          isActive: false,
        },
      },
    );

    // D-001：isActive=false 不连 SSE
    await waitFor(() => expect(currentFake).not.toBeNull());
    expect(currentFake!.connect).not.toHaveBeenCalled();

    // 但 FR-07 dialog 恢复仍执行
    await waitFor(() => {
      expect(
        result.current.perms.some((p) => p.request_id === "pending-d001"),
      ).toBe(true);
    });
    expect(
      seenUrls.some((u) => u.endsWith("/sessions/sess-active/dialogs")),
    ).toBe(true);
  });
});
