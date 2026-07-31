---
id: task-06
title: dialog/panel 离线只读测试
title_zh: 离线弹窗会话列表历史只读与四操作禁用测试
author: WhaleFall
created_at: 2026-07-31T11:23:11
priority: P0
depends_on: [task-03, task-04]
blocks: []
requirement_ids: [FR-02, FR-03]
decision_ids: [D-001@v1, D-002@v1]
allowed_paths:
  - frontend/src/components/daemon/__tests__/interactive-session-panel-offline.test.tsx
goal: >
  验证离线（offlineReadOnly）时 panel：列表/历史只读展示 + 4 按钮 disabled + 离线横幅 +
  active 保持（不转 ended）+ attach 不卡 reconnecting。
implementation:
  - 新建 interactive-session-panel-offline.test.tsx
  - 用例 1：offlineReadOnly=true + active 会话 → 顶部离线横幅渲染 + 4 按钮（新建/发送/打断/结束）disabled + 历史展示
  - 用例 2：offlineReadOnly=true → view.status 保持 active（不转 ended）
  - 用例 3：offlineReadOnly=true attach → 不建立 SSE（mock establishStream 不被调）+ 显示 initialTurns
  - 用例 4：offlineReadOnly=false/undefined → 无横幅 + 按钮可点（回归）
acceptance:
  - 离线横幅 + 4 按钮 disabled + active 保持 + 不建 SSE
  - 默认 false 回归
verify:
  - pnpm test interactive-session-panel-offline
constraints:
  - mock listAgentSessions/getAgentSessionLogs 返回 DB 数据
  - mock SSE establishStream 验证离线不调
---

## 实现说明

render InteractiveSessionPanel with offlineReadOnly + mock session/logs/SSE。断言横幅文本、按钮 disabled 属性、view.status、establishStream 调用次数。
