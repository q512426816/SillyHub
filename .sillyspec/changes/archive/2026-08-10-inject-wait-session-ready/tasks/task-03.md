---
id: task-03
title: daemon.ts restoreAndReconnect recover 调 notifySessionReady
title_zh: daemon 重启 recover 完成后上报 session ready
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
  daemon 重启 recover 重建 session 完成、markReconnected 切回 active 后主动上报 ready，
  与 fresh create 路径双覆盖，避免 recover 后 inject 等 ready 超时（design gap-1 修正）。
implementation:
  - 定位 _routeSessionResume 中 restoreAndReconnect 与 markReconnected（daemon.ts 约 2763-2764 行）切回 active 的成功处
  - markReconnected 成功后追加 this.hubClient.notifySessionReady 调用，sessionId 复用本方法已归一化的 sessionId 变量
  - best-effort 上报，失败仅 warn 日志不抛、不阻塞 session_resume_ok 主循环，与 task-01 契约一致
  - recover 失败路径不调用，restoreAndReconnect 抛错已被上层 catch 或 markReconnected 失败时跳过上报
acceptance:
  - recover 成功路径（restoreAndReconnect + markReconnected 完成）调用 notifySessionReady
  - recover 失败路径（restoreAndReconnect 抛错或 markReconnected 失败）不调用 notifySessionReady
  - pnpm exec tsc --noEmit 类型检查通过且无回归
verify:
  - "cd sillyhub-daemon && pnpm exec tsc --noEmit"
constraints:
  - 仅 recover 成功路径调用，fresh create 上报由 task-02 负责
  - 上报 best-effort 不阻塞 WS 主循环，失败 warn 不抛
  - 跨平台（Windows / Linux / macOS）
---
