---
id: task-02
title: 新增 useNotify() hook（封装 App.useApp().message + errMessage，暴露 error/success）
priority: P0
estimated_hours: 0.5
depends_on: [task-01]
blocks: [task-04]
requirement_ids: [FR-02]
decision_ids: [D-005@v1, D-007@v1]
allowed_paths:
  - frontend/src/lib/errors.ts
author: qinyi
created_at: 2026-06-25 10:21:25
---

## 目标

在同文件 `frontend/src/lib/errors.ts` 追加 `useNotify()` hook，封装 antd v5 推荐的 `App.useApp().message` + `errMessage`，暴露 `{ error, success }` 两个方法。它是后续 daemon runtime 删除（task-04）统一 toast 入口；执行场景见 design §5「展示策略规范」（操作类一律走 toast）。**必须在 `<AntApp>` 内使用** —— dashboard layout 已全局包裹（R-01 已确认）。

## 前置依赖

- **task-01**：`errMessage` 必须先存在（本 hook 内部调用）。同文件追加，无 import 成本。
- **antd `<AntApp>` 上下文**：`frontend/src/components/antd-providers.tsx:68` 的 `<AntApp>{children}</AntApp>` 已包裹整个应用（由 root `app/layout.tsx` 引入），`App.useApp()` 在任意客户端组件内可拿到 message 实例。

## 实现步骤

1. 打开 task-01 创建的 `frontend/src/lib/errors.ts`。
2. 顶部新增 import（在现有 `import { ApiError } from "@/lib/api";` 之后）：

```ts
import { App } from "antd";
```

3. 在 `errMessage` 函数下方追加 hook（**注意是 React hook，文件仍是 `.ts` 不是 `.tsx`** —— 仅类型/闭包，无 JSX）：

```ts
/**
 * 组件内统一的 antd toast 通知入口。
 *
 * 封装 App.useApp().message + errMessage：调用方传任意错误对象，
 * 内部自动取出中文文案（network 兜底 / err.message / fallback）。
 *
 * 必须在 <AntApp> 内使用 —— dashboard 全局已被 antd-providers.tsx
 * 的 <AntApp> 包裹（R-01 已确认），所有 dashboard 路由均可直接调用。
 *
 * 展示策略规范（design §5）：操作类（删/建/改/启停）走 toast；
 * 加载/列表失败仍用 inline 红条 setError(errMessage(err))，不走本 hook。
 */
export function useNotify(): {
  error: (err: unknown, fallback?: string) => void;
  success: (msg: string) => void;
} {
  const { message } = App.useApp();
  return {
    error: (err, fallback) => message.error(errMessage(err, fallback)),
    success: (msg) => message.success(msg),
  };
}
```

4. 保存。
5. 跑 typecheck 自检：`cd frontend && pnpm exec tsc --noEmit`（应 0 error）。如报 `App.useApp` 类型找不到，确认 antd 版本 ≥ 5（package.json `antd: ^5.x`，CONVENTIONS 已载明 v5）。
6. **不写单测**：`useNotify` 是 1 行薄封装，测试它需要 mock `App.useApp()`（需 renderHook + AntApp provider，成本高收益低）。其行为正确性由 task-04 的端到端页面测试（`runtimes/page.test.tsx`，task-05 守护）间接覆盖。`errMessage` 自身由 task-03 覆盖。

## 参考代码

- **`App.useApp()` 是 antd v5 推荐方式**（CONVENTIONS 「样式」节：「antd 上下文由 `components/antd-providers.tsx`（`App as AntApp` + `ConfigProvider`）统一注入，组件内用 `App.useApp()` 取实例」）。返回 `{ message, notification, modal }`，本 hook 只取 `message`。
- **旧式 `message.useMessage()` 范例**（`frontend/src/components/ppm-project-plan-form.tsx:110`）：`const [messageApi, contextHolder] = message.useMessage();` —— 这是 antd v4 静态方式，需手动挂 contextHolder。**本 hook 用 v5 的 `App.useApp()` 不需要 contextHolder**，更简洁，规范统一。
- **`<AntApp>` 包裹点**（`frontend/src/components/antd-providers.tsx:67-69`）：

```tsx
<ConfigProvider locale={zhCN} theme={{...}}>
  <AntApp>{children}</AntApp>
</ConfigProvider>
```

  → R-01「`useNotify` 依赖 `App.useApp()`，须在 `<AntApp>` 内调用」已验证：调用点（如 runtimes/page.tsx）均在 dashboard 路由组内，必经此 provider。

- **errMessage（task-01 产物）**：本 hook `error` 方法直接调 `errMessage(err, fallback)`，文案规则全部委托，hook 自身不做文案判定。

## 验收标准

对应 plan.md AC-02 的 toast 入口就绪（task-04 完成端到端）：
- `useNotify()` 在 `<AntApp>` 内调用不抛错（R-01）。
- `notify.error(err)` 弹出 `errMessage(err)` 的文案（network 兜底 / 业务中文 / fallback 三态正确）。
- `notify.success(msg)` 弹出传入的 msg。
- 类型签名严格匹配 design §7：`{ error(err: unknown, fallback?: string): void; success(msg: string): void }`。
- `tsc --noEmit` 0 error。

## 测试

本 task 不写独立单测。覆盖路径：
- **`errMessage` 行为**：由 task-03 的 `errors.test.ts` 6 个 it 完整覆盖（hook 内部仅转调）。
- **`useNotify` 接线正确性**：由 task-04 的 daemon runtime 删除端到端（`runtimes/page.test.tsx`，task-05 守护不破坏）间接验证 —— 409 时弹友好中文 toast、204 时弹「运行时已移除」。
- 不为 1 行薄封装单独 renderHook + mock App provider，性价比低（与 design YAGNI 一致）。

## 风险/注意事项

- **必须在 `<AntApp>` 内调用**：若在 root layout 之外或非客户端组件（RSC）使用，`App.useApp()` 会拿到 undefined 并抛错。R-01 已确认所有预期调用点（runtimes/page、16 处 D 模式收敛）均在 dashboard 内。**禁止**在 store 层（`stores/*.ts`，非 React 上下文）调本 hook —— store 错误反馈继续用静态 `message` 或迁移到调用方组件内（task-07 仅合并 util 不动 store 静态 message，N2）。
- **hook 命名**：`useNotify` 而非 `useMessage` —— 避免与 antd `message` / React `useMessage` 概念混淆，语义更准（封装 error+success 两种通知）。
- **返回值稳定性**：每次 render 返回新对象（`{ error, success }` 字面量）。调用方若把 `notify.error` 作为 useEffect 依赖会有无限循环 —— 但实际用法都是在事件 handler 内调（onClick / catch 块），不进依赖数组，无此问题。如未来需要稳定引用，再用 `useCallback` 包，本次 YAGNI。
- **不扩展 info/warning**：design §7 注释「info/warning 按需扩展」。本次只做 error/success（覆盖 daemon 删除 + D 模式收敛需求），避免投机性 API 膨胀。
- **`.ts` vs `.tsx`**：本文件无 JSX，保持 `.ts`（与 `lib/` 下其它 util 一致，如 `lib/api.ts`、`lib/utils.ts`）。
