---
author: qinyi
created_at: 2026-08-24 07:58:12
id: task-06
title: 会话门户接线——信号/重连 → invalidate 前缀
title_zh: 会话门户接线——信号/重连 → invalidate 前缀
goal: SessionsPortal 挂载信号订阅：收到信号或重连成功即失效 ["agentSessions"] 前缀触发三入口列表重拉；卸载关闭。
depends_on: [task-05]
provides:
  - contract: portal-wiring
    fields:
      - 三入口（全局/workspace/change）列表经信号通道秒级刷新（集成验收依赖）
expects_from:
  - task-05
  - contract: frontend-subscription
    fields:
      - subscribeAgentSessionsEvents(opts): { close }
allowed_paths:
  - frontend/src/components/sessions/sessions-portal.tsx
  - frontend/src/components/sessions/__tests__/sessions-portal.test.tsx
implementation:
  - sessions-portal.tsx：
    - import subscribeAgentSessionsEvents（自 @/lib/daemon）
    - useEffect（deps [qc]）：const sub = subscribeAgentSessionsEvents({ onEvent: refreshSessionLists, onReconnected: refreshSessionLists })；return () => sub.close()
    - 复用既有 refreshSessionLists useCallback（前缀 invalidate ["agentSessions"]，sessions-portal.tsx 已有）——不另写 invalidate
  - 注释：引用 design D-001/D-006 与 ql 变更名
  - 测试 sessions-portal.test.tsx 追加 describe：
    - mock @/lib/daemon 的 subscribeAgentSessionsEvents（该文件已整模块 mock @/lib/daemon——在 mock 工厂补此导出，捕获 opts）
    - 用例1：渲染门户 → 捕获的 opts.onEvent() → waitFor listAgentSessions 调用次数增加（invalidate 生效）
    - 用例2：opts.onReconnected() 同样触发重拉
    - 用例3：unmount → close 被调
acceptance:
  - 信号/重连回调触发列表查询失效重拉；卸载关闭订阅
  - 三入口共享 SessionsPortal 自动生效（无需 per-入口改动）
  - 追加测试全绿；portal 既有测试零回归
verify:
  - pnpm -C frontend exec vitest run src/components/sessions/__tests__/sessions-portal.test.tsx
constraints:
  - 不改 useDaemonMachines（机器旁路 15s 轮询维持现状，design §2.2 已核实非 agentSessions 前缀）
  - 不动 sessionListPollInterval（D-007 轮询兜底保留）

---
