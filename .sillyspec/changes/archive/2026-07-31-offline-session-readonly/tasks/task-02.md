---
id: task-02
title: dialog 从实时 runtimes 重查派生 runtimeOffline
title_zh: 弹窗据实时运行时状态派生离线标志透传面板
author: WhaleFall
created_at: 2026-07-31T11:23:11
priority: P0
depends_on: []
blocks: [task-03, task-07]
requirement_ids: [FR-02]
decision_ids: [D-005@v1]
allowed_paths:
  - frontend/src/components/daemon/runtime-session-dialog.tsx
goal: >
  RuntimeSessionDialog 从实时 `runtimes` prop 重查 runtime.status 派生 runtimeOffline 透传
  InteractiveSessionPanel。不用 stale `runtime` prop（Design Grill B2：dialogRuntime 是 page
  state 快照，不随 machines 轮询更新，重连后不翻转）。
implementation:
  - runtime-session-dialog.tsx（:145-164 附近）新增：
    `const liveRuntime = runtimes.find((r) => r.id === runtime?.id);`
    `const runtimeOffline = (liveRuntime?.status ?? runtime?.status) !== "online";`
  - 透传 `<InteractiveSessionPanel offlineReadOnly={runtimeOffline} ... />`
  - 列表 reload / 历史 logs / URL 恢复逻辑不变（DB 查询，离线照常）
acceptance:
  - dialog 收到 runtimes（实时）+ runtime（stale 快照），用 runtimes 重查 status
  - runtimeOffline 随 runtimes 实时变化（machines 15s 轮询刷新 → 翻转）
  - 现有 onlineProviders/hasOnlineProvider 逻辑保留（新建 provider 选择）
verify:
  - frontend: pnpm test（task-07 重连翻转用例）
  - pnpm typecheck
constraints:
  - 必须从 runtimes（实时）重查，不能用 runtime prop（stale，D-005）
  - fallback：runtimes 找不到时退 runtime?.status（保守判）
---

## 实现说明

page.tsx:1072 `runtime={dialogRuntime}`（stale state，setDialogRuntime 时设一次）+ :1075 `runtimes={allRuntimes}`（实时，machines flatMap）。dialog 内用 runtimes.find 重查当前 runtime 的实时 status → runtimeOffline。machines 15s 轮询（use-daemon-machines）刷新 allRuntimes → dialog 重渲染 → runtimeOffline 翻转 → panel 切换在线/离线态。
