---
author: flow-machine-draft
created_at: 2026-10-22T01:21:47.536Z
---
# 任务注册表（Tasks）— 2026-10-22-fix-trajectory-row-select

- [ ] task-01: `TrajectoryPane` 增加受控 `selectedRowId` 状态并把 `selectedRowId` / `onSelectRow` 传给 `TrajectoryView`（点击账本行、点时间轴条目、↑↓/Esc 均复用既有 TrajectoryView 逻辑）；验证：切「轨迹」后点行，检查器不再停留在空提示
- [ ] task-02: 在 `turn-timeline-trajectory-view.test.tsx` 新增 3 个用例（账本行点击 → 选中+检查器详情；时间轴条目点击 → 对应行选中；↑/↓ 切换、Esc 清除）；验证：该文件全绿
- [ ] task-03: 回归 `frontend/src/components/daemon/trajectory/__tests__` 与 `turn-timeline` 相关既有用例；验证：全绿、未改既有断言
- [ ] task-04: `frontend` 跑 `pnpm exec tsc --noEmit`；验证：退出码 0
