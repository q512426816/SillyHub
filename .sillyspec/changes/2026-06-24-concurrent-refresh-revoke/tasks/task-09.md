---
id: task-09
title: AppShell 主动刷新定时器
priority: P1
depends_on: [task-07]
blocks: [task-10]
requirement_ids: [FR-06]
decision_ids: [D-004@v1]
allowed_paths:
  - frontend/src/components/app-shell.tsx
---

# task-09

> 在 `frontend/src/components/app-shell.tsx`(dashboard 全局组件)新增一个主动刷新 `useEffect`:
> - 挂载后启动每 60 秒一次的定时器,每次 tick 读 `useSession.getState().accessToken`,
>   用 task-07 的 `decodeJwtExp()` 取 `exp`/`iat`,若剩余有效期 `exp - now < (exp - iat)/3`
>   (即剩余 < 1/3 TTL,30min TTL → 约 10min)则调 `ensureFreshAccessToken()` 主动续期。
> - token 缺失 / 解析失败 / 未登录时静默跳过,不抛错、不跳转。
>
> 目的:把"过期点 401 风暴 + 并发刷新竞态"从被动兜底变成主动前置 —— 在 access token
> 即将到期前用单飞锁续期,避免多个并发请求同时撞到 401 各自发起刷新。复用 task-07 的
> 单飞锁,与 task-08 的 401 被动刷新共享同一 `inflight`,杜绝双重并发刷新。
>
> 覆盖 FR-06、D-004@v1;依赖 task-07(`ensureFreshAccessToken` / `decodeJwtExp` 已落地)。

## 修改文件

| 操作 | 文件路径 | 说明 |
|---|---|---|
| 修改 | `frontend/src/components/app-shell.tsx` | 新增主动刷新 `useEffect`(每 60s tick,剩余 < 1/3 TTL 调 `ensureFreshAccessToken()`);import `ensureFreshAccessToken` / `decodeJwtExp` |

仅修改单文件。**不**触碰 `token-refresh.ts`(task-07)、`api.ts` / `auth.ts` / `ppm/export.ts`(task-08)、`stores/session.ts`。

## 覆盖来源

| 来源 | 章节 | 要点 |
|---|---|---|
| `design.md` §5 Phase 2 | 前端单飞锁 + 主动刷新 | `AppShell` 增加主动刷新 `useEffect`:解析 access token `exp`,剩余 < 1/3 TTL(~10min)时调 `ensureFreshAccessToken()` |
| `design.md` §6 文件变更清单 | `frontend/src/components/app-shell.tsx`(修改) | 增加主动刷新 `useEffect`(定时校验 exp,剩余<1/3 TTL 触发) |
| `design.md` §7 接口定义(前端 AppShell) | D-004 落地点 | AppShell useEffect 定时校验 exp,调单飞锁续期 |
| `requirements.md` FR-06 | AppShell 主动刷新定时器 | 登录态(accessToken 非空)下每分钟校验,`exp - now < (exp - iat)/3` 时自动调 `ensureFreshAccessToken()`;token 缺失/解析失败静默跳过 |
| `decisions.md` D-004@v1 | 主动刷新挂 AppShell、剩余 1/3 TTL 触发 | 挂 `app-shell.tsx`(dashboard 全局组件)的 `useEffect`;解析 access token `exp`;每分钟定时校验;复用单飞锁避免与 401 被动刷新并发竞争 |
| `plan.md` task-09 | Wave 3 | `useEffect` 定时(每分钟)校验 exp,剩余<1/3 TTL 调 `ensureFreshAccessToken()`;token 缺失静默跳过 |

## 实现要求

