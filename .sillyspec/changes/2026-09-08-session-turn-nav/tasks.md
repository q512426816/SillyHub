---
author: WhaleFall
created_at: 2026-09-08 11:02:33
---

# tasks.md — 2026-09-08-session-turn-nav

> brainstorm 期初版 8 任务已按 plan（light）收敛为 6 任务；观察感基准 prototype-session-turn-nav.html（v3 刻度轨）。

- [x] task-01: TurnRow 锚点与受控高亮——turn-timeline.tsx 两分支根节点加 data-turn-key、highlightTurnKey 派生 per-row 布尔 (target_files: frontend/src/components/daemon/turn-timeline.tsx)
- [x] task-02: TickRail 刻度轨组件+单测——NEW turn-catalog.tsx（刻度渲染/飞出卡/钳制/aria）+ turn-catalog.test.tsx (depends_on: task-01) (target_files: NEW:frontend/src/components/sessions/turn-catalog.tsx, NEW:frontend/src/components/sessions/__tests__/turn-catalog.test.tsx)
- [x] task-03: 目录数据派生——session-panel-page.tsx 复用 runsMeta 合并 displayTurns 生成 catalogEntries (depends_on: task-02) (target_files: frontend/src/components/daemon/session-panel/session-panel-page.tsx)
- [x] task-04: 跳转链路——handleJumpToTurn（直跳/循环加载/suppress/hasEarlier 镜像/两档 toast）+ 触顶 hook 接 suppress (depends_on: task-03) (target_files: frontend/src/components/daemon/session-panel/session-panel-page.tsx, frontend/src/components/daemon/session-panel/page-helpers.tsx)
- [x] task-05: desktop 布局挂载+滚动联动——sessionBody 包 flex 行挂 TickRail、activeTurnKey 联动、variant 测试 desktop 父链断言有意更新 (depends_on: task-04) (target_files: frontend/src/components/daemon/session-panel/session-panel-page.tsx, frontend/src/components/daemon/__tests__/session-panel-variant.test.tsx)
- [x] task-06: mobile Drawer 入口+集成测试补齐——⋯菜单项+antd Drawer 行式列表、跳转/抑制/菜单集成用例、相关子集测试+tsc (depends_on: task-05) (target_files: frontend/src/components/daemon/session-panel/session-panel-page.tsx)
