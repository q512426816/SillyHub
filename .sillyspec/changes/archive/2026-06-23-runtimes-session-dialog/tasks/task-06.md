---
id: task-06
title: 新增 runtime-session-dialog.test.tsx（Wave-4）
priority: P1
estimated_hours: 3
depends_on: [task-02, task-03]
blocks: [task-07]
requirement_ids: [FR-01, FR-02, FR-04, FR-05]
decision_ids: [D-002@v1, D-004@v1]
allowed_paths:
  - frontend/src/components/daemon/runtime-session-dialog.test.tsx
created_at: 2026-06-23T10:29:26+08:00
author: qinyi
---

# task-06: 新增 runtime-session-dialog.test.tsx

> Wave-4 测试任务。为 task-02/03 新建的 `RuntimeSessionDialog` 组件补集成测试，覆盖 4 个 FR（FR-01/02/04/05）与 4 个验收场景（SC-2/3/4/5）。
> 依据文档：`design.md` §5 Phase-1/2、§10 R-02；`requirements.md` FR-01/02/04/05；`decisions.md` D-002（默认态）、D-004（active attach）；`plan.md` 验收 SC-2/3/4/5。

## 修改文件

| 操作 | 路径 | 说明 |
|---|---|---|
| 新增 | `frontend/src/components/daemon/runtime-session-dialog.test.tsx` | co-located（与被测组件 `runtime-session-dialog.tsx` 同目录），与 `page.test.tsx` 测试约定一致 |

> 注：`design.md` §6 文件清单写的是 `__tests__/runtime-session-dialog.test.tsx`，但 `plan.md`/`tasks.md` 均采用 co-located 路径（与 `page.test.tsx` 一致），本任务遵循 plan / tasks 的 co-located 约定（也是 `allowed_paths` 指定的路径）。

## 覆盖来源

| 来源 | 引用内容 |
|---|---|
| `design.md` §5 Phase-1 | `RuntimeSessionDialog` props（`runtime`/`open`/`onClose`/`runtimes`）+ 自管 `sessions`/`selected`/`attachSession` + 左列表（过滤 `runtime_id`）右三态 + 默认态 D-002 |
| `design.md` §5 Phase-2 | active → `getAgentSessionLogs` → `logsToTurns` → `setAttachSession` → attach（建 SSE + 轮询到 active + 启用发送）；ended/failed claude → 只读 + 「继续对话」reopen；codex ended → 只读无续聊 |
| `design.md` §10 R-02 | 弹窗关闭时 SSE / 轮询泄漏 → 关闭触发 `InteractiveSessionPanel` cleanup（closeStream + clearInterval），测试断言关闭后无残留连接 |
| `requirements.md` FR-01 | 弹窗打开 + 左侧列出该 runtime 历史会话（过滤 `runtime_id`）+ 默认态（有活跃 attach / 无 idle 新建） |
| `requirements.md` FR-02 | active 会话点开 → attach 模式（输入框可用可发送续聊） |
| `requirements.md` FR-04 | ended/failed claude → 只读 + 「继续对话」可用；codex ended → 只读续聊置灰 |
| `requirements.md` FR-05 | attach 中关闭弹窗 → SSE 关闭 + 轮询清理无泄漏 |
| `decisions.md` D-002@v1 | 默认态：有活跃会话 → 自动 attach 最近活跃；无 → idle 新建空白面板 |
| `decisions.md` D-004@v1 | active 续聊复用 attach 模式（非只读回看） |
| `plan.md` 验收 | SC-2（active 续聊）/ SC-3（ended claude 继续）/ SC-4（codex ended 置灰）/ SC-5（关闭清理） |

## 实现要求

### 公共 mock 模式（复用 `page.test.tsx`）

文件顶部与每个用例的 mock 基线完全复用 `page.test.tsx` 的成熟模式，**不新造轮子**：

