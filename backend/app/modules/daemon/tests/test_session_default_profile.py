"""2026-10-21-agent-profile-slim-default task-02：会话未显式选档案时注入用户默认档案。

覆盖 FR-03 三场景：
  1. 用户默认档案存在且可见 → lease.metadata 注入 system_prompt/skill_refs，
     AgentSession.agent_profile_id / config_snapshot.profile_name 带出。
  2. 未设默认 → 零注入（与现状逐字节一致：lease 无档案键）。
  3. 默认档案失可见（直接把 user 列指向他人 private 档案，模拟管理员收紧可见性
     的竞态残留）→ 软偏好静默跳过 = 零注入。

helpers 复用 test_session_switch_config（_create_user/_create_runtime/_mock_hub 范式）。
"""

from __future__ import annotations

import json
import uuid

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.daemon.model import DaemonTaskLease

from .test_session_switch_config import (
    _create_profile,
    _create_runtime,
    _create_user,
    _mock_hub,
)


@pytest.fixture()
def mocked_hub():
    hub = _mock_hub()
    with pytest.MonkeyPatch.context() as mp:
        from app.modules.daemon import ws_hub as ws_hub_module

        mp.setattr(ws_hub_module, "get_daemon_ws_hub", lambda: hub)
        yield hub


@pytest.fixture()
def mocked_redis():
    from unittest.mock import AsyncMock, patch

    redis = AsyncMock()
    redis.publish = AsyncMock()
    with patch("app.modules.daemon.session.service.get_redis", return_value=redis):
        yield redis


async def _lease_metadata(db_session: AsyncSession, lease_id: uuid.UUID) -> dict:
    # apply_session_profile_to_lease 是 raw SQL UPDATE——identity map 缓存的 lease
    # 对象不随 UPDATE 刷新，显式 refresh 后再读列。
    lease = await db_session.get(DaemonTaskLease, lease_id)
    if lease is None:
        return {}
    await db_session.refresh(lease)
    # ORM 属性名 metadata_（避开 SQLAlchemy 保留字 metadata）。
    raw = lease.metadata_
    if isinstance(raw, str):
        return json.loads(raw) if raw else {}
    return dict(raw) if isinstance(raw, dict) else {}


class TestSessionDefaultProfileInjection:
    @pytest.mark.asyncio
    async def test_default_profile_injected(
        self, db_session, mocked_hub, mocked_redis
    ):
        """用户默认档案 → 未显式选档案的会话注入人格 + 技能引用。"""
        from app.modules.auth.model import User
        from app.modules.daemon.service import DaemonService

        uid = await _create_user(db_session)
        rt = await _create_runtime(db_session, uid)
        profile = await _create_profile(
            db_session,
            uid,
            name="默认人格",
            system_prompt="你是默认助手",
            skill_refs=["s1", "s2"],
        )
        user = await db_session.get(User, uid)
        user.default_agent_profile_id = profile.id
        await db_session.commit()

        created = await DaemonService(db_session).create_session(
            uid, provider="claude", prompt="hi", runtime_id=str(rt.id)
        )

        meta = await _lease_metadata(db_session, created.lease_id)
        assert meta.get("system_prompt") == "你是默认助手"
        assert meta.get("skill_refs") == ["s1", "s2"]
        assert created.agent_session.agent_profile_id == profile.id
        assert (created.agent_session.config_snapshot or {}).get("profile_name") == "默认人格"

    @pytest.mark.asyncio
    async def test_no_default_zero_injection(self, db_session, mocked_hub, mocked_redis):
        """未设默认 → 行为与现状一致：lease 无档案键、session 无档案绑定。"""
        from app.modules.daemon.service import DaemonService

        uid = await _create_user(db_session)
        rt = await _create_runtime(db_session, uid)

        created = await DaemonService(db_session).create_session(
            uid, provider="claude", prompt="hi", runtime_id=str(rt.id)
        )

        meta = await _lease_metadata(db_session, created.lease_id)
        assert "system_prompt" not in meta
        assert "skill_refs" not in meta
        assert created.agent_session.agent_profile_id is None
        assert (created.agent_session.config_snapshot or {}).get("profile_name") is None

    @pytest.mark.asyncio
    async def test_default_invisible_falls_back_silently(
        self, db_session, mocked_hub, mocked_redis
    ):
        """默认档案失可见（指向他人 private 档案）→ 软偏好静默跳过 = 零注入。"""
        from app.modules.auth.model import User
        from app.modules.daemon.service import DaemonService

        uid = await _create_user(db_session)
        other_uid = await _create_user(db_session)
        rt = await _create_runtime(db_session, uid)
        # 他人 private 档案：对 uid 不可见（_can_read 私有档仅 owner 可见）。
        foreign = await _create_profile(
            db_session, other_uid, name="他人私档", system_prompt="不应注入"
        )
        user = await db_session.get(User, uid)
        user.default_agent_profile_id = foreign.id
        await db_session.commit()

        created = await DaemonService(db_session).create_session(
            uid, provider="claude", prompt="hi", runtime_id=str(rt.id)
        )

        meta = await _lease_metadata(db_session, created.lease_id)
        assert "system_prompt" not in meta
        assert "skill_refs" not in meta
        assert created.agent_session.agent_profile_id is None
