---
id: task-02
title: themes.ts dark 底色 zinc-900→zinc-950
title_zh: dark 主题底色提深 zinc-950
allowed_paths:
  - frontend/src/styles/themes.ts
  - frontend/src/styles/themes.test.ts
depends_on: []
goal: FR-06（D-005@v1）：darkTheme.color.bg #18181b→#09090b，拉大 dark 页面底与卡片反差
implementation: |
  1. themes.ts darkTheme.color.bg 改 #09090b（zinc-950，Tailwind v3 默认值）；注释更新。
  2. themes.test.ts 中断言旧值的用例适配为新值（仅断言适配，逻辑不变）。
  3. card 保持 #27272a 不动（Grill G-06：Tailwind 默认值铁律优先于原型 #1b1b1f 近似值）。
acceptance: themes.ts dark.bg=#09090b 且 card 不变；globals.css dark 块同值已在 task-01 同步；themes.test.ts 全绿
verify: pnpm -C frontend exec vitest run src/styles/themes.test.ts 通过
constraints:
  - 只改 dark.bg 一个键，其余主题/键零触碰
  - 与 task-01 的 globals.css dark 块改动配套验收（两处同值）
---

## 说明

与 task-01 同 Wave，文件不相交可并行。
