---
id: task-08
title: api.ts/ppm-export.ts/auth.ts 三处 401 收口到单飞锁
priority: P1
depends_on: [task-07]
blocks: [task-10]
requirement_ids: [FR-05]
decision_ids: []
allowed_paths:
  - frontend/src/lib/api.ts
  - frontend/src/lib/ppm/export.ts
  - frontend/src/lib/auth.ts
---

# task-08

> 把前端三处各自实现的"401 → 发起 `/api/auth/refresh` → 重试"逻辑,统一收口到 task-07 新增的 `ensureFreshAccessToken()` 单飞锁:
>
> - `frontend/src/lib/api.ts`:`apiFetch` 的 401 分支(line 156-206)——删除内联的 `fetch(.../api/auth/refresh)`、`safeJsonParse(refreshText)`、`setTokens(...)`,改调 `ensureFreshAccessToken()`;拿到新 token 则带 `x-auth-retry: "1"` 重试一次,否则 `clear()` + 跳 `/login`。
> - `frontend/src/lib/ppm/export.ts`:`downloadExcel` 的 401 分支(line 76-108)——删除独立的 `fetch(.../api/auth/refresh)` + `setTokens(...)`,改调 `ensureFreshAccessToken()`;成功则用返回的新 access token 重试 `doFetch` 一次,失败保持原有"clear + 跳 login + 抛 Error"行为。
> - `frontend/src/lib/auth.ts`:`refreshTokens()`(line 55-72)——不再自己 `apiFetch` `/api/auth/refresh`,改为复用同一模块级 `inflight`(通过 `ensureFreshAccessToken()`),失败时抛出与原签名一致的错误,保留 `SessionTokens` 返回契约供既有调用方使用。
>
> 收口后并发 401 风暴只会触发 1 次 refresh(由 task-07 单飞保证),根治"旧 refresh token 命中已 revoked session → revoke_all → 误吊销"的竞态(FR-05 / D-001 前端侧)。

## 修改文件(3 个)

| 操作 | 文件路径 | 说明 |
|---|---|---|
| 修改 | `frontend/src/lib/api.ts` | 401 分支:删除内联 fetch refresh,改调 `ensureFreshAccessToken()`;保留 `x-auth-retry` 与 `isAuthEndpoint` 防递归 |
| 修改 | `frontend/src/lib/ppm/export.ts` | 401 分支:删除独立 fetch refresh,改调 `ensureFreshAccessToken()`;重试用返回的新 access token |
| 修改 | `frontend/src/lib/auth.ts` | `refreshTokens()` 复用同一单飞 inflight(经 `ensureFreshAccessToken()`),消除第三处独立刷新实现 |

## 覆盖来源

| 来源 | 章节 | 要点 |
|---|---|---|
| `design.md` §5 Phase 2 | 前端单飞锁 + 主动刷新 | `api.ts` / `ppm/export.ts` / `auth.ts` 三处 401 刷新收口到 `ensureFreshAccessToken()` |
| `design.md` §6 文件变更清单 | `api.ts` / `ppm/export.ts` / `auth.ts` 三行 | 401 分支改调 `ensureFreshAccessToken()`,删除内联 fetch refresh |
| `design.md` §7 接口定义(前端 api.ts 401 分支改造后) | 完整伪代码 | `newToken = await ensureFreshAccessToken()`;有则带 `x-auth-retry:1` 重试;否则 `clear()` + 跳 `/login` |
| `requirements.md` FR-05 | 三处 401 刷新收口到单飞锁 | 统一调 `ensureFreshAccessToken()`,删除各处内联 fetch refresh;`/api/auth/*` 端点不触发刷新重试(防递归) |
| `plan.md` task-08 | Wave 3 | 删除内联 fetch refresh,改调 `ensureFreshAccessToken()`;保留 `isAuthEndpoint` 防递归 |
| `task-07.md` | 锚任务 | `ensureFreshAccessToken(): Promise<string \| null>` 的签名与语义(单飞、写回 store、失败返回 null) |

## 实现要求(逐文件改造点)

### 1. `frontend/src/lib/api.ts`

