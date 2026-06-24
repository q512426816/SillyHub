---
author: qinyi
created_at: 2026-06-24 11:17:15
id: task-06
title: 前端测试 token-refresh 单飞 + api 401(TDD 红)
priority: P1
depends_on: []
blocks: [task-07, task-08]
requirement_ids: [FR-04, FR-05]
decision_ids: []
allowed_paths:
  - frontend/src/lib/__tests__/token-refresh.test.ts
---

# task-06

## 修改文件

- `frontend/src/lib/__tests__/token-refresh.test.ts` —— **新增**文件,用 vitest + jsdom 覆盖:
  - `ensureFreshAccessToken()` 的 **single-flight** 语义:并发 N 次调用只发起 1 次 `POST /api/auth/refresh`,所有调用共享同一 Promise、拿到同一 access token、`setTokens` 被调用一次含新 token 对(覆盖 **FR-04**)。
  - `ensureFreshAccessToken()` 在 refresh 失败 / 未登录 / 未 hydrate 时返回 `null` 且**不**写 store、**不**发请求的边界。
  - `decodeJwtExp()` 对合法 JWT 返回 `{exp, iat}`、对非 JWT / 损坏 token / 缺 exp|iat 返回 `null` 且不抛。
  - 守护 **FR-05** 契约断言:`apiFetch` 收到 401 时调用 `ensureFreshAccessToken()`(而非内联 fetch refresh);`/api/auth/*` 端点自身不触发重试(`isAuthEndpoint` 防递归)。

> 本任务是 TDD 的"先写测试(红)"步骤。此时 `frontend/src/lib/token-refresh.ts` 尚不存在(task-07 才新增)、`api.ts` 401 分支仍是内联 fetch(task-08 才收口到 `ensureFreshAccessToken`),因此本测试文件**应当失败(RED)**(import `token-refresh` 即报模块找不到 / `api.ts` 不再触发内联 refresh 断言失败);task-07/08 实现后转绿(GREEN)。**禁止**为让本任务通过而提前实现 `token-refresh.ts` 或改 `api.ts`(`CLAUDE.md` 规则 2/7)。

## 覆盖来源

- 需求:
  - `FR-04`(前端单飞刷新锁):浏览器单 tab,N 个并发请求同时收到 401,store 内为同一 refreshToken → 各自调用 `ensureFreshAccessToken()` → 仅发起 **1 次** `POST /api/auth/refresh`;所有调用共享同一结果;成功后 store 更新为新 token。本任务用 `Promise.all` 直接并发调用 `ensureFreshAccessToken()` 模拟"N 个 401 同时触发",断言 `fetch.mock.calls.length === 1`。
  - `FR-05`(三处 401 刷新收口到单飞锁):`api.ts` 的 401 分支需统一调用 `ensureFreshAccessToken()`、删除内联 fetch refresh;`/api/auth/*` 端点不触发刷新重试。本任务对 `api.ts` 用**行为级断言**守护(见"接口定义"用例 6/7),具体对 `ppm/export.ts`、`auth.ts` 的收口断言由 task-08 内联测试覆盖,本文件不重复。
- 设计:
  - `design.md` §7 接口定义 · 前端 `token-refresh.ts`:`inflight: Promise<SessionTokens | null> | null`、`ensureFreshAccessToken(): Promise<string | null>`、`doRefresh()`、`decodeJwtExp()` 的完整签名与返回值。
  - `design.md` §7 接口定义 · 前端 `api.ts` 401 分支(改造后):`const newToken = await ensureFreshAccessToken(); if (newToken) { return apiFetch(..., { headers: { ...headers, "x-auth-retry": "1" } }) } useSession.getState().clear(); window.location.href = "/login"`。
  - `design.md` §9 兼容策略:未登录 / refresh token 缺失时 `ensureFreshAccessToken()` 返回 `null`,401 分支走原 `clear()` + 跳 `/login`,行为不变。
  - `design.md` §10 风险 R-04(`inflight` 在异常路径需 `finally` 清空,避免死锁)。
- 计划:
  - `plan.md` task-06:并发调 `ensureFreshAccessToken` N 次只发 1 次 `/api/auth/refresh`;此时失败(红)。验证命令 `cd frontend && pnpm test -- token-refresh`(预期 RED)。
  - `plan.md` 覆盖矩阵:FR-04 → task-06/07,AC-04;FR-05 → task-08。
  - `plan.md` AC-04:前端 N 个并发 401 只发起 1 次 `/api/auth/refresh`;AC-07(前后端全绿)。

## 实现要求

