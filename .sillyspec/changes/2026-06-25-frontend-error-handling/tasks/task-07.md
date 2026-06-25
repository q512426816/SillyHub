---
id: task-07
title: 验证 runtimes 页面测试不破坏（page.test.tsx + __tests__/page-usage.test.tsx，同步 mock/断言到 Modal.confirm + notify）
priority: P0
estimated_hours: 1.0
depends_on:
  - task-06
blocks: []
requirement_ids: []
decision_ids: []
allowed_paths:
  - frontend/src/app/(dashboard)/runtimes/page.test.tsx
  - frontend/src/app/(dashboard)/runtimes/__tests__/page-usage.test.tsx
author: qinyi
created_at: 2026-06-25 10:21:25
---

## 目标

task-06 把 `runtimes/page.tsx` 的删除流程从 `window.confirm` + `setError` 改为 antd `Modal.confirm` + `notify.error/.success` 后，`page.test.tsx` 的相关用例必然破坏（R-06）。本任务负责：

1. 精确识别哪些用例受影响、为何受影响。
2. 调整 mock 策略（从 mock `window.confirm` 改 mock / 触发 antd Modal）与断言（从 inline 红条改 toast）。
3. 补齐覆盖：409 → 友好 toast、204 → 成功 toast（对应 AC-02-c/d 的端到端断言）。

完成此任务后，`pnpm test runtimes/page` 全绿，R-06 关闭。

## 前置依赖

- **task-06**：删除流程已改造（Modal.confirm + notify）。本任务验证其不破坏既有测试 + 补新断言。

## page.test.tsx 现状（精确行号）

文件 `frontend/src/app/(dashboard)/runtimes/page.test.tsx` 共 252 行，6 个用例：

| 用例 | 行号 | 是否受 task-06 影响 | 原因 |
|---|---|---|---|
| 渲染 runtime 列表，无底部常驻会话区 | 125-136 | **否** | 不涉及删除 |
| 点「会话」按钮 → 弹 RuntimeSessionDialog | 138-150 | **否** | 不涉及删除 |
| **ql-012 移除 runtime（confirm → deleteDaemonRuntime）** | **152-162** | **是 — 必破坏** | 见下「受影响用例详解」 |
| URL ?session=<active> mount → 自动开弹窗 | 164-204 | **否** | 不涉及删除 |
| URL ?session=<ended> → 不开弹窗 + 清 param | 206-231 | **否** | 不涉及删除 |
| URL ?session=<不存在> → 清 param | 233-250 | **否** | 不涉及删除 |

**关键 mock 设施**（beforeEach，88-117 行）：

- 116 行：`vi.stubGlobal("confirm", vi.fn(() => true));` — **task-06 后失效**（Modal.confirm 不调 window.confirm）。
- 96 行：`daemon.deleteDaemonRuntime.mockResolvedValue(undefined);` — 保留（204 成功路径）。

**imports**（13-17 行）：`@testing-library/react` 的 `render/screen/waitFor/fireEvent/within` + `vitest` + 被测 `RuntimesPage` + `useSession`。**无 antd test utils、无 mock antd App**。

## 受影响用例详解

### 用例「ql-012 移除 runtime」（152-162 行）— 必破坏

**现状代码**：

```tsx
it("ql-012 移除 runtime（confirm → deleteDaemonRuntime）", async () => {
  daemon.listDaemonRuntimes.mockResolvedValue([
    makeRuntime({ id: "rt-del", name: "to-remove" }),
  ]);
  render(<RuntimesPage />);
  const removeBtn = await screen.findByRole("button", { name: /移除/ });
  fireEvent.click(removeBtn);
  await waitFor(() => expect(daemon.deleteDaemonRuntime).toHaveBeenCalledWith("rt-del"));
  expect(confirm).toHaveBeenCalled();
  await waitFor(() => expect(screen.queryByText("to-remove")).not.toBeInTheDocument());
});
```

**破坏点**（对应 task-06 改动）：

1. **行 158 `fireEvent.click(removeBtn)` 后不再立即 delete**：task-06 把删除搬进 `modal.confirm({ onOk: async () => {...} })`，点移除按钮只弹 Modal，需再点 Modal 的「移除」OK 按钮才触发 delete。
   - 后果：行 159 `await waitFor(() => expect(daemon.deleteDaemonRuntime).toHaveBeenCalledWith("rt-del"))` 超时失败（delete 没被调）。