- 新增 import:`import { ensureFreshAccessToken } from "@/lib/token-refresh";`(顶部 import 区,与 `useSession` 同区域)。
- 改造 401 分支(现 line 156-206):
  - **删除**:整段内联 `fetch(\`${url.origin}/api/auth/refresh\`, {...})`、`refreshText = await refreshResp.text()`、`safeJsonParse(refreshText)`、`pair = refreshPayload as any`、`setTokens({ accessToken: pair.access_token ?? null, ... })`,以及 `try/catch (fallthrough)` 包裹。
  - **删除**:`else if (!hydrated) { ... }` 注释分支(单飞锁内部已处理未 hydrate → 返回 null,api.ts 不再需要读 `hydrated`)。
  - **保留**:`isAuthEndpoint(url.pathname)` 判定 —— `/api/auth/*` 端点(含 `/api/auth/refresh` 自身)收到 401 时**不**触发刷新重试,直接走 `clear()` + 跳 `/login`,防止"refresh 失败 → 401 → 再 refresh"无限递归。
  - **保留**:`x-auth-retry` 头判定 —— 同一请求最多重试一次,防止单请求无限重试。
  - **新增**:调 `const newToken = await ensureFreshAccessToken();`;若 `newToken` 非空 → `return apiFetch<T>(path, { ...options, headers: { ...headers, "x-auth-retry": "1" }, json, query });`(沿用原重试签名);否则落回 `useSession.getState().clear()` + `window.location.href = "/login"`。
- **不动**:fetch 主流程、`ApiError`、`safeJsonParse`、`isApiErrorPayload`、`getApiBaseUrl`、`getDirectApiBaseUrl`、`isAuthEndpoint`、`resolveUrl`、`safeUUID`、请求头组装、query 编码 —— 本任务只改 401 分支。

### 2. `frontend/src/lib/ppm/export.ts`

- 新增 import:`import { ensureFreshAccessToken } from "@/lib/token-refresh";`。
- 改造 401 分支(现 line 76-108):
  - **删除**:内联 `const { refreshToken, setTokens, hydrated } = useSession.getState();` + `if (refreshToken && hydrated) { fetch(.../api/auth/refresh)... setTokens(...) }` 整段独立刷新实现。
  - **保留**:`if (resp.status === 401)` 外层判定与"仍然 401 → clear + 跳 login + 抛 Error"的兜底(单飞失败 / 二次 401 都会落到这里)。
  - **新增**:在 401 分支内,`const newToken = await ensureFreshAccessToken();`;若 `newToken` 非空 → `resp = await doFetch(newToken);`(用单飞返回的新 access token 重试一次);`doFetch` 函数本身不改。
  - **保留**:`useSession` import 仍用于 `getState()` 读取 `accessToken` 与 `clear()`;若 `ensureFreshAccessToken` 成功已写回 store,这里直接用返回值即可,无需再读 store。
- **不动**:`downloadExcel` 的 URL 构造、query 编码、`doFetch`、`parseFilenameFromContentDisposition`、文件名解析、blob 下载触发保存逻辑。

### 3. `frontend/src/lib/auth.ts`

- 新增 import:`import { ensureFreshAccessToken } from "@/lib/token-refresh";`。
- 改造 `refreshTokens()`(现 line 55-72):
  - **删除**:`apiFetch<TokenPair>("/api/auth/refresh", {...})` 调用与本地 `pair` 解构、`tokens = { accessToken: pair.access_token, refreshToken: pair.refresh_token }`、`setTokens(tokens)` —— 这些副作用由 `ensureFreshAccessToken()` 内部完成(单飞 + 写回 store)。
  - **保留**:`refreshTokens(): Promise<SessionTokens>` 的函数签名与返回类型(既有调用方依赖)。
  - **新增**:`const newAccess = await ensureFreshAccessToken();`;若 `newAccess` 为 null → 抛错(语义对齐原 `Missing refresh token` 与"刷新失败"):推荐 `throw new Error("刷新失败:请重新登录");`;若成功 → 从 store 读回新 token 对返回(`const { accessToken, refreshToken } = useSession.getState(); return { accessToken, refreshToken };`),保持 `SessionTokens` 返回契约。
  - **注意**:`TokenPair` / `fetchMe` / `login` / `logout` 不动 —— 它们走 `apiFetch`(已含 401 收口)或独立 fetch(logout 清理 session),无独立刷新逻辑需改。

## 接口定义(改造前后伪代码)

