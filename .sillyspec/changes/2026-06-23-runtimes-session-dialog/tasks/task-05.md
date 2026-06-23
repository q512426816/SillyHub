---
id: task-05
title: 更新 page.test.tsx（C-4 四处断言重写）（Wave-4）
priority: P1
estimated_hours: 2
depends_on: [task-04]
blocks: [task-07]
requirement_ids: [FR-03, FR-05, FR-06]
decision_ids: [D-003@v1, D-004@v1]
allowed_paths:
  - frontend/src/app/(dashboard)/runtimes/page.test.tsx
created_at: 2026-06-23T10:29:26+08:00
author: qinyi
---

# task-05: 更新 page.test.tsx（C-4 四处断言重写）（Wave-4）

> 覆盖：R-05, SC-1/6/7/8
> 性质：测试重写任务（实现已由 task-04 完成），对应项目执行顺序中「写测试 → 跑测试」环节
> 依赖：task-04（`page.tsx` 移除常驻会话区 + 接 `dialogRuntime` + URL 恢复已落地）
> 产出唯一文件：`frontend/src/app/(dashboard)/runtimes/page.test.tsx`

## 修改文件

仅一个文件（`allowed_paths` 强约束）：

- `frontend/src/app/(dashboard)/runtimes/page.test.tsx` — 重写 4 处失效断言（C-4），保留通过中的测试（runtime 列表渲染、删除会话、气泡 channel、ended 续聊按钮 AC-11-01~06）做最小适配。

弹窗组件自身的细粒度行为（attach 后 SSE 推送去重、关闭泄漏、默认态）由 task-06 的 `runtime-session-dialog.test.tsx` 覆盖，**本任务不重复测**；本文件只验证「`page.tsx` 把会话区从常驻改为弹窗驱动、active 从只读改为 attach」这一层契约。

## 覆盖来源

- **R-05**（design.md §10）：原 `page.test.tsx` 四处断言因会话弹窗化 + active 改 attach 而失效，本任务逐条重写。
- **SC-1**：点 runtime 卡片「会话」→ 弹窗打开，左侧列出该 runtime 历史会话（新断言② + 弹窗内 listAgentSessions 过滤可见）。
- **SC-6**：页面无底部常驻会话区，runtime 卡片更舒展（新断言①：无常驻 `session-list-scroll`）。
- **SC-7**：活跃中刷新 → URL `?session=` 自动开弹窗 attach（新断言④上半：active URL → 等 Dialog open → 断言 `streamSession` + 交互式面板）。
- **SC-8**：主动关闭弹窗 → 清 `?session=`，刷新不再自动弹（新断言④下半：ended URL → 不开 Dialog / 开但 idle + `nav.replace`）。
- **FR-03**：页面精简（无常驻会话区）— 由新断言①守护。
- **FR-05**：关闭清理（`onClose` 清 param）— 由新断言④下半（ended URL 降级）间接覆盖；SSE 泄漏断言归 task-06。
- **FR-06**：URL `?session=` 恢复 — 由新断言④两分支守护。
- **D-003@v1**：URL 恢复 + `onClose` 清 param 时序 — 新断言④。
- **D-004@v1**：active 复用 attach（非只读）— 新断言③反转。

## 实现要求

### 保留的 mock 基础设施（不动）

现有文件已建立的 mock 全部复用，无需新增：

- `vi.mock("next/navigation", ...)`：`useSearchParams` / `useRouter({ replace: nav.replace })` — 新断言④复用 `nav.searchParams` / `nav.replace`。
- `vi.mock("@/lib/daemon", ...)`：`listDaemonRuntimes` / `listAgentSessions` / `getAgentSession` / `getAgentSessionLogs` / `reopenSession` / `streamSession` / `deleteAgentSession` / `deleteDaemonRuntime` / `respondSessionPermission` / `parseSessionPermissionEvent` — 弹窗内逻辑复用同一 mock。
- `FakeES` EventSource stub（`vi.stubGlobal("EventSource", FakeES)`）— attach 链路建 SSE 时命中。
- `beforeEach` 默认 mock 返回值（`streamSession` 返回 no-op 连接、`getAgentSession` 返回 reconnecting stub）— 直接可用。
- `useSession.setState({ accessToken, hydrated })` — 不变。

