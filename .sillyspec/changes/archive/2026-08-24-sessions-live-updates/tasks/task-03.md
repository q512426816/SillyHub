---
author: qinyi
created_at: 2026-08-24 07:58:12
id: task-03
title: 跨模块埋点（run_sync/sweep/lease/platform_sync/agent×2）+ 独立测试
title_zh: 跨模块埋点（run_sync/sweep/lease/platform_sync/agent×2）+ 独立测试
goal: 其余 6 个模块的 agent_sessions 写入点发布三类信号，补全 design §3 生命周期契约表。
depends_on: [task-01]
provides:
  - contract: cross-module-events
    fields:
      - run_sync/sweep/lease/platform_sync/agent 模块写入路径已发布对应事件
expects_from:
  - task-01
  - contract: session-events-publisher
    fields:
      - SESSIONS_CHANGED_CHANNEL 常量
      - publish_sessions_changed(event, session_id, user_id)（静默容错）
allowed_paths:
  - backend/app/modules/daemon/run_sync/service.py
  - backend/app/modules/daemon/sweep.py
  - backend/app/modules/daemon/lease_service.py
  - backend/app/modules/platform_sync/service.py
  - backend/app/modules/agent/service.py
  - backend/app/modules/agent/placement.py
  - backend/app/modules/daemon/tests/test_session_events_cross.py
implementation:
  - run_sync/service.py close_interactive_run：仅 run 终态回写 session 的分支（_apply_session_terminal_status 命中 status→ended/failed）发 status_changed；仅刷 last_active_at 的分支不发
  - sweep.py session_reconnect_sweep_once / session_offline_sweep_once：批量 UPDATE 后对每行发 status_changed（两处已有 per-session session_ended 发布可参考其取 user_id 的方式）
  - lease_service.py cancel_lease：interactive 分支实际把 status 置 ended 时发 status_changed（幂等场景未变更不发）
  - platform_sync/service.py tool_report upsert：仅「未命中新 INSERT」分支发 created；命中已有会话只刷 last_active_at → 不发
  - agent/service.py start_scan_dispatch：INSERT 后发 created（激活分支可再发 status_changed，对齐 task-02 create_session 模式）
  - agent/placement.py INSERT INTO agent_sessions：raw SQL 插入后发 created（user_id 从插入参数取；取不到则不发）
  - 测试 test_session_events_cross.py（独立文件，勿动 test_session_events.py）：每模块至少 1 条断言（monkeypatch publish_sessions_changed 捕获），重点覆盖：close_interactive_run 终态发/非终态不发、tool_report 仅插入分支发、sweep 批量逐行发
acceptance:
  - 6 模块写入点各自发布正确事件；明确的不发路径（last_active-only、幂等未变更）零发布
  - 断言测试全绿
verify:
  - cd backend && uv run pytest app/modules/daemon/tests/test_session_events_cross.py -q
  - 中间防破损（改动函数被既有用例直接断言）：uv run pytest app/modules/daemon/tests/test_close_interactive_run_session_status.py app/modules/daemon/tests -q -k "cancel_lease or sweep or interactive"（以实际存在的文件名为准，先 ls/grep 确认再跑）
constraints:
  - 不改各写入点的业务语义；只追加 await publish 调用与 import
  - sweep 是无请求上下文的常驻协程——publish 失败静默已由 task-01 保证，勿额外加重试

---
