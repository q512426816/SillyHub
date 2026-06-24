---
id: task-07
title: 新增 lib/token-refresh.ts 单飞锁 + decodeJwtExp
priority: P0
depends_on: [task-06]
blocks: [task-08, task-09, task-10]
requirement_ids: [FR-04]
decision_ids: []
allowed_paths:
  - frontend/src/lib/token-refresh.ts
---

# task-07

> 新增 `frontend/src/lib/token-refresh.ts`:
> - 模块级单飞锁 `inflight`,提供 `ensureFreshAccessToken()` —— 并发调用只发起一次 `/api/auth/refresh`,所有调用共享同一 Promise,成功后写回 `useSession` store。
> - `decodeJwtExp(token)` 工具 —— 仅解析 JWT 的 `exp`/`iat`(不验签),供 task-09 AppShell 主动刷新定时器判断剩余 TTL。
>
> 本任务为 task-06 的实现绿:N 个并发 401 → 只发 1 次 refresh,task-06 单飞用例转绿。
> 同时作为 task-08(三处 401 收口)与 task-09(主动刷新)的依赖锚。

## 修改文件(新增文件)

| 操作 | 文件路径 | 说明 |
|---|---|---|
| 新增 | `frontend/src/lib/token-refresh.ts` | 单飞锁 `ensureFreshAccessToken()` + `decodeJwtExp()` 工具 |

仅新增单文件,不触碰任何现有文件(对 `api.ts` / `auth.ts` / `ppm/export.ts` / `app-shell.tsx` 的改造分别由 task-08、task-09 负责)。

## 覆盖来源

| 来源 | 章节 | 要点 |
|---|---|---|
| `design.md` §5 Phase 2 | 前端单飞锁 + 主动刷新 | 新增 `token-refresh.ts`:模块级 `inflight`,`ensureFreshAccessToken()` 单飞 |
| `design.md` §6 文件变更清单 | `frontend/src/lib/token-refresh.ts`(新增) | `ensureFreshAccessToken()` 单飞锁 + `decodeJwtExp()` 工具 |
| `design.md` §7 接口定义(前端 token-refresh.ts) | 完整代码 | `inflight`、`ensureFreshAccessToken`、`doRefresh`、`decodeJwtExp` |
| `requirements.md` FR-04 | 前端单飞刷新锁 | 并发调用 `ensureFreshAccessToken()` 仅发起 1 次 refresh;共享结果;成功更新 store |
| `plan.md` task-07 | Wave 3 | 模块级 `inflight` + `ensureFreshAccessToken()` + `decodeJwtExp()`;task-06 转绿 |

## 实现要求

1. **单文件、纯模块级状态**:不引入 class、不引入 React 依赖,确保在非组件上下文(apiFetch、auth.ts 普通函数、AppShell useEffect)都能直接调用。
2. **single-flight 语义**:模块级 `let inflight: Promise<SessionTokens | null> | null = null`。
   - 进入 `ensureFreshAccessToken()` 时若 `inflight` 已存在 → `await inflight` 复用,**不**新建 Promise。
   - 不存在 → `inflight = doRefresh()`,`try/await`,`finally { inflight = null }`,保证异常路径也清空(避免死锁:后续调用永远 await 一个已 reject 的 Promise)。
3. **成功写回 store**:refresh 成功后调 `useSession.getState().setTokens(tokens)`,让后续请求(含 task-08 的 retry)读到新 token。
4. **返回值**:`ensureFreshAccessToken()` 返回 `string | null`(新 access token 或 null),便于 task-08 直接用作 retry 判定;不返回完整 `SessionTokens`,store 才是唯一持久化处。
5. **decodeJwtExp 仅解析不验签**:前端只需读 `exp`/`iat` 算剩余 TTL,验签在后端;异常返回 `null`,不抛(调用方 task-09 静默跳过)。
6. **跨平台**:只用标准 `fetch` / `atob` / `JSON.parse`,Windows 与 macOS 浏览器通用(AC-08);**不**依赖 `crypto.subtle`(那是验签才需要的)。
7. **不引入新依赖**:复用 `@/stores/session` 的 `useSession`/`SessionTokens` 类型与 `@/lib/api` 的 `getApiBaseUrl`,无新增 npm 包。