1. **TDD 红阶段**:本文件提交时**必须 RED**。RED 的来源是 `token-refresh.ts` 尚不存在 → `import { ensureFreshAccessToken, decodeJwtExp } from "@/lib/token-refresh"` 失败(vitest 报 "Failed to resolve import")。**不要**为了让 import 通过而创建 `token-refresh.ts`(那是 task-07)。提交本任务前运行 `pnpm test -- token-refresh` 确认失败,贴 RED 日志。
2. **遵循 `frontend/src/lib/__tests__/` 既有风格**:
   - `import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"`(对齐 `api.test.ts`、`daemon-session.test.ts`)。
   - mock 全局 `fetch`:用 `vi.stubGlobal("fetch", vi.fn())` 或 `vi.spyOn(globalThis, "fetch")` 二选一,与 `api.test.ts`(`vi.stubGlobal` + `fetchMock.mockReset()`)、`daemon-session.test.ts`(`vi.spyOn` + `beforeEach(vi.restoreAllMocks)`)风格一致。本文件**统一用 `vi.stubGlobal`**(因 `token-refresh.ts` 的 `doRefresh` 直接调 `fetch`,stub 最稳)。
   - mock `useSession`:参考 `daemon-session.test.ts:25-29` 的 `vi.mock("@/stores/session", () => ({ useSession: { getState: () => ({...}) } }))`。本文件需在**每个用例**里重置 store 状态(refreshToken / hydrated / setTokens 的 mock),故用 `vi.doMock` + 动态 import,或直接 `useSession.setState(...)` 操作真实 store —— 推荐后者(见实现要求 3)。
3. **mock `useSession` 的两种方式与选择**:
   - **方式 A(推荐)**:**不** mock `@/stores/session`,直接 import 真实 `useSession`,每个用例在 `beforeEach` 里 `useSession.setState({ accessToken: "old-access", refreshToken: "rt-1", hydrated: true, user: null })` 把 store 摆到"已登录"状态,用 `vi.spyOn(useSession, "getState")` 或直接读 `useSession.getState()` 验证 `setTokens` 被调(用 `vi.spyOn(useSession, "setState")` 捕获)。优点:测真实 store 行为,task-07 的 `useSession.getState().setTokens(...)` 写回逻辑能被真实验证。
   - **方式 B(备选)**:`vi.mock("@/stores/session", ...)` 提供假 `getState()`,但 `setTokens` 的 mock 需每用例重置。缺点:与 task-07 的真实 store 解耦,需手写更多桩。
   - 本任务**采用方式 A**(真实 store + `setState` 摆位),`token-refresh.test.ts` 不 `vi.mock("@/stores/session")`,让 `token-refresh.ts` 内的 `useSession.getState()` 指向真实 store。
4. **模拟并发的关键技巧**:用 `Promise.all([ensureFreshAccessToken(), ensureFreshAccessToken(), ..., ensureFreshAccessToken()])` 触发 N(建议 N=5)次并发。为暴露"非单飞会发 N 次请求"的红状态,让 mock fetch 返回一个**延迟 Promise**(用 `new Promise(resolve => setTimeout(() => resolve(refreshResp), 0))` 或 `vi.advanceTimersByTimeAsync` 配合 `vi.useFakeTimers`),确保第一个调用进入 `await inflight` 前,后续调用已进入函数体并命中 `if (inflight)` 分支。**注意**:若不延迟,jsdom 单线程下 N 个同步 `ensureFreshAccessToken()` 调用可能在第一个 `await fetch` 让出前就全部进入函数体(task-07 实现下 `inflight` 已被赋值,后续命中复用分支)—— 这正是要验证的;红阶段 `token-refresh.ts` 不存在,import 即炸,并发断言用例天然 RED。
5. **断言 `fetch` 调用次数**:`expect(fetchMock.mock.calls.length).toBe(1)`,并进一步断言唯一一次调用的 URL 含 `/api/auth/refresh`、method 为 `POST`、body 含 `{ refresh_token: "rt-1" }`(参考 `daemon-session.test.ts` 的 `fetchCall` helper 模式)。
6. **断言 store 更新**:`expect(useSession.getState().accessToken).toBe("new-access")` 且 `refreshToken` 被替换为新值。若用方式 A,`setTokens` 内部走 `useSession.setState`,读 `getState()` 即可。
7. **断言共享结果**:并发 N 次的 `Promise.all` 结果数组中,每个元素都 `===` 同一个 access token 字符串 `"new-access"`(引用相等),证明共享同一 inflight 结果。
8. **`decodeJwtExp` 用例**:构造一个最小合法 JWT(`header.payload.signature`,payload 为 base64url 编码的 `{exp, iat}` JSON),断言返回 `{exp, iat}`;构造 `{a.b}`(段数不足)、`xxx.yyy`(payload 非 JSON)、`header.{非数字 exp}.sig` 三种非法输入,断言返回 `null` 且不抛。可用 `btoa(JSON.stringify({ exp: 1700000000, iat: 1699999000 }))` 造合法 payload(base64,非 base64url —— 测试时把 `+` `/` 视情况转成 `-` `_` 以覆盖 base64url 分支,或直接用 base64 让 `decodeJwtExp` 的 replace 兼容)。注意 `btoa` 在 jsdom 可用,但若 vitest 跑在纯 node 环境需确认 `atob`/`btoa` 全局存在(jsdom 默认提供)。
9. **FR-05 的 `api.ts` 守护用例**:测 `apiFetch` 401 分支时,**不** `vi.mock("@/lib/token-refresh")`(那样会与真实 import 冲突且失去守护意义);而是 `import { ensureFreshAccessToken } from "@/lib/token-refresh"` 后 `vi.spyOn(tokenRefreshModule, "ensureFreshAccessToken").mockResolvedValue("new-access")`,mock fetch 第一次返回 401、第二次返回 200,断言:
   - `ensureFreshAccessToken` 被调用 **1 次**(证明 401 走单飞而非内联 fetch)。
   - `fetch` 总共被调用 **2 次**(第 1 次原请求 401,第 2 次带 `x-auth-retry: 1` 重试 200)。
   - 重试请求的 headers 含 `x-auth-retry: "1"` 与 `authorization: Bearer new-access`(新 token)。
   - 返回值为第二次的 200 payload。
   > 因 `token-refresh.ts` 红阶段不存在,`import { ensureFreshAccessToken }` 会炸 → 该用例 RED。task-07 落地后转绿的前提是 `api.ts` 已收口(task-08);**若 task-07 已落地但 task-08 未动 api.ts**,此用例仍 RED(401 分支仍是内联 fetch,`ensureFreshAccessToken` 不被调用)—— 这是预期,task-08 收口后才转绿。本用例因此**横跨 task-07/08 的 GREEN**,验收时需说明:本用例 RED 消失需要 task-07 + task-08 **都**完成。
