"""task-03 单测：close_interactive_run 处理 model_usage 明细 + run 列填充（FR-01-3）。

钉死终态上报新契约的落库语义（design §1.2 / §2 / §4.1，2026-08-29-usage-by-provider-model）：
- 带 model_usage 的 close → agent_run_model_usage 明细行 delete+insert 落库（四维 +
  分摊后 api_requests 原样落行）；run.model 终态填 input+output 最大行；
  llm_provider_id 已有值不覆盖（R-08：dispatch 已写）、仅空时填会话当前值。
- 不带 model_usage（老 daemon）→ 零变化：无明细行、run 列不填（N-01 兼容）。
- 重复 close 重放幂等：终态 no-op 早退，明细行数/值不变。

参照 test_close_interactive_run_model_error.py 的 _seed_session_and_run +
DaemonService facade + mocked_redis 范式（SQLite 内存库不强制 FK，llm_provider_id
用裸 UUID 即可，无需真插 llm_providers 行）。
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from unittest.mock import AsyncMock, patch

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.agent.model import AgentRun, AgentRunModelUsage, AgentSession
from app.modules.agent.placement import RunPlacementService
from app.modules.daemon.model import DaemonRuntime
from app.modules.daemon.schema import ModelUsageItemRead
from app.modules.daemon.service import DaemonService

# ── Fixtures ─────────────────────────────────────────────────────────────────


async def _create_user(session: AsyncSession) -> uuid.UUID:
    from app.modules.auth.model import User

    uid = uuid.uuid4()
    session.add(
        User(
            id=uid,
            email=f"task03-{uid}@example.com",
            password_hash="x",
            display_name="T",
            status="active",
        )
    )
    await session.commit()
    return uid


async def _create_runtime(session: AsyncSession, user_id: uuid.UUID) -> DaemonRuntime:
    rt = DaemonRuntime(
        id=uuid.uuid4(),
        user_id=user_id,
        name="daemon",
        provider="claude",
        status="online",
        last_heartbeat_at=datetime.now(UTC),
    )
    session.add(rt)
    await session.commit()
    await session.refresh(rt)
    return rt


def _mock_redis() -> AsyncMock:
    redis = AsyncMock()
    redis.publish = AsyncMock()
    return redis


@pytest.fixture()
def mocked_redis():
    redis = _mock_redis()
    # close_interactive_run 的 get_redis 从 run_sync.service 取；_publish_session_event
    # 从 session.service 取。patch 两处指向同一 mock（对齐 lifecycle_patch 范式）。
    with (
        patch("app.modules.daemon.run_sync.service.get_redis", return_value=redis),
        patch("app.modules.daemon.session.service.get_redis", return_value=redis),
    ):
        yield redis


async def _seed_session_and_run(
    db_session: AsyncSession,
    *,
    session_provider_id: uuid.UUID | None = None,
    run_provider_id: uuid.UUID | None = None,
) -> tuple[uuid.UUID, uuid.UUID, str]:
    """构造 quick-chat session + lease + running run，返回 (lease_id, run_id, token)。

    session_provider_id / run_provider_id 模拟会话当前选的供应商 / dispatch 已按轮
    写入 run 的供应商（session/service.py:3359），二者刻意取不同值以钉死 R-08
    「已有值不覆盖」语义。change_id=None 跳过 stage 回写，聚焦明细落库本身。
    """
    uid = await _create_user(db_session)
    rt = await _create_runtime(db_session, uid)
    placement = RunPlacementService(db_session)
    session_id = uuid.uuid4()
    run_id = uuid.uuid4()
    dispatch = await placement.prepare_interactive_dispatch(
        agent_session_id=session_id,
        agent_run_id=run_id,
        user_id=uid,
        provider="claude",
        prompt="hi",
        model=None,
    )
    session = AgentSession(
        id=session_id,
        user_id=uid,
        provider="claude",
        status="active",
        config={},
        turn_count=1,
        runtime_id=rt.id,
        lease_id=dispatch.lease_id,
        llm_provider_id=session_provider_id,
        last_active_at=datetime.now(UTC),
        created_at=datetime.now(UTC),
    )
    run = AgentRun(
        id=run_id,
        agent_type="claude_code",
        provider="claude",
        status="running",
        spec_strategy="quick-chat",
        agent_session_id=session_id,
        change_id=None,
        llm_provider_id=run_provider_id,
    )
    db_session.add_all([session, run])
    await db_session.commit()
    return dispatch.lease_id, run_id, dispatch.claim_token


async def _usage_rows(db_session: AsyncSession, run_id: uuid.UUID) -> list[AgentRunModelUsage]:
    """按 model 排序读回该 run 的全部明细行（排序让断言与插入顺序解耦）。"""
    return list(
        (
            await db_session.execute(
                select(AgentRunModelUsage)
                .where(AgentRunModelUsage.run_id == run_id)
                .order_by(AgentRunModelUsage.model)
            )
        )
        .scalars()
        .all()
    )


def _sample_usage() -> list[ModelUsageItemRead]:
    """两行明细：glm-4.7 消耗（in+out=1200）> gpt-5-mini（in+out=300）。

    api_requests 为 daemon 按 design §2 分摊后的行值（7+3 == run 总数 10）。
    """
    return [
        ModelUsageItemRead(
            model="gpt-5-mini",
            input_tokens=200,
            output_tokens=100,
            cache_read_tokens=50,
            cache_creation_tokens=25,
            api_requests=3,
        ),
        ModelUsageItemRead(
            model="glm-4.7",
            input_tokens=1000,
            output_tokens=200,
            cache_read_tokens=8000,
            cache_creation_tokens=400,
            api_requests=7,
        ),
    ]


# ── 带 model_usage：明细落库 + run 列填充（R-08 不覆盖）──────────────────────


@pytest.mark.asyncio
async def test_close_with_model_usage_persists_rows_and_fills_run_columns(
    db_session: AsyncSession, mocked_redis
) -> None:
    """带 model_usage 的 close → 明细行四维 + 分摊 api_requests 落库；run.model 填
    input+output 最大行的 model；llm_provider_id 已有值（dispatch 写入）不被会话
    当前值覆盖（R-08）。"""
    session_provider = uuid.uuid4()  # 会话当前选的供应商（终态若覆盖会错写成它）
    dispatch_provider = uuid.uuid4()  # dispatch 时点已写入 run 的准确供应商
    lease_id, run_id, token = await _seed_session_and_run(
        db_session,
        session_provider_id=session_provider,
        run_provider_id=dispatch_provider,
    )
    svc = DaemonService(db_session)
    run = await svc.close_interactive_run(
        lease_id,
        run_id,
        token,
        status="success",
        is_error=False,
        model_usage=_sample_usage(),
        api_requests=10,
    )
    assert run.status == "completed"

    # 明细行：两行均落库，四维 + 分摊 api_requests 与 daemon 上报值逐字段一致
    # （backend 不重复分摊，直接落行）。
    rows = await _usage_rows(db_session, run_id)
    assert [r.model for r in rows] == ["glm-4.7", "gpt-5-mini"]
    glm_row, gpt_row = rows
    assert (glm_row.input_tokens, glm_row.output_tokens) == (1000, 200)
    assert (glm_row.cache_read_tokens, glm_row.cache_creation_tokens) == (8000, 400)
    assert glm_row.api_requests == 7
    assert (gpt_row.input_tokens, gpt_row.output_tokens) == (200, 100)
    assert (gpt_row.cache_read_tokens, gpt_row.cache_creation_tokens) == (50, 25)
    assert gpt_row.api_requests == 3

    # run 列：model 终态填最大消耗行（glm-4.7 in+out=1200 > gpt-5-mini 300）；
    # llm_provider_id 保持 dispatch 写入值（R-08：仅空时填，非空绝不覆盖）。
    refreshed = await db_session.get(AgentRun, run_id, populate_existing=True)
    assert refreshed is not None
    assert refreshed.model == "glm-4.7"
    assert refreshed.llm_provider_id == dispatch_provider


@pytest.mark.asyncio
async def test_close_fills_llm_provider_id_only_when_run_empty(
    db_session: AsyncSession, mocked_redis
) -> None:
    """run.llm_provider_id 为空（老数据 / 未记录路径）→ 终态填会话当前值；单行
    明细 + 不传 run 级 api_requests（None）同样正常落行（跳过 run 级承载）。"""
    session_provider = uuid.uuid4()
    lease_id, run_id, token = await _seed_session_and_run(
        db_session, session_provider_id=session_provider, run_provider_id=None
    )
    svc = DaemonService(db_session)
    run = await svc.close_interactive_run(
        lease_id,
        run_id,
        token,
        status="success",
        is_error=False,
        model_usage=[
            ModelUsageItemRead(
                model="claude-sonnet-4",
                input_tokens=300,
                output_tokens=50,
                api_requests=4,
            )
        ],
        api_requests=None,
    )
    assert run.status == "completed"
    rows = await _usage_rows(db_session, run_id)
    assert len(rows) == 1
    assert rows[0].model == "claude-sonnet-4"
    assert rows[0].api_requests == 4
    refreshed = await db_session.get(AgentRun, run_id, populate_existing=True)
    assert refreshed is not None
    assert refreshed.model == "claude-sonnet-4"
    assert refreshed.llm_provider_id == session_provider


# ── 不带 model_usage（老 daemon）：零变化（N-01）────────────────────────────


@pytest.mark.asyncio
async def test_close_without_model_usage_zero_change(
    db_session: AsyncSession, mocked_redis
) -> None:
    """老 daemon 不传 model_usage → 无明细行；run.model / llm_provider_id 均不填
    （即使会话有当前供应商也不填——填充是 model_usage 处理块的一部分）；close
    本身正常收口（零回归）。"""
    session_provider = uuid.uuid4()
    lease_id, run_id, token = await _seed_session_and_run(
        db_session, session_provider_id=session_provider, run_provider_id=None
    )
    svc = DaemonService(db_session)
    run = await svc.close_interactive_run(
        lease_id,
        run_id,
        token,
        status="success",
        is_error=False,
    )
    assert run.status == "completed"
    assert await _usage_rows(db_session, run_id) == []
    refreshed = await db_session.get(AgentRun, run_id, populate_existing=True)
    assert refreshed is not None
    assert refreshed.model is None
    assert refreshed.llm_provider_id is None


# ── 重复 close 重放幂等 ──────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_close_replay_same_payload_idempotent(db_session: AsyncSession, mocked_redis) -> None:
    """重放同 payload：第二次 close 撞终态 no-op 早退，明细行数/值与 run 列均
    不变（不叠行、不翻转）——daemon 网络抖动重试安全。"""
    lease_id, run_id, token = await _seed_session_and_run(db_session)
    svc = DaemonService(db_session)
    first = await svc.close_interactive_run(
        lease_id,
        run_id,
        token,
        status="success",
        is_error=False,
        model_usage=_sample_usage(),
        api_requests=10,
    )
    assert first.status == "completed"
    replay = await svc.close_interactive_run(
        lease_id,
        run_id,
        token,
        status="success",
        is_error=False,
        model_usage=_sample_usage(),
        api_requests=10,
    )
    assert replay.status == "completed"

    rows = await _usage_rows(db_session, run_id)
    assert len(rows) == 2  # 不叠行（delete+insert 幂等 + 终态 no-op 早退双保险）
    refreshed = await db_session.get(AgentRun, run_id, populate_existing=True)
    assert refreshed is not None
    assert refreshed.model == "glm-4.7"
