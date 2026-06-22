---
id: task-02
title: useAgentRunStream hook 单测
priority: P0
estimated_hours: 3
created_at: 2026-06-22T11:24:44+08:00
author: qinyi
depends_on: [task-01]
blocks: []
requirement_ids: [FR-02, FR-04, FR-06]
decision_ids: [D-001@v1, D-003@v1]
allowed_paths:
  - frontend/src/lib/__tests__/use-agent-run-stream.test.ts
---

# task-02 — useAgentRunStream hook 单测

## 修改文件

| 操作 | 路径 | 说明 |
|---|---|---|
| 新增 | `frontend/src/lib/__tests__/use-agent-run-stream.test.ts` | hook 单元测试（vitest + jsdom + `@testing-library/react` 的 `renderHook`） |

> 不动 `use-agent-stream.ts`（由 task-01 提供）、不动 `agent-stream.ts`、不动任何调用点。allowed_paths 严格限定本测试文件。

## 覆盖来源

| 来源 | 章节 | 取用要点 |
|---|---|---|
| design.md | §7.1 hook 接口 | `UseAgentRunStreamOptions`/`UseAgentRunStreamResult`/`AgentRunInputStream` 字段语义；token 来自 `useSession.getState().accessToken`，空 token → set error 不连（Grill X-005） |
| design.md | §7.3 生命周期契约 | permission_request → perms 增（按 request_id 去重）；permission_resolved → dismissPerm；done → onDone(status) |
| design.md | §11 决策追踪 | D-001（isActive=false 仅 prefetch）、D-003（dismissPerm 仅本地移除，不调 respondSessionPermission） |
| requirements.md | FR-02 | 活跃 run 连接、runId/isActive 变化重连（useEffect cleanup） |
| requirements.md | FR-04 | permission_request → perms 增；permission_resolved → dismissPerm 移除 |
| requirements.md | FR-06 | isActive=false → 仅 prefetch 历史，不连 SSE |
| `agent-stream.ts` | 真实签名 | mock `AgentRunStreamClient`：`connect(token)`/`disconnect()`/`onMessage`/`onStatusChange`/`onDone`/`onPermissionRequest`/`onPermissionResolved` 各返回 unsubscribe |
| `daemon-permission.test.ts` / `ask-user-dialog-card.test.tsx` | mock 风格 | `vi.mock("@/stores/session")` 注入 token；`vi.spyOn(fetch)` 拦截 `submitAgentRunInput`/`fetchPendingDialogs` |

## 测试策略（mock 方案）

### 1) 被测对象

`useAgentRunStream` hook（task-01 实现）。它内部 `new AgentRunStreamClient(workspaceId, runId)` 并 `connect(token)`。要断言 hook 对 client 事件回调的状态收敛，**必须 mock 掉 client 类**，否则会拉真 SSE + 真 fetch。

### 2) mock `AgentRunStreamClient`

```ts
// vi.mock 整个 ../agent-stream 模块，提供可编程的假 client。
type Cb<T> = (payload: T) => void;

interface FakeClient {
  connect: ReturnType<typeof vi.fn>;          // vi.fn<(token: string) => Promise<void>>
  disconnect: ReturnType<typeof vi.fn>;       // vi.fn<() => void>
  onMessage: ReturnType<typeof vi.fn>;        // 注册回调，返回 unsubscribe
  onStatusChange: ReturnType<typeof vi.fn>;
  onDone: ReturnType<typeof vi.fn>;
  onPermissionRequest: ReturnType<typeof vi.fn>;
  onPermissionResolved: ReturnType<typeof vi.fn>;
  // —— 测试侧"事件触发器"：hook 注册回调后，测试调这些把事件喂回去 ——
  __emitMessage: (e: StreamLogEvent) => void;
  __emitStatus: (s: StreamStatus) => void;
  __emitDone: (d: StreamDoneData) => void;
  __emitPermissionRequest: (r: SessionPermissionRequest) => void;
  __emitPermissionResolved: (r: SessionPermissionResolved) => void;
  __registered: { message: Cb<StreamLogEvent>[]; status: Cb<StreamStatus>[]; done: Cb<StreamDoneData>[]; permReq: Cb<SessionPermissionRequest>[]; permRes: Cb<SessionPermissionResolved>[] };
}
```

实现要点：

- `vi.mock("../agent-stream", () => ({ AgentRunStreamClient: vi.fn(() => makeFakeClient()) }))`，工厂返回每次 new 的同一 fake 实例（或队列，便于断言 `new` 被调几次）。
- `onXxx(cb)` 把 cb push 进 `__registered`，返回 `() => splice`（仿真 unsubscribe，用于测 cleanup）。
- `__emitXxx` 遍历对应 `__registered` 数组调回。
- `connect` 默认 resolve（不抛），测试可 override 让它 reject。
- 暴露 `lastInstance` 引用供断言 `connect.calls`/`disconnect.calls`。