10. **`isAuthEndpoint` 防递归守护用例**(FR-05 后半):对 `/api/auth/refresh`、`/api/auth/login`、`/api/auth/logout`、`/api/auth/me` 路径调用 `apiFetch` 收到 401,断言 `ensureFreshAccessToken` **不**被调用、**不**重试、直接抛 `ApiError(401)`。红阶段:import 失败即炸;绿阶段(task-08):`api.ts` 的 `isAuthEndpoint(url.pathname)` 分支短路重试。
11. **重置模块级 `inflight`**:每个 `beforeEach` 必须 `vi.resetModules()` + 重新动态 `import("@/lib/token-refresh")`,确保模块级 `inflight` 变量在用例间清空(否则上一个用例残留的 settled inflight 会让下一个用例的"只发 1 次"断言失真 —— 真实场景 task-07 的 `finally` 会清空,但测试隔离要显式 reset)。配合动态 import 拿到**新模块实例**,断言才独立。详见"边界处理"边界 1。
12. **文件头注释**:注明覆盖 FR-04/FR-05、对应 design §7 章节、TDD 红→绿顺序(本任务=红,task-07=单飞锁绿,task-08=api 收口绿),与 `daemon-session.test.ts:1-10` 的注释风格对齐。

## 接口定义(测试用例 + 断言伪代码)

### 用例列表

| # | 用例 | 覆盖 | 场景简述 | 预期(本任务=RED) | task-07/08 后(GREEN) |
|---|---|---|---|---|---|
| 1 | `concurrent calls trigger single refresh` | FR-04 GWT 核心 | `Promise.all` 调 `ensureFreshAccessToken()` 5 次,store 已登录(refreshToken="rt-1", hydrated=true) | RED:`import token-refresh` 失败 | GREEN:`fetch.mock.calls.length === 1`;5 个返回值都 `=== "new-access"`;`useSession.getState().accessToken === "new-access"` |
| 2 | `shared inflight writes tokens once` | FR-04 | 同用例 1,额外断言 `setTokens` 等价动作只发生一次(store 最终态固定) | RED:import 失败 | GREEN:store.accessToken/refreshToken 各被写一次最终值,无重复抖动 |
| 3 | `returns null when not logged in` | design §9 | store.refreshToken=null,hydrated=true → 调 `ensureFreshAccessToken()` | RED:import 失败 | GREEN:返回 `null`;`fetch` **0 次调用**;store 不变 |
| 4 | `returns null when store not hydrated` | design §9 | store.refreshToken="rt-1",hydrated=false | RED:import 失败 | GREEN:返回 `null`;`fetch` **0 次调用**;store 不变 |
| 5 | `refresh failure clears inflight and returns null` | design §10 R-04 | mock fetch 返回 401(resp.ok=false)→ 调一次 `ensureFreshAccessToken()`,再调一次 | RED:import 失败 | GREEN:第 1 次返回 `null`;第 2 次仍能触发新 fetch(证明 inflight 已清空,非死锁);fetch 总调用 2 次 |
| 6 | `decodeJwtExp parses valid jwt` | FR-04 辅助(task-09 依赖) | 合法 JWT payload `{exp, iat}` | RED:import 失败 | GREEN:返回 `{exp, iat}` 数字对 |
| 7 | `decodeJwtExp returns null on malformed` | 同上 | 段数不足 / payload 非 JSON / exp|iat 非数字 | RED:import 失败 | GREEN:返回 `null`,不抛 |
| 8 | `apiFetch 401 routes through ensureFreshAccessToken` | FR-05 | `apiFetch("/api/example")` 首次 401,refresh 单飞成功("new-access"),重试 200 | RED:`import ensureFreshAccessToken` 失败 或 api.ts 仍内联 fetch(未调单飞) | GREEN(需 task-07 **+ task-08**):`ensureFreshAccessToken` spy 被调 1 次;fetch 总 2 次;重试带 `x-auth-retry:1` + `Bearer new-access`;返回 200 payload |
| 9 | `apiFetch skips refresh on auth endpoints` | FR-05 | `apiFetch("/api/auth/refresh")` 等 401 | RED:import 失败 | GREEN(task-08):`ensureFreshAccessToken` **0 次调用**;不重试;抛 `ApiError(401)` |

### 断言伪代码

