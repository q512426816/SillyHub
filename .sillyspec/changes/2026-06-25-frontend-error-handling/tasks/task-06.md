---
id: task-06
title: daemon runtime 删除改造（window.confirm→antd Modal.confirm + notify toast）
priority: P0
estimated_hours: 1.5
depends_on:
  - task-01
  - task-02
blocks:
  - task-07
  - task-08
requirement_ids:
  - FR-03
decision_ids:
  - D-003@v1
  - D-007@v1
allowed_paths:
  - frontend/src/app/(dashboard)/runtimes/page.tsx
author: qinyi
created_at: 2026-06-25 10:21:25
---

## 目标

把 `runtimes/page.tsx` 的 daemon runtime 删除流程改造为 design §5 规范化展示策略的首个落地场景：

1. 二次确认从 `window.confirm`（浏览器原生丑弹窗）改为 antd `Modal.confirm`（走主题、destructive 主题）。
2. 删除失败从 inline `setError(...)`（顶部红条）改为 antd toast `notify.error(...)`——409 时后端中文 message（如「该 daemon 仍被 N 个 workspace 绑定…」）直接弹，无英文 code 暴露。
3. 删除成功补 `notify.success("运行时已移除")`（D-003@v1 范例：成功 toast 仅本场景补，不扩展全站）。
4. 409 时列表保持不变（runtime 仍在），仅 toast 提示去解绑。

完成此任务后，daemon runtime 删除成为 Wave 2 验收 AC-02 的端到端示范。

## 前置依赖

- **task-01**（`errMessage` 纯函数，`lib/errors.ts`）：`notify.error` 内部依赖。
- **task-02**（`useNotify` hook，`lib/errors.ts`）：本任务直接消费 `useNotify().error/.success`。
- design §7 已确认 `useNotify` 仅封装 `App.useApp().message`，**不封装 modal**——故本任务 Modal.confirm 另从 `App.useApp().modal` 取，**不扩展 useNotify**（保持 hook 单一职责，避免 scope creep）。

## 实现步骤

### 步骤 1 — 新增 import

`frontend/src/app/(dashboard)/runtimes/page.tsx` 当前（行 1）是 `"use client"`，组件顶部 imports（行 6-53）含 lucide-react / 自定义 ui / `@/lib/daemon` / `@/lib/api` 的 `ApiError` / `@/stores/session`。**无任何 antd import**。

在 imports 区追加：

```ts
import { App } from "antd";
import { useNotify } from "@/lib/errors";
```

> 不再单独 import `Modal`——用 `App.useApp().modal.confirm` 走主题（design §5 / CONVENTIONS.md §样式：antd 上下文由 `antd-providers.tsx` 的 `<AntApp>` 注入，组件内用 `App.useApp()` 取实例）。

### 步骤 2 — 组件内取 notify / modal 实例

`RuntimesPage` 组件函数体（778 行起），在现有 useState 声明块（779-797 行）之后、`useRouter`（800 行）之前或紧邻，追加：

```ts
const notify = useNotify();
const { modal } = App.useApp();
```

> R-01 应对：`useNotify` / `App.useApp()` 依赖 `<AntApp>` 包裹，dashboard layout 已被 `components/antd-providers.tsx` 包裹，page 在其内，调用合法。

### 步骤 3 — 改造 handleDeleteRuntime（864-882 行）

**现状**（精确行号）：

- 865-867：`const confirmed = window.confirm(\`确定移除运行时「${runtime.name ?? getProviderLabel(runtime.provider)}」？\n将同时清除该运行时下的会话与任务记录，且不可恢复。daemon 下次心跳会重新注册。\`)`
- 868：`if (!confirmed) return;`
- 869：`setError(null);`
- 870：`setRuntimeActionId(runtime.id);`
- 871-876：try 块——`await deleteDaemonRuntime(runtime.id)` → `setItems((prev) => prev ? prev.filter(...) : prev)` → `setSessions((prev) => prev.filter(...))` → `if (dialogRuntime?.id === runtime.id) setDialogRuntime(null)` → `setLastRefreshedAt(new Date())`
- 877-878：catch `setError(err instanceof ApiError ? err.message : "移除运行时失败")`
- 879-881：finally `setRuntimeActionId(null)`
- 882：依赖数组 `[dialogRuntime?.id]`

**改法**——把同步 confirm + try/catch 重构为 antd `modal.confirm` 异步回调风格，实际删除逻辑搬进 `onOk`：

