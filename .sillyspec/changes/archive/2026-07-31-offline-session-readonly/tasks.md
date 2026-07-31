---
author: WhaleFall
created_at: 2026-07-31T11:17:49
---

# 任务清单（Tasks）— /runtimes 离线只读浏览会话

> 方案 A · plan 阶段细化 Wave 与 task 卡片。文件清单 3 前端文件 + 测试，后端/page.tsx 0 改动。

## Wave 1 — 入口开放 + offline 只读态（核心）

- task-01: runtime-card `canOpenSession` 放宽（去 online 与运算），离线会话按钮仍渲染 + title/图标只读提示（runtime-card.tsx:90-92, 242-252）（覆盖 FR-01, D-001）
- task-02: runtime-session-dialog 从实时 `runtimes` 重查派生 `runtimeOffline` 透传 panel（非 stale runtime prop，B2/D-005）（runtime-session-dialog.tsx:145-164 附近）（覆盖 FR-02, D-005）
- task-03: interactive-session-panel 加 `offlineReadOnly?: boolean` prop + 顶部离线横幅 + 4 按钮 disabled（新建:982/发送:1202 走 sendingDisabled:891/打断:1026/结束:1037）（覆盖 FR-02, FR-03, D-001）
- task-04: panel attach effect（:444-461）加 offlineReadOnly 守卫跳过 establishStream，直接以 initialTurns 只读渲染，不进 reconnecting 卡超时（B3）（覆盖 FR-02, R1）

## Wave 2 — 测试 + 回归

- task-05: runtime-card 离线会话按钮渲染 + 点击进 dialog 测试（FR-01）
- task-06: dialog 离线只读测试（列表/历史展示 + 4 按钮 disabled + 离线横幅 + active 保持）（FR-02, FR-03）
- task-07: runtime 重连恢复测试（runtimeOffline 从 runtimes 重查翻转：离线→在线，横幅消失 + 按钮启用 + attach 恢复 SSE）（FR-02, D-005）
- task-08: change-session-section 回归测试（不传 offlineReadOnly，行为不变）（FR-04）

## 任务总表

| 编号 | 任务 | Wave | 优先级 | 依赖 | 覆盖 FR/D |
|---|---|---|---|---|---|
| task-01 | runtime-card 离线会话按钮 | W1 | P0 | — | FR-01, D-001 |
| task-02 | dialog runtimes 重查 runtimeOffline | W1 | P0 | — | FR-02, D-005 |
| task-03 | panel offlineReadOnly prop + 横幅 + 4 按钮 disabled | W1 | P0 | task-02 | FR-02, FR-03 |
| task-04 | panel attach 离线不建 SSE 直接只读 | W1 | P0 | task-03 | FR-02, R1 |
| task-05 | runtime-card 离线按钮测试 | W2 | P0 | task-01 | FR-01 |
| task-06 | dialog 离线只读测试 | W2 | P0 | task-03,04 | FR-02, FR-03 |
| task-07 | 重连恢复测试 | W2 | P0 | task-02 | FR-02, D-005 |
| task-08 | change-session-section 回归测试 | W2 | P0 | task-03 | FR-04 |