### 逐条重写：4 处失效断言

#### ① 卡片高度 class + 常驻会话区断言（行 127-128）— SC-6 / FR-03

**旧（失效）**：
```tsx
// 行 127-128
expect(screen.getByTestId("runtime-list-scroll")).toHaveClass("max-h-[680px]");
expect(screen.getByTestId("session-list-scroll")).toHaveClass("max-h-[520px]");
```
失效原因：task-04 移除底部常驻 `SessionListSection`，`session-list-scroll` testid 不再存在于 `page.tsx`（移入弹窗内，弹窗测试归 task-06）；`runtime-list-scroll` 的 `max-h-[680px]` 随卡片调高/布局精简可能变更。

**新（重写）**：在原 `renders runtime list ... and empty session list` 用例中，删除上面两行 class 断言，改为断言「无常驻会话区」语义：
```tsx
// SC-6：页面无底部常驻会话区（session-list-scroll 已移入弹窗，page 初始渲染不可见）
expect(screen.queryByTestId("session-list-scroll")).not.toBeInTheDocument();
// runtime 列表容器仍存在（卡片更舒展，但不硬编码具体高度 class，避免脆性）
expect(screen.getByTestId("runtime-list-scroll")).toBeInTheDocument();
```
说明：不新断言具体高度 class（design 未规定卡片精确像素，断言脆）。用例标题改为 `renders runtime list and no persistent session section (SC-6)`。empty state 断言（`screen.getByText(/没有会话/)`）随之删除——该文案原属常驻会话区，弹窗未打开时不渲染；若 task-04 在页面主体保留了别的 empty 提示则按实际保留，否则删除断言。

#### ② 「会话」按钮聚焦态断言（行 209-231）— SC-1 / FR-01

**旧（失效）**：`ql-012 card 会话 button focuses the runtime in the session section`
```tsx
// 行 225-230
const sessionBtn = await screen.findByRole("button", { name: /^会话$/ });
fireEvent.click(sessionBtn);
// 聚焦态：会话标题含 runtime 名 + 「显示全部」退出按钮可见
await waitFor(() => expect(screen.getByText(/会话 · MyClaude/)).toBeInTheDocument());
expect(screen.getByRole("button", { name: "显示全部" })).toBeInTheDocument();
```
失效原因：task-04 的 `handleOpenSession` 从 `setFocusedRuntime + scrollIntoView` 改为 `setDialogRuntime(runtime)`；「显示全部」是常驻区聚焦态的退出按钮，弹窗化后不存在；「会话 · MyClaude」标题迁移到弹窗 header（文案可能微调）。

**新（重写）**：用例改名为 `SC-1: card 会话 button opens the runtime session dialog`，断言改为「弹窗打开」：
```tsx
const sessionBtn = await screen.findByRole("button", { name: /^会话$/ });
fireEvent.click(sessionBtn);

// SC-1：弹窗打开（Radix DialogContent 默认 role=dialog，jsdom 下可查询）
await waitFor(() =>
  expect(screen.getByRole("dialog")).toBeInTheDocument(),
);
// 弹窗 header 含 runtime 名（弹窗标题「会话 · MyClaude」或带 runtime 名的标题，按 task-02 实际 header 文案匹配，用宽松正则）
expect(screen.getByText(/MyClaude/)).toBeInTheDocument();
// 不再断言「显示全部」按钮（弹窗化后无此按钮，关闭走 Dialog 自带 X / ESC / overlay）
expect(screen.queryByRole("button", { name: "显示全部" })).not.toBeInTheDocument();
```
说明：`/MyClaude/` 用 `getAllByText` 兜底若 runtime 名在卡片 + 弹窗 header 各出现一次（避免 `getByText` 多匹配报错）；若 task-02 弹窗 header 文案为「会话 · MyClaude」则保留原正则。radix Dialog 在 jsdom 需确认 `role=dialog` 可查（见注意事项①）。