## 接口定义(完整 TypeScript 实现)

> 搬砖工照做。以下为 `frontend/src/lib/token-refresh.ts` 的**完整内容**,逐字落地即可。

```typescript
/**
 * Single-flight access-token refresh.
 *
 * 多个并发调用者(如同时收到 401 的 N 个请求、AppShell 主动续期、auth.ts)共享同一次
 * `/api/auth/refresh` 的结果,避免并发刷新命中后端 reuse-attack 导致误吊销全部 session。
 *
 * 仅负责"发起一次刷新 + 写回 store";具体哪个调用点触发由 task-08(三处 401 收口)与
 * task-09(AppShell 主动刷新)决定。
 */
import { useSession, type SessionTokens } from "@/stores/session";
import { getApiBaseUrl } from "@/lib/api";

/** 模块级单飞 Promise:存在时所有新调用复用它,而非发起新请求。 */
let inflight: Promise<SessionTokens | null> | null = null;

/**
 * 确保拿到一个"尽可能新鲜"的 access token:若当前没有进行中的刷新则发起一次,
 * 否则等待已进行中的刷新完成。并发调用只触发 **1 次** `POST /api/auth/refresh`。
 *
 * @returns 新的 access token;无法刷新(未登录 / 未 hydrate / refresh 失败)时返回 null。
 */
export async function ensureFreshAccessToken(): Promise<string | null> {
  const { refreshToken, hydrated } = useSession.getState();
  // 未登录或 store 尚未 hydrate(persist 异步):不猜测 refresh token,直接放行给上层处理。
  if (!refreshToken || !hydrated) return null;

  // 已有进行中的刷新:复用,不再发起新请求(单飞核心)。
  if (inflight) {
    const shared = await inflight;
    return shared?.accessToken ?? null;
  }

  // 没有进行中的刷新:发起一次。
  inflight = doRefresh();
  try {
    const tokens = await inflight;
    if (tokens) {
      useSession.getState().setTokens(tokens);
    }
    return tokens?.accessToken ?? null;
  } finally {
    // 无论成功/失败/异常,都清空 inflight,避免后续调用永远 await 一个已 settle 的 Promise。
    inflight = null;
  }
}

/** 实际发起 refresh 请求。返回新 token 对,失败返回 null(不抛,交由调用方判定)。 */
async function doRefresh(): Promise<SessionTokens | null> {
  const { refreshToken } = useSession.getState();
  if (!refreshToken) return null;

  const resp = await fetch(`${getApiBaseUrl()}/api/auth/refresh`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ refresh_token: refreshToken }),
  });
  if (!resp.ok) return null;

  const pair = (await resp.json()) as {
    access_token: string;
    refresh_token: string;
  };
  return {
    accessToken: pair.access_token,
    refreshToken: pair.refresh_token,
  };
}

/**
 * 解析 JWT 的 exp / iat(仅读 payload,**不验签**)。前端只用于推算剩余 TTL。
 *
 * @returns `{ exp, iat }`(均为秒级 Unix 时间戳);token 格式非法时返回 null(不抛)。
 */
export function decodeJwtExp(
  token: string,
): { exp: number; iat: number } | null {
  try {
    const parts = token.split(".");
    if (parts.length < 2) return null;
    // JWT payload 是 base64url:补齐 padding,把 -_ 还原成 +/ 后用 atob 解。
    const payloadB64url = parts[1];
    const payloadB64 = payloadB64url.replace(/-/g, "+").replace(/_/g, "/");
    const pad = payloadB64.length % 4 === 0 ? "" : "=".repeat(4 - (payloadB64.length % 4));
    // atob 在所有现代浏览器 + Node 16+ 均可用,跨平台(AC-08)。
    const json =
      typeof atob === "function"
        ? atob(payloadB64 + pad)
        : Buffer.from(payloadB64 + pad, "base64").toString("utf-8");
    const claims = JSON.parse(json) as { exp?: number; iat?: number };
    if (typeof claims.exp !== "number" || typeof claims.iat !== "number") {
      return null;
    }
    return { exp: claims.exp, iat: claims.iat };
  } catch {
    // 格式异常 / 非 JWT / base64 损坏:静默返回 null,调用方(task-09)跳过主动刷新。
    return null;
  }
}
```