```typescript
// frontend/src/lib/__tests__/token-refresh.test.ts
// 覆盖:FR-04(单飞刷新锁)、FR-05(api.ts 401 收口 + isAuthEndpoint 防递归)。
// TDD:本任务=RED(token-refresh.ts 不存在),task-07=单飞锁 GREEN,task-08=api.ts 收口 GREEN。
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import { useSession } from "@/stores/session";

// 动态 import:每用例 vi.resetModules 后重新拿干净模块实例,
// 确保模块级 inflight 在用例间隔离(详见边界 1)。
async function loadTokenRefresh() {
  return (await import("@/lib/token-refresh")) as typeof import("@/lib/token-refresh");
}

const refreshRespBody = { access_token: "new-access", refresh_token: "new-rt" };

function mockRefreshOk() {
  // 延迟 resolve,让并发调用在首调用 await 期间命中 inflight 复用分支
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

describe("ensureFreshAccessToken · single-flight (FR-04)", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.resetModules(); // 关键:清空 token-refresh 的模块级 inflight
    useSession.setState({
      accessToken: "old-access",
      refreshToken: "rt-1",
      hydrated: true,
      user: null,
    });
    fetchMock = mockRefreshOk();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    useSession.setState({ accessToken: null, refreshToken: null, hydrated: false, user: null });
  });

  it("用例1:并发 5 次只发 1 次 /api/auth/refresh,共享同一 accessToken", async () => {
    const { ensureFreshAccessToken } = await loadTokenRefresh();

    const results = await Promise.all([
      ensureFreshAccessToken(),
      ensureFreshAccessToken(),
      ensureFreshAccessToken(),
      ensureFreshAccessToken(),
      ensureFreshAccessToken(),
    ]);

    // 核心断言(对齐 FR-04 GWT):
    expect(fetchMock.mock.calls.length).toBe(1); // 只发 1 次
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("/api/auth/refresh");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({ refresh_token: "rt-1" });

    // 共享结果:5 个返回值都等于同一 access token(引用相等)
    expect(results).toHaveLength(5);
    for (const r of results) expect(r).toBe("new-access");
    // 且是严格相等(同一字符串字面量)
    expect(new Set(results).size).toBe(1);

    // store 被更新为新 token 对(对齐 FR-04:成功后 store 更新)
    expect(useSession.getState().accessToken).toBe("new-access");
    expect(useSession.getState().refreshToken).toBe("new-rt");
  });

  it("用例2:store 只被写一次(最终态固定,无重复抖动)", async () => {
    const { ensureFreshAccessToken } = await loadTokenRefresh();
    const setStateSpy = vi.spyOn(useSession, "setState");

    await Promise.all([ensureFreshAccessToken(), ensureFreshAccessToken(), ensureFreshAccessToken()]);

    // setTokens 内部走 setState({accessToken, refreshToken})。
    // 成功路径下应仅被调用一次(单飞成功后写回一次)。
    const tokenWrites = setStateSpy.mock.calls.filter(
      (c) => "accessToken" in (c[0] ?? {}),
    );
    expect(tokenWrites.length).toBe(1);
    expect(useSession.getState().accessToken).toBe("new-access");
  });

  it("用例3:未登录(refreshToken=null)返回 null,不发请求", async () => {
    useSession.setState({ refreshToken: null, hydrated: true });
    const { ensureFreshAccessToken } = await loadTokenRefresh();

    const r = await ensureFreshAccessToken();
    expect(r).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(useSession.getState().accessToken).toBe("old-access"); // 不变
  });

  it("用例4:store 未 hydrate 返回 null,不发请求", async () => {
    useSession.setState({ hydrated: false });
    const { ensureFreshAccessToken } = await loadTokenRefresh();

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
    const { ensureFreshAccessToken } = await loadTokenRefresh();

    const r1 = await ensureFreshAccessToken();
    expect(r1).toBeNull(); // 失败返回 null
    // store 不被写(保留旧 token)
    expect(useSession.getState().accessToken).toBe("old-access");

    // inflight 必须已清空:第 2 次调用应能再次发起 refresh(若 finally 漏清会死锁 → 第 2 次复用已 reject/settled)
    const r2 = await ensureFreshAccessToken();
    expect(r2).toBe("new-access");
    expect(fetchMock.mock.calls.length).toBe(2); // 两次调用各发 1 次
  });
});

describe("decodeJwtExp (FR-04 辅助 / task-09 依赖)", () => {
  beforeEach(() => vi.resetModules());

  function makeJwt(claims: Record<string, unknown>): string {
    const header = btoa(JSON.stringify({ alg: "HS256", typ: "JWT" }));
    const payload = btoa(JSON.stringify(claims));
    return `${header}.${payload}.sig`;
  }

  it("用例6:合法 JWT 返回 {exp, iat}", async () => {
    const { decodeJwtExp } = await loadTokenRefresh();
    const jwt = makeJwt({ exp: 1700000000, iat: 1699999000, sub: "u1" });
    expect(decodeJwtExp(jwt)).toEqual({ exp: 1700000000, iat: 1699999000 });
  });

  it("用例7:非 JWT / 损坏 / 缺 exp|iat 返回 null 且不抛", async () => {
    const { decodeJwtExp } = await loadTokenRefresh();
    expect(decodeJwtExp("not-a-jwt")).toBeNull(); // 段数不足
    expect(decodeJwtExp("a.b.c")).toBeNull(); // payload 非 JSON
    expect(decodeJwtExp(makeJwt({ sub: "u1" }))).toBeNull(); // 缺 exp|iat
    expect(decodeJwtExp(makeJwt({ exp: "x", iat: "y" }))).toBeNull(); // exp|iat 非数字
  });
});

describe("apiFetch 401 走单飞 (FR-05)", () => {
  // 此 describe 用例的 GREEN 依赖 task-07(单飞锁存在)+ task-08(api.ts 收口)同时完成。
  // 红阶段:import ensureFreshAccessToken 失败 → RED。
  beforeEach(() => {
    vi.resetModules();
    useSession.setState({
      accessToken: "old-access",
      refreshToken: "rt-1",
      hydrated: true,
      user: null,
    });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    useSession.setState({ accessToken: null, refreshToken: null, hydrated: false, user: null });
  });

  it("用例8:401 → ensureFreshAccessToken 被调 1 次 → 带 x-auth-retry 重试成功", async () => {
    const tokenRefresh = await loadTokenRefresh();
    const { apiFetch } = await import("@/lib/api");
    const spy = vi
      .spyOn(tokenRefresh, "ensureFreshAccessToken")
      .mockResolvedValue("new-access");

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

    expect(spy).toHaveBeenCalledTimes(1); // 401 走单飞,非内联 fetch
    expect(fetchMock).toHaveBeenCalledTimes(2); // 原请求 + 重试
    // 重试带 x-auth-retry:1 与新 token
    const retryInit = fetchMock.mock.calls[1]![1] as RequestInit;
    const retryHeaders = retryInit.headers as Record<string, string>;
    expect(String(retryHeaders["x-auth-retry"] ?? "")).toContain("1");
    expect(retryHeaders["authorization"]).toBe("Bearer new-access");
    expect(result).toEqual({ ok: true });
  });

  it("用例9:/api/auth/* 端点 401 不触发刷新重试(isAuthEndpoint 防递归)", async () => {
    const tokenRefresh = await loadTokenRefresh();
    const { apiFetch, ApiError } = await import("@/lib/api");
    const spy = vi.spyOn(tokenRefresh, "ensureFreshAccessToken");

    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ code: "auth_invalid_token", message: "expired" }),
        { status: 401 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    for (const path of [
      "/api/auth/refresh",
      "/api/auth/login",
      "/api/auth/logout",
      "/api/auth/me",
    ]) {
      await expect(apiFetch(path)).rejects.toBeInstanceOf(ApiError);
    }
    expect(spy).not.toHaveBeenCalled(); // 防递归:auth 端点不刷新
    expect(fetchMock).toHaveBeenCalledTimes(4); // 每个 path 一次,无重试
  });
});
```