#### ③ active 只读无发送断言（行 402-449，ql-20260619-007）— SC-2 / FR-02 / D-004

**旧（失效）**：`loads an active session into read-only history view (ql-20260619-007)`
```tsx
// 行 437-448
const item = await screen.findByText(/sess-active1/);
fireEvent.click(item);
// active 会话也调 getAgentSessionLogs 并渲染历史日志（不再空白 live 分支）
await waitFor(() => expect(daemon.getAgentSessionLogs).toHaveBeenCalledWith(sid));
await waitFor(() => expect(screen.getByText("active session history output")).toBeInTheDocument());
// 只读视图：无 live 面板的发送控件
expect(screen.queryByTitle(/发送/)).not.toBeInTheDocument();
```
失效原因：D-004 将 active 会话从「统一只读回看」改为「走 attach 可续聊」。task-03/04 后 active 会话点击 → `getAgentSessionLogs` 转 `initialTurns` → `setAttachSession` → attach 模式建 SSE + 发送控件可用。原「只读无发送」断言需**反转**。

**新（重写）**：用例改名为 `SC-2: active session opens into attach mode (sendable, D-004) — reverses ql-007`。前置需先打开弹窗（active 会话列表只在弹窗左侧 sidebar，页面主体已无常驻列表）：
```tsx
// 先打开弹窗（active 会话项在弹窗 sidebar 内，不在页面主体）
// 需先 mock 一个 runtime 供「会话」按钮点击
daemon.listDaemonRuntimes.mockResolvedValue([
  { id: "r1", name: "daemon", provider: "claude", version: "1.0.0",
    status: "online", last_heartbeat_at: "t", capabilities: { protocol: "ws", agents: ["claude"] },
    created_at: "t", updated_at: "t" },
]);
render(<RuntimesPage />);
const sessionBtn = await screen.findByRole("button", { name: /^会话$/ });
fireEvent.click(sessionBtn);
await waitFor(() => expect(screen.getByRole("dialog")).toBeInTheDocument());

// 弹窗 sidebar 内点 active 会话
const item = await screen.findByText(/sess-active1/);
fireEvent.click(item);

// D-004：active → attach 链路
// 1) 拉历史 logs 转 initialTurns（attach 前置）
await waitFor(() => expect(daemon.getAgentSessionLogs).toHaveBeenCalledWith(sid));
// 2) attach：建 SSE（streamSession 以 sid 调用）
await waitFor(() =>
  expect(daemon.streamSession).toHaveBeenCalledWith(sid, expect.anything()),
);
// 3) attach panel header 可见（交互式会话，非只读回看）
await waitFor(() => expect(screen.getByText(/交互式会话/)).toBeInTheDocument());
// 4) 反转原断言：有发送控件（非只读）
expect(screen.queryByTitle(/发送/)).toBeInTheDocument(); // 或 getByPlaceholderText(/输入/) 兜底
// 历史日志作为 initialTurns 预填（不再以纯文本 "active session history output" 断言，预填后可能进气泡）
```
说明：①active 会话点击前的弹窗打开步骤是本任务相对旧测试的最大结构变化（旧测试 active 项在页面常驻列表，直接点；新测试必须先进弹窗）。②`streamSession` mock 在 `beforeEach` 已返回 no-op 连接，attach 链路不会真发网络请求。③发送控件断言用 `queryByTitle(/发送/)` 或输入框 placeholder 兜底，按 task-02/03 实际渲染选择稳定 selector。④预填历史日志断言可保留 `getByText("active session history output")`（作为气泡渲染），但需确认 `logsToTurns` 把 stdout log 转成 agent 气泡；若不确定则弱化为仅断言 attach 链路（`streamSession` + 交互式面板 header）。

