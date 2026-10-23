---
author: flow-machine-draft
created_at: 2026-10-23T16:30:40.307Z
---
# 任务注册表（Tasks）— 2026-10-22-trajectory-context-jump

- [x] task-01: `from-turn-views.ts` 派生 system_event → 上下文行 + `trajectory-view-model.ts` 标签「上下文」与搜索字段；验证：`from-turn-views.test.ts` 新增用例 + 既有零回归
- [ ] task-02: `handleJumpToTurn` 轨迹分支 + `TurnTimeline`/`TrajectoryPane` 透传跳转信号并选中轮首行；验证：`turn-timeline-trajectory-view.test.tsx` 与 `trajectory-redesign.test.tsx` 信号用例
- [ ] task-03: `trajectory-ledger.tsx` 选中行 scrollIntoView effect；验证：滚入视野用例（stub scrollIntoView 断言调用）
- [ ] task-04: 轨迹目录 + 会话面板相关测试全绿、`pnpm exec tsc --noEmit` 退出 0；验证：vitest 输出零失败 + tsc 0