> 上述伪代码说明断言意图与 mock 组合方式。实际编写时:(a) `btoa` 在 jsdom 可用(vitest.config `environment: "jsdom"`),若个别用例报 `btoa is not defined` 改用 `Buffer.from(JSON.stringify(claims)).toString("base64")`;(b) `useSession.setState` 是 zustand 原生 API,直接摆位 store 状态最简洁;(c) 用例 8/9 的 `import("@/lib/api")` 与 `import("@/lib/token-refresh")` 需在 `vi.resetModules()` **之后**动态 import,否则 spy 不生效(esm 模块绑定)。

## 边界处理

1. **模块级 `inflight` 的用例间重置(最关键)**:`token-refresh.ts` 的 `inflight` 是模块级 `let`,一旦 settle(task-07 的 `finally` 会清空),理论上下个用例重新 import 即为 `null`。但 vitest 默认缓存模块,连续 `import` 拿到同一实例 → `inflight` 可能残留上用例的 settled Promise。**必须**每个 `beforeEach` 调 `vi.resetModules()` + 动态 `import("@/lib/token-refresh")` 拿新模块实例,保证 `inflight` 初始为 `null`。否则用例 1(并发 5 次发 1 次)跑完后,用例 2 若不 reset,可能命中残留 inflight 导致"0 次请求"假阳性。
2. **mock 全局 `fetch` 的方式**:`token-refresh.ts` 的 `doRefresh` 直接调 `fetch(...)`(裸全局),故 `vi.stubGlobal("fetch", fetchMock)` 最稳;`vi.spyOn(globalThis, "fetch")` 也可但需 `vi.restoreAllMocks()` 还原。本文件统一 `vi.stubGlobal` + `afterEach(vi.unstubAllGlobals())`,与 `daemon-session.test.ts` 的 streamSession 用例风格一致。**注意**:`api.ts` 内部也调 `fetch`,同一 `fetchMock` 会同时接到 `apiFetch` 与 `ensureFreshAccessToken` 的请求 —— 用例 8 正是据此断言 `fetchMock.mock.calls.length === 2`(原请求 + 重试,refresh 走单飞 spy 不计入 fetch)。
3. **mock `useSession` store 的方式**:采用真实 store + `useSession.setState({...})` 摆位(方式 A),不 `vi.mock("@/stores/session")`。理由:`token-refresh.ts` 调 `useSession.getState().setTokens(...)` 写回,真实 store 才能验证"写回新 token"的端到端行为;mock store 会割裂这一验证。每个 `afterEach` 用 `useSession.setState({ accessToken: null, refreshToken: null, hydrated: false, user: null })` 复位,避免 persist 中间件跨用例泄漏(注:jsdom 下 persist 依赖 `localStorage`,setup.ts 已补 polyfill,但测试间 store 实例状态仍需手动复位)。
4. **`Promise.all` 模拟并发的时序**:jsdom 单线程,`ensureFreshAccessToken()` 是 async 函数,函数体在首个 `await` 前同步执行。task-07 实现下,首个调用同步执行到 `inflight = doRefresh()` 后才 `await`,此时 `inflight` 已赋值;后续 4 个调用进入函数体时 `if (inflight)` 为真 → 复用。为**稳定复现**这一时序(避免某些微任务调度下后续调用先于首调用赋值 inflight),让 mock fetch 返回**延迟 Promise**(`setTimeout(resolve, 0)`),拉长首调用在 `await` 处的停留窗口。红阶段无需关心时序(import 即炸),绿阶段(task-07)此延迟保证"5 个调用同步进入函数体时 inflight 已就绪"。
5. **失败时 `inflight` 清空验证(R-04 死锁防护)**:用例 5 显式覆盖 —— refresh 失败(resp.ok=false → doRefresh 返回 null)后,`finally { inflight = null }` 必须执行;第 2 次调用 `ensureFreshAccessToken()` 应能再次发起 refresh(而非复用已 settled 的 null)。若 task-07 漏写 `finally`,第 2 次会复用旧 inflight → 返回 null → `fetch` 只被调 1 次 → 用例 5 断言 `fetch.mock.calls.length === 2` 失败,暴露 bug。
6. **`decodeJwtExp` 的 base64url 兼容**:JWT 规范 payload 是 base64url(`-`/`_` 无 padding),但测试用 `btoa` 产出标准 base64(`+`/`/` 带 padding)。task-07 的 `decodeJwtExp` 用 `.replace(/-/g, "+").replace(/_/g, "/")` 把 base64url 还原成 base64 再 `atob`,故对标准 base64 输入也兼容(无 `-`/`_` 可替换,replace 是 no-op)。测试因此可直接用 `btoa`,无需手造 base64url。额外可加一个"真 base64url"用例:`payload = btoa(JSON.stringify({exp,iat})).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,"")`,断言也能正确解析,覆盖 replace 分支。
7. **`apiFetch` 与 `ensureFreshAccessToken` 的模块绑定(esm live binding)**:用例 8/9 用 `vi.spyOn(tokenRefreshModule, "ensureFreshAccessToken")` 后,`api.ts` 内 `import { ensureFreshAccessToken } from "@/lib/token-refresh"` 拿到的是**同一模块导出的 live binding** —— 仅当 `vi.resetModules()` + 动态 `import` 后,`api.ts` 的依赖图与 spy 指向同一模块实例时 spy 才生效。故用例 8/9 必须在 `beforeEach(vi.resetModules())` 后**先** `await loadTokenRefresh()` 再 `await import("@/lib/api")`,确保两者共享同一模块实例。若顺序颠倒(spy 前静态 import api.ts),`api.ts` 拿到的是旧模块实例,spy 不生效,`ensureFreshAccessToken` 仍调用真实实现。
8. **jsdom `setTimeout(0)` 与 fake timers**:用例 1 用 `setTimeout(resolve, 0)` 延迟 fetch。若全局启了 `vi.useFakeTimers`,需 `vi.advanceTimersByTimeAsync(0)` 或 `vi.runAllTimersAsync()` 推进;本文件**默认不启 fake timers**(真实 `setTimeout` 在 jsdom 可用),保持简单。若个别用例需要可控时序再局部 `vi.useFakeTimers({ toFake: ["setTimeout"] })` + `afterEach(vi.useRealTimers)`。
9. **`isAuthEndpoint` 端点清单同步**:用例 9 的 4 个路径(`/api/auth/refresh|login|logout|me`)必须与 `api.ts:49` 的 `isAuthEndpoint` 实现一致。若 task-08 扩展了 `isAuthEndpoint`(如加 `/api/auth/sessions`),本用例需同步补路径 —— 但那是 task-08 的调整,本任务先按当前 `api.ts:49-58` 的实际端点列表写(task-08 收口时核对)。红阶段 import 即炸,路径清单准确性不影响 RED。

