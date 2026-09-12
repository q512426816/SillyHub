"""chain-limit 停跑可感知单测（2026-09-12-session-live-display-fixes R5 / D-004）。

背景（生产实证会话 d4c29d95，2026-09-12 15:11）：续跑链第 2 次被上游静默断流
打断，backend ``auto_recover_nudge_chain_limit``（chain=2 ≥ AUTO_RESUME_MAX_CHAIN）
按防循环守卫停跑交回用户——但此前纯静默 return，用户只见「供应商异常」失败卡，
不知道为什么不再自动续、需要手动继续（体验断层）。

R5：chain-limit 分支对刚终态 run 补写 ``error_detail``——hint 覆写为接续指引
文案 + ``auto_resume_stopped: true`` 标记；type/code/raw/message 原值不动
（auto-recovery 判定消费 type/raw，既有断言零影响）；写入失败仅 warn 不抛出。

覆盖：

- 链到上限停跑：hint/标记写入、原键不动、无排队条目（停跑语义不变）；
- 未到上限（chain<2）：正常 nudge 入队，error_detail **零写入**。

注：error_detail 缺失的 run 走不到 chain-limit 分支（恢复分类以 error_detail.type
为输入，缺失判 unknown 落分支 C 不动作）——实现中的最小 dict 构造为纯防御代码，
无公共路径可触达，不设用例。

harness 对齐 ``test_auto_recover_failed_turn.py``（_seed/_close_failed/
_add_prev_run 直引）。
"""

from __future__ import annotations

from datetime import UTC, datetime
from unittest.mock import AsyncMock, patch

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.agent.model import AgentRun, AgentRunLog

from .test_auto_recover_failed_turn import (
    _add_prev_run,
    _close_failed,
    _queued,
    _seed,
    _transient_error,
)


@pytest.fixture()
def mocked_redis():
    """同 test_auto_recover_failed_turn.mocked_redis（fixture 不跨模块，本地声明）。"""

    redis = AsyncMock()
    redis.publish = AsyncMock()
    with (
        patch("app.modules.daemon.run_sync.service.get_redis", return_value=redis),
        patch("app.modules.daemon.session.service.get_redis", return_value=redis),
    ):
        yield redis


async def _mark_tool_activity(db_session: AsyncSession, run_id) -> None:
    db_session.add(
        AgentRunLog(
            run_id=run_id,
            channel="tool_call",
            content_redacted='{"tool":"bash"}',
            timestamp=datetime.now(UTC),
        )
    )
    await db_session.commit()


@pytest.mark.asyncio
async def test_chain_limit_writes_hint_and_marker(db_session, mocked_redis) -> None:
    """链到上限停跑：error_detail.hint 指引文案 + auto_resume_stopped 标记；
    type/code/raw 原值不动；无排队条目。"""
    lease_id, run_id, token, session_id, uid = await _seed(db_session)
    await _mark_tool_activity(db_session, run_id)
    prev1 = await _add_prev_run(
        db_session, session_id, uid, error_detail={"type": "provider_error"}
    )
    run = await db_session.get(AgentRun, run_id)
    run.metadata_ = {"auto_resume_of": str(prev1)}
    await db_session.commit()

    closed = await _close_failed(
        db_session,
        lease_id,
        run_id,
        token,
        _transient_error(raw="[silent stream truncation] api_calls=116"),
    )

    detail = closed.error_detail
    assert detail is not None
    assert detail.get("auto_resume_stopped") is True
    assert "自动续跑已达上限" in str(detail.get("hint"))
    assert "手动" in str(detail.get("hint"))
    # 原键不动（auto-recovery 判定与既有断言消费面）。
    assert detail.get("type") == "provider_error"
    assert detail.get("raw") == "[silent stream truncation] api_calls=116"
    # 停跑语义不变：不入队。
    assert await _queued(db_session, session_id) == []


@pytest.mark.asyncio
async def test_below_chain_limit_no_marker(db_session, mocked_redis) -> None:
    """未到上限：正常 nudge 入队（既有语义），error_detail 不写标记。"""
    lease_id, run_id, token, session_id, _ = await _seed(db_session)
    await _mark_tool_activity(db_session, run_id)

    with patch(
        "app.modules.daemon.session.service.auto_resume.AUTO_RESUME_ORIGIN_PREFIX",
        "auto_resume:",
    ):
        closed = await _close_failed(db_session, lease_id, run_id, token, _transient_error())

    # nudge 正常入队（chain=1 < 2）。
    queued = await _queued(db_session, session_id)
    assert len(queued) == 1
    # error_detail 无停跑标记（hint 保持原值或空，不被覆写）。
    detail = closed.error_detail or {}
    assert "auto_resume_stopped" not in detail