### 3) mock `@/stores/session`

```ts
vi.mock("@/stores/session", () => ({
  useSession: {
    getState: () => ({ accessToken: "test-token" }),
  },
}));
```

token 空用例用 `vi.spyOn` 或在 `beforeEach` 重写 getState 返回 `{ accessToken: null }`。

### 4) mock `fetch`（input.submit / fetchPendingDialogs / getAgentRun）

hook 内部 `input.submit(logId)` → `submitAgentRunInput` → `apiFetch` → `globalThis.fetch`；`isActive=true` 时还可能调 `getAgentRun`（取 session_id）+ `fetchPendingDialogs`。统一 `vi.spyOn(globalThis, "fetch")` 按用例返回 JSON（参考 `ask-user-dialog-card.test.tsx:168` / `daemon-permission.test.ts:32`）。

> 注意：mock client 已屏蔽 `connect` 不会真发 SSE，但 `getAgentRun`/`fetchPendingDialogs`/`submitAgentRunInput` 走的是 `apiFetch`（不在 client 内），仍需 fetch mock。

### 5) renderHook 环境

项目 vitest.config 用 `environment: "jsdom"` + `@vitejs/plugin-react` + setupFiles。用 `@testing-library/react` 的 `renderHook`（v13+ 内置，无需额外依赖）：

```ts
import { renderHook, act } from "@testing-library/react";

const { result, rerender, unmount } = renderHook(
  ({ workspaceId, runId, isActive }) =>
    useAgentRunStream(workspaceId, runId, { isActive }),
  { initialProps: { workspaceId: "ws-1", runId: "run-1", isActive: true } },
);
```

- `act(...)` 包裹所有触发事件/调 setState 的动作（`__emitPermissionRequest`、`input.submit` await、`dismissPerm`）。
- `rerender({ ..., runId: "run-2" })` 验证 runId 切换重连。
- `unmount()` 验证 cleanup 调 disconnect。

> EventSource 在 jsdom 下不完整，但因 mock 掉 client，`new EventSource` 永不执行，无需 `vi.stubGlobal("EventSource", ...)`。

## 测试用例清单