```tsx
const handleDeleteRuntime = useCallback(
  (runtime: DaemonRuntimeRead) => {
    modal.confirm({
      title: "移除运行时",
      content: `确定移除运行时「${
        runtime.name ?? getProviderLabel(runtime.provider)
      }」？将同时清除该运行时下的会话与任务记录，且不可恢复。daemon 下次心跳会重新注册。`,
      okText: "移除",
      okType: "danger",
      cancelText: "取消",
      onOk: async () => {
        setRuntimeActionId(runtime.id);
        try {
          await deleteDaemonRuntime(runtime.id);
          setItems((prev) =>
            prev ? prev.filter((item) => item.id !== runtime.id) : prev,
          );
          setSessions((prev) => prev.filter((s) => s.runtime_id !== runtime.id));
          if (dialogRuntime?.id === runtime.id) setDialogRuntime(null);
          setLastRefreshedAt(new Date());
          notify.success("运行时已移除");
        } catch (err) {
          notify.error(err, "移除运行时失败");
        } finally {
          setRuntimeActionId(null);
        }
      },
    });
  },
  [dialogRuntime?.id, modal, notify],
);
```

**关键变化点**：

1. **签名从 `async (runtime) => Promise<void>` 改为 `(runtime) => void`**——`modal.confirm` 立即返回，实际删除在 `onOk` 异步回调里。删除按钮的 `onClick={() => void onDelete(runtime)}`（709 行）仍兼容（void 忽略）。
2. **`window.confirm` 文案拆为 title + content**：title 短「移除运行时」，content 把原 `\n` 分隔的多句话改成单句陈述（Modal 视觉里换行用空格更自然，不强制 `\n`）。
3. **`okType: "danger"`**——destructive 红色按钮（R-05 视觉一致）。
4. **成功路径补 `notify.success("运行时已移除")`**——D-003@v1 范例。
5. **失败路径 `notify.error(err, "移除运行时失败")`**——errMessage 内部对 `ApiError` 取 `err.message`（409 中文直接弹），network_error 走中文兜底，非 ApiError 走 fallback。
6. **依赖数组**：加 `modal` / `notify`（来自 useApp/useNotify，引用稳定但 TS exhaustive-deps 要求列出）。
7. **删掉 `setError(null)`（原 869 行）**——删除流程不再用顶部 error state。

### 步骤 4 — 评估顶部 error state 是否保留

`error` state 声明在 780 行：`const [error, setError] = useState<string | null>(null);`。

**调研**：`setError` 在本文件还有 3 处使用：

- `reload`（839 行 catch）——列表加载失败，**保留**（design §5：页面加载/列表拉取失败用 inline 红条）。
- `handleToggleRuntime`（857 行 catch）——启停运行时失败，**本任务不改**（Wave 2 范围仅删除；启停可作为后续收敛）。
- 删除流程（原 878 行）——**本步骤已移除**。

**结论**：保留 `error` state 与顶部 inline 红条渲染（1042-1047 行）不动——`reload` / `handleToggleRuntime` 仍用。仅删除流程从 inline 改 toast。这与 design §5「按场景区分」一致（操作类 toast / 加载 inline）。

### 步骤 5 — 验证 ApiError import 仍需要

`ApiError` import（35 行）原本服务于 reload（839）/ toggle（857）/ 删除（原 878）三处 `err instanceof ApiError`。删除流程改 notify 后不再直接用 `instanceof`，但 reload/toggle 仍用，**保留 import**。

> 注：`notify.error(err, fallback)` 内部已封装 `instanceof ApiError` 判断（task-01 errMessage），调用方不再需要手写三元。

## 参考代码

### ppm-project-plan-form.tsx 的 message 范式（不一致——本任务不照搬）

`frontend/src/components/ppm-project-plan-form.tsx:110` 用的是**静态 `message.useMessage()` + `contextHolder`** 范式：

```tsx
const [messageApi, contextHolder] = message.useMessage();
// ...
{contextHolder}
```

提交时 `messageApi.error(e instanceof ApiError ? e.message : "保存失败")`（259 行）。

**本任务不照搬此范式**，因为：

1. design §7 明确 `useNotify` 走 `App.useApp().message`（项目推荐范式，CONVENTIONS.md §样式）。
2. `App.useApp()` 由 `antd-providers.tsx` 的 `<AntApp>` 统一注入，无需每组件手动放 contextHolder。
3. `message.useMessage()` 与 `App.useApp().message` 混用会导致主题/config 不一致（前者无全局 ConfigProvider 上下文）。

> ppm 表单是历史代码（早于 antd-providers 改造），Wave 3 / 后续可统一收敛，本任务不动。

### page.test.tsx 现状（task-07 详改，本任务仅知会）

`page.test.tsx:116` 在 `beforeEach` 里 `vi.stubGlobal("confirm", vi.fn(() => true))`；第 152-162 行用例「ql-012 移除 runtime」断言：