1. **单 useEffect、标准定时器**:用 `useEffect` + `setInterval`(或递归 `setTimeout`)实现每 60 秒一次的 tick;**不**引入第三方调度库,**不**依赖 `requestAnimationFrame`(后台 tab 会节流,不符合"每分钟"语义)。
2. **每 tick 实时读 store,不闭包旧 token**:tick 回调内通过 `useSession.getState()` 读取**当前** accessToken,而不是 useEffect 闭包捕获的快照(避免 store 更新后定时器仍用旧 token 判定)。useEffect 依赖数组留空 `[]`(只在挂载时启定时器),token 变化靠 `getState()` 动态读取。
3. **触发阈值 = 剩余 < 1/3 TTL**:`const ttl = exp - iat; const remain = exp - now; if (remain < ttl / 3) ensureFreshAccessToken()`。`now` 用 `Math.floor(Date.now() / 1000)`(秒级,与 JWT exp/iat 对齐)。不硬编码 15/30min,完全由 token 自带 `exp`/`iat` 推算(design §9)。
4. **复用单飞锁**:只调 `ensureFreshAccessToken()`,**不**直接 `fetch('/api/auth/refresh')`;与 task-08 的 401 被动刷新共享同一 `inflight`,避免主动+被动同时发起两次刷新(task-07 单飞保证)。
5. **静默跳过、绝不跳转**:`ensureFreshAccessToken()` 失败时 `.catch(() => {})` 吞掉,主动刷新**不**负责登录态清理与跳转 `/login` —— 那是 task-08 api 层 401 分支的职责。主动刷新失败只意味着"这次没续上",等真正 401 时由 api 层处理。
6. **cleanup clearInterval**:useEffect 返回 `() => clearInterval(timer)`,组件卸载时清掉定时器,避免泄漏 / 卸载后仍发请求。
7. **跨平台**:只用标准 `setInterval` / `Date.now()` / `useEffect`(AC-08),Windows 与 macOS 浏览器通用;**不**依赖 ` BroadcastChannel` / `ServiceWorker` / 平台特定 API。
8. **不改既有逻辑**:AppShell 现有的 collapsed localStorage useEffect(line 135-141)、logout 弹窗、菜单渲染等**全部保持不变**;只在合适位置(现有 useEffect 之后)追加一个新的 useEffect,不重构、不挪动既有代码。

## 接口定义(useEffect 完整伪代码)

> 搬砖工照做。以下为要**新增到** `frontend/src/components/app-shell.tsx` 的 import 与 useEffect。插入位置:
> - import 加到现有 `import { useSession } from "@/stores/session";`(line 50)附近。
> - useEffect 加到现有 collapsed localStorage useEffect(line 135-141)**之后**、`toggleCollapsed`(line 143)**之前**。

### 1. 新增 import

```typescript
import { ensureFreshAccessToken, decodeJwtExp } from "@/lib/token-refresh";
```

### 2. 新增 useEffect(完整实现)

```typescript
/**
 * 主动刷新定时器(D-004@v1 / FR-06):
 * 每 60s tick 一次,读当前 accessToken,解析 exp/iat;
 * 若剩余有效期 < 1/3 TTL(30min TTL → 约 10min)则调单飞锁 ensureFreshAccessToken() 续期。
 * - token 缺失 / decode 失败:静默跳过(不抛、不跳转)。
 * - ensureFreshAccessToken 失败:catch 吞掉(401 由 api 层处理,主动刷新不负责登录态清理)。
 * 依赖数组空:只在挂载时启定时器;tick 内用 getState() 读最新 token,避免闭包旧值。
 */
useEffect(() => {
  const REFRESH_INTERVAL_MS = 60_000; // 每分钟校验一次

  const timer = setInterval(() => {
    const { accessToken } = useSession.getState();
    // 未登录 / 已登出:无 token 可续,静默跳过。
    if (!accessToken) return;

    const claims = decodeJwtExp(accessToken);
    // token 非 JWT / 损坏 / 缺 exp|iat:静默跳过(decodeJwtExp 返回 null 不抛)。
    if (!claims) return;

    const now = Math.floor(Date.now() / 1000); // 秒级,与 JWT exp/iat 对齐
    const ttl = claims.exp - claims.iat;        // token 总有效期(秒)
    const remain = claims.exp - now;            // 剩余有效期(秒)

    // remain < ttl/3:剩余不足 1/3 TTL → 触发主动续期。
    // (30min TTL → 约 10min;15min TTL → 约 5min;完全由 token 自带 exp/iat 推算,不硬编码)
    if (remain > 0 && remain < ttl / 3) {
      // 复用单飞锁:与 task-08 的 401 被动刷新共享 inflight,不会并发发起两次 refresh。
      // 失败静默吞掉 —— 主动刷新不负责 clear()/跳转 /login,那是 api 层 401 分支的职责。
      ensureFreshAccessToken().catch(() => {
        /* 静默:刷新失败不跳转,等真正 401 时由 api 层处理 */
      });
    }
  }, REFRESH_INTERVAL_MS);

  // 组件卸载时清掉定时器,避免泄漏 / 卸载后仍发请求。
  return () => clearInterval(timer);
}, []); // 空依赖:只在挂载时启一次;token 变化靠 getState() 动态读取
```

