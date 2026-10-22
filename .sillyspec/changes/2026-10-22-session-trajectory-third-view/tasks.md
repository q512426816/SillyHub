---
author: flow-machine-draft
created_at: 2026-10-22T01:23:58.655Z
---
# 任务注册表（Tasks）— 2026-10-22-session-trajectory-third-view

- [x] task-01: 基础面三态化——`SessionViewMode` 扩为 `"conversation" | "all" | "trajectory"`，新增共享组件 `session-view-tabs.tsx`（对话 / 进度 / 轨迹），`turn-state.ts` 持久化读写支持 `"trajectory"`，`session-panel/index.tsx` 受控 props 类型同步；验证：新增 `session-view-tabs.test.tsx` 与 `view-mode-persist.test.ts` 全绿
- [x] task-02: `TurnTimeline` 去第二层开关——删除 `progressLens` 与 `progress-lens`，`viewMode === "trajectory"` 直接渲染轨迹面板；`TrajectoryPane` 增加受控 `selectedRowId` 并传给 `TrajectoryView` 修复点击；验证：`turn-timeline-trajectory-view.test.tsx` 按三态改写并新增选中/空态用例全绿
- [ ] task-03: 弹窗版 `session-panel-dialog.tsx` 与整页版 `session-panel-page.tsx` 改用 `SessionViewTabs`，`viewMode` 类型与持久化调用三态化；验证：`session-panel-variant.test.tsx` 新增移动 variant 三态 tablist 用例通过
- [ ] task-04: 回归相关测试——会话面板、轨迹、回放目录用例全绿且未放宽既有断言；验证：vitest 输出零失败
- [ ] task-05: `frontend` 跑 `pnpm exec tsc --noEmit`；验证：退出码 0