#### ④ URL `?session=` 恢复测试（行 577-644）— SC-7 / SC-8 / FR-06 / D-003

**旧（部分失效）**：三个用例 `改动一-4` / `改动一-6 ended` / `改动一-6 不存在`。失效点：弹窗化后 active URL 恢复需**先等 Dialog open** 再断言 attach（旧测试直接在页面主体断言 `streamSession` + `交互式会话`，弹窗未打开时这些不渲染）；ended URL 分支断言 `交互式会话` 在弹窗未开时也不可见，原断言 `expect(screen.getByText(/交互式会话/))` 会失败。

**新（重写，三个用例调整）**：

**(4a) active URL → 自动开弹窗 attach（SC-7）**，用例改名 `SC-7: URL ?session=<active> auto-opens dialog and attaches on mount`：
```tsx
nav.searchParams = new URLSearchParams("session=sess-url-active");
// 需 mock 对应 runtime（getAgentSession 兜底返回 runtime_id，page 据此 setDialogRuntime）
daemon.listDaemonRuntimes.mockResolvedValue([
  { id: "r1", name: "daemon", ... }, // runtime_id "r1" 需匹配
]);
// getAgentSession 默认返回 runtime_id: null（beforeEach），这里 override 为 r1 + active
daemon.getAgentSession.mockResolvedValue({
  id: "sess-url-active", runtime_id: "r1", lease_id: null, provider: "claude",
  status: "active", agent_session_id: "ag-1", config: null,
  turn_count: 1, created_at: "t", last_active_at: null, ended_at: null,
});

render(<RuntimesPage />);
// SC-7：先等 Dialog open（弹窗化后 attach 发生在弹窗内，弹窗不开则 streamSession 不调）
await waitFor(() => expect(screen.getByRole("dialog")).toBeInTheDocument());
// 再断言 attach 链路
await waitFor(() =>
  expect(daemon.streamSession).toHaveBeenCalledWith("sess-url-active", expect.anything()),
);
await waitFor(() => expect(screen.getByText(/交互式会话/)).toBeInTheDocument());
// active 恢复成功：不清 param（nav.replace 不应被调用，保留恢复点）
expect(nav.replace).not.toHaveBeenCalled();
```

**(4b) ended URL → 降级不开弹窗 + 清 param（SC-8 半）**，用例改名 `SC-8: URL ?session=<ended> degrades to idle and clears param`：
```tsx
nav.searchParams = new URLSearchParams("session=sess-url-ended");
daemon.getAgentSession.mockResolvedValue({
  id: "sess-url-ended", runtime_id: "r1", ..., status: "ended", ended_at: "t2",
});

render(<RuntimesPage />);
// ended → 不开弹窗（D-003 降级）
await waitFor(() => expect(daemon.getAgentSession).toHaveBeenCalledWith("sess-url-ended"));
await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
// 不 attach
expect(daemon.streamSession).not.toHaveBeenCalled();
// 清 param（nav.replace 被调用）
await waitFor(() => expect(nav.replace).toHaveBeenCalled());
```
说明：原断言 `expect(screen.getByText(/交互式会话/))` 删除——弹窗不开则页面主体无交互式面板（页面精简后主体只剩 runtime 卡片）。

**(4c) 不存在/已删 URL → getAgentSession 404 → 清 param**，用例改名 `URL ?session=<gone> getAgentSession 404 → clear param`：
```tsx
nav.searchParams = new URLSearchParams("session=sess-gone");
daemon.getAgentSession.mockRejectedValue(new ApiError(404, {...}));

render(<RuntimesPage />);
await waitFor(() => expect(daemon.getAgentSession).toHaveBeenCalledWith("sess-gone"));
await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
await waitFor(() => expect(nav.replace).toHaveBeenCalled());
expect(daemon.streamSession).not.toHaveBeenCalled();
```
说明：原断言基本保留，补充 `queryByRole("dialog")` 确认不开弹窗（弹窗化新增的显式断言）。

### 保留 / 最小适配的用例（不重写，仅按需微调）