### 关键类型契约

| 符号 | 来源 | 说明 |
|---|---|---|
| `SessionTokens` | `@/stores/session`(已存在,`{ accessToken: string\|null; refreshToken: string\|null }`) | 直接 import 复用,不重复定义 |
| `useSession.getState()` | `@/stores/session` | zustand store 的非 React 访问入口,解构 `{ refreshToken, hydrated, setTokens }` |
| `getApiBaseUrl()` | `@/lib/api`(已 export,api.ts:29-32) | 浏览器返回 `window.location.origin`(走 Next.js rewrite 代理),SSR 返回 `SERVER_API_BASE_URL` |

## 边界处理

| # | 场景 | 处理 |
|---|---|---|
| 1 | `refreshToken` 缺失(未登录 / 已登出) | `ensureFreshAccessToken()` 入口直接 `return null`,不发起请求 |
| 2 | store 未 `hydrated`(zustand persist 异步恢复中) | `return null`,避免读到空的/旧 persist 数据发起错误刷新;待 hydrate 完成后由 task-09 定时器或下次 401 重新触发 |
| 3 | `doRefresh()` 失败(401 / 网络错 / 非 JSON) | `doRefresh` 内 `!resp.ok` 或异常时返回 `null`;`ensureFreshAccessToken` 返回 `null`,**不写 store**(保留旧 token,交由 task-08 的 401 分支决定 `clear()` + 跳 `/login`) |
| 4 | 并发复用同一 inflight | 进入时 `if (inflight) return (await inflight)?.accessToken ?? null`,**不**覆盖已存在的 inflight,确保 N 个并发调用共享同一 Promise、只发 1 次 refresh(AC-04) |
| 5 | `inflight` 清空时机 | `try/finally`,`finally { inflight = null }` 无论成功/失败/异常都置空,避免后续调用永久 await 一个已 settle 的 Promise(死锁) |
| 6 | `inflight` Promise reject | `doRefresh` 用 `try/catch` 吞掉所有异常转 `null`,inflight 永远 resolve(不 reject),`await inflight` 不会抛;即使因故 reject,`finally` 仍清空 |
| 7 | `decodeJwtExp` 收到非 JWT / 损坏 token | `split('.')` 段数 < 2 或 JSON.parse 失败或 exp/iat 非数字 → `catch` 返回 `null`,**不抛**(task-09 调用方据此静默跳过主动刷新) |
| 8 | 浏览器无 `atob`(极端老环境) | fallback 到 `Buffer.from(..., "base64")`(Node SSR 场景);两者都不可用则进入 catch 返回 null |
| 9 | tab 刷新 / SPA 路由切换 | `inflight` 是模块级变量,页面单例;未 settle 时整页刷新会丢弃(新页面重新 import,`inflight=null`),无泄漏 |

## 非目标

- **不做跨 tab 同步**:不引入 `BroadcastChannel` / `localStorage` 事件广播;多 tab 由后端 grace window(task-05)兜底,前端只保证单 tab 内单飞(design §3 非目标)。
- **不验签 JWT**:`decodeJwtExp` 只读 `exp`/`iat`,签名校验在后端;前端验签无意义且增加复杂度(YAGNI)。
- **不处理 SSE/EventSource 的 token**:SSE 走 `getDirectApiBaseUrl()` 直连后端、不走 `apiFetch`,其 token 续期不在本任务范围。
- **不改 `api.ts`/`auth.ts`/`ppm/export.ts`/`app-shell.tsx`**:三处 401 收口(task-08)、主动刷新定时器(task-09)是独立任务,本任务只提供被依赖的函数。
- **不缓存 token / 不记录上次刷新时间**:主动刷新的触发判定由 task-09 持有,本模块无状态(除 `inflight` 外)。
- **不引入重试 / 退避**:`doRefresh` 失败即返回 null,重试策略由调用方决定。