### 文件 1:`frontend/src/lib/api.ts` — 401 分支

**改造前**(现 line 156-206,内联 fetch refresh):

```typescript
if (
  resp.status === 401 &&
  !String(finalHeaders["x-auth-retry"] ?? "").includes("1") &&
  !isAuthEndpoint(url.pathname)
) {
  try {
    const { refreshToken, setTokens, hydrated } = useSession.getState();
    if (refreshToken && hydrated) {
      const refreshResp = await fetch(`${url.origin}/api/auth/refresh`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-request-id": String(finalHeaders["x-request-id"]) },
        body: JSON.stringify({ refresh_token: refreshToken }),
      });
      const refreshText = await refreshResp.text();
      const refreshPayload = refreshText ? safeJsonParse(refreshText) : null;
      if (refreshResp.ok && refreshPayload && typeof refreshPayload === "object") {
        const pair = refreshPayload as any;
        setTokens({ accessToken: pair.access_token ?? null, refreshToken: pair.refresh_token ?? null });
        return apiFetch<T>(path, { ...options, headers: { ...headers, "x-auth-retry": "1" }, json, query });
      }
    } else if (!hydrated) {
      // Not hydrated yet; don't guess refresh token.
    }
  } catch {
    // fallthrough to original error throw
  }
  useSession.getState().clear();
  if (typeof window !== "undefined") window.location.href = "/login";
}
throw new ApiError(resp.status, errorPayload);
```

**改造后**(调单飞锁):

```typescript
if (
  resp.status === 401 &&
  !String(finalHeaders["x-auth-retry"] ?? "").includes("1") &&
  !isAuthEndpoint(url.pathname)
) {
  // 单飞刷新:并发 401 风暴由 task-07 保证只发 1 次 /api/auth/refresh,写回 store。
  const newToken = await ensureFreshAccessToken();
  if (newToken) {
    // 拿到新 access token,带 x-auth-retry:1 重试一次(防单请求无限重试)。
    return apiFetch<T>(path, {
      ...options,
      headers: { ...headers, "x-auth-retry": "1" },
      json,
      query,
    });
  }
  // 单飞失败(未登录 / refresh 失败 / 未 hydrate):清 session + 跳 login,行为与原实现一致。
  useSession.getState().clear();
  if (typeof window !== "undefined") {
    window.location.href = "/login";
  }
}
throw new ApiError(resp.status, errorPayload);
```

> 搬砖要点:`isAuthEndpoint(url.pathname)` 与 `x-auth-retry` 两个守卫**必须保留**;`ensureFreshAccessToken()` 内部已处理 `hydrated`/`refreshToken` 缺失 → 返回 null,故 api.ts 不再读 `hydrated`。

### 文件 2:`frontend/src/lib/ppm/export.ts` — 401 分支

**改造前**(现 line 76-108,独立 fetch refresh):

```typescript
if (resp.status === 401) {
  const { refreshToken, setTokens, hydrated } = useSession.getState();
  if (refreshToken && hydrated) {
    const refreshResp = await fetch(`${url.origin}/api/auth/refresh`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ refresh_token: refreshToken }),
    });
    if (refreshResp.ok) {
      const refreshPayload = (await refreshResp.json().catch(() => null)) as { access_token?: string | null; refresh_token?: string | null } | null;
      if (refreshPayload?.access_token) {
        setTokens({ accessToken: refreshPayload.access_token, refreshToken: refreshPayload.refresh_token ?? null });
        resp = await doFetch(refreshPayload.access_token);
      }
    }
  }
  if (resp.status === 401) {
    useSession.getState().clear();
    if (typeof window !== "undefined") window.location.href = "/login";
    throw new Error("导出失败:登录已过期,请重新登录");
  }
}
```

**改造后**(调单飞锁):

```typescript
if (resp.status === 401) {
  // 单飞刷新:与 apiFetch 共享同一 inflight,并发导出 + 普通 API 401 只发 1 次 refresh。
  const newToken = await ensureFreshAccessToken();
  if (newToken) {
    resp = await doFetch(newToken);
  }
  // 仍然 401(单飞失败 / 二次 401)→ 清 session 跳 /login,与 apiFetch 行为对齐。
  if (resp.status === 401) {
    useSession.getState().clear();
    if (typeof window !== "undefined") {
      window.location.href = "/login";
    }
    throw new Error("导出失败:登录已过期,请重新登录");
  }
}
```

