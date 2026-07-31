---
id: task-07
title: runtime 重连恢复测试
title_zh: 运行时离线转在线后只读态自动恢复可操作测试
author: WhaleFall
created_at: 2026-07-31T11:23:11
priority: P0
depends_on: [task-02]
blocks: []
requirement_ids: [FR-02]
decision_ids: [D-005@v1]
allowed_paths:
  - frontend/src/components/daemon/__tests__/runtime-session-dialog-reconnect.test.tsx
goal: >
  验证 dialog runtimeOffline 从实时 runtimes 重查：runtime 离线→在线翻转后，panel 自动恢复
  （横幅消失 + 按钮启用 + attach 恢复 SSE）。这是 D-005 的核心验证（非 stale prop）。
implementation:
  - 新建 runtime-session-dialog-reconnect.test.tsx
  - 用例：render dialog，runtimes prop 中目标 runtime status=offline → runtimeOffline=true（横幅 + disabled）
  - rerender，runtimes 同一 runtime status 翻转为 online → runtimeOffline=false（横幅消失 + 按钮启用 + establishStream 被调恢复 SSE）
  - 验证用的是 runtimes（实时）重查，非 runtime prop（stale）
acceptance:
  - runtimes status 翻转 → panel 自动切回在线态
  - runtime prop 保持不变（stale）但 runtimes 变化能驱动翻转
verify:
  - pnpm test runtime-session-dialog-reconnect
constraints:
  - 模拟 machines 轮询刷新 runtimes（rerender 传新 runtimes）
  - 验证 establishStream 在翻转后被调用
---

## 实现说明

render dialog with runtimes=[{id, status:offline}] + runtime（stale 快照）。rerender runtimes=[{id, status:online}]（runtime prop 不变）。断言 panel 从离线横幅+disabled 切到在线+enabled+SSE 恢复。证明从 runtimes 重查（D-005），非 stale runtime prop。
