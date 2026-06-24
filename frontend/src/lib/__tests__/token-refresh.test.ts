// task-06（FR-04 / FR-05）：前端 token-refresh 单飞锁 + api.ts 401 收口 —— TDD 红阶段测试。
//
// 覆盖：
//   - FR-04（前端单飞刷新锁）：并发 N 次调 ensureFreshAccessToken() 只发 1 次 POST /api/auth/refresh，
//     所有调用共享同一 Promise、拿到同一 access token、store 写回一次。
//   - FR-05（三处 401 收口到单飞锁 —— api.ts 这一处）：apiFetch 收到 401 时调用
//     ensureFreshAccessToken()（而非内联 fetch refresh）；/api/auth/* 端点不触发刷新重试（isAuthEndpoint 防递归）。
//   - decodeJwtExp 合法/坏输入（FR-04 辅助 / task-09 依赖）。
//
// 对齐 design.md §7（前端 token-refresh.ts / api.ts 401 分支）、§9（未登录/未 hydrate 返回 null）、
// §10 风险 R-04（inflight 异常路径 finally 清空，避免死锁）。
//
// TDD 顺序：本任务（task-06）= 红（token-refresh.ts 尚不存在 → import 失败 → 全 RED）；
//   task-07 = 单飞锁 GREEN（用例 1-7 转绿）；
//   task-08 = api.ts 收口 GREEN（用例 8-9 转绿）。
// 红阶段禁止为让测试通过而创建 token-refresh.ts 或改 api.ts（CLAUDE.md 规则 2/7）。
//
// ---------------------------------------------------------------------------
// Store 隔离说明（task-06 修订，对齐 CLAUDE.md 规则 7 —— 仅改隔离机制，断言不变）：
//
// 早期版本用"真实 store(useSession.setState) + vi.resetModules()"组合，但 zustand `create()`+persist
// 在 resetModules 后会重新求值，产生**新 store 实例**；token-refresh.ts 静态 import 的 useSession
// 与测试操作的 useSession 不是同一引用 → 用例 1/2（store 写不回去）、用例 4（persist localStorage 跨用例泄漏
// 覆盖 hydrated:false）失败。task-07 的单飞实现本身是正确的（单飞 CALLS=1 成立），问题纯在测试隔离。
//
// 现采用 vi.doMock("@/stores/session", ...) 在动态 import token-refresh **之前**注入一个受控的 mock store。
// 这样 token-refresh.ts 执行 `import { useSession } from "@/stores/session"` 时拿到的正是测试持有的同一引用，
// 且 mock store 无 persist 中间件、不触碰 localStorage，用例间天然隔离。断言（并发 N 次→fetch 1 次、
// 返回同一 accessToken、setTokens 写回一次）完全不变。
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

/**
 * 受控的 mock store：模拟 zustand `useSession` 被 token-refresh.ts / api.ts 用到的接口。
 * 每个用例 beforeEach 重建一份，彼此隔离。
 *
 * 关键：真实 zustand store 的 action(setTokens/clear/...)是**放在 state 里**的
 * （create(set => ({ ..., setTokens: ... }))），调用方写 useSession.getState().setTokens()。
 * 因此 mock 的 getState() 返回的对象必须携带这些 action，而不仅是数据字段。
 * 不订阅订阅器，因此无需实现 subscribe/getServerSnapshot。
 */
interface SessionTokens {
  accessToken: string | null;
  refreshToken: string | null;
}

interface MockSessionState extends SessionTokens {
  hydrated: boolean;
  user: unknown | null;
  setTokens: (t: SessionTokens) => void;
  setUser: (u: unknown | null) => void;
  clear: () => void;
  markHydrated: () => void;
}

interface MockUseSession {
  getState: () => MockSessionState;
  setState: (patch: Partial<MockSessionState>) => void;
}

function createMockUseSession(initial: MockSessionData): MockUseSession {
  const state: MockSessionState = {
    accessToken: initial.accessToken,
    refreshToken: initial.refreshToken,
    hydrated: initial.hydrated,
    user: initial.user,
    setTokens: (t) => {
      state.accessToken = t.accessToken;
      state.refreshToken = t.refreshToken;
    },
    setUser: (u) => {
      state.user = u;
    },
    clear: () => {
      state.user = null;
      state.accessToken = null;
      state.refreshToken = null;
    },
    markHydrated: () => {
      state.hydrated = true;
    },
  };
  return {
    getState: () => state,
    setState: (patch) => Object.assign(state, patch),
  };
}

