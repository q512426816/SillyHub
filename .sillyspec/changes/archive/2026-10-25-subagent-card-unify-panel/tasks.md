---
author: flow-machine-draft
created_at: 2026-10-25T02:38:35.812Z
---
# 任务注册表（Tasks）— 2026-10-25-subagent-card-unify-panel

- [x] task-01: SubagentBlockView 删内联展开分支；无 Provider 纯展示头部（FR-01）
- [x] task-02: dialog 挂 Provider + Drawer（SubagentDetailPanel），toggle/close/段失效自动关（FR-02）
- [x] task-03: 整页右栏零改动回归（FR-03）
- [x] task-04: 改写内联展开用例 + 回放断言 + 新增 Drawer 用例；全部通过；lint/typecheck 通过（FR-04）
- [x] task-05: TurnLiveMarquee 加 layout=inline 变体与 testId；SubagentBlockView 头部下嵌内部活动流动条（FR-05）

## 文件清单

| 操作 | 路径 |
| --- | --- |
| 修改 | frontend/src/components/daemon/turn-segment-views.tsx |
| 修改 | frontend/src/components/daemon/turn-live-marquee.tsx |
| 修改 | frontend/src/components/daemon/session-panel/session-panel-dialog.tsx |
| 修改 | frontend/src/components/daemon/__tests__/turn-segment-views.test.tsx |
| 新增 | frontend/src/components/daemon/__tests__/session-panel-dialog-subagent-drawer.test.tsx |
| 新增 | .sillyspec/changes/2026-10-25-subagent-card-unify-panel/visual-evidence.md |
