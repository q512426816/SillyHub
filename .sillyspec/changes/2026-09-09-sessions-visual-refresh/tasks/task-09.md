---
id: task-09
title: dashboard 应用壳极光背景 + 侧栏/顶栏玻璃化
title_zh: 应用壳极光背景与侧栏顶栏玻璃化
allowed_paths:
  - frontend/src/app/(dashboard)/layout.tsx
  - frontend/src/components/app-shell.tsx
  - frontend/src/components/top-bar.tsx
  - frontend/src/components/__tests__/app-shell.test.tsx
  - frontend/src/components/__tests__/top-bar.test.tsx
depends_on:
  - task-01
goal: FR-02（D-008@v1）：极光铺满应用壳底（fixed），侧栏/顶栏玻璃化，玻璃下有色彩可透
implementation: |
  1. dashboard layout 根容器背景改：background-image: var(--aurora-1), var(--aurora-2), var(--aurora-4); background-attachment: fixed（底色仍 bg-background）。
  2. 侧栏实际在 app-shell.tsx（<aside> 367-452 行）——背景改 var(--glass) + backdrop-blur(14px) + saturate(1.4)；顶栏 top-bar.tsx 同步 var(--glass) 玻璃化（sticky h-16 契约不动）。
  3. 极光只挂壳层，滚动内容区不挂 blur（R-02）。
  4. app-shell.test.tsx / top-bar.test.tsx 类名断言适配。
acceptance: 三主题下壳层极光可见且内容区文字对比不受影响；侧栏/顶栏玻璃透出极光；app-shell/top-bar 测试全绿（适配后）
verify: pnpm -C frontend exec vitest run src/components/__tests__/app-shell.test.tsx src/components/__tests__/top-bar.test.tsx 通过；tsc --noEmit 0 错
constraints:
  - 不动 top-bar 高度/sticky/层级契约（FRONTEND_PAGE_STYLE §0.5-6）
  - 极光浓度不超 v4 原型口径（浅 ≤12% / dark ≤22%）
---

## 说明

layout.tsx 只 import AppShell，侧栏/顶栏实体在 app-shell.tsx/top-bar.tsx（plan 审查核实）；面板/列表列玻璃化分别在 task-07/task-08 闭环。