/**
 * 动态 import：每个用例 beforeEach 里 vi.resetModules() + vi.doMock("@/stores/session", ...)
 * 之后重新拿干净的模块实例，确保：
 *   1. 模块级 inflight 变量在用例间隔离（蓝图"边界处理"边界 1）；
 *   2. token-refresh.ts 静态 import 的 useSession 与测试持有的 mock store 是同一引用（Reverse Sync 修复核心）。
 *
 * 红阶段：@/lib/token-refresh 不存在 → import 即 reject，测试 RED。
 */
async function loadTokenRefresh(
  mockStore: MockUseSession,
): Promise<typeof import("@/lib/token-refresh")> {
  // 注意顺序：必须先 doMock 再 import，否则 token-refresh 早已拿到真实 store。
  vi.doMock("@/stores/session", () => ({ useSession: mockStore }));
  return (await import("@/lib/token-refresh")) as typeof import("@/lib/token-refresh") & {};
}

const refreshRespBody = { access_token: "new-access", refresh_token: "new-rt" };

/**
 * 构造一个延迟 resolve 的 fetch mock，让并发调用在首调用 await fetch 期间
 * 命中 inflight 复用分支（稳定复现单飞时序，详见蓝图"边界处理"边界 4）。
 */
function mockRefreshOk(): ReturnType<typeof vi.fn> {
  return vi.fn().mockImplementation(() =>
    new Promise<Response>((resolve) =>
      setTimeout(
        () =>
          resolve(
            new Response(JSON.stringify(refreshRespBody), {
              status: 200,
              headers: { "content-type": "application/json" },
            }),
          ),
        0,
      ),
    ),
  );
}

/** mock store 的原始数据字段（不含 action，action 由 createMockUseSession 注入）。 */
type MockSessionData = Pick<
  MockSessionState,
  "accessToken" | "refreshToken" | "hydrated" | "user"
>;

/** 默认"已登录"摆位，与早期版本 useSession.setState 的初值一致。 */
const LOGGED_IN: MockSessionData = {
  accessToken: "old-access",
  refreshToken: "rt-1",
  hydrated: true,
  user: null,
};