## 非目标

- **不**测 `AppShell` 主动刷新定时器(FR-06 / D-004@v1):那是 task-09 的范围(挂 `useEffect`、每分钟校验 exp、剩余 < 1/3 TTL 触发)。本文件只测 `ensureFreshAccessToken` 与 `decodeJwtExp` 作为**纯函数/模块**的行为,不涉及 React 组件生命周期、定时器、`exp - now` 计算。
- **不**测 `decodeJwtExp` 的验签:它本就不验签(前端无意义),只读 exp/iat。用例 6/7 覆盖"能解析合法 JWT / 对坏输入返回 null 不抛"即可,不测签名篡改场景。
- **不**测 `ppm/export.ts`、`auth.ts` 的 401 收口(FR-05 另外两处):那两处的收口断言由 task-08 内联补到各自测试文件(`frontend/src/lib/__tests__/` 下 ppm/auth 相关),本文件只守护 `api.ts` 这一处 401 → 单飞的路由(因 `api.ts` 是最核心的请求入口,且现有 `api.test.ts` 已建立风格)。
- **不**测跨 tab 同步(design §3 非目标):不引入 `BroadcastChannel` / `storage` 事件;单 tab 单飞即满足 FR-04。
- **不**测真实 HTTP(`/api/auth/refresh` 路由、状态码、DTO):全用 mock fetch,不连真实后端;后端 grace 行为由 task-04/05 后端测试覆盖,端到端由 task-10 curl 覆盖。
- **不**实现 `token-refresh.ts`(本任务=写测试,实现是 task-07);**不**改 `api.ts`(收口是 task-08)。本任务提交时测试为 RED。
- **不**修改 `frontend/src/lib/__tests__/` 下任何现有测试文件(零回归);仅新增 `token-refresh.test.ts` 一个文件。
- **不**引入新 npm 依赖:仅用 vitest 自带 API(`vi`、`describe`、`expect`)与 jsdom 全局(`fetch`、`btoa`、`setTimeout`、`Response`)。