> 搬砖要点:`doFetch` 不改;单飞成功后 `doFetch(newToken)` 用返回的新 access token 直接重试,不再本地 `setTokens`(单飞内部已写回 store)。

### 文件 3:`frontend/src/lib/auth.ts` — `refreshTokens()`

**改造前**(现 line 55-72,自己 apiFetch refresh):

```typescript
export async function refreshTokens(): Promise<SessionTokens> {
  const { refreshToken } = useSession.getState();
  if (!refreshToken) {
    throw new Error("Missing refresh token");
  }
  const pair = await apiFetch<TokenPair>("/api/auth/refresh", {
    method: "POST",
    json: { refresh_token: refreshToken },
  });
  const tokens = { accessToken: pair.access_token, refreshToken: pair.refresh_token };
  useSession.getState().setTokens(tokens);
  return tokens;
}
```

**改造后**(复用同一单飞 inflight):

```typescript
export async function refreshTokens(): Promise<SessionTokens> {
  const { refreshToken } = useSession.getState();
  if (!refreshToken) {
    throw new Error("Missing refresh token");
  }
  // 复用 token-refresh 模块级 inflight,与 apiFetch/ppm-export 三处共用同一次刷新,
  // 避免本函数与并发 401 各发一次 refresh 触发 reuse-attack。
  const newAccess = await ensureFreshAccessToken();
  if (!newAccess) {
    throw new Error("刷新失败:请重新登录");
  }
  // 单飞成功已写回 store,从 store 读回完整 token 对,保持 SessionTokens 返回契约。
  const { accessToken, refreshToken: newRefresh } = useSession.getState();
  return { accessToken, refreshToken: newRefresh };
}
```

> 搬砖要点:函数签名与返回类型 `Promise<SessionTokens>` 不变(既有调用方无需改动);失败抛错语义对齐原实现(原 `Missing refresh token` 保留,新增"刷新失败"分支)。

## 边界处理

| # | 场景 | 处理 |
|---|---|---|
| 1 | `/api/auth/*` 端点自身收到 401(含 `/api/auth/refresh`、`/api/auth/login` 等) | `isAuthEndpoint(url.pathname)` 守卫 → **不**调 `ensureFreshAccessToken()`,直接走 `clear()` + 跳 `/login`,防止"refresh 401 → 触发刷新 → 又 401 → 再刷新"无限递归(api.ts 保留 `isAuthEndpoint` 判定) |
| 2 | `ensureFreshAccessToken()` 返回 null(未登录 / 未 hydrate / refresh 失败) | api.ts / ppm-export.ts 均落回原 `clear()` + `window.location.href = "/login"` 兜底;auth.ts `refreshTokens()` 抛 `Error("刷新失败:请重新登录")`,语义对齐原"Missing refresh token"(边界 1, design §9) |
| 3 | 单请求无限重试防护 | `x-auth-retry: "1"` 头判定保留:重试请求带上该头后,二次 401 不再触发刷新,直接抛 `ApiError`(防 401→refresh→401→refresh 死循环)(api.ts 改造后代码保留 `!String(finalHeaders["x-auth-retry"] ?? "").includes("1")`) |
| 4 | 三处共用同一模块级 inflight | `ensureFreshAccessToken()` 来自 `@/lib/token-refresh`,模块级 `let inflight`(task-07 定义);api.ts、ppm-export.ts、auth.ts 三处 import 同一符号,并发调用只发 1 次 `/api/auth/refresh`,根治竞态(FR-05 / AC-04) |
| 5 | auth 端点自身 401 直接 clear 不刷新 | api.ts 401 分支顶层 `if (... && !isAuthEndpoint(url.pathname))` 守卫:`isAuthEndpoint` 为 true 时整个 if 体不进入,直接 `throw new ApiError(401, ...)`(由调用方处理);refresh/login/logout 端点的 401 不会被误触发刷新 |
| 6 | ppm-export.ts 重试后仍 401 | 单飞返回新 token 但新 token 也被拒(罕见,如权限刚被吊销)→ `doFetch(newToken)` 返回 401 → 外层 `if (resp.status === 401)` 兜底 `clear()` + 跳 login + 抛 Error,行为与原实现一致 |
| 7 | auth.ts `refreshTokens()` 在未 hydrate 时被调用 | `ensureFreshAccessToken()` 内部 `if (!refreshToken \|\| !hydrated) return null`(task-07 边界 2)→ `newAccess` 为 null → 抛 `Error("刷新失败:请重新登录")`;不会用空/旧 persist 数据发起错误刷新 |
| 8 | tab 刷新 / SPA 路由切换时 `inflight` 未 settle | `inflight` 是 `token-refresh` 模块级变量,页面单例;整页刷新会丢弃(task-07 边界 9),新页面重新 import `inflight=null`,三处调用点无残留状态,无泄漏 |

