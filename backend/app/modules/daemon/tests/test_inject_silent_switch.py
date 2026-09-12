"""纯切换轮不落空 user_input / 不增 turn_count 单测（2026-09-12-session-live-display-fixes R3 / D-002）。

背景（生产实证会话 d4c29d95-755f-4eec-883a-5f1b9c42bb7d）：用户在会话配置条
切换供应商/档案时前端发空 prompt + 切换字段，``_inject_into_session`` 此前
**无条件**落 channel=user_input 空行 + turn_count+1，与其上方 ql-20260817-010
注释声明的「纯配置变更记录，无 user_input 日志 → 时间线不渲染」矛盾——30 轮
中 12 轮为空切换轮，轮次导航/会话列表「N 轮」虚高。

R3 修复：user_input 落库与 turn_count 递增收口到 ``silent_config_switch``
单源（定义同时收紧：纯切换 = config_switch 且空 prompt **且无附件**——空
prompt + 附件是 D-7 看图说话真 LLM 轮）；run 照建（前端紧凑配置行
ql-20260818-011 / runsMeta 孤儿轮补建消费链）、last_active_at 照刷、终态
completed 收口同变量。

覆盖：

- 纯切换轮（prompt="" + agent_profile_id）：新 run 无 user_input 行、
  turn_count 不变、run completed、配置切换生效；
- 带消息切换轮（prompt 非空 + agent_profile_id）：user_input 照写 + 计数照增
  （既有语义零回归）；
- 普通追问轮：user_input 照写 + 计数照增。

harness 对齐 ``test_inject_empty_prompt.py`` service 层（_mock_hub +
mocked_redis；不打对象存储——本组用例不涉附件）。
"""

from __future__ import annotations

import uuid
from typing import Any
from unittest.mock import AsyncMock, patch

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.agent.model import AgentRunLog

from .test_session_switch_config import (
    _create_profile,
    _create_runtime,
    _create_user,
    _finish_first_turn,
    _mock_hub,
)


class TestSilentSwitchSkipsUserInput:
    """R3：纯切换轮零 user_input 行 + turn_count 不增；带消息轮零回归。"""

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

    async def _user_input_rows(
        self, db_session: AsyncSession, run_id: uuid.UUID
    ) -> list[AgentRunLog]:
        return list(
            (
                await db_session.execute(
                    select(AgentRunLog).where(
                        AgentRunLog.run_id == run_id,
                        AgentRunLog.channel == "user_input",
                    )
                )
            )
            .scalars()
            .all()
        )

    @pytest.mark.asyncio
    async def test_pure_switch_no_user_input_no_count(
        self, db_session, mocked_hub, mocked_redis
    ) -> None:
        """纯切换轮：无 user_input 行、turn_count 不变（改前为空行 + +1）、run completed。"""
        from app.modules.daemon.service import DaemonService

        uid, created = await self._seed_session(db_session)
        count_before = created.agent_session.turn_count
        profile_b = await _create_profile(db_session, uid, name="新人格", system_prompt="b")

        svc = DaemonService(db_session)
        result = await svc.inject_session(
            created.agent_session.id, uid, prompt="", agent_profile_id=str(profile_b.id)
        )

        # run 照建且直接终态 completed（切换生效语义不变）。
        assert result.agent_run.status == "completed"
        assert result.agent_run.agent_profile_id == profile_b.id
        # R3 核心：无 user_input 行 + turn_count 不变。
        assert await self._user_input_rows(db_session, result.agent_run.id) == []
        assert created.agent_session.turn_count == count_before

    @pytest.mark.asyncio
    async def test_switch_with_message_keeps_user_input_and_count(
        self, db_session, mocked_hub, mocked_redis
    ) -> None:
        """带消息切换轮（prompt 非空 + 切换字段）：user_input 照写 + 计数照增（零回归）。"""
        from app.modules.daemon.service import DaemonService

        uid, created = await self._seed_session(db_session)
        count_before = created.agent_session.turn_count
        profile_b = await _create_profile(db_session, uid, name="新人格2", system_prompt="b")

        svc = DaemonService(db_session)
        result = await svc.inject_session(
            created.agent_session.id,
            uid,
            prompt="带消息切换",
            agent_profile_id=str(profile_b.id),
        )

        rows = await self._user_input_rows(db_session, result.agent_run.id)
        assert len(rows) == 1
        assert rows[0].content_redacted == "带消息切换"
        assert created.agent_session.turn_count == count_before + 1
        # 带消息切换轮是真 LLM 轮：不落静默终态（派发路径 mock hub 下正常 pending）。
        assert result.agent_run.status != "completed"

    @pytest.mark.asyncio
    async def test_plain_turn_keeps_user_input_and_count(
        self, db_session, mocked_hub, mocked_redis
    ) -> None:
        """普通追问轮（无切换字段）：user_input 照写 + 计数照增（零回归）。"""
        from app.modules.daemon.service import DaemonService

        uid, created = await self._seed_session(db_session)
        count_before = created.agent_session.turn_count

        svc = DaemonService(db_session)
        result = await svc.inject_session(created.agent_session.id, uid, prompt="普通追问")

        rows = await self._user_input_rows(db_session, result.agent_run.id)
        assert len(rows) == 1
        assert rows[0].content_redacted == "普通追问"
        assert created.agent_session.turn_count == count_before + 1