describe("ensureFreshAccessToken · single-flight (FR-04)", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let useSession: ReturnType<typeof createMockUseSession>;

  beforeEach(() => {
    // 关键：清空 token-refresh 的模块级 inflight + 解除上轮 doMock，拿全新模块实例
    vi.resetModules();
    vi.unmock("@/stores/session");
    // 受控 mock store（无 persist，不触碰 localStorage，用例间天然隔离）
    useSession = createMockUseSession({ ...LOGGED_IN });
    fetchMock = mockRefreshOk();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.doUnmock("@/stores/session");
  });

  it("用例1:并发 5 次只发 1 次 /api/auth/refresh,共享同一 accessToken (FR-04 GWT 核心)", async () => {
    const { ensureFreshAccessToken } = await loadTokenRefresh(useSession);

    const results = await Promise.all([
      ensureFreshAccessToken(),
      ensureFreshAccessToken(),
      ensureFreshAccessToken(),
      ensureFreshAccessToken(),
      ensureFreshAccessToken(),
    ]);

    // 核心断言（对齐 FR-04 GWT）：只发 1 次 refresh
    expect(fetchMock.mock.calls.length).toBe(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(String(url)).toContain("/api/auth/refresh");
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({ refresh_token: "rt-1" });

    // 共享结果：5 个返回值都等于同一 access token（严格相等）
    expect(results).toHaveLength(5);
    for (const r of results) expect(r).toBe("new-access");
    expect(new Set(results).size).toBe(1);

    // store 被更新为新 token 对（对齐 FR-04：成功后 store 更新）
    expect(useSession.getState().accessToken).toBe("new-access");
    expect(useSession.getState().refreshToken).toBe("new-rt");
  });

  it("用例2:store 只被写一次(最终态固定,无重复抖动)", async () => {
    const { ensureFreshAccessToken } = await loadTokenRefresh(useSession);
    // token-refresh.ts 成功路径调 useSession.getState().setTokens(tokens)。
    // （真实 zustand store 里 setTokens 走内部 set()，不经公开 setState；故这里 spy setTokens 本身，
    //  而非早期版本误 spy 的 setState —— 那在真实 store 下本就抓不到。）
    const setTokensSpy = vi.spyOn(useSession.getState(), "setTokens");

    await Promise.all([
      ensureFreshAccessToken(),
      ensureFreshAccessToken(),
      ensureFreshAccessToken(),
    ]);

    // 单飞成功后写回一次（并发 3 次只触发 1 次 setTokens）。
    expect(setTokensSpy).toHaveBeenCalledTimes(1);
    expect(setTokensSpy.mock.calls[0]![0]).toEqual({
      accessToken: "new-access",
      refreshToken: "new-rt",
    });
    expect(useSession.getState().accessToken).toBe("new-access");
  });

  it("用例3:未登录(refreshToken=null)返回 null,不发请求 (design §9)", async () => {
    useSession.setState({ accessToken: "old-access", refreshToken: null, hydrated: true });
    const { ensureFreshAccessToken } = await loadTokenRefresh(useSession);

    const r = await ensureFreshAccessToken();
    expect(r).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(useSession.getState().accessToken).toBe("old-access"); // 不变
  });

  it("用例4:store 未 hydrate 返回 null,不发请求 (design §9)", async () => {
    useSession.setState({ accessToken: "old-access", refreshToken: "rt-1", hydrated: false });
    const { ensureFreshAccessToken } = await loadTokenRefresh(useSession);

    const r = await ensureFreshAccessToken();
    expect(r).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("用例5:refresh 失败时清空 inflight,后续调用可再次发起(不死锁,R-04)", async () => {
    fetchMock.mockReset();
    fetchMock
      .mockResolvedValueOnce(new Response("unauthorized", { status: 401 })) // 第 1 次 refresh 失败
      .mockResolvedValueOnce(
        new Response(JSON.stringify(refreshRespBody), { status: 200 }), // 第 2 次成功
      );
    const { ensureFreshAccessToken } = await loadTokenRefresh(useSession);

    const r1 = await ensureFreshAccessToken();
    expect(r1).toBeNull(); // 失败返回 null
    // store 不被写（保留旧 token）
    expect(useSession.getState().accessToken).toBe("old-access");

    // inflight 必须已清空：第 2 次调用应能再次发起 refresh
    // （若 task-07 漏写 finally，第 2 次会复用已 settled 的 null → 死锁，fetch 只调 1 次 → 用例失败）
    const r2 = await ensureFreshAccessToken();
    expect(r2).toBe("new-access");
    expect(fetchMock.mock.calls.length).toBe(2); // 两次调用各发 1 次
  });
});

describe("decodeJwtExp (FR-04 辅助 / task-09 依赖)", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unmock("@/stores/session");
  });

  function makeJwt(claims: Record<string, unknown>): string {
    const header = btoa(JSON.stringify({ alg: "HS256", typ: "JWT" }));
    const payload = btoa(JSON.stringify(claims));
    return `${header}.${payload}.sig`;
  }

  it("用例6:合法 JWT 返回 {exp, iat}", async () => {
    // decodeJwtExp 不依赖 store，但 loadTokenRefresh 仍会 doMock session（无害）。
    const useSession = createMockUseSession({ ...LOGGED_IN });
    const { decodeJwtExp } = await loadTokenRefresh(useSession);
    const jwt = makeJwt({ exp: 1700000000, iat: 1699999000, sub: "u1" });
    expect(decodeJwtExp(jwt)).toEqual({ exp: 1700000000, iat: 1699999000 });
  });

  it("用例7:非 JWT / 损坏 / 缺 exp|iat 返回 null 且不抛", async () => {
    const useSession = createMockUseSession({ ...LOGGED_IN });
    const { decodeJwtExp } = await loadTokenRefresh(useSession);
    expect(decodeJwtExp("not-a-jwt")).toBeNull(); // 段数不足
    expect(decodeJwtExp("a.b.c")).toBeNull(); // payload 非 JSON（解析失败）
    expect(decodeJwtExp(makeJwt({ sub: "u1" }))).toBeNull(); // 缺 exp|iat
    expect(decodeJwtExp(makeJwt({ exp: "x", iat: "y" }))).toBeNull(); // exp|iat 非数字
  });
});