- **`vi.hoisted` + `vi.mock("@/lib/daemon")`**：mock 出 `listAgentSessions` / `getAgentSession` / `getAgentSessionLogs` / `deleteAgentSession` / `reopenSession` / `streamSession` / `respondSessionPermission` / `parseSessionPermissionEvent` 等命名的 `vi.fn()`，`streamSession` 默认返回 no-op 连接 `{ close: () => {}, getLastEventId: () => null }`（避免真实 EventSource 网络请求）。
- **`vi.mock("next/navigation")`**：`useSearchParams` 返回可控 `URLSearchParams`，`useRouter` 返回带 `replace`/`push`/`refresh` 的 spy（`RuntimeSessionDialog` 本身不直接用 navigation，但其子组件 `InteractiveSessionChatSection` 的 `onSessionCreated` 回调由 `page.tsx` 写 URL；为保持被测组件树与生产一致，dialog 不直接 mock navigation——若 dialog 不引 navigation 可省此 mock，按实际依赖裁剪）。
- **`FakeES`（EventSource stub）**：class 形式，`static instances: FakeES[]` 记录所有构造实例，`addEventListener`/`removeEventListener`/`close` 全留 stub。`beforeEach` 里 `vi.stubGlobal("EventSource", FakeES)` + `FakeES.instances.length = 0`。**关闭泄漏验证（SC-5）依赖此 `instances` 数组**。
- **`useSession.setState({ accessToken: "tok", hydrated: true })`**：`@/stores/session` 注入 token，让 `lib/daemon` 的 fetch header 不报错。
- **`vi.stubGlobal("confirm", vi.fn(() => true))`**：删除会话 confirm 不阻塞。
- **`afterEach`**：`vi.unstubAllGlobals()` + `vi.restoreAllMocks()`。

被测导入：`import { RuntimeSessionDialog } from "@/components/daemon/runtime-session-dialog"`（**直接渲染组件**，不走 `RuntimesPage`——这是本任务与 task-05 的关键区别，确保只测 dialog 单元，避免 page 层 mock 干扰）。

**props 工厂**（每个用例复用）：

```ts
const baseRuntime = {
  id: "rt-1", name: "MyClaude", provider: "claude", version: "1.0.0",
  status: "online", last_heartbeat_at: "2026-06-18T10:00:00Z",
  capabilities: { protocol: "ws", agents: ["claude"] },
  created_at: "2026-06-18T09:00:00Z", updated_at: "2026-06-18T10:00:00Z",
};
```

会话对象结构沿用 `page.test.tsx` 的字段集（`id`/`runtime_id`/`lease_id`/`provider`/`status`/`agent_session_id`/`config`/`turn_count`/`created_at`/`last_active_at`/`ended_at`）。`runtime_id` 必须等于被测 `runtime.id`（"rt-1"）才会出现在过滤后的左列表；混入一两条 `runtime_id` 不等的会话验证过滤生效。

---

### 用例 1：弹窗渲染 + 列表过滤（FR-01 / SC-1）

- **名称**：`renders dialog with runtime-scoped session list when open, nothing when closed`
- **Given**：`daemon.listAgentSessions` mock 返回 3 条会话——2 条 `runtime_id === "rt-1"`（含一个 active、一个 ended），1 条 `runtime_id === "rt-other"`（噪音，验证过滤）。
- **When**：`render(<RuntimeSessionDialog runtime={baseRuntime} open={true} onClose={vi.fn()} runtimes={[baseRuntime]} />)`。
- **Then**：
  - `screen.getByRole("dialog")` 存在（Radix `DialogContent` 在 jsdom 暴露 `role="dialog"`）。
  - 左侧列表出现 2 条 `runtime_id === "rt-1"` 的会话项（按 `id` 文本断言，如 `screen.getByText(/sess-active/)` / `screen.getByText(/sess-ended/)`）。
  - **不**出现 `rt-other` 的会话项（`screen.queryByText(/sess-other/)` 为 null，验证 `runtime_id` 过滤）。
- **When（open=false 分支）**：另起一个 render，`open={false}`。
- **Then**：`screen.queryByRole("dialog")` 为 null（Radix Dialog closed 时不挂载 portal）。
- **关键 mock**：`listAgentSessions` 返回 `{ items: [...], total, limit: 50, offset: 0 }`。

---

### 用例 2：默认态 D-002 — 有活跃自动 attach / 无活跃 idle 新建（D-002@v1 / FR-01）

拆成两个子用例（D-002 的两个分支）：