2. **行 160 `expect(confirm).toHaveBeenCalled()` 失败**：task-06 不再用 `window.confirm`，全局 `confirm` stub（116 行）根本不会被调。即使保留 stub，断言对象不对。
3. **行 161 列表立即移除失败**：同理，delete 未触发 → 列表未变 → `queryByText("to-remove")` 仍在 DOM。

## 实现步骤

### 步骤 1 — 调整 beforeEach（88-117 行）

**删除** 116 行的 `vi.stubGlobal("confirm", vi.fn(() => true));` —— 不再需要。

**评估是否需 mock antd Modal**：antd `Modal.confirm` 在 jsdom 下会渲染到 document.body 的 portal。`App.useApp().modal` 需要 `<AntApp>` 上下文。两条路：

- **路 A（推荐）**：测试渲染 `<RuntimesPage />` 时，让其内部的 `App.useApp()` 能拿到上下文。需确认 `(dashboard)/layout.tsx` 的 `<AntApp>` 是否被 import 进测试。若 page 组件直接被 render（不经 layout），`App.useApp()` 会抛 `Context not found`。
- **路 B**：在测试里包一层 `<App>`（从 antd import）作为 wrapper：`render(<RuntimesPage />, { wrapper: ({ children }) => <App>{children}</App> })`。

**先验证**：跑一次现有测试看 task-06 后实际报错（是 Context 错误还是断言超时），决定走 A 还是 B。若 `antd-providers.tsx` 的 `<AntApp>` 不在 page 直接依赖链上（layout 才包），则用**路 B**——给 `render` 加 wrapper。

```tsx
// 顶部 imports 追加（13 行附近）
import { App as AntApp } from "antd";

// 在每个用例的 render 调用包 wrapper（或抽 helper）
function renderPage(ui: React.ReactElement) {
  return render(<AntApp>{ui}</AntApp>);
}
// 用法：renderPage(<RuntimesPage />)
```

> 注：`useNotify` 内部的 `App.useApp()` 同样依赖此 wrapper，故所有用例（不只是删除用例）都需走 wrapper，否则 page mount 即崩。

### 步骤 2 — 重写「ql-012 移除 runtime」用例（152-162 行）

改用「点移除按钮 → 找 Modal → 点 Modal OK → 断言 delete + 列表移除」：

```tsx
it("ql-012 移除 runtime（Modal.confirm → deleteDaemonRuntime → 成功 toast + 列表移除）", async () => {
  daemon.listDaemonRuntimes.mockResolvedValue([
    makeRuntime({ id: "rt-del", name: "to-remove" }),
  ]);
  renderPage(<RuntimesPage />);
  const removeBtn = await screen.findByRole("button", { name: /移除/ });
  fireEvent.click(removeBtn);

  // task-06：点移除 → 弹 antd Modal.confirm（document.body portal）
  const dialog = await screen.findByRole("dialog");
  // Modal 的 OK 按钮文案「移除」（okText），用 within 限定弹窗作用域
  const okBtn = within(dialog).getByRole("button", { name: "移除" });
  fireEvent.click(okBtn);

  await waitFor(() =>
    expect(daemon.deleteDaemonRuntime).toHaveBeenCalledWith("rt-del"),
  );
  // 204 成功 → notify.success("运行时已移除") + 列表移除
  await waitFor(() =>
    expect(screen.queryByText("to-remove")).not.toBeInTheDocument(),
  );
});
```

**注意**：

- 删除 `expect(confirm).toHaveBeenCalled()`——window.confirm 已不用。
- Modal 的 OK 按钮用 `within(dialog).getByRole("button", { name: "移除" })` 定位。**风险**：卡片内也有「移除」按钮（704-714 行），但卡片不在 dialog 内，`within(dialog)` 限定作用域后不会误匹配。
- **取消断言 `notify.success` 被调**：jsdom 下 antd `message.success` 会异步渲染到 message container，断言「运行时已移除」文本出现可能不稳（动画/portal 时序）。**优先断言行为（delete 被调 + 列表移除）**，toast 文本作为可选软断言（`expect(screen.findByText("运行时已移除")).resolves.toBeInTheDocument()` 用 try/catch 兜底）。若需严格断言 toast，可 mock `useNotify` 返回的 `success` 为 `vi.fn()` 再断言被调。

### 步骤 3 — 补 409 友好 toast 用例（对应 AC-02-c）

