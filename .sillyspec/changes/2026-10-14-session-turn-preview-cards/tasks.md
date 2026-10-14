---
author: WhaleFall
created_at: 2026-10-14 09:59:33
---
# 任务清单（Tasks）— 2026-10-14-session-turn-preview-cards

- [x] task-01: 归并纯函数与类型扩展（NEW:frontend/src/components/daemon/session-panel/preview-merge.ts + NEW:frontend/src/components/daemon/__tests__/preview-merge.test.ts，turn-timeline.tsx 仅加 preview 可选字段类型）(depends_on: 无)
- [x] task-02: 渲染层预览卡（frontend/src/components/daemon/turn-timeline.tsx TurnRow 预览分支 + TurnPreviewCard + expandPreview 可选 props + NEW:frontend/src/components/daemon/__tests__/turn-preview-card.test.tsx 渲染/点击/零回归测试）(depends_on: task-01)
- [x] task-03: 交互链路接线（frontend/src/components/daemon/session-panel/session-panel-page.tsx displayTurns 接归并 + handleExpandPreview 复用直达链路 + 跳转后附近预取三重判重 + TurnTimeline 挂载传 prop）(depends_on: task-01, task-02)
- [x] task-04: 预取行为测试与既有面回归（turn-preview-card.test.tsx 预取 describe 组 + 复跑 session-panel jump / turn-nav-list / turn-catalog / turn-timeline 相关测试 + tsc）(depends_on: task-03)
