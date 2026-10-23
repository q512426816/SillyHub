---
author: flow-machine-draft
created_at: 2026-10-23T03:00:27.832Z
---
# 任务注册表（Tasks）— 2026-10-23-session-first-window-turn-align

- [x] task-01: 新增 initial-window.ts 自适应编排纯模块（probe 截断判定 + 截断轮合并去重 + 最小 2 轮向前补拉 + 预算/单轮 2000 上限门控），并补 initial-window.test.ts 四类边界单测——验证：`pnpm exec vitest run src/components/daemon/session-panel/__tests__/initial-window.test.ts` 全绿
- [x] task-02: session-panel-page.tsx 首屏接入 buildInitialWindow（cursor/streamCursor/hasEarlier 用合并后行集，补拉前后 cancelled 校验，失败降级回底窗）——验证：tsc 零错 + 既有会话页用例零回归
- [x] task-03: page.test.tsx 补首屏自适应接线集成用例（单轮超窗全量可见 / 已满足条件不额外补拉）——验证：`pnpm exec vitest run "src/app/(dashboard)/sessions/__tests__/page.test.tsx"` 全绿
- [x] task-04: 跑相关 vitest 与 `tsc --noEmit`，确认本次触达面全绿零错