新增用例，验证 409 时列表不变 + 中文 message 走 toast：

```tsx
it("task-06：删除被绑定（409）→ notify.error 弹后端中文 message，列表不变", async () => {
  daemon.listDaemonRuntimes.mockResolvedValue([
    makeRuntime({ id: "rt-bound", name: "bound-runtime" }),
  ]);
  const { ApiError } = await import("@/lib/api");
  daemon.deleteDaemonRuntime.mockRejectedValue(
    new ApiError(409, {
      code: "HTTP_409_CONFLICT",
      message: "该 daemon 仍被 2 个 workspace 绑定，请先解绑后再移除",
      request_id: "req-1",
      details: null,
    }),
  );

  renderPage(<RuntimesPage />);
  const removeBtn = await screen.findByRole("button", { name: /移除/ });
  fireEvent.click(removeBtn);
  const dialog = await screen.findByRole("dialog");
  fireEvent.click(within(dialog).getByRole("button", { name: "移除" }));

  // 409 → notify.error 弹后端中文 message（不含英文 code）
  await waitFor(() =>
    expect(screen.getByText(/该 daemon 仍被 2 个 workspace 绑定/)).toBeInTheDocument(),
  );
  // 列表不变（runtime 仍在）
  await waitFor(() =>
    expect(screen.getByText("bound-runtime")).toBeInTheDocument(),
  );
  // 反向断言：英文 code 不暴露给用户
  expect(screen.queryByText(/HTTP_409/)).not.toBeInTheDocument();
});
```

**toast 文本断言风险**：antd `message.error(msg)` 渲染的文本节点在 message container（portal），用 `screen.getByText` 跨 portal 可查到。但若时序不稳，fallback 是 mock `useNotify`：

```tsx
// 在 vi.mock("@/lib/errors", ...) 里把 useNotify 返回的 error 改 vi.fn()
// 然后断言 notify.error 被调，参数是 errMessage(err) 结果
```

**推荐先用真实 antd message 渲染断言**（端到端更真实），时序问题再降级 mock。

### 步骤 4 — 补 Modal 取消用例（对应 AC-02-e，可选）

```tsx
it("task-06：Modal 取消 → 不调 deleteDaemonRuntime，列表不变", async () => {
  daemon.listDaemonRuntimes.mockResolvedValue([
    makeRuntime({ id: "rt-x", name: "stay" }),
  ]);
  renderPage(<RuntimesPage />);
  fireEvent.click(await screen.findByRole("button", { name: /移除/ }));
  const dialog = await screen.findByRole("dialog");
  fireEvent.click(within(dialog).getByRole("button", { name: "取消" }));
  // 取消 → 不 delete
  expect(daemon.deleteDaemonRuntime).not.toHaveBeenCalled();
  // 列表不变
  expect(screen.getByText("stay")).toBeInTheDocument();
});
```

> 此用例优先级低于步骤 3，时间紧可省，但建议补（覆盖 AC-02-e ESC/取消路径）。

### 步骤 5 — 其余 4 个不涉及删除的用例（125-150、164-250）

**仅需统一改 render 调用为 `renderPage`**（包 `<AntApp>` wrapper），因为 task-06 后 page 组件内 `useNotify()` → `App.useApp()` 在 mount 时即需 AntApp 上下文（不只删除流程）。

逐个用例改：

- 127 行：`render(<RuntimesPage />)` → `renderPage(<RuntimesPage />)`
- 140 行：同上
- 165 行（URL active 用例）：同上
- 207 行（URL ended 用例）：同上
- 234 行（URL 不存在用例）：同上

**断言不变**（这些用例不查删除/不查 confirm）。

> 若验证发现 `App.useApp()` 在 page mount 时是惰性调用（仅在 handleDeleteRuntime 触发时才调），则非删除用例可不包 wrapper。但 `const notify = useNotify(); const { modal } = App.useApp();` 是组件顶层调用（render 时即执行），**必须包 wrapper**，否则所有用例 mount 即抛错。

## 参考代码

### useNotify mock 范式（若 toast 文本断言不稳时降级用）