#### 用例 2a：`auto-attaches most recent active session on open when active exists (D-002)`
- **Given**：`listAgentSessions` 返回含 1 条 `status: "active"`（`runtime_id === "rt-1"`，`agent_session_id: "ag-1"`）的会话。
- **When**：`render(... open={true} ...)`。
- **Then**：`waitFor` 断言 `daemon.streamSession` 以该 active 会话 id 被调用（`expect(daemon.streamSession).toHaveBeenCalledWith("sess-active", expect.anything())`）——证明自动 attach 建 SSE。右侧出现「交互式会话」面板 header（`screen.getByText(/交互式会话/)`）。
- **关键 mock**：`getAgentSessionLogs` mock 返回空数组或少量 log（attach 预填路径会调用）；`getAgentSession` mock 返回 `status: "active"`（让轮询首轮即转 active，不卡 reconnecting）。

#### 用例 2b：`enters idle new-session panel when no active session (D-002)`
- **Given**：`listAgentSessions` 返回 1 条 `status: "ended"` 会话（无 active/pending/reconnecting）。
- **When**：`render(... open={true} ...)`。
- **Then**：`expect(daemon.streamSession).not.toHaveBeenCalled()`（idle 不建 SSE）；右侧渲染新建空白面板（`screen.getByText(/交互式会话/)` 或 idle 占位文案如「输入首条消息创建会话」）。

---

### 用例 3：active attach 续聊（SC-2 / FR-02 / D-004@v1）

- **名称**：`attaches active session on click → SSE + poll + enabled input (SC-2)`
- **Given**：`listAgentSessions` 返回 1 条 `status: "active"`（`id: "sess-active"`，`agent_session_id: "ag-1"`）+ 1 条 ended（避免默认态自动 attach 干扰，可让默认态分支用 2a 已覆盖；此处为点击触发的显式断言）。`getAgentSessionLogs` mock 返回 2 条 log（1 user_input + 1 stdout，同 `run_id`）验证 `logsToTurns` 预填。`getAgentSession` mock 返回 `status: "active"`。
- **When**：render open=true → 等列表渲染 → `fireEvent.click(screen.getByText(/sess-active/))`。
- **Then**：
  - `waitFor(() => expect(daemon.getAgentSessionLogs).toHaveBeenCalledWith("sess-active"))`（拉历史预填）。
  - `waitFor(() => expect(daemon.streamSession).toHaveBeenCalledWith("sess-active", expect.anything()))`（建 SSE）。
  - 右侧 attach 面板：历史 turn 预填可见（`screen.getByText(/历史 agent 回答/)`）。
  - 输入框可用（**非只读**）：找到发送按钮 `screen.getByTitle(/发送/)`，断言 `disabled === false`（D-004 核心：active 走 attach 而非只读 `SessionHistoryView`，与旧 `ql-20260619-007` 只读行为形成对照）。
- **关键 mock**：`streamSession` no-op；`getAgentSession` 返回 active（轮询首轮即收敛，`sendingDisabled` 因 status!==reconnecting 解除）。

---

### 用例 4：ended claude 继续对话（SC-3 / FR-04）

- **名称**：`ended claude session → read-only history + clickable 继续对话 → reopen→attach (SC-3)`
- **Given**：`listAgentSessions` 返回 1 条 `status: "ended"`、`provider: "claude"`、`agent_session_id: "ag-123"` 的会话（`id: "sess-ended-claude"`）。`getAgentSessionLogs` mock 返回历史 log。`reopenSession` mock resolve `{ session_id: "sess-ended-claude", status: "reconnecting" }`。
- **When**：render open=true → `fireEvent.click(screen.getByText(/sess-ended-claude/))`。
- **Then**：
  - 右侧只读历史回看：历史 log 文本可见；**无**发送按钮（`screen.queryByTitle(/发送/)` 为 null）——只读。
  - 「继续对话」按钮存在且可点：`const btn = await screen.findByRole("button", { name: /继续对话/ }); expect(btn.disabled).toBe(false)`。
- **When（续）**：`fireEvent.click(btn)`。
- **Then**：
  - `waitFor(() => expect(daemon.reopenSession).toHaveBeenCalledWith("sess-ended-claude"))`。
  - reopen 成功后切 attach：`waitFor(() => expect(daemon.streamSession).toHaveBeenCalledWith("sess-ended-claude", expect.anything()))`。
  - attach 面板 header 可见（`screen.getByText(/交互式会话/)`）。