## 非目标

- **不改 `apiFetch` 的其它逻辑**:请求头组装、query 编码、`ApiError` 构造、`safeJsonParse`、`isApiErrorPayload`、`getApiBaseUrl`/`getDirectApiBaseUrl`、`resolveUrl`、`safeUUID` —— 本任务只替换 401 分支内的刷新实现。
- **不改 `downloadExcel` 主体**:URL 构造、`doFetch`、`parseFilenameFromContentDisposition`、blob 下载触发保存逻辑全部不动,只替换 401 分支内的刷新实现。
- **不改 `login` / `logout` / `fetchMe`**:`login` 走 `apiFetch`(已含收口)、`logout` 是清理 session 的独立 fetch(不刷新)、`fetchMe` 走 `apiFetch` —— 均无独立刷新逻辑需改。
- **不新增跨 tab 同步**:多 tab 由后端 grace window(task-05)兜底,前端只保证单 tab 单飞(design §3 非目标)。
- **不改 `token-refresh.ts`**:那是 task-07 的 allowed_path,本任务只消费其导出的 `ensureFreshAccessToken`。
- **不改 `app-shell.tsx`**:主动刷新定时器是 task-09 的范围。
- **不引入重试/退避策略**:单飞失败即落回 clear+login,重试由 `x-auth-retry` 单次守卫保证。
- **不改既有测试断言**:若 `api.ts`/`auth.ts` 已有相关测试,只调整 mock(把内联 fetch refresh 的 mock 改为 mock `ensureFreshAccessToken`),不改测试期望行为(`CLAUDE.md` 规则 7)。

## 参考

- `design.md`:
  - §5 Phase 2(前端单飞锁 + 三处 401 收口)
  - §6 文件变更清单(`api.ts` / `ppm/export.ts` / `auth.ts` 三行)
  - §7 接口定义 · 前端 `api.ts` 401 分支(改造后)完整伪代码
  - §9 兼容策略(未登录返回 null 行为不变)
  - §10 R-04(inflight 生命周期)
- `requirements.md` FR-05(三处 401 刷新收口到单飞锁)
- `plan.md` task-08(Wave 3,依赖 task-07,完成标准:删除内联 fetch refresh + 保留 isAuthEndpoint)
- `task-07.md`(锚任务,提供 `ensureFreshAccessToken(): Promise<string | null>` 签名与语义)
- 现有源码:
  - `frontend/src/lib/api.ts:49-51` `isAuthEndpoint`(pathname 以 `/api/auth/` 开头判定)
  - `frontend/src/lib/api.ts:156-206` 401 分支(改造前完整代码)
  - `frontend/src/lib/ppm/export.ts:64-70` `doFetch`(重试复用)
  - `frontend/src/lib/ppm/export.ts:76-108` 401 分支(改造前完整代码)
  - `frontend/src/lib/auth.ts:55-72` `refreshTokens`(改造前完整代码)
  - `frontend/src/stores/session.ts:15-18` `SessionTokens` 类型、`useSession.getState()` 的 `clear`/`setTokens`/`hydrated`/`accessToken`/`refreshToken`

## TDD 步骤

> 依赖 task-06(`frontend/src/lib/__tests__/token-refresh.test.ts`,红)已由 task-07 转绿;task-06 中应已包含 `api.ts` 401 重试走单飞的用例(plan.md task-06 覆盖 FR-04+FR-05)。若 task-06 未覆盖 api.ts 401,本任务执行时先补测试用例到同文件(新增用例,**不修改**已有断言,`CLAUDE.md` 规则 7)。