| # | 用例 | Given | When | Then |
|---|---|---|---|---|
| TC-01 | 活跃 run 建立 SSE 连接 | token="test-token"，isActive=true，runId="run-1" | `renderHook` 首渲 | `AgentRunStreamClient` 被 new 1 次；实例 `connect("test-token")` 被调 1 次；`result.current.streaming/loading` 初始状态符合（loading=true 或 streaming 连接中，依实现；本测只断言"被调 connect"） |
| TC-02 | permission_request → perms 增 | hook 已连，perms=[] | `fakeClient.__emitPermissionRequest({request_id:"req-1", tool_name:"Bash", ...})`（act 包裹） | `result.current.perms` length===1；`perms[0].request_id==="req-1"`；不阻塞 logs 流 |
| TC-03 | permission_request 按 request_id 去重 | perms 已含 req-1 | 再次 `__emitPermissionRequest({request_id:"req-1", ...})` | `perms` length 仍===1（D-001 契约：去重防重复渲染卡片） |
| TC-04 | 不同 request_id 累加 | perms 已含 req-1 | `__emitPermissionRequest({request_id:"req-2", ...})` | `perms` length===2，两条都在 |
| TC-05 | permission_resolved → dismissPerm 移除 | perms 含 req-1、req-2 | `__emitPermissionResolved({request_id:"req-1", decision:"allow"})` | `perms` 剩 req-2，req-1 消失（两条路径收敛，design §7.3） |
| TC-06 | dismissPerm 直接本地移除（D-003，不调 API） | perms 含 req-1 | `act(() => result.current.dismissPerm("req-1"))` | `perms` 清空 req-1；**fetch 未被调**（assert `fetchMock` not called 或 callCount 不增，验证 D-003：决策 API 归卡片自调，hook 只做本地移除） |
| TC-07 | isActive=false → 不连 SSE，仅 prefetch | isActive=false，runId="run-1" | 首渲 | `AgentRunStreamClient` 仍被 new（prefetch 历史走 client 内部）但 `connect` **未被调**；或 hook 不 new client 而直接调 `getAgentRunLogs`——依 task-01 实现，断言"connect 未被调 + 无 permission/input 回调注册"；历史日志能展示（若 prefetch 走 client，断言 `onMessage` 未注册 perm 回调） |
| TC-08 | isActive=false 收到 perm 事件无效 | isActive=false | 即使 `__emitPermissionRequest`（若 client 仍存在） | `perms` 不变（间接验 D-001：非活跃不挂 perm 回调） |
| TC-09 | runId 切换 → 旧 client.disconnect + 新 client.connect | 已连 run-1 | `rerender({ runId: "run-2", isActive: true })` | 旧实例 `disconnect` 被调 1 次；`new AgentRunStreamClient` 共 2 次；新实例 `connect` 被调 |
| TC-10 | isActive true→false → disconnect | 已连 | `rerender({ isActive: false })` | 当前 client `disconnect` 被调 1 次（Grill R-01 应对） |
| TC-11 | unmount → disconnect | 已连 | `unmount()` | `client.disconnect` 被调 1 次（防内存泄漏，R-01） |
| TC-12 | done 事件 → onDone 回调 + status | hook 连接，onDone=vi.fn() | `fakeClient.__emitDone({ status:"completed", exit_code:0 })` | `onDone` 被 `toHaveBeenCalledWith("completed")` 或等价格式（依 task-01 实现 onDone 签名）；`result.current.status==="completed"`；streaming→false |
| TC-13 | token 空 → set error 不连 | `useSession.getState().accessToken = null` | 首渲 isActive=true | `connect` **未被调**；`result.current.error` 非空字符串（Grill X-005，复刻 page.tsx:335-341） |
| TC-14 | input.set 更新 values | hook 返回 input | `act(() => input.set("log-1", "hello"))` | `result.current.input.values["log-1"]==="hello"` |
| TC-15 | input.submit 调 submitAgentRunInput + 标记 replied | fetch mock 返回 `{run_id, accepted:true}` | `await act(() => input.submit("log-1"))`（input.values["log-1"]="hello" 先 set） | `fetch` 被调到 `/api/workspaces/ws-1/agent/runs/run-1-实际runId/input`，method POST，body.content==="hello"；`input.submitting["log-1"]` 提交中 true→成功后 false；`input.replied` 含 "log-1" |
| TC-16 | input.submit 失败 → errors 有值、submitting 复位、replied 不加 | fetch mock 返回 502 | `await act(() => input.submit("log-2"))` | `input.errors["log-2"]` 非空；`input.submitting["log-2"]`===false；`input.replied` 不含 "log-2" |
| TC-17 | onMessage → logs 增 + lastLogId 去重 | 已连 | `__emitMessage({channel:"stdout", content:"hi", timestamp:"2026-06-22T10:00:00Z", log_id:"L1"})`；再发同 log_id | 第一次 logs +1；第二次同 log_id logs 不增（client 已去重，hook 透传即可；此用例验证 hook 不会重复 append） |
| TC-18 | clear() 清空状态 | logs/perms 非空 | `act(() => result.current.clear())` | logs=[]、perms=[]、status=null、error=null（FR-02 接口 clear 方法语义） |
| TC-19 | isActive=false→true → 连接建立 | 先 isActive=false（未连），后 rerender isActive=true | rerender | `connect` 首次被调（之前 TC-07 断言未调，本例验证延迟连接） |
| TC-20 | 多次 permission_resolved 幂等 | perms 已无 req-1 | `__emitPermissionResolved({request_id:"req-1",...})` | 不抛错，perms 保持不变（防 race：卡片已 dismiss 后 SSE 又来 resolved） |

## 边界处理

- **runId=null**：hook 应 guard（design §7.1 注释），`connect` 不被调，`logs/perms` 保持空。补 1 用例：`renderHook({ runId: null, isActive: true })` → `connect` 未被调、`error` 可空。
- **connect reject**：`fakeClient.connect.mockRejectedValueOnce(new Error("boom"))` → `result.current.error` 非空、`streaming` false（依 task-01 实现，断言不崩溃）。
- **workspaceId 变化**：`rerender({ workspaceId: "ws-2" })` 视为 run 上下文变更，旧 disconnect + 新 connect（与 runId 切换同路径，可合并 1 用例或单独）。
- **act 边界**：所有 `__emitXxx` / `dismissPerm` / `input.set` / `input.submit` 必须包在 `act()` 内，否则 React state 更新告警 + 断言读到旧值。
- **fakeClient reset**：`beforeEach` 内 `vi.clearAllMocks()` + 重置 `__registered` 数组 + 重置 `lastInstance`，避免用例间回调串扰。
- **fetch mock 复位**：`afterEach` `vi.restoreAllMocks()`（沿用 daemon-permission.test.ts:28 模式）。
- **jsdom 无 EventSource**：因 mock client 屏蔽 `connect`，EventSource 不会实例化；如个别用例意外穿透，在 setup 补 `vi.stubGlobal("EventSource", class { close(){} addEventListener(){} set onmessage(){} })` 兜底。

