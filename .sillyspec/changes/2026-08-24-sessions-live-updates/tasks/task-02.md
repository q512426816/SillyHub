---
author: qinyi
created_at: 2026-08-24 07:58:12
id: task-02
title: SessionService 埋点（9 写入点）+ 埋点断言测试
title_zh: SessionService 埋点（9 写入点）+ 埋点断言测试
goal: agent_sessions 的 SessionService 写入路径在关键节点发布三类信号，覆盖 design §3 生命周期契约表的 session/service.py 各行。
depends_on: [task-01]
provides:
  - contract: session-service-events
    fields:
      - SessionService 写入路径已发布 created/status_changed/deleted 信号（供端点测试/集成验收依赖）
expects_from:
  - task-01
  - contract: session-events-publisher
    fields:
      - SESSIONS_CHANGED_CHANNEL 常量
      - publish_sessions_changed(event, session_id, user_id)（静默容错）
allowed_paths:
  - backend/app/modules/daemon/session/service.py
  - backend/app/modules/daemon/tests/test_session_events.py
implementation:
  - import：from app.modules.daemon.session_events import publish_sessions_changed（模块顶部）
  - 埋点（await 调用放在事务 commit 之后或等价落库点之后；具体锚点行号见 design §3，以当前源码为准逐一 grep 函数名定位）：
    1. create_session：INSERT 落库后发 created（user_id=入参 user_id）；派发成功激活分支（status→active）再发 status_changed
    2. _converge_failed_dispatch：status→failed 落库后发 status_changed
    3. _activate_tool_report_session：status→active 后发 status_changed
    4. end_session：status→ended 后发 status_changed
    5. reopen_session：status→reconnecting 后发 status_changed
    6. recover_session_after_daemon_restart：status→reconnecting 后发 status_changed
    7. confirm_session_reconnected：status→active 后发 status_changed
    8. mark_session_recovery_failed：status→failed 后发 status_changed
    9. delete_agent_session：软删落库后发 deleted
  - 不动 inject 系列（turn 增量，Non-Goal）
  - user_id 取 AgentSession.user_id（session 实体字段）
  - 测试（追加到 test_session_events.py，与 task-01 同文件注意不覆盖其用例）：选 3 个代表路径断言（create_session→created+status_changed、end_session→status_changed、delete_agent_session→deleted），monkeypatch publish_sessions_changed 捕获调用参数
acceptance:
  - 上述 9 个调用点各自发布正确事件；inject 路径零发布
  - 埋点调用不改变原函数返回值/异常语义（publish 自身静默容错）
  - 断言测试全绿
verify:
  - cd backend && uv run pytest app/modules/daemon/tests/test_session_events.py -q
  - 中间防破损（改动函数被既有用例直接断言）：uv run pytest app/modules/daemon/tests -q -k "session"（覆盖 session service 相关既有测试）
constraints:
  - 只加 await publish 调用与 import，不重构原写入逻辑
  - 埋点放在 DB flush/commit 生效点之后，避免「信号先于落库」导致前端重拉读旧值

---