以下用例逻辑不失效，但若依赖「页面常驻会话列表」入口则需改为「先开弹窗再操作」：

| 用例 | 行号 | 处理 |
|---|---|---|
| `renders runtime list (task-11 regression)` | 109-129 | 改断言①（已述） |
| `loads session list and selects ended into read-only view` | 131-181 | **需适配**：ended 会话项在弹窗 sidebar，需先开弹窗再点；read-only 断言（无发送）保留（ended 仍只读，FR-04） |
| `ql-012 removes runtime via 移除 button` | 183-207 | 保留（runtime 卡片移除按钮在页面主体，不涉及弹窗） |
| `card 会话 button focuses...` | 209-231 | 改断言②（已述） |
| `confirms and deletes terminal session` | 233-263 | **需适配**：删除会话按钮若随会话项移入弹窗 sidebar，需先开弹窗；若 task-04 保留页面级删除则不变。按 task-04 实际结构调整，优先「先开弹窗」 |
| `renders delete button for active session (task-04)` | 265-305 | **需适配**：同上，active 会话项在弹窗内，先开弹窗 |
| `renders user-channel log as right-aligned bubble (task-02)` | 307-359 | **需适配**：ended 会话点开走只读回看（弹窗内 SessionHistoryView），需先开弹窗再点会话；气泡 class 断言保留 |
| `renders agent-only history without user log (task-02 D-005)` | 361-400 | **需适配**：同上，先开弹窗 |
| `loads active session into read-only (ql-007)` | 402-449 | 改断言③（已述，反转） |
| `AC-11-01 ~ AC-11-06`（续聊按钮） | 451-573 | **需适配**：ended 会话续聊流程在弹窗内，所有 `fireEvent.click(await screen.findByText(/sess-resume1/))` 前需先开弹窗；`renderWithSession` helper 需补充「mock runtime + 开弹窗」步骤。AC-11-05 的 `streamSession` / `交互式会话` 断言保留（attach 链路不变） |
| `改动一-4 / 改动一-6 ended / 改动一-6 gone` | 577-644 | 改断言④（已述） |

**适配通用模式**：凡用例需要「点击会话项」，统一在 `render(<RuntimesPage/>)` 后、`findByText(/sess-.../)` 前插入：
```tsx
// 先开弹窗（会话项在弹窗 sidebar）
daemon.listDaemonRuntimes.mockResolvedValue([<该会话 runtime_id 对应的 runtime>]);
const sessionBtn = await screen.findByRole("button", { name: /^会话$/ });
fireEvent.click(sessionBtn);
await waitFor(() => expect(screen.getByRole("dialog")).toBeInTheDocument());
```
建议提取一个本地 helper（如 `openSessionDialog(runtimeName)`）减少重复，但本文件内联亦可（与现有 `renderWithSession` / `claudeEndedSession` helper 风格一致）。

### 删除的用例

无整条删除。所有现有用例经适配后保留（覆盖 runtime 列表 / 删除会话 / 气泡渲染 / 续聊按钮回归，这些是 task-02/03/04 之外的历史功能，不能丢）。

## 完成标准

- [ ] 4 处失效断言全部按上述①②③④重写完成
- [ ] 保留用例（runtime 列表 / 删除会话 / 气泡 channel / AC-11-01~06）完成「先开弹窗」适配，逻辑不回归
- [ ] `cd frontend && pnpm test -- run page.test.tsx` 该文件全绿（vitest run 单文件）
- [ ] SC-1 达成（点「会话」→ 弹窗打开 + 列出 runtime 会话，断言②）
- [ ] SC-6 达成（无常驻会话区，断言①）
- [ ] SC-7 达成（active URL 自动开弹窗 attach，断言④a）
- [ ] SC-8 达成（ended URL 降级不开弹窗 + 清 param，断言④b/c）
- [ ] 覆盖 R-05（4 处旧断言全部重写，无残留失效断言）
- [ ] 无新增依赖（复用现有 daemon / next/navigation / FakeES mock）
- [ ] 若 task-04 实际 header 文案 / selector 与本蓝图假设不符，按实际调整并在下方「实现备忘」记录差异

