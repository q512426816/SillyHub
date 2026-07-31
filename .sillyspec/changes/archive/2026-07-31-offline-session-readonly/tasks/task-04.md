---
id: task-04
title: panel attach 离线不建 SSE 直接只读
title_zh: 离线时挂载会话跳过SSE建流直接以历史快照只读展示
author: WhaleFall
created_at: 2026-07-31T11:23:11
priority: P0
depends_on: [task-03]
blocks: [task-06]
requirement_ids: [FR-02]
decision_ids: [D-002@v1]
allowed_paths:
  - frontend/src/components/daemon/interactive-session-panel.tsx
goal: >
  离线（offlineReadOnly）attach 时跳过 establishStream，直接以 initialTurns（DB logs）只读
  渲染，不进 reconnecting 卡 15s 超时轮询（Design Grill B3）。重连后 effect 重跑建 SSE 恢复实时。
implementation:
  - interactive-session-panel.tsx attach effect（:444-461）开头加：
    `if (offlineReadOnly) return;`（跳过 establishStream）
  - 跳过后 panel 以 initialTurns（attach 时 handleSelect 已拉好的 DB logs）渲染只读态
  - 确保不进 reconnecting 状态轮询（避免对离线 daemon 的无谓重连/超时）
  - 重连（offlineReadOnly false）后 effect 重跑 → establishStream 恢复 SSE
acceptance:
  - 离线 attach：不建 SSE，直接显示 initialTurns 历史（只读）
  - 不卡 reconnecting 超时轮询
  - 重连后 SSE 恢复（与 task-07 配合验证）
verify:
  - frontend: pnpm test（task-06 离线只读不卡重连）
  - pnpm typecheck
constraints:
  - 离线 daemon 不产生新增量，initialTurns 快照够展示历史
  - 重连恢复 SSE 由 task-02 runtimeOffline 翻转驱动 effect 重跑
  - ⚠️ attach effect 的 deps 数组**必须含 `offlineReadOnly`**（plan-review 提示），否则重连翻转后 effect 不重跑建 SSE（task-07 重连测试的隐含前提）。eslint exhaustive-deps 会提醒。
---

## 实现说明

attach effect mount 时无条件 establishStream（:451）。离线加守卫 return 跳过。initialTurns 是 attach 时 handleSelect 拉的 DB logs（runtime-session-dialog.tsx:202 getAgentSessionLogs），离线只读靠它。重连后 offlineReadOnly 翻转 → effect deps 变化重跑 → 建流。