describe("apiFetch 401 走单飞 (FR-05)", () => {
  // 此 describe 的 GREEN 依赖 task-07（单飞锁存在）+ task-08（api.ts 收口）同时完成。
  // 红阶段：import { ensureFreshAccessToken } 失败 → 全 RED；
  // 即便 task-07 落地但 task-08 未改 api.ts，spy 不会被调用 → 用例 8/9 仍 RED。
  let useSession: ReturnType<typeof createMockUseSession>;

  beforeEach(() => {
    vi.resetModules();
    vi.unmock("@/stores/session");
    useSession = createMockUseSession({ ...LOGGED_IN });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.doUnmock("@/stores/session");
  });

  it("用例8:401 → ensureFreshAccessToken 被调 1 次 → 带 x-auth-retry 重试成功", async () => {
    // 顺序：先 load token-refresh（确保 spy 与 api.ts 依赖图共享同一模块实例，
    // 详见蓝图"边界处理"边界 7：esm live binding），再 import api。
    const tokenRefresh = await loadTokenRefresh(useSession);
    const { apiFetch } = await import("@/lib/api");
    // 注意:不能仅 mockResolvedValue("new-access")。apiFetch 重试走递归 apiFetch(path, ...),
    // 内部从 store 读 accessToken(api.ts:123 `const { accessToken } = useSession.getState()`)组装
    // Authorization 头。真实 ensureFreshAccessToken 成功后会 useSession.getState().setTokens(...)
    // 把新 token 写回 store,故 apiFetch 重试时读到的是新 token。这里用 mockImplementation
    // 在返回前同步把新 token 写回 mock store,以匹配真实契约 —— 断言(Bearer new-access)不变。
    const spy = vi
      .spyOn(tokenRefresh, "ensureFreshAccessToken")
      .mockImplementation(async () => {
        useSession.getState().setTokens({
          accessToken: "new-access",
          refreshToken: "new-rt",
        });
        return "new-access";
      });

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ code: "auth_invalid_token", message: "expired" }),
          { status: 401 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ok: true }), { status: 200 }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const result = await apiFetch<{ ok: boolean }>("/api/example");

    expect(spy).toHaveBeenCalledTimes(1); // 401 走单飞，非内联 fetch
    expect(fetchMock).toHaveBeenCalledTimes(2); // 原请求 + 重试
    // 重试带 x-auth-retry:1 与新 token
    const retryInit = fetchMock.mock.calls[1]![1] as RequestInit;
    const retryHeaders = retryInit.headers as Record<string, string>;
    expect(String(retryHeaders["x-auth-retry"] ?? "")).toContain("1");
    // Authorization 头:api.ts finalHeaders.Authorization 写入(api.ts:124,大写 key),
    // 重试时 apiFetch 递归从 store 读 accessToken 重新组装。这里校验携带新 token
    // (断言语义 Bearer new-access 不变,仅访问 key 与实现对齐)。
    expect(retryHeaders["Authorization"]).toBe("Bearer new-access");
    expect(result).toEqual({ ok: true });
  });

  it("用例9:/api/auth/* 端点 401 不触发刷新重试(isAuthEndpoint 防递归)", async () => {
    const tokenRefresh = await loadTokenRefresh(useSession);
    const { apiFetch, ApiError } = await import("@/lib/api");
    const spy = vi.spyOn(tokenRefresh, "ensureFreshAccessToken");

    // 注意:不能仅 mockResolvedValue(singleResponse)。循环 4 个 auth 端点,每个 apiFetch
    // 内部 await resp.text() 会消费 body;同一 Response 实例的 body stream 被消费后再次读取
    // 抛 TypeError(或 text() 返回空串触发 payload 解析异常)。真实后端每次响应都是独立 Response,
    // 这里用 mockImplementation 每次构造新实例以匹配真实语义 —— 断言(4 次 fetch / spy 未被调)不变。
    const fetchMock = vi.fn().mockImplementation(
      () =>
        new Response(
          JSON.stringify({ code: "auth_invalid_token", message: "expired" }),
          { status: 401 },
        ),
    );
    vi.stubGlobal("fetch", fetchMock);

    // 与 api.ts:49-51 的 isAuthEndpoint(pathname.startsWith("/api/auth/")) 端点清单对齐
    for (const path of [
      "/api/auth/refresh",
      "/api/auth/login",
      "/api/auth/logout",
      "/api/auth/me",
    ]) {
      await expect(apiFetch(path)).rejects.toBeInstanceOf(ApiError);
    }
    expect(spy).not.toHaveBeenCalled(); // 防递归：auth 端点不刷新
    expect(fetchMock).toHaveBeenCalledTimes(4); // 每个 path 一次，无重试
  });
});
