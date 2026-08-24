---
author: qinyi
created_at: 2026-08-24 07:58:12
id: task-01
title: 后端信号基建——session_events.py 发布辅助 + 单测
title_zh: 后端信号基建——session_events.py 发布辅助 + 单测
goal: 提供 agent_sessions 变更信号的统一发布入口（Redis 全局频道），供后续埋点 task 调用；发布失败静默容错不阻断业务。
depends_on: []
provides:
  - contract: session-events-publisher
    fields:
      - SESSIONS_CHANGED_CHANNEL 常量（值 "agent_sessions:changed"）
      - publish_sessions_changed(event, session_id, user_id) 协程（event ∈ created|status_changed|deleted；user_id 为 None 时跳过发布；异常 log.warning 不抛）
expects_from: []
allowed_paths:
  - backend/app/modules/daemon/session_events.py
  - backend/app/modules/daemon/tests/test_session_events.py
implementation:
  - 新建 backend/app/modules/daemon/session_events.py：
    - 常量 SESSIONS_CHANGED_CHANNEL = "agent_sessions:changed"
    - async def publish_sessions_changed(event: Literal["created","status_changed","deleted"], session_id: uuid.UUID, user_id: uuid.UUID | None) -> None
    - user_id 为 None 直接 return（无主数据不进列表视图）
    - payload = {"event": event, "session_id": str(session_id), "user_id": str(user_id), "at": datetime.now(timezone.utc).isoformat()}
    - get_redis()（app/core/redis.py 既有单例）→ await redis.publish(channel, json.dumps(payload))
    - try/except Exception → structlog log.warning("publish_sessions_changed_failed", ...) 不抛——容错语义对齐 session/service.py:643 _publish_session_event
  - 单测 test_session_events.py：mock get_redis（monkeypatch app.modules.daemon.session_events.get_redis）断言 publish 频道名/payload JSON 字段；user_id=None 不调用；redis 抛异常不向上传播。测试风格对齐 backend/app/modules/daemon/tests/ 既有 pytest+asyncio auto 模式。
acceptance:
  - publish_sessions_changed 三类事件均发布到 agent_sessions:changed 频道，payload 含 event/session_id/user_id/at 四字段
  - user_id=None 跳过发布；Redis 异常静默（调用方不感知）
  - 新增单测全绿（backend: uv run pytest app/modules/daemon/tests/test_session_events.py）
verify:
  - cd backend && uv run pytest app/modules/daemon/tests/test_session_events.py -q
constraints:
  - 不改 Redis 初始化方式（复用 app/core/redis.py get_redis）
  - 不引入新依赖；注释/日志中文（对齐仓库 ruff ignore RUF 约定）
  - structlog 已在用（先例 session/service.py:655-666），勿用 print

---
