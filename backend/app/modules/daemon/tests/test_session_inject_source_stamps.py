"""2026-10-25-trajectory-source-model FR-01/FR-04：注入来源盖戳与透传。

- 主控简报轮（inject 路径 resolve_first_turn_briefing 命中）→ metadata_.turn_trigger
  = 'team_brief'；该轮 task_wakeup/auto_resume 恒空（优先级链不冲突断言）。
- create 路径：分身形态（parent_session_id）首轮 → 'worker_dispatch'；预建团队
  mission 主控首轮 → 'team_brief'；普通会话不盖。
- 通知轮（inject_session_as_service turn_trigger='agent_notice'）→ 戳透传落库。
- 真实用户输入（无 mission 追问轮）不盖戳（metadata_ 为 None/无 turn_trigger 键）。
"""

from __future__ import annotations

import uuid
from unittest.mock import AsyncMock, patch

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.agent.model import AgentRunLog
from app.modules.daemon.service import DaemonService

from .test_inject_first_turn_briefing import (
    _create_runtime,
    _create_user,
    _make_mission,
    _mock_hub,
    _setup_injectable_session,
)


@pytest.fixture()
def mocked_hub():
    hub = _mock_hub()
    with patch("app.modules.daemon.ws_hub.get_daemon_ws_hub", return_value=hub):
        yield hub


@pytest.fixture()
def mocked_redis():
    redis = AsyncMock()
    redis.publish = AsyncMock()
    with patch("app.modules.daemon.session.service.get_redis", return_value=redis):
        yield redis


async def _last_user_input_log(db_session: AsyncSession, run_id: uuid.UUID) -> AgentRunLog | None:
    result = await db_session.execute(
        select(AgentRunLog)
        .where(AgentRunLog.run_id == run_id, AgentRunLog.channel == "user_input")
        .order_by(AgentRunLog.timestamp.desc())
        .limit(1)
    )
    return result.scalar_one_or_none()


class TestInjectPathStamps:
    async def test_briefing_turn_stamps_team_brief(
        self, db_session, mocked_hub, mocked_redis
    ) -> None:
        """主控简报轮盖 team_brief：活跃 mission + 未消耗 orchestrator run + prompt 非空。"""
        svc, uid, created = await _setup_injectable_session(db_session)
        sid = created.agent_session.id
        await _make_mission(db_session, session_id=sid, objective="源标记目标")

        result = await svc.inject_session(sid, uid, prompt="开始推进任务")

        log = await _last_user_input_log(db_session, result.agent_run.id)
        assert log is not None
        assert log.metadata_["turn_trigger"] == "team_brief"

    async def test_plain_user_turn_not_stamped(self, db_session, mocked_hub, mocked_redis) -> None:
        """无 mission 的普通追问轮不盖戳（存量如实呈现）。"""
        svc, uid, created = await _setup_injectable_session(db_session)
        sid = created.agent_session.id

        result = await svc.inject_session(sid, uid, prompt="普通追问")

        log = await _last_user_input_log(db_session, result.agent_run.id)
        assert log is not None
        assert not (log.metadata_ or {}).get("turn_trigger")

    async def test_agent_notice_service_path_stamped(
        self, db_session, mocked_hub, mocked_redis
    ) -> None:
        """inject_session_as_service 显式 turn_trigger 透传落库（通知轮通道）。"""
        svc, _uid, created = await _setup_injectable_session(db_session)
        sid = created.agent_session.id

        result = await svc._sess.inject_session_as_service(
            sid, prompt="【系统通知·团队任务】全部分身已进入终态", turn_trigger="agent_notice"
        )

        log = await _last_user_input_log(db_session, result.agent_run.id)
        assert log is not None
        assert log.metadata_["turn_trigger"] == "agent_notice"


class TestCreatePathStamps:
    async def test_worker_dispatch_first_turn_stamped(
        self, db_session, mocked_hub, mocked_redis
    ) -> None:
        """分身形态（parent_session_id）首轮盖 worker_dispatch。"""
        uid = await _create_user(db_session)
        await _create_runtime(db_session, uid)
        svc = DaemonService(db_session)

        # 分身派发走 SessionService（DaemonService 门面不透传 parent_session_id）。
        created = await svc._sess.create_session(
            uid,
            provider="claude",
            prompt="你是多 Agent 团队中的一个 Worker（角色：worker）。",
            parent_session_id=uuid.uuid4(),
        )

        log = await _last_user_input_log(db_session, created.agent_run.id)
        assert log is not None
        assert log.metadata_["turn_trigger"] == "worker_dispatch"

    async def test_team_mission_first_turn_stamped_team_brief(
        self, db_session, mocked_hub, mocked_redis
    ) -> None:
        """预建团队 mission 的主控首轮盖 team_brief（create 路径简报轮）。"""
        from app.modules.daemon.schema import TeamMissionCreateBlock

        uid = await _create_user(db_session)
        await _create_runtime(db_session, uid)
        svc = DaemonService(db_session)

        created = await svc.create_session(
            uid,
            provider="claude",
            prompt="用团队分析当前上下文",
            team_mission=TeamMissionCreateBlock(
                objective="源标记目标", scope_workspace_ids=[uuid.uuid4()]
            ),
        )

        log = await _last_user_input_log(db_session, created.agent_run.id)
        assert log is not None
        assert log.metadata_["turn_trigger"] == "team_brief"

    async def test_plain_create_not_stamped(self, db_session, mocked_hub, mocked_redis) -> None:
        """普通会话首轮不盖戳。"""
        uid = await _create_user(db_session)
        await _create_runtime(db_session, uid)
        svc = DaemonService(db_session)

        created = await svc.create_session(uid, provider="claude", prompt="普通首句")

        log = await _last_user_input_log(db_session, created.agent_run.id)
        assert log is not None
        assert not (log.metadata_ or {}).get("turn_trigger")


class TestSubmitMetadataPassthrough:
    """FR-04：daemon 上报 metadata 白名单透传与 session_header channel 直通。"""

    async def test_whitelist_keys_persist_and_unknown_dropped(
        self, db_session, mocked_redis
    ) -> None:
        from .test_run_sync_submit_timestamp import _seed_one_run

        lease_id, token, run_id = await _seed_one_run(db_session)
        svc = DaemonService(db_session)

        result = await svc.submit_messages(
            lease_id,
            token,
            run_id,
            [
                {
                    "event_type": "text",
                    "content": '{"systemPrompt": null}',
                    "channel": "session_header",
                    "metadata": {"reason": "initial", "evil_key": "x"},
                },
                {
                    "event_type": "text",
                    "content": "普通输出",
                    "channel": "stdout",
                    "metadata": {"turn_trigger": "agent_notice", "evil_key": "y"},
                },
            ],
        )
        assert result == 2

        rows = (
            (await db_session.execute(select(AgentRunLog).where(AgentRunLog.run_id == run_id)))
            .scalars()
            .all()
        )
        header = next(r for r in rows if r.channel == "session_header")
        assert header.metadata_["reason"] == "initial"
        assert "evil_key" not in header.metadata_
        stamped = next(r for r in rows if r.channel == "stdout")
        assert stamped.metadata_["turn_trigger"] == "agent_notice"
        assert "evil_key" not in stamped.metadata_