- **关键 mock**：`reopenSession` resolve reconnecting；`getAgentSession` 在 attach 轮询中返回 active（让 reopen→attach 链路收敛到可发送态，可在最终断言发送按钮转 enabled）。

---

### 用例 5：codex ended 只读置灰（SC-4 / FR-04）

- **名称**：`codex ended session → read-only + disabled 继续对话 with codex title (SC-4)`
- **Given**：`listAgentSessions` 返回 1 条 `status: "ended"`、`provider: "codex"`、`agent_session_id: "ag-codex"` 的会话（`id: "sess-codex-ended"`）。`getAgentSessionLogs` mock 返回历史 log。
- **When**：render open=true → `fireEvent.click(screen.getByText(/sess-codex-ended/))`。
- **Then**：
  - 右侧只读历史回看（无发送按钮）。
  - 「继续对话」按钮存在但**置灰**：`const btn = await screen.findByRole("button", { name: /继续对话/ }); expect(btn.disabled).toBe(true)`。
  - title 提示 codex 不支持续聊：`expect(btn.getAttribute("title")).toMatch(/codex 暂不支持续聊/)`（沿用 helper `resumeDisabledTitle` 文案）。
  - 点击置灰按钮**不**触发 reopen：`fireEvent.click(btn); expect(daemon.reopenSession).not.toHaveBeenCalled()`。
- **关键 mock**：与用例 4 仅 `provider` 差异（codex vs claude），验证 `canResumeSession` / `resumeDisabledTitle` 对 provider 的分支。

---

### 用例 6：关闭清理无泄漏（SC-5 / FR-05 / R-02）

- **名称**：closing dialog during attach closes SSE + clears poll interval (no leak) (SC-5)
- **Given**：复用用例 3 的 active attach 场景——`listAgentSessions` 返回 active 会话，render open=true，等 `streamSession` 被调（建 SSE）。此时 `FakeES.instances` 至少有 1 个（或 `streamSession` 的 mock 返回带 spy 的 connection）。
- **关键 mock 调整**：为可断言 close，把 `streamSession` mock 改为返回带 spy 的连接：
  ```ts
  const connCloseSpy = vi.fn();
  daemon.streamSession.mockImplementation(() => ({
    close: connCloseSpy,
    getLastEventId: () => null,
  }));
  ```
  并用 `vi.useFakeTimers()` 控制轮询 interval（attach 轮询 1500ms 一次），便于精确断言 `clearInterval`。
- **When**：`fireEvent.click(screen.getByRole("button", { name: /关闭|×/ }))`（dialog 关闭按钮，Radix DialogContent 自带 close 按钮；按实际 aria-label/title 调整选择器）或调用 `onClose`（若 dialog 关闭完全由 `open` prop 驱动，则 rerender `open={false}`）。
- **Then**（二选一或组合，覆盖 R-02「无残留连接」）：
  - **SSE close 被调**：`expect(connCloseSpy).toHaveBeenCalled()`（attach 面板 unmount → `InteractiveSessionPanel` cleanup effect 调 `streamConnRef.current.close()`）。
  - **轮询清理**：用 `vi.useFakeTimers()` + `vi.advanceTimersByTime(3000)` 后断言 `getAgentSession` 调用次数不再增加（interval 已 clear，无新 poll tick）。或断言 `attachPollRef` 间接证据——关闭后 advance timer 不触发额外 `getAgentSession`。
  - **EventSource 实例维度**（备选，若用真实 FakeES 而非 spy connection）：记录关闭前后 `FakeES.instances` 中 `.close()` 被调的实例数，断言 attach 用的那个实例 close 被调。
- **关键 mock**：`vi.useFakeTimers()` / `vi.useRealTimers()`（用例末尾恢复）；`streamSession` 返回 spy connection；`getAgentSession` 返回 active（首轮收敛，避免轮询与关闭竞态）。

> 说明：R-02 的核心是「关闭 = cleanup」，测试只需断言 attach 期间建立的 SSE/轮询在关闭后被释放。优先用 `streamSession` 返回的 connection 的 `close` spy（最直接），轮询用 fake timers 断言不再 tick。两条断言都过即覆盖 R-02。

