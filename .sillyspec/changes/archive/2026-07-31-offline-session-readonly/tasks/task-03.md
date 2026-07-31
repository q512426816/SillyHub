---
id: task-03
title: panel offlineReadOnly prop + 离线横幅 + 4 操作禁用
title_zh: 会话面板加离线只读模式属性含横幅与四操作禁用
author: WhaleFall
created_at: 2026-07-31T11:23:11
priority: P0
depends_on: [task-02]
blocks: [task-04, task-06, task-08]
requirement_ids: [FR-02, FR-03]
decision_ids: [D-001@v1, D-003@v1]
allowed_paths:
  - frontend/src/components/daemon/interactive-session-panel.tsx
goal: >
  InteractiveSessionPanel 加可选 offlineReadOnly prop。true 时：顶部渲染"运行时离线，只读浏览"
  横幅；新建/结束/打断/发送 4 按钮 disabled；active 态保持（不转 ended）。prop 默认 false →
  change-session-section 不传，原行为不变。
implementation:
  - 加 `offlineReadOnly?: boolean` prop（默认 undefined/false）
  - 顶部：offlineReadOnly 时渲染黄色横幅"⚠️ 运行时离线，当前为只读浏览（发送/打断/结束/新建已禁用），重连后自动恢复"
  - 4 按钮 disabled 加 `|| offlineReadOnly` 守卫（行号已核对）：新建会话 :982、发送按钮 :1202（走 sendingDisabled:891-898）、打断 :1026、结束 :1037
  - active 态保持：不改 view.status；历史 initialTurns 照常渲染
  - sendingDisabled（:891-898）叠加 `|| offlineReadOnly`（与既有 !hasOnlineProvider 一致，冗余但不冲突）
  - RunErrorItem 重新发送走 handleResend:726 已有 !hasOnlineProvider 守卫，无需叠加（R3 闭环）
acceptance:
  - offlineReadOnly=true：顶部横幅 + 4 按钮 disabled + active 保持
  - offlineReadOnly=false/undefined：原行为完全不变（change-session-section 回归）
  - RunErrorItem 重新发送离线不可用（走既有守卫）
verify:
  - frontend: pnpm test（task-06 离线只读 + task-08 changes 回归）
  - pnpm typecheck
constraints:
  - prop 默认 false（不波及 change-session-section，D-003）
  - 不改 view.status（active 保持，D-002）
  - :1001 是 provider select 的 disabled（非发送），不要误改
---

## 实现说明

发送按钮行号 v1 张冠李戴已修正：:1001 是 select 提供方，发送按钮在 :1202（走 sendingDisabled:891）。4 按钮 disabled 统一加 offlineReadOnly。RunErrorItem 不在 4 按钮之列但 handleResend 已守卫，离线时 hasOnlineProvider 多半 false 已挡住。
