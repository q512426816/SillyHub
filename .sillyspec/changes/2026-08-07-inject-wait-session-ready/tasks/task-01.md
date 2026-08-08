---
id: task-01
title: hub-client.ts 加 notifySessionReady
title_zh: daemon hub-client 增加 session ready 上报方法
author: WhaleFall
created_at: 2026-08-07 14:32:00
priority: P0
depends_on: []
blocks: [task-02, task-03]
requirement_ids: [FR-01]
decision_ids: [D-001@v1]
allowed_paths:
  - sillyhub-daemon/src/hub-client.ts
provides:
  - contract: HubClient.notifySessionReady
    fields:
      - sessionId
goal: >
  为 daemon 新增向 backend 上报 session ready 的 HTTP 方法 notifySessionReady，供
  task-02 fresh create 与 task-03 recover 完成时调用以解除 backend inject 的 ready
  等待；本任务只做 client 方法本身，不改 daemon.ts 调用点。
implementation:
  - 复用 _request POST 范式，参照 notifySessionEnd 与 confirmReconnected 同构写法（hub-client.ts 680-759）
  - 在 HubClient 类内新增 async notifySessionReady，入参 sessionId 字符串，返回 Promise void
  - 方法内 try 包裹 _request，catch 仅 warn 不抛不阻塞，路径为 REST_PREFIX 拼 sessions 拼 encodeURIComponent(sessionId) 拼 ready
acceptance:
  - notifySessionReady 方法存在于 HubClient 类，收 sessionId 字符串返回 Promise void
  - HTTP 失败或网络错误仅 warn 不抛异常，不阻塞 daemon 主循环
  - sillyhub-daemon 类型检查通过，无类型错误
verify:
  - cd sillyhub-daemon && pnpm exec tsc --noEmit
constraints:
  - best-effort 失败仅 warn 不抛异常，不阻塞 daemon 主循环
  - 不修改 HubClient 类内现有方法签名与其他方法实现
  - 跨平台兼容 Windows Linux 与 macOS
---