## 完成标准

- [ ] `runtime-session-dialog.test.tsx` 新建于 `frontend/src/components/daemon/`（co-located，**非** `__tests__/`）。
- [ ] 6 个用例（用例 2 拆 2a/2b 共 7 个 `it`）全部存在：渲染+过滤 / 默认态×2 / active attach / ended claude / codex ended / 关闭清理。
- [ ] 覆盖 4 个 FR：FR-01（用例 1/2）、FR-02（用例 3）、FR-04（用例 4/5）、FR-05（用例 6）。
- [ ] 覆盖 4 个 SC：SC-2（用例 3）、SC-3（用例 4）、SC-4（用例 5）、SC-5（用例 6）；SC-1 由用例 1 覆盖。
- [ ] `pnpm --filter frontend exec vitest run src/components/daemon/runtime-session-dialog.test.tsx` 全绿。
- [ ] mock 模式完全复用 `page.test.tsx`（`vi.mock @/lib/daemon` + `vi.hoisted` + `FakeES` + `useSession.setState` + `next/navigation`），无新造 mock 设施。
- [ ] 直接渲染 `RuntimeSessionDialog` 组件（不走 `RuntimesPage`），隔离单元。

## 注意事项

1. **co-located 位置**：路径为 `frontend/src/components/daemon/runtime-session-dialog.test.tsx`（与被测组件同目录，与 `page.test.tsx` 同套约定）。`design.md` §6 写的 `__tests__/` 子目录是 design 草稿，`plan.md`/`tasks.md` 及本任务 `allowed_paths` 均采用 co-located，以 plan 为准。
2. **复用 page.test.tsx mock 模式**：顶部 `vi.hoisted` daemon 对象 + `vi.mock("@/lib/daemon", async () => ({...actual, ...overrides}))` + `FakeES` class + `beforeEach` 全量重置（含 `nav.searchParams`/`nav.replace` 若引 navigation）。**禁止**为 dialog 测试新造一套不同的 mock——保持仓库一致性，降低维护成本。
3. **Radix DialogContent 在 jsdom 可查 `role="dialog"`**：`screen.getByRole("dialog")` 可定位打开的弹窗；`open={false}` 时 Radix 不挂载 portal，`queryByRole("dialog")` 返回 null。若 jsdom 下 Radix 动画/portal 有怪异，备选用 `data-testid` 包裹或按 header 文案定位（`getByText(/交互式会话/)`）。
4. **关闭泄漏验证方式（R-02）**：优先让 `streamSession` mock 返回带 `close` spy 的 connection 对象（而非真实 EventSource），断言 attach 期间建立的连接在弹窗关闭（`open`→false 触发 attach 面板 unmount）后 `close` 被调；轮询清理用 `vi.useFakeTimers()` + `advanceTimersByTime` 断言 `getAgentSession` 不再被调。FakeES.instances 是备选维度。三者任一组合能证明「无残留 SSE/轮询」即可。
5. **直接渲染组件 vs 走 page**：本任务 `render(<RuntimeSessionDialog .../>)` 直驱，**不** import `RuntimesPage`。`page.tsx` 的弹窗接入/URL 恢复由 task-05 的 `page.test.tsx` 覆盖（SC-1/6/7/8）；本任务聚焦 dialog 自身行为（SC-2/3/4/5），避免双层 mock 干扰。
6. **active 默认态自动 attach 与点击 attach 的区分**：用例 2a 测「打开即自动 attach」（D-002 默认态），用例 3 测「显式点击 active 项 attach」（D-004 用户操作）。若默认态会自动 attach 导致用例 3 的 `streamSession` 断言歧义，用例 3 的 `listAgentSessions` 可只放 ended 会话（默认态走 idle 不 attach），再单独测「点列表中 active 项」——或用 `streamSession.mockClear()` 在点击前清调用记录，点击后断言**新增**调用。
7. **helper 文件依赖**：测试不直接断言 helper 内部（`canResumeSession`/`resumeDisabledTitle`/`isActiveSession`/`logsToTurns`），只通过 dialog 的可观察行为（按钮 disabled / title 文案 / 历史预填 / SSE 建立）间接覆盖——这些 helper 由 task-01 提取、task-02/03 消费，本任务测消费侧。