### 关键类型契约

| 符号 | 来源 | 说明 |
|---|---|---|
| `ensureFreshAccessToken` | `@/lib/token-refresh`(task-07 新增) | `() => Promise<string\|null>`;单飞锁,并发调用只发 1 次 refresh,成功写回 store,失败返回 null(不抛) |
| `decodeJwtExp` | `@/lib/token-refresh`(task-07 新增) | `(token: string) => { exp: number; iat: number }\|null`;仅解析不验签,异常返回 null |
| `useSession.getState()` | `@/stores/session`(已存在) | zustand store 非 React 访问入口;解构 `{ accessToken }`,tick 内实时读最新值 |
| `useEffect` / `setInterval` | React 标准库 / 浏览器全局 | 跨平台通用(AC-08) |

## 边界处理

| # | 场景 | 处理 |
|---|---|---|
| 1 | `accessToken` 为 null(未登录 / 已登出 / store 未 hydrate) | tick 入口 `if (!accessToken) return;` 直接跳过,不发请求、不报错;hydrate 完成或重新登录后下一个 tick 自然命中 |
| 2 | `decodeJwtExp(accessToken)` 返回 null(token 非 JWT / 损坏 / 缺 exp\|iat / base64 异常) | `if (!claims) return;` 静默跳过;`decodeJwtExp` 自身已 catch 不抛,本任务无需额外 try/catch |
| 3 | `ensureFreshAccessToken()` 失败(网络错 / 401 / refresh token 失效) | `.catch(() => {})` 吞掉,**不** `clear()`、**不**跳 `/login` —— 主动刷新只负责"尽量续上",登录态清理与跳转是 task-08 api 层 401 分支的职责;本次没续上,等真正 401 时由 api 层兜底 |
| 4 | 组件卸载(路由切到 `/login` / tab 关闭) | useEffect cleanup `return () => clearInterval(timer)`,定时器停止,不再发请求;已 inflight 的 refresh 由 task-07 的 `finally` 自清理,无泄漏 |
| 5 | 跨平台 / 后台 tab 节流 | 只用标准 `setInterval` + `Date.now()` + `useEffect`(AC-08),Windows/macOS 浏览器通用;后台 tab 的 `setInterval` 节流(1Hz)不影响"每分钟"语义(最多略晚触发,阈值已留 1/3 TTL 余量) |
| 6 | 主动刷新与 task-08 被动 401 刷新同时发生 | 共享 task-07 的模块级 `inflight`,单飞保证只发 1 次 `/api/auth/refresh`;主动调 `ensureFreshAccessToken()` 时若已有 inflight 则复用,不会并发第二次 |
| 7 | token 刚续期(remain 充足) | `remain >= ttl/3` 不进入刷新分支,等下一个 60s tick 再判;避免无意义刷新风暴 |
| 8 | `remain <= 0`(token 已过期) | `if (remain > 0 && ...)` 短路,不主动刷新已过期 token —— 这种情况必然会在下一次请求撞 401,由 task-08 被动刷新处理,主动刷新不抢这个点(避免与即将到来的 401 刷新抢锁) |
| 9 | AppShell 多实例(理论可能,如嵌套渲染) | useEffect 挂载多次会启多个定时器,但单飞锁保证仍只发 1 次 refresh;实际 AppShell 为 dashboard 全局单例组件,正常不会多实例;不为此额外去重(参考 design §3 非目标:不做跨实例/跨 tab 同步) |

## 非目标