## 参考

现有前端 lib 测试风格(`frontend/src/lib/__tests__/`):

- **`api.test.ts`**:`vi.stubGlobal("fetch", fetchMock)` + `afterEach(fetchMock.mockReset())` + `fetchMock.mockResolvedValueOnce(new Response(...))` 的 mock fetch 模式;`ApiError` 断言 `toMatchObject({ name, status, code, message, requestId })`;`fetch.mock.calls[0]?.[1]` 取 RequestInit 断言 headers。本文件的 `apiFetch` 401 用例(用例 8/9)直接沿用此风格。
- **`daemon-session.test.ts`**:
  - `vi.mock("../../stores/session", () => ({ useSession: { getState: () => ({ accessToken: "test-token" }) } }))` 的 mock store 模式(本文件改用真实 store + setState,因需验证 setTokens 写回)。
  - `vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(...))` 的替代 mock 风格。
  - `fetchCall(fetchMock, n)` helper 取第 N 次调用的 url/init(本文件可内联类似 helper)。
  - 文件头注释风格(标注覆盖的 task/FR/design 章节)。
- **`test/setup.ts`**:`localStorage` polyfill(zustand persist 依赖),本文件用真实 store 时自动受益。
- **`vitest.config.ts`**:`environment: "jsdom"`、`globals: true`(可直接用 `describe`/`it`/`expect` 无需 import,但本文件显式 import 与现有风格一致)、`setupFiles: ["./src/test/setup.ts"]`、alias `@ → ./src`。

现有源码契约:

- `frontend/src/stores/session.ts`:`useSession.getState()` / `useSession.setState(...)` / `SessionTokens = { accessToken: string|null; refreshToken: string|null }` / `setTokens` 内部走 `set({ accessToken, refreshToken })`。
- `frontend/src/lib/api.ts:29-32`:`export function getApiBaseUrl()`(浏览器返回 `window.location.origin`)。
- `frontend/src/lib/api.ts:49-58`:`isAuthEndpoint(pathname)` 守护的端点清单(用例 9 对齐)。
- `frontend/src/lib/api.ts:60-...`:`export class ApiError`。
- `frontend/src/lib/api.ts:156-206`:现状 401 分支(内联 fetch refresh)—— 本任务 RED 的基线;task-08 改造目标。

## TDD 步骤

本变更前端单飞锁的 TDD 节奏:**task-06 = 步骤 1-2(写测试 + 确认 RED)**,task-07 = 步骤 3-4(写单飞锁 + decodeJwtExp,用例 1-7 转绿),task-08 = 步骤 5(收口 api.ts,用例 8-9 转绿)。

1. **(读码·已完成)** 确认 `frontend/src/stores/session.ts`(`useSession.getState`/`setState`/`setTokens`/`SessionTokens`)、`frontend/src/lib/api.ts:29-58,156-206`(`getApiBaseUrl`/`isAuthEndpoint`/`apiFetch` 401 内联分支)、`frontend/src/lib/__tests__/{api,daemon-session}.test.ts`(mock fetch / mock store / 断言风格)、`frontend/src/test/setup.ts`、`frontend/vitest.config.ts`。
2. **(写测试·本任务)** 新建 `frontend/src/lib/__tests__/token-refresh.test.ts`,按"接口定义"9 个用例 + 断言伪代码编写。运行:
   ```bash
   cd frontend && pnpm test -- token-refresh
   ```
   确认 **RED**:
   - 用例 1-7:`Failed to resolve import "@/lib/token-refresh"`(模块不存在)→ 整个文件收集失败或用例全 RED。
   - 用例 8-9:同样因 `import { ensureFreshAccessToken }` 解析失败而 RED;即便强行动态 import 容错,`api.ts` 现状 401 分支仍是内联 fetch,`spy` 不会被调用 → 断言 `spy.toHaveBeenCalledTimes(1)` 失败。
   - RED 确认后,**提交本任务**(测试文件单独提交,不夹带 `token-refresh.ts` 或 `api.ts` 改动)。