```tsx
const notifyMock = vi.hoisted(() => ({
  error: vi.fn(),
  success: vi.fn(),
}));

vi.mock("@/lib/errors", async () => {
  const actual = await vi.importActual<typeof import("@/lib/errors")>("@/lib/errors");
  return {
    ...actual,
    useNotify: () => notifyMock,
  };
});

// 用例里
fireEvent.click(okBtn);
await waitFor(() => expect(daemon.deleteDaemonRuntime).toHaveBeenCalled());
expect(notifyMock.error).toHaveBeenCalledWith(
  expect.any(ApiError),
  "移除运行时失败",
);
```

> 优先用真实渲染断言（步骤 3），mock 作为降级。mock 时注意 `errMessage` 仍需真实（actual.errMessage），否则断言 message 文本失真。

### antd Modal.confirm 在 jsdom 的渲染

antd v5 `Modal.confirm` 渲染到 document.body 的 `.ant-modal` portal，`screen`（绑 document.body）可查到。OK 按钮默认 `class="ant-btn-primary"` + `okText` 文案；cancel 按钮 `okType` 默认 default + `cancelText`。用 `within(dialog).getByRole("button", { name: "移除" })` 最稳。

## 验收标准

对应 plan.md AC-02 测试侧 + AC-05（既有测试不破坏）：

- [ ] **AC-05-a**：`pnpm --filter frontend test runtimes/page` 全绿（6 个原用例 + 新增用例）。
- [ ] **AC-05-b**：原「ql-012 移除 runtime」用例改为「点移除 → 找 Modal dialog → 点 Modal OK → 断言 delete 被调 + 列表移除」，不再断言 `window.confirm`。
- [ ] **AC-02-c（测试侧）**：新增 409 用例——deleteDaemonRuntime reject `ApiError(409, 中文 message)` → 断言 toast 显示中文 message、列表不变、**反断言**无英文 `HTTP_409` 暴露。
- [ ] **AC-02-b（测试侧）**：原删除用例覆盖 204 成功路径（delete 被调 + 列表移除）；成功 toast 软断言（行为优先，toast 文本可选）。
- [ ] **AC-02-e（测试侧，可选）**：Modal 取消用例——断言 delete 未被调 + 列表不变。
- [ ] **AC-05-c**：4 个非删除用例统一包 `<AntApp>` wrapper（因 page 顶层调 `useNotify`/`App.useApp()`），断言逻辑不变。
- [ ] **AC-05-d**：`pnpm --filter frontend tsc --noEmit` 0 error（测试文件类型对齐）。

## 测试

本任务**就是**测试任务，无额外测试套件。完成标准即上述 AC-05-a（`pnpm test runtimes/page` 全绿）。

## 风险/注意事项

- **R-06（核心风险）**：本任务存在的意义就是应对 R-06。若改完测试仍红，**不可改测试逻辑迁就实现**（CLAUDE.md 规则 8）——应回到 task-06 修实现。例外：mock 设施（wrapper、vi.mock）属测试基础设施调整，非逻辑迁就。
- **App.useApp() Context 风险**：page 顶层 `const { modal } = App.useApp()` 在 render 时即执行，若无 `<AntApp>` 祖先会抛 `App.useApp() only works under <App>`。所有用例必须包 wrapper（步骤 5），否则 6 个用例全崩。**先跑一次看实际报错**再决定 wrapper 形式。
- **antd Modal 在 jsdom 的 portal 时序**：`Modal.confirm` 打开有动画，jsdom 下 `findByRole("dialog")` 异步等待通常 OK，但若 flaky，加 `await waitFor`。OK 按钮点击后的 onOk 是 async，`deleteDaemonRuntime` 调用有微任务延迟，用 `await waitFor` 包断言。
- **toast 文本断言 flaky**：antd `message.success/error` 渲染到独立 portal，时序与 Modal 关闭/列表重渲染交织。**优先断言数据层行为**（deleteDaemonRuntime 被调、列表项消失/保留），toast 文本作为增强断言。flaky 时降级 mock useNotify（见参考代码）。
- **useNotify mock 与 errMessage 真实性**：若降级 mock useNotify，mock 时保留 `...actual` spread（errMessage 仍真实），否则 409 用例的中文 message 断言失真——errMessage 是 err→中文文案的关键转换。
- **`<AntApp>` wrapper 引入 ConfigProvider 副作用**：包 `<AntApp>` 会带入 antd 默认主题/config，可能影响其他 antd 组件（如 RuntimeSessionDialog）在测试中的渲染。若发现副作用，改用更轻量的 `App.useApp()` Context Provider（直接 import antd 内部 Context）——但这属 hack，优先用公开 `<App>` API。
