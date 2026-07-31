---
id: task-01
title: runtime-card 离线会话按钮开放
title_zh: 离线时会话按钮仍渲染可点
author: WhaleFall
created_at: 2026-07-31T11:23:11
priority: P0
depends_on: []
blocks: [task-05]
requirement_ids: [FR-01]
decision_ids: [D-001@v1]
allowed_paths:
  - frontend/src/components/daemon/runtime-card.tsx
goal: >
  离线时 /runtimes 卡片"会话"按钮仍渲染可点（不再因 status!=='online' 隐藏），点击进入
  会话弹窗。这是离线"看不见"的根因入口。
implementation:
  - runtime-card.tsx:90-92 canOpenSession 去掉 `runtime.status === "online" &&` 与运算，
    保留 provider 限制（claude|codex）
  - 离线时按钮（:242-252）title 改"运行时离线，点击只读浏览会话历史"，加 WifiOff 图标 + 灰色调暗示只读（仍可点）
acceptance:
  - 离线 runtime 卡片显示"会话"按钮（不再隐藏）
  - 点击按钮仍触发 onOpenSession → 打开 RuntimeSessionDialog
  - 在线 runtime 按钮行为不变（回归）
verify:
  - frontend: pnpm test（task-05 离线按钮用例）
  - pnpm typecheck
constraints:
  - 不改 onOpenSession 回调签名（只放宽显示条件）
  - provider 仍限制 claude/codex（其余 provider 本就无会话）
---

## 实现说明

根因：`canOpenSession = runtime.status === "online" && (claude|codex)` → 离线 false → 按钮不渲染。改成 `provider === claude|codex` 即可（去掉 online 与运算）。离线态用 title/图标暗示只读，不改 onClick（dialog 内部据离线态只读处理，见 task-02/03）。