## 非目标

- 不测 `AgentRunStreamClient` 内部（重连退避/EventSource 解析/prefetch）—— 那是 client 的职责，本测只验 hook 状态收敛。
- 不测 `AgentRunPanel`（task-04 集成测试覆盖 perms→卡片渲染）。
- 不测调用点迁移（task-05/06/07）。
- 不测真实 SSE 网络链路 / 后端契约（daemon-permission.test.ts 已覆盖 `parseSessionPermissionEvent`）。
- 不测 `respondSessionPermission`（卡片自调，D-003，由 ask-user-dialog-card.test.tsx 覆盖）。
- 不做快照测试、不做 E2E。

## 参考

- design.md §7.1（hook 接口）、§7.3（生命周期契约表）、§11（D-001/D-003）、§13 Grill（X-004 loading、X-005 token）
- requirements.md FR-02 / FR-04 / FR-06（GWT 原文）
- `frontend/src/lib/agent-stream.ts`（AgentRunStreamClient 真实方法签名：connect/disconnect/onMessage/onStatusChange/onDone/onPermissionRequest/onPermissionResolved）
- `frontend/src/lib/agent.ts:182`（submitAgentRunInput URL/method）、`:77`（getAgentRun）、`:88`（getAgentRunLogs）
- `frontend/src/lib/__tests__/daemon-permission.test.ts`（vi.mock session + fetch mock 模式）
- `frontend/src/components/ask-user-dialog-card.test.tsx`（@testing-library/react + waitFor 用法）
- `frontend/vitest.config.ts`（jsdom + globals + setupFiles）
- plan.md Wave1 task-02（依赖 task-01）

## TDD 步骤

> 本任务本身是测试文件。TDD 在此体现为：**测试先行于 hook 实现的细节**（hook 由 task-01 实现，本测试定义其契约）。若 task-01 尚未实现，本测试文件先提交为 `xit`/`it.skip` 或直接 fail（红灯），task-01 实现后转绿。

1. **Red**：写 `use-agent-run-stream.test.ts`，import `useAgentRunStream` from `../use-agent-run-stream`。若该模块不存在，tsc/vitest import 解析失败 → 红灯（预期，等 task-01）。
2. **Green（task-01 完成后）**：`cd frontend && pnpm test use-agent-run-stream` 全部通过。
3. **Refactor**：若实现暴露的 loading/error 字段语义与用例假设不符，**优先调整用例以对齐 design §7.1 接口**（接口是契约，实现服从接口），仅在 design 有歧义时回写 design 补注。
4. 每个用例独立 `it(...)`，describe 分组：`连接生命周期` / `permission（FR-04）` / `isActive 语义（FR-06/D-001）` / `input（FR-05 间接）` / `clear & 边界`。

## 验收标准

执行：`cd frontend && pnpm test src/lib/__tests__/use-agent-run-stream.test.ts`

| AC | 条件 |
|---|---|
| AC-01 | 命令 exit code === 0，全部用例 pass（TC-01..TC-20 + 边界用例） |
| AC-02 | 覆盖率：`use-agent-run-stream.ts` 行覆盖 ≥ 85%（statements/branches，vitest --coverage 可选跑） |
| AC-03 | FR-02 覆盖：TC-01（连接）/TC-09（runId 切换重连）/TC-11（unmount disconnect）/TC-18（clear）通过 |
| AC-04 | FR-04 覆盖：TC-02..TC-06、TC-20（permission 增/去重/resolved/幂等）通过 |
| AC-05 | FR-06 / D-001 覆盖：TC-07（isActive=false 不连）、TC-08（非活跃不挂 perm 回调）、TC-19（false→true 延迟连接）通过 |
| AC-06 | D-003 覆盖：TC-06（dismissPerm 不调 fetch）通过 |
| AC-07 | Grill X-005 覆盖：TC-13（token 空 set error 不连）通过 |
| AC-08 | input 契约：TC-14/TC-15/TC-16（set/submit 成功+失败+replied）通过 |
| AC-09 | `pnpm typecheck` 对本测试文件无类型错误（TS strict，接口签名固化） |
| AC-10 | `pnpm lint` 对本测试文件无 warning（遵循项目 eslint 规则） |
| AC-11 | 全量 `pnpm test` 仍绿（本测试不破坏既有 daemon-permission/ask-user-dialog-card 等用例） |

> 完成后回填 plan.md Wave1 task-02 的 `[ ]` → `[x]`，并在 progress.json（若存在）标记 task-02 done。