1. **读 task-06 测试**:确认 `api.ts` 401 重试相关用例的 mock 形态(通常 mock `@/lib/token-refresh` 的 `ensureFreshAccessToken` + mock `global.fetch` 返回 401 一次再 200)、断言点(重试时调用 `ensureFreshAccessToken`、未内联 fetch `/api/auth/refresh`、retry 带上 `x-auth-retry:1`)。
2. **读三处源码**:`api.ts:156-206`、`ppm/export.ts:76-108`、`auth.ts:55-72`,确认改造点与"接口定义"伪代码一致。
3. **按"接口定义"逐文件改造**:
   - `api.ts`:加 import,替换 401 分支为 `ensureFreshAccessToken()` 调用,保留 `isAuthEndpoint` + `x-auth-retry` 守卫。
   - `ppm/export.ts`:加 import,替换 401 分支为 `ensureFreshAccessToken()` + `doFetch(newToken)`,保留 clear+login 兜底。
   - `auth.ts`:加 import,`refreshTokens()` 改调 `ensureFreshAccessToken()`,失败抛错,成功从 store 读回返回。
4. **跑测试转绿**:
   ```bash
   cd frontend && pnpm test -- token-refresh
   ```
   预期 task-06 的单飞 + api 401 用例全绿。
5. **回归**:
   ```bash
   cd frontend && pnpm test
   ```
   全绿(若有 api/auth 相关既有测试因 mock 形态变化失败,只调整 mock 不改断言)。
6. **typecheck**:
   ```bash
   cd frontend && pnpm typecheck
   ```
7. **grep 自检**:确认三处不再有内联 `/api/auth/refresh`(见验收标准 AC-08-3)。

> 若 task-06 测试尚未覆盖 api.ts 401,先停下补 task-06 用例(红),再改实现(绿),不要为了"让测试过"去改测试逻辑(`CLAUDE.md` 规则 7)。

## 验收标准

| AC | 标准 | 验证 |
|---|---|---|
| AC-08-1 | `api.ts` 401 分支调 `ensureFreshAccessToken()`,拿到新 token 则带 `x-auth-retry: "1"` 重试一次,否则 `clear()` + 跳 `/login`;`isAuthEndpoint` 与 `x-auth-retry` 守卫保留 | 读 `frontend/src/lib/api.ts` 401 分支代码;`cd frontend && pnpm test -- token-refresh` 中 api 401 用例绿 |
| AC-08-2 | `ppm/export.ts` 401 分支调 `ensureFreshAccessToken()`,成功用返回的新 access token 重试 `doFetch`;失败落回 `clear()` + 跳 `/login` + 抛 Error | 读 `frontend/src/lib/ppm/export.ts` 401 分支代码 |
| AC-08-3 | 三处均无内联 `/api/auth/refresh` fetch | `cd frontend && grep -rn "/api/auth/refresh" src/lib/api.ts src/lib/ppm/export.ts src/lib/auth.ts` —— **仅** `auth.ts` 的 `refreshTokens` 注释或 `token-refresh.ts` import 可存在,源码内不得有 `fetch(.../api/auth/refresh...)` 字面量(api.ts/ppm-export.ts/auth.ts 三文件内 grep 结果应为空) |
| AC-08-4 | `auth.ts` `refreshTokens()` 复用 `ensureFreshAccessToken()`,签名 `() => Promise<SessionTokens>` 不变,失败抛 `Error` | 读 `frontend/src/lib/auth.ts:55-72`;`cd frontend && pnpm typecheck` 通过 |
| AC-08-5 | `/api/auth/*` 端点 401 不触发刷新(防递归) | api.ts 401 分支顶层 `!isAuthEndpoint(url.pathname)` 守卫保留;task-06 测试若有对应用例须绿 |
| AC-08-6 | 仅改 `allowed_paths` 内三文件,不触碰 `token-refresh.ts`/`app-shell.tsx`/其它 | `cd frontend && git diff --name-only` 只含 `src/lib/api.ts`、`src/lib/ppm/export.ts`、`src/lib/auth.ts`(及测试文件) |
| AC-08-7 | typecheck 通过 | `cd frontend && pnpm typecheck` 全绿 |
| AC-08-8 | 前端全量测试零回归 | `cd frontend && pnpm test` 全绿 |
