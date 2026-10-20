"""inject 新轮落库的列表变更信号单测（2026-10-20-session-status-live-sync）。

背景：左侧会话列表徽标的第一优先信号源 current_run_status 来自最新活跃
run，但 run 级状态迁移此前不发布 agent_sessions:changed——发消息后左侧
「正在执行」徽标最长等 10s/30s 轮询 tick 才亮。修复：_inject_into_session
commit 后补发 status_changed 哑信号（前端 400ms 去抖失效列表查询，秒级收敛）。

覆盖：

- 普通追问轮（真 LLM 轮）：恰一条 ("status_changed", session_id, user_id)；
- 带消息切换轮（prompt 非空 + 切换字段，真 LLM 轮）：照发；
- 纯切换轮（空 prompt，run 直接落 completed 非活跃态，列表无可见状态变化）：
  不发。

harness 对齐 test_inject_silent_switch.py（_mock_hub + mocked_redis，service
层不打对象存储）。信号 spy patch 在 session_events 模块属性——inject 侧函数
内局部 import 每次调用重解析，monkeypatch 生效。
"""

from __future__ import annotations

import uuid
from typing import Any
from unittest.mock import AsyncMock, patch

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from .test_session_switch_config import (
    _create_profile,
    _create_runtime,
    _create_user,
    _finish_first_turn,
    _mock_hub,
)


class TestInjectPublishesListSignal:
    """inject 新轮 commit 后发布 status_changed 列表信号。"""

    @pytest.fixture()
    def mocked_hub(self):
        hub = _mock_hub()
        with patch("app.modules.daemon.ws_hub.get_daemon_ws_hub", return_value=hub):
            yield hub

    @pytest.fixture()
    def mocked_redis(self):
        redis = AsyncMock()
        redis.publish = AsyncMock()
        with patch("app.modules.daemon.session.service.get_redis", return_value=redis):
            yield redis

    @pytest.fixture()
    def list_signal_spy(self, monkeypatch):
        calls: list[tuple[str, uuid.UUID, object]] = []

        async def spy_publish(event, session_id, user_id, **kwargs):
            calls.append((event, session_id, user_id))

        monkeypatch.setattr(
            "app.modules.daemon.session_events.publish_sessions_changed", spy_publish
        )
        return calls

    async def _seed_session(self, db_session: AsyncSession) -> tuple[uuid.UUID, Any]:
        """建 user/runtime + 会话（首轮 completed，空闲轮 inject 场景）。"""
        uid = await _create_user(db_session)
        rt = await _create_runtime(db_session, uid)
        from app.modules.daemon.service import DaemonService

        svc = DaemonService(db_session)
        created = await svc.create_session(
            uid, provider="claude", prompt="first", runtime_id=str(rt.id)
        )
        await _finish_first_turn(db_session, created)
        return uid, created

    @pytest.mark.asyncio
    async def test_plain_turn_publishes_list_signal(
        self, db_session, mocked_hub, mocked_redis, list_signal_spy
    ) -> None:
        """普通追问轮：commit 后恰一条 status_changed（session_id + 会话属主）。"""
        from app.modules.daemon.service import DaemonService

        uid, created = await self._seed_session(db_session)

        svc = DaemonService(db_session)
        result = await svc.inject_session(created.agent_session.id, uid, prompt="追问")

        assert result.agent_run.status != "completed"  # 真 LLM 轮（pending/running）
        assert list_signal_spy == [("status_changed", created.agent_session.id, uid)]

    @pytest.mark.asyncio
    async def test_switch_with_message_publishes_list_signal(
        self, db_session, mocked_hub, mocked_redis, list_signal_spy
    ) -> None:
        """带消息切换轮（真 LLM 轮）：照发。"""
        from app.modules.daemon.service import DaemonService

        uid, created = await self._seed_session(db_session)
        profile_b = await _create_profile(db_session, uid, name="新人格", system_prompt="b")

        svc = DaemonService(db_session)
        result = await svc.inject_session(
            created.agent_session.id,
            uid,
            prompt="带消息切换",
            agent_profile_id=str(profile_b.id),
        )

        assert result.agent_run.status != "completed"
        assert list_signal_spy == [("status_changed", created.agent_session.id, uid)]

    @pytest.mark.asyncio
    async def test_pure_switch_does_not_publish(
        self, db_session, mocked_hub, mocked_redis, list_signal_spy
    ) -> None:
        """纯切换轮（空 prompt，run 直接落 completed 非活跃态）：零发布。"""
        from app.modules.daemon.service import DaemonService

        uid, created = await self._seed_session(db_session)
        profile_b = await _create_profile(db_session, uid, name="新人格2", system_prompt="b")

        svc = DaemonService(db_session)
        result = await svc.inject_session(
            created.agent_session.id, uid, prompt="", agent_profile_id=str(profile_b.id)
        )

        assert result.agent_run.status == "completed"
        assert list_signal_spy == []
