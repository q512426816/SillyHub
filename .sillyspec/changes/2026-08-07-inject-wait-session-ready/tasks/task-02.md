---
id: task-02
title: daemon.ts _startInteractiveSession create 完成调 notifySessionReady
title_zh: fresh create 完成后上报 session ready
author: WhaleFall
created_at: 2026-08-07 14:32:00
priority: P0
depends_on:
  - task-01
blocks:
  - task-11
requirement_ids:
  - FR-01
decision_ids: []
allowed_paths:
  - sillyhub-daemon/src/daemon.ts
expects_from:
  task-01:
    - contract: HubClient.notifySessionReady
      needs:
        - sessionId
goal: >
  fresh create 成功后调用 notifySessionReady，让 backend 知道 session 已就绪、可接收 inject，
  修复 inject 在 daemon create 完成前到达被丢弃导致 /model 空白的时序竞态。
implementation:
  - 在 _startInteractiveSession 的 interactive_session_started 日志后（daemon.ts 3313-3318，try 块内）插入 await this.hubClient.notifySessionReady(sessionId)，sessionId 取 execPayload.agentSessionId（@2937）
  - best-effort 不阻塞 create 主流程，task-01 方法本身失败 warn 不抛，调用点无需额外 try/catch 包裹
  - 仅 create 成功路径调用，catch 块（create 失败 3319-3332）不触发上报，由 backend DaemonRuntimeOffline 兜底
acceptance:
  - fresh create 成功路径（interactive_session_started 触发后）调用 hubClient.notifySessionReady
  - create 失败（catch 路径）不调用上报
  - 上报不阻塞 create 主流程、不改变 _interactiveSessionsByLease 登记语义
verify:
  - 在 sillyhub-daemon 目录执行 pnpm exec tsc --noEmit 通过
constraints:
  - 仅 create 成功路径调用，recover 路径由 task-03 处理
  - best-effort 不阻塞 daemon 主循环，不改 SessionManager.create 与 inputQueue 推送时序
  - 跨平台（Windows/Linux/macOS）
---
