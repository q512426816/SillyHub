---
author: flow-machine-draft
created_at: 2026-10-10T11:53:02.321Z
---
# 需求规格（Requirements）— 2026-10-10-variant-test-nav-flip

## 功能需求

### FR-01: session-panel-variant 回归锚用例断言随导航阈值放宽翻转（1 轮 fixture 导航列渲染）

- `session-panel-variant.test.tsx` 的「不传 variant：根/头部 className 与改前字面量逐字一致」用例必须把「轮次导航不存在」断言（锁旧 ql-20260909-005 <3 隐藏行为，注释预留「常驻断言随行为翻转」）翻转为「导航列渲染」，与已归档变更 2026-10-10-single-turn-nav-and-jump-head 的 FR-01（阈值 <3→<1）一致；除该断言与注释外必须零改动。

#### 场景：断言翻转后全绿

- Given 当前 HEAD（阈值已放宽）
- When 运行 session-panel-variant.test.tsx
- Then 回归锚用例通过（1 轮 fixture 下 `getByRole("navigation", { name: "轮次导航" })` 命中），全文件 10/10 绿

## 测试绑定（每条 FR 至少一行——`FR-NN: test/路径「用例名」`；空行/待填在 flow done 拒收）

FR-01: frontend/src/components/daemon/__tests__/session-panel-variant.test.tsx「不传 variant：根/头部 className 与改前字面量逐字一致，桌面 chrome 原位、无 ⋯ 菜单」