## 注意事项

1. **Radix Dialog `role=dialog` 在 jsdom 可查询**：shadcn `DialogContent` 基于 `@radix-ui/react-dialog`，默认渲染 `<div role="dialog">`。jsdom 下 Radix Dialog 需确认 `DialogPortal` 正常挂载到 `document.body`（默认行为），`screen.getByRole("dialog")` 可查。若 task-02 给 `DialogContent` 显式传了 `role` prop 或用 `aria-label`，按实际 selector 调整。**若 jsdom 下 Radix Dialog 因 `Presence` / 动画导致异步挂载**，所有 dialog 断言一律包在 `await waitFor(() => expect(screen.getByRole("dialog")).toBeInTheDocument())` 内（已在示例中体现）。

2. **复用现有 mock，不新增 vi.mock**：本任务 `allowed_paths` 仅一个文件，不引入新 mock 模块。弹窗组件 `RuntimeSessionDialog` 内部对 `lib/daemon` 的调用通过现有 `daemon.*` mock 拦截（同一 `vi.mock("@/lib/daemon")`），无需为弹窗单独 mock。`FakeES` 对 attach 链路的 SSE 同样生效。

3. **反转 active 只读断言（D-004 核心验证点）**：原 `ql-20260619-007` 是「active 统一只读」的历史决策，D-004 明确推翻。新断言③必须**显式反转**——从 `expect(screen.queryByTitle(/发送/)).not.toBeInTheDocument()` 改为 `expect(...).toBeInTheDocument()`，并补 `streamSession` 调用断言证明走 attach。这是本任务最关键的语义反转，不能用「删除旧断言」糊弄，必须改成正向 attach 断言。

4. **弹窗打开是新增的前置步骤**：旧测试所有「点会话项」操作都假设会话列表在页面主体；新设计会话列表在弹窗 sidebar。适配时**先开弹窗**是统一模式，漏掉会导致 `findByText(/sess-.../)` 超时找不到（项不在 DOM）。建议优先跑一次 vitest 看哪些用例因这个原因失败，再批量加「开弹窗」前置。

5. **不硬编码脆性 class**：旧断言①的 `max-h-[680px]` / `max-h-[520px]` 是脆性断言（像素级）。新断言改为语义级（`session-list-scroll` 不存在 / `dialog` 存在），避免 task-04 微调布局时测试反复改。runtime 卡片高度不新断言具体值。

6. **active URL 恢复的 runtime 映射**：断言④a 需 `getAgentSession` 返回的 `runtime_id` 能在 `listDaemonRuntimes` 结果里找到对应 runtime（page 据此 `setDialogRuntime`）。mock 时两者 `id` 必须一致（如都为 `"r1"`），否则 page 找不到 runtime 不开弹窗，`getByRole("dialog")` 超时。

7. **`nav.replace` 断言方向**：active 恢复成功时 `nav.replace` **不应**被调用（保留恢复点，断言 `not.toHaveBeenCalled`）；ended / 不存在降级时**应**被调用（清 param，断言 `toHaveBeenCalled`）。方向不能搞反。

8. **与 task-06 的边界**：弹窗内部细粒度行为（attach 后 SSE 推送去重 R-01、关闭 SSE/轮询清理 R-02、默认态 D-002、codex 续聊置灰 SC-4）由 `runtime-session-dialog.test.tsx`（task-06）覆盖。本任务只验「page → 弹窗」的集成契约（弹窗开 / active 走 attach / URL 恢复），**不重复**测弹窗内部。若发现弹窗内部 bug，回溯 task-02/03 修，不在本文件加断言。

## 实现备忘

（实现中若 task-04 实际 header 文案 / selector / 会话项位置与本蓝图假设有差异，在此记录：`| 断言编号 | 假设 | 实际 | 调整 |`。无则留空。）