- **不做跨 tab 同步**:不引入 `BroadcastChannel` / `localStorage` 事件广播;多 tab 由后端 grace window(task-05)兜底(design §3 非目标)。
- **不显示刷新 UI**:主动刷新对用户完全无感,不弹 toast / loading / 状态条;不修改 TopBar / Sidebar / 任何可见组件。
- **不改其它 useEffect**:collapsed localStorage useEffect(line 135-141)、logout 流程、菜单渲染、`useWorkspaceId` 等既有逻辑全部不动,只**追加**一个新的 useEffect。
- **不直接 fetch refresh**:只调 `ensureFreshAccessToken()`;直接发起 `/api/auth/refresh` 是 task-07 的 `doRefresh` 内部行为,调用方不感知。
- **不处理 refresh token 过期**:access token 主动续期失败时静默,refresh token 是否过期由后端 `/api/auth/refresh` 的 401 表达,前端不预判、不本地计时。
- **不调整刷新间隔 / 阈值为可配置**:60s 间隔与 1/3 TTL 阈值按 D-004 硬编码;如需调参是后续优化,不在本任务范围(YAGNI)。
- **不改 task-07 的 token-refresh.ts**:本任务只消费 `ensureFreshAccessToken` / `decodeJwtExp`,不修改它们的实现或签名。
- **不写新测试文件**:本任务的验证依赖手工或复用 task-06 测试套件(见 TDD 步骤);如需 vi.useFakeTimers 单测,加到 `frontend/src/lib/__tests__/` 或 `frontend/src/components/__tests__/`,但不**修改**已有测试断言(CLAUDE.md 规则 7),且新增测试文件不在本任务 allowed_paths 内(需另开任务或经同意)。

## 参考

- `design.md` §5 Phase 2(前端单飞锁 + 主动刷新)、§6(文件清单 app-shell.tsx 修改)、§7(AppShell 主动刷新落地点)、§9(不硬编码 TTL,按 token exp/iat 推算)、§10 R-04(inflight 生命周期)、§3 非目标(不做跨 tab)
- `requirements.md` FR-06(AppShell 主动刷新定时器 GWT)
- `decisions.md` D-004@v1(主动刷新挂 AppShell、剩余 1/3 TTL 触发、复用单飞锁)
- `plan.md` task-07(依赖锚,提供 `ensureFreshAccessToken` / `decodeJwtExp`)、task-09(本任务)、task-08(三处 401 收口,与本任务共享单飞锁)
- 现有源码:
  - `frontend/src/components/app-shell.tsx:111`(`AppShell` 定义,dashboard 全局组件)
  - `frontend/src/components/app-shell.tsx:115`(`const { user, accessToken, refreshToken, clear } = useSession();`)
  - `frontend/src/components/app-shell.tsx:135-141`(现有 collapsed localStorage useEffect 风格 —— `try/catch` 静默吞异常、依赖数组 `[collapsed]`)
  - `frontend/src/stores/session.ts`:`useSession.getState()` 的 `accessToken` 字段
  - `frontend/src/lib/token-refresh.ts`(task-07 新增):`ensureFreshAccessToken` / `decodeJwtExp`

## TDD 步骤

> 依赖 task-07 已落地(`frontend/src/lib/token-refresh.ts` 导出 `ensureFreshAccessToken` / `decodeJwtExp`)。

1. **确认依赖就绪**:读 `frontend/src/lib/token-refresh.ts`,确认 `ensureFreshAccessToken` 与 `decodeJwtExp` 已 export 且 task-06 测试绿。
   ```bash
   cd frontend && pnpm test -- token-refresh
   ```
2. **读现有 app-shell.tsx**:确认 line 50 附近的 import 区、line 135-141 的 collapsed useEffect 插入点(本任务 useEffect 紧随其后)。
3. **按"接口定义"落地**:
   - 加 import `ensureFreshAccessToken, decodeJwtExp`。
   - 在 collapsed useEffect 之后追加主动刷新 useEffect(setInterval 60s + getState + decodeJwtExp + 阈值判定 + catch 静默 + cleanup)。
4. **typecheck**:
   ```bash
   cd frontend && pnpm typecheck
   ```
   预期通过(确认 import 路径、类型签名匹配)。
5. **lint**:
   ```bash
   cd frontend && pnpm lint
   ```
   预期通过(react-hooks/exhaustive-deps 对空依赖 `[]` 不报错;无未使用变量)。
