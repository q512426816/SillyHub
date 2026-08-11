---
id: task-05
title: session/service.py 加 SessionReadiness 模块级单例
title_zh: 后端内存 session ready 状态管理器
author: WhaleFall
created_at: 2026-08-07 14:32:00
priority: P0
depends_on: []
blocks: [task-06, task-08, task-09, task-10]
requirement_ids: [FR-02]
decision_ids: [D-002@v1]
allowed_paths:
  - backend/app/modules/daemon/session/service.py
provides:
  - contract: SessionReadiness
    fields:
      - mark_ready
      - wait
      - clear
goal: >
  在 session/service.py 新增跨请求共享的内存 SessionReadiness，记录哪些 session 已
  ready 并提供阻塞等待，供 inject 等 daemon create 完成（task-08），并供 clear
  （task-09）与 recover mark_ready（task-10）使用。
implementation:
  - 新增 SessionReadiness 类（service.py 模块级），持有 ready set 与 per-session events dict，事件按需懒建
  - mark_ready 把 id 加入 set 并取或建 event 后 set，唤醒所有 wait 协程，幂等不报错
  - async wait 用 asyncio.wait_for 包 event.wait，超时返回 False 不抛 TimeoutError，已 ready 返回 True
  - clear 从 set discard 并用新 event 替换槽位，clear 后 wait 应等下一次 mark 不复用旧 event
  - 模块级暴露单例（如 session_readiness 实例或 get_session_readiness 访问器），禁止放 SessionService 实例字段（per-request 实例化会让 mark 与 wait 各看各的 set 失效，gap-2 与 D-002）
acceptance:
  - mark_ready wait clear 三方法可用且语义正确
  - 跨请求同一 SessionReadiness 实例共享（模块级单例生效）
  - wait 已 ready 立即返回 True，超时返回 False 不抛
  - clear 后再 wait 须等下一次 mark_ready 才能 set
  - 新增单测通过（mark wait clear 超时）
verify:
  - cd backend && python -m pytest
  - cd backend && ruff check app/modules/daemon/session/service.py
constraints:
  - 必须模块级单例或挂 app.state，禁止放 per-request 实例字段（gap-2）
  - 纯内存无 DB 无 migration（D-002）
  - asyncio.Event 必须在 event loop 内 await，线程模型正确（FastAPI handler 内调）
  - clear 后 wait 应重新等待下一次 mark 不复用旧 event
---
