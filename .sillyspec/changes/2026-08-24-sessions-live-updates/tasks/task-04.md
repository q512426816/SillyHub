---
author: qinyi
created_at: 2026-08-24 07:58:12
id: task-04
title: SSE 端点 GET /api/daemon/sessions/events + 端点测试
title_zh: SSE 端点 GET /api/daemon/sessions/events + 端点测试
goal: 浏览器可订阅的会话变更信号流：订阅全局频道、按当前用户过滤下发、30s keepalive、断开清理。
depends_on: [task-01]
provides:
  - contract: sessions-events-endpoint
    fields:
      - GET /api/daemon/sessions/events 返回 text/event-stream（data 帧 JSON：event/session_id/user_id/at；仅当前用户的信号）
      - ": connected" 初始注释 + 静默约 30s 发 ": keepalive"
expects_from:
  - task-01
  - contract: session-events-publisher
    fields:
      - SESSIONS_CHANGED_CHANNEL 常量
allowed_paths:
  - backend/app/modules/daemon/router.py
  - backend/app/modules/daemon/tests/test_sessions_events_stream.py
implementation:
  - router.py 新路由（放在既有 stream_session_logs 路由附近）：
    - @router.get("/sessions/events")，鉴权依赖与 list_sessions 同款（登录用户）
    - async 生成器：redis=get_redis(); pubsub=redis.pubsub(); await pubsub.subscribe(SESSIONS_CHANGED_CHANNEL)
    - 先 yield ": connected\n\n"
    - 循环 msg = await pubsub.get_message(ignore_subscribe_messages=True, timeout=30.0)：msg 非空且 msg["type"]=="message" → 解析 JSON → data.get("user_id")==str(current_user.id) 才 yield f"data: {raw}\n\n"；timeout 到点无消息 → yield ": keepalive\n\n"
    - finally: await pubsub.unsubscribe(SESSIONS_CHANGED_CHANNEL); await pubsub.close()
    - 无 DB 访问（不占连接池）
  - 返回 StreamingResponse(media_type="text/event-stream")，headers 对齐既有 SSE 端点（Cache-Control: no-cache 等，抄 stream_session_logs）
  - 测试 test_sessions_events_stream.py：
    - mock get_redis 返回假 pubsub（可控消息序列）→ 断言：他人 user_id 信号被过滤不下发；本人信号原样 data 帧下发
    - keepalive：timeout 无消息路径产出 ": keepalive"
    - 断开清理：生成器被 close 后 unsubscribe/close 被调用
    - 测试形态参考既有 daemon SSE 路由测试 backend/app/modules/daemon/tests/test_session_sse.py（真实先例；agent/tests 下无 text/event-stream 测试）
acceptance:
  - 端点流式下发本人信号、过滤他人信号；30s 静默 keepalive；断开清理无泄漏
  - 端点测试全绿；既有 daemon 路由测试零回归
verify:
  - cd backend && uv run pytest app/modules/daemon/tests/test_sessions_events_stream.py -q && uv run pytest app/modules/daemon -q
constraints:
  - 不做 Last-Event-ID 回放（D-006 Non-Goal）
  - 不引入每用户频道（D-005：单频道+服务端过滤）
  - 错误消息若面向用户须中文（CONVENTIONS l10n 规则）；本端点正常路径无用户可见报错

---