6. **(可选,推荐)vi.useFakeTimers 单测**:若要自动化验证"剩余 < 1/3 TTL 触发刷新",可在 `frontend/src/components/__tests__/app-shell-refresh.test.tsx`(新增)中:
   - mock `@/lib/token-refresh` 的 `decodeJwtExp` 返回 `{ exp: now+300, iat: now-1500 }`(TTL=1800s,remain=300s < 600s=ttl/3 → 应触发);
   - mock `ensureFreshAccessToken` 为 `vi.fn().mockResolvedValue("new-token")`;
   - `vi.useFakeTimers()` + `act(() => { vi.advanceTimersByTime(60_000) })`;
   - 断言 `ensureFreshAccessToken` 被调用 1 次。
   - 再测一个 remain 充足用例(`{ exp: now+1700, iat: now-100 }`,remain=1700 >= 600 → 不触发)。
   > 注意:新增测试文件不在本任务 `allowed_paths` 内。如需落地,先与 reviewer 确认扩展 allowed_paths,或归入 task-10 集成验收。本任务的最小验收以 typecheck + lint + 手工为准。
7. **回归**:确认未破坏其他前端测试(本任务只改 app-shell.tsx):
   ```bash
   cd frontend && pnpm test
   ```
8. **手工联调(可推迟到 task-10)**:登录后,在 DevTools 把 store 的 accessToken 换成一个 exp 即将到 1/3 阈值的 token,等 ≤ 60s,观察 Network 是否出现一次 `/api/auth/refresh` 且 store 更新为新 token。

> 若 task-07 尚未落地,先停下做 task-07,不要在本任务里内联实现 refresh 逻辑(违反单一职责 + 单飞锁收口目标)。

## 验收标准

| AC | 标准 | 验证 |
|---|---|---|
| AC-09-1 | `app-shell.tsx` 新增主动刷新 useEffect:挂载后 `setInterval(60_000)`,tick 内 `useSession.getState().accessToken` + `decodeJwtExp` + `remain < ttl/3` 判定 + `ensureFreshAccessToken().catch(()=>{})`;cleanup `clearInterval` | 代码评审 / `git diff frontend/src/components/app-shell.tsx` |
| AC-09-2 | TypeScript 类型检查通过(import 路径、`decodeJwtExp` 返回值解构、`useEffect` 签名均正确) | `cd frontend && pnpm typecheck` 通过 |
| AC-09-3 | ESLint 通过(含 `react-hooks/exhaustive-deps` 对空依赖 `[]` 不报错;无未使用 import) | `cd frontend && pnpm lint` 通过 |
| AC-09-4 | 登录态下 access token 剩余 < 1/3 TTL 时,60s 内自动触发一次 `ensureFreshAccessToken()` 续期,store 更新为新 token;剩余充足时不触发 | 手工联调(DevTools 改 store token exp)或 `vi.useFakeTimers` 单测(mock decodeJwtExp 返回临界 exp/iat,advance 60s,断言 ensureFreshAccessToken 被调用) |
| AC-09-5 | 未登录(accessToken=null)/ token 损坏(decodeJwtExp 返回 null)/ ensureFreshAccessToken 失败时,定时器静默跳过,不抛错、不 `clear()`、不跳 `/login` | 手工或单测:mock accessToken=null → ensureFreshAccessToken 调用次数 0;mock decodeJwtExp 返回 null → 调用次数 0;mock ensureFreshAccessToken reject → 不抛、组件不卸载、不跳转 |
| AC-09-6 | 组件卸载时定时器被 `clearInterval` 清除,卸载后不再发 `/api/auth/refresh` | 手工:登录 → 卸载(跳 /login)→ 等 60s+ → Network 无 refresh 请求;或单测 unmount + advanceTimers 验证无调用 |
| AC-09-7 | 仅修改 `frontend/src/components/app-shell.tsx`,`git diff --name-only` 只含该文件(若加单测则另含测试文件,需先扩展 allowed_paths) | `git diff --name-only` |
| AC-09-8 | 前端全量测试零回归(collapsed useEffect、logout、菜单渲染等既有逻辑不受影响) | `cd frontend && pnpm test` 全绿 |