3. **(写实现·task-07)** 不在本任务进行。task-07 新增 `frontend/src/lib/token-refresh.ts`,落地 `inflight` + `ensureFreshAccessToken` + `decodeJwtExp`。
4. **(跑测试·task-07)** task-07 实现后,重跑 `pnpm test -- token-refresh` → 用例 1-7(单飞 + decodeJwtExp)转 **GREEN**;用例 8-9 仍 RED(因 `api.ts` 未收口)。
5. **(收口·task-08)** task-08 改 `api.ts` 401 分支调 `ensureFreshAccessToken`、改 `ppm/export.ts`、`auth.ts`;重跑 → 用例 8-9 转 **GREEN**,全文件绿。
6. **(回归·task-08/task-10)** `cd frontend && pnpm test` 全量绿;`pnpm typecheck` 通过。
7. **(更新文档·task-10)** task-10 收口同步 `docs/` 下 `lib-api.md` / 前端 auth 模块文档的单飞锁说明。

> 本任务交付物 = RED 状态的测试文件 + 运行日志证明 RED。**禁止**为让本任务"通过 CI"而提前写 `token-refresh.ts` 或改 `api.ts`(违反 `CLAUDE.md` 规则 2/7:禁止先写代码再补文档 / 禁止改测试逻辑让测试通过 —— 此处反向适用:禁止改实现让红测试变绿,绿化是 task-07/08 的职责)。

## 验收标准

| 编号 | 验收项 | 验证方式 | 通过标准(本任务=RED 阶段) | task-07 后 | task-08 后(全绿) |
|---|---|---|---|---|---|
| AC-06-1 | 测试文件存在且可被 vitest 收集 | `cd frontend && pnpm test -- token-refresh --run` | 文件被收集(vitest 报 `N test files`),但因 import 失败,9 用例全 RED / 文件级 ERROR | 同左 | 9 用例全 PASS |
| AC-06-2 | 用例 1(并发单飞)为 RED | 运行 `... -- token-refresh` | **FAIL**:`Failed to resolve import "@/lib/token-refresh"` | **PASS**:`fetch.mock.calls.length === 1`,5 个返回值都 `=== "new-access"`,store 更新 | 同 task-07 |
| AC-06-3 | 用例 2(store 只写一次)为 RED | 同上 | **FAIL**:import 失败 | **PASS**:`setTokens` 等价 setState 只发生一次 | 同 task-07 |
| AC-06-4 | 用例 3/4(未登录/未 hydrate 返回 null)为 RED | 同上 | **FAIL**:import 失败 | **PASS**:返回 null,fetch 0 次,store 不变 | 同 task-07 |
| AC-06-5 | 用例 5(失败清 inflight 不死锁,R-04)为 RED | 同上 | **FAIL**:import 失败 | **PASS**:第 1 次返回 null,第 2 次重发 refresh,fetch 共 2 次 | 同 task-07 |
| AC-06-6 | 用例 6/7(decodeJwtExp)为 RED | 同上 | **FAIL**:import 失败 | **PASS**:合法 JWT 返回 `{exp,iat}`;坏输入返回 null 不抛 | 同 task-07 |
| AC-06-7 | 用例 8(api 401 走单飞)为 RED | 同上 | **FAIL**:import 失败 **或** spy 未被调用(api.ts 仍内联 fetch) | 仍 **RED**(api.ts 未收口,spy 不被调) | **PASS**:`ensureFreshAccessToken` 被调 1 次,fetch 共 2 次,重试带 `x-auth-retry:1` + `Bearer new-access` |
| AC-06-8 | 用例 9(isAuthEndpoint 防递归)为 RED | 同上 | **FAIL**:import 失败 | 仍 **RED**(api.ts 未收口,可能误触发刷新) | **PASS**:4 个 `/api/auth/*` 路径 401 → spy 0 次,各 fetch 1 次无重试,抛 ApiError(401) |
| AC-06-9 | 仅新增一个测试文件 | `git diff --name-only` | 仅 `frontend/src/lib/__tests__/token-refresh.test.ts` | 同左(task-07 才加 token-refresh.ts) | 同左 |
| AC-06-10 | 未引入新依赖 | 读 `frontend/package.json` diff | 无 vitest/jsdom 之外新增;仅用 `vi`/`fetch`/`btoa`/`setTimeout`/`Response` | 同左 | 同左 |
| AC-06-11 | 未改实现文件 | `git diff --name-only` 排除测试 | 不含 `token-refresh.ts`/`api.ts`/`auth.ts`/`ppm/export.ts`/`app-shell.tsx` | task-07 加 token-refresh.ts | task-08 改 api.ts 等 |
| AC-06-12 | 覆盖 FR-04 GWT | 用例映射 | 用例 1↔FR-04 GWT(并发 1 次 refresh + 共享结果 + store 更新);文件头注释标注 | 同左 | 同左 |
| AC-06-13 | 覆盖 FR-05 契约 | 用例映射 | 用例 8↔FR-05(api.ts 401 收口)、用例 9↔FR-05(isAuthEndpoint 防递归);文件头注释标注 | 同左 | 同左 |
| AC-06-14 | 对齐 AC-04(并发 401 只发 1 次 refresh) | 用例 1 断言 | RED 阶段断言已写,等待实现 | `fetch.mock.calls.length === 1` 命中 | 同左 |