- `fireEvent.click(removeBtn)` → `daemon.deleteDaemonRuntime` 被调（159 行）
- `expect(confirm).toHaveBeenCalled()`（160 行）
- 列表立即移除（161 行）

改 Modal.confirm 后此用例必破坏——具体改法见 task-07。**本任务实现时不动测试文件**（allowed_paths 仅 page.tsx），由 task-07 同步修测试。

## 验收标准

对应 plan.md AC-02（daemon runtime 删除）：

- [ ] **AC-02-a**：点「移除」按钮 → 弹出 antd `Modal.confirm`（非 window.confirm），title「移除运行时」、content 含 runtime 名称 + 不可恢复提示、OK 按钮 destructive 红色「移除」、取消「取消」。
- [ ] **AC-02-b**：Modal 点「移除」→ 调 `deleteDaemonRuntime(id)` → 204 成功 → 列表立即移除该卡片 + sessions 同步清 + （若该 runtime 弹窗开着）关闭弹窗 + 弹 toast「运行时已移除」。
- [ ] **AC-02-c**：deleteDaemonRuntime reject `ApiError(409, { message: "该 daemon 仍被 N 个 workspace 绑定…" })` → 弹 toast 显示后端中文 message（**不**显示英文 `HTTP_409_…` code、**不**显示 500/英文），列表保持不变（runtime 仍在），不弹成功 toast。
- [ ] **AC-02-d**：deleteDaemonRuntime reject `ApiError(network_error)` → 弹 toast「网络连接失败，请检查网络后重试」（errMessage 中文兜底）。
- [ ] **AC-02-e**：Modal 点「取消」/ 按 ESC / 点遮罩 → 不调 deleteDaemonRuntime，列表不变，无 toast。
- [ ] **AC-02-f**：顶部 inline 红条（`error` state + 1042-1047 行渲染）保留——reload / toggle 失败仍走 inline（本任务不动这两处）。
- [ ] **AC-02-g**：`tsc --noEmit` 0 error（含 useCallback 依赖数组完整、`App`/`useNotify` 类型对齐）。
- [ ] **AC-02-h**：删除按钮 `disabled={actioning}`（708 行）行为不变——`setRuntimeActionId` 在 onOk try/finally 内仍设置/清空，删除进行中按钮禁用。

## 测试

本任务**不改** `page.test.tsx`（allowed_paths 仅 page.tsx）。测试同步由 **task-07** 负责。

实现完成后**手工**验证（task-07 改完测试前）：

1. `pnpm --filter frontend tsc --noEmit` 通过。
2. 启动 dev server，进 /runtimes 页面，点某 runtime 卡片「移除」→ 应弹 antd Modal（非浏览器原生 confirm）。
3. 点 Modal「移除」→ 卡片消失 + 右下/顶部 toast「运行时已移除」。
4. 构造 409（runtime 被绑定）→ 点移除 → Modal 确认 → toast 显示后端中文 message、卡片仍在。
5. 点 Modal「取消」→ 无任何变化。

## 风险/注意事项

- **R-05（Modal.confirm UX 变化）**：从浏览器原生 confirm 改 antd Modal，视觉/交互变化（Modal 可 ESC 关、点遮罩关、有动画）。属改善，沿用 destructive 主题，低风险。但需确认 Modal z-index 不被 RuntimeSessionDialog（1148 行）遮挡——删除按钮在卡片内，弹窗未开时点移除不会与 dialog 冲突；若 dialog 开着点另一卡片的移除，antd Modal 默认 z-index 高于自定义 dialog，需实测。
- **R-06（测试破坏）**：`page.test.tsx:152-162` 用例必失败（详见 task-07）。本任务实现后 `pnpm test runtimes/page` 会红，是预期，由 task-07 修复——**不可为让测试通过而回退实现或改测试逻辑**（CLAUDE.md 规则 8）。
- **R-01（useNotify 依赖 AntApp）**：dashboard layout 已包 `<AntApp>`，page 在其内。若实测发现 toast 不弹（App context 未注入），检查 `components/antd-providers.tsx` 是否在 `(dashboard)/layout.tsx` 之上。
- **useCallback 依赖**：`modal` / `notify` 来自 `App.useApp()` / `useNotify()`，引用在单次 render 内稳定（antd 内部用 useMemo/useRef 缓存），加入依赖数组不会导致无限重渲染。
- **删除按钮 disabled 时序**：原同步流程点按钮 → 立即 setRuntimeActionId → 禁用。改 Modal 后，点按钮先弹 Modal（按钮此时未禁用），点 Modal OK 才 setRuntimeActionId。用户在 Modal 打开期间可重复点其他卡片移除按钮——低风险（每次开新 Modal 会替换前一个，antd 行为），如需严格防抖可加 ref，本任务不做（YAGNI）。