## 参考

- `design.md` §5 Phase 2、§6(文件清单)、§7(前端 token-refresh.ts 完整代码)、§10 R-04(inflight 生命周期)、§9(未登录返回 null 行为不变)
- `requirements.md` FR-04(单飞刷新锁)
- `plan.md` task-06(测试先行,红)、task-07(本任务,绿)、task-08/09(下游消费)
- 现有源码:
  - `frontend/src/stores/session.ts`:`SessionTokens` 接口、`useSession.getState()` 的 `refreshToken`/`hydrated`/`setTokens`
  - `frontend/src/lib/api.ts:29-32`:`getApiBaseUrl()` 导出(浏览器返回 `window.location.origin`)

## TDD 步骤

> 依赖 task-06 已写好红测试 `frontend/src/lib/__tests__/token-refresh.test.ts`(并发调 `ensureFreshAccessToken` N 次 → 期望只 fetch 1 次 `/api/auth/refresh`)。

1. **读 task-06 测试**:`frontend/src/lib/__tests__/token-refresh.test.ts`,确认 mock 形态(通常 mock `global.fetch` + mock `useSession.getState` / `setTokens`)、断言点(fetch 调用次数 === 1、`setTokens` 被调用一次含新 token、N 个 await 都拿到同一 accessToken)。
2. **按"接口定义"逐字落地** `frontend/src/lib/token-refresh.ts`(本任务 allowed_path 唯一文件)。
3. **跑测试转绿**:
   ```bash
   cd frontend && pnpm test -- token-refresh
   ```
   预期 task-06 的单飞用例从 RED → GREEN。
4. **回归**:确认未破坏其他前端测试(本任务只新增文件,理论上零回归):
   ```bash
   cd frontend && pnpm test
   ```
5. **typecheck**:
   ```bash
   cd frontend && pnpm typecheck
   ```
6. **不自测 api.ts 401**:那是 task-08 的范围;本任务只保证 `token-refresh.ts` 自身可被 import、单飞用例绿。

> 若 task-06 测试尚未落地(顺序倒置),先停下补 task-06,不要为了"让测试过"去改测试逻辑(`CLAUDE.md` 规则 7)。

## 验收标准

| AC | 标准 | 验证 |
|---|---|---|
| AC-07-1 | task-06 单飞用例转绿(并发 N 次 `ensureFreshAccessToken` → fetch 仅 1 次 `/api/auth/refresh`;所有调用返回同一 accessToken;`setTokens` 被调用一次含新 token 对) | `cd frontend && pnpm test -- token-refresh` 全绿 |
| AC-07-2 | `token-refresh.ts` 导出 `ensureFreshAccessToken` 与 `decodeJwtExp` 两个符号,类型分别为 `() => Promise<string\|null>` 与 `(token: string) => { exp: number; iat: number }\|null` | `cd frontend && pnpm typecheck` 通过 |
| AC-07-3 | 模块级 `inflight` 在成功/失败/异常后均被 `finally` 清空(后续调用可再次发起刷新,不死锁) | task-06 测试用例覆盖(连续两轮刷新各发 1 次) |
| AC-07-4 | `decodeJwtExp` 对合法 JWT 返回 `{exp, iat}`;对非 JWT / 损坏 token / 缺 exp|iat 返回 `null` 且不抛 | task-06 测试用例覆盖(若 task-06 未覆盖 decodeJwtExp,本任务补一条最小用例到 task-06 同文件,但**不修改**已有断言) |
| AC-07-5 | 仅新增 `frontend/src/lib/token-refresh.ts`,不触碰 `allowed_paths` 之外的文件 | `git diff --name-only` 只含该文件 |
| AC-07-6 | 前端全量测试零回归(本任务纯新增) | `cd frontend && pnpm test` 全绿 |
