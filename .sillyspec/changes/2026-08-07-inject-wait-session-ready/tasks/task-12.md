---
id: task-12
title: backend 测试 SessionReadiness + inject 等 + 端点 + recover
title_zh: 后端 ready 管理 inject 等待 端点 recover 的单测
author: WhaleFall
created_at: 2026-08-07 14:32:00
priority: P1
depends_on: [task-05, task-06, task-08, task-09, task-10]
blocks: []
requirement_ids: [FR-05]
decision_ids: []
allowed_paths:
  - backend/app/modules/daemon/tests/test_session_readiness.py
expects_from: {}
goal: >
  单测覆盖 ready 管理（SessionReadiness 四方法）、inject 等 ready（已 ready 直通与超时
  fallback 仍发 SESSION_INJECT）、POST ready 端点（daemon auth 加调 mark_ready 加 204）、
  confirm_session_reconnected 翻转 mark_ready 四块，确保 task-05 与 06 与 08 与 09 与 10
  的修复行为正确并防回归。
implementation:
  - SessionReadiness 单测（模块级单例）mark_ready 写 set 加 Event set，wait 小超时已 ready 立即返 True 与未 ready 超时返 False，clear 后 set 无该 id 且 wait 需重新等，并发 mark 加 wait 协程交错 True
  - inject 等 ready 直通复用 test_session_router 的 _seed_active_session 加 fresh_ws_hub fixture，先 mark_ready 再走 inject_session，断言 ws sent_messages 仍含 SESSION_INJECT 且无 30s 阻塞（patch wait 即时返回）
  - inject 超时 fallback 构造 SessionReadiness 不 mark_ready，patch wait 返 False 极快，断言 inject 仍发 SESSION_INJECT 加触发 warn 日志（log warning session_ready_timeout）
  - POST ready 端点用 client 加 auth_headers（get_current_principal 双路接受 JWT 或 X-API-Key），断言 200 加调 service mark_session_ready（spy）加缺鉴权头 401 或 403
  - confirm_session_reconnected mark_ready 复用 test_session_recovery 的 _make_active_session（status reconnecting）加 mocked_redis，调 svc confirm_session_reconnected 翻 active，断言 SessionReadiness set 含该 sid（双保险 design gap-1）
  - 复用现有 fixture（db_session client auth_headers fresh_ws_hub mocked_redis）不重复造，asyncio_mode auto 全局已开 async def test 直接用
acceptance:
  - SessionReadiness mark_ready wait 已 ready True wait 超时 False clear 四方法断言全过
  - inject 已 ready 直通发 SESSION_INJECT 断言过，超时 fallback 仍发 SESSION_INJECT 加 warn 断言过
  - POST ready 200 加调 mark_session_ready 加鉴权拦截断言过
  - confirm_session_reconnected mark_ready 翻转后 set 含 sid 断言过
  - backend 全量单测过（无回归）
verify:
  - cd backend && python -m pytest app/modules/daemon/tests/test_session_readiness.py -v
  - cd backend && python -m pytest
  - cd backend && ruff check app/modules/daemon/tests/test_session_readiness.py
constraints:
  - 复用现有 fixture（db_session client auth_headers fresh_ws_hub mocked_redis）不连真实 Postgres Redis daemon 全 mock
  - 不改被测源码（service.py 或 router.py），若发现 mock 缺字段按惯例补 mock 不改源码迁就测试
  - asyncio 测试用 async def test（项目 asyncio_mode auto 无需手标 pytest mark asyncio，但显式标也可参照 test_session_recovery）
  - 跨平台路径用 pathlib 不写 Windows-only，时间用 datetime.now UTC
  - SessionReadiness 单例跨请求共享，测试间 clear 或新建实例隔离避免相互污染
---
