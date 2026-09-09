---
id: task-11
title: session-input-bar composer 聚焦柔环
title_zh: 输入框聚焦柔环降透明
allowed_paths:
  - frontend/src/components/daemon/session-input-bar.tsx
  - frontend/src/components/daemon/__tests__/session-input-bar-height.test.tsx
  - frontend/src/components/daemon/__tests__/session-input-bar-mention.test.tsx
  - frontend/src/components/daemon/__tests__/session-input-bar-plus-menu.test.tsx
  - frontend/src/components/daemon/__tests__/session-input-bar-upload.test.tsx
depends_on:
  - task-01
goal: FR-03 子项（D-009@v1）：composer 聚焦环从 ring-4 ring-brand-100 改 3px/10% 品牌色柔环
implementation: |
  1. session-input-bar.tsx:661 容器类：focus-within:ring-4 focus-within:ring-brand-100 改为 focus-within:ring-[3px] focus-within:ring-brand-500/10；聚焦边框色 border-primary→brand-400/45 半透明（color-mix 由 ring/边框类透明度承担）。
  2. 常态 shadow-sm / 聚焦 shadow-md 保持（P0 已落地）；dark 主题下霓虹感由 10% 透明度消除。
  3. 测试适配：类名断言随改（行为/高度/mention 契约不动）。
acceptance: 聚焦环 3px/10% 生效；输入框高度/粘贴/联想既有测试全绿
verify: pnpm -C frontend exec vitest run src/components/daemon/__tests__/session-input-bar 通过（height/mention/plus-menu/upload 四件套；turn-timeline-session-input-bar.test.tsx 归 task-06 轮尾适配）
constraints:
  - textarea 高度测量/拖拽把手/＋菜单等交互零改动
  - ring 透明度走 brand 阶 color-mix 机制（config 已支持 /alpha）
---

## 说明

v4 原型 .composer:focus-within 口径；阴影不再从 md 跳 lg。
