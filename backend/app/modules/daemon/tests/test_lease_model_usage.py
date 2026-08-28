"""task-04（2026-08-29-usage-by-provider-model）：complete_lease batch 明细落库 + run 列填充。

覆盖 design §4.1 complete_lease 消费端（stats.model / api_requests，daemon task-07 上报）：

- a) stats 带 model/api_requests → agent_run_model_usage 单行明细 + run.model 填充；
- b) stats 不带新字段（老 daemon，N-01）→ 零变化（无明细行、run.model 不动）；
- c) 终态重放（retryTerminal / outbox 补发）→ delete+insert 幂等，同 run 仍一行；
- R-08：run.llm_provider_id 仅空时按 lease metadata 显式键回填，已有值不覆盖。

fixture 惯例镜像 test_lease_service.py（_create_user / _create_runtime / 手插
claimed batch lease + AgentRun 行）。
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import col

from app.modules.agent.model import AgentRun, AgentRunModelUsage
from app.modules.daemon.model import DaemonRuntime, DaemonTaskLease
from app.modules.daemon.service import DaemonService
from app.modules.llm_provider.model import LlmProvider

# ── Helpers（镜像 test_lease_service.py） ─────────────────────────────────────


async def _create_user(session: AsyncSession) -> uuid.UUID:
    """Insert a User row so FK constraints on daemon_runtimes are satisfied."""
    from app.modules.auth.model import User

    uid = uuid.uuid4()
    user = User(
        id=uid,
        email=f"test-{uid}@example.com",
        password_hash="irrelevant",
        display_name="Test",
        status="active",
    )
    session.add(user)
    await session.commit()
    return uid


async def _create_runtime(session: AsyncSession, user_id: uuid.UUID) -> DaemonRuntime:
    """Create a DaemonRuntime row for testing."""
    rt = DaemonRuntime(
        id=uuid.uuid4(),
        user_id=user_id,
        name="test-daemon",
        provider="claude_code",
        status="online",
        last_heartbeat_at=datetime.now(UTC),
    )
    session.add(rt)
    await session.commit()
    await session.refresh(rt)
    return rt


async def _create_batch_run_with_lease(
    session: AsyncSession,
    runtime_id: uuid.UUID,
    *,
    run_llm_provider_id: uuid.UUID | None = None,
    lease_meta_extra: dict | None = None,
) -> tuple[uuid.UUID, uuid.UUID, str]:
    """构造 running AgentRun + claimed batch lease，返回 (lease_id, run_id, claim_token)。

    run.llm_provider_id 可注入（R-08 已有值不覆盖分支）；lease metadata 可追加
    llm_provider_id / session_llm_provider_id 键（provider 回填数据源）。
    """
    now = datetime.now(UTC)
    run_id = uuid.uuid4()
    claim_token = "tok-" + uuid.uuid4().hex[:8]
    run = AgentRun(
        id=run_id,
        agent_type="claude_code",
        status="running",
        llm_provider_id=run_llm_provider_id,
    )
    meta: dict = {"claim_token": claim_token}
    meta.update(lease_meta_extra or {})
    lease = DaemonTaskLease(
        id=uuid.uuid4(),
        runtime_id=runtime_id,
        agent_run_id=run_id,
        status="claimed",
        kind="batch",
        claimed_at=now,
        lease_expires_at=now + timedelta(seconds=60),
        metadata_=meta,
        created_at=now,
        updated_at=now,
    )
    session.add_all([run, lease])
    await session.commit()
    return lease.id, run_id, claim_token


async def _fetch_usage_rows(session: AsyncSession, run_id: uuid.UUID) -> list[AgentRunModelUsage]:
    stmt = select(AgentRunModelUsage).where(col(AgentRunModelUsage.run_id) == run_id)
    return list((await session.execute(stmt)).scalars().all())


# ── a/b/c：batch 明细 + run.model 填充 ────────────────────────────────────────


class TestCompleteLeaseModelUsage:
    """task-04 / FR-01-2：complete_lease stats.model/api_requests 消费三态。"""

    @pytest.mark.asyncio
    async def test_stats_with_model_writes_detail_and_run_model(
        self, db_session: AsyncSession
    ) -> None:
        """a) stats 带 model/api_requests → 单行明细（四维+requests）+ run.model 填充。"""
        user_id = await _create_user(db_session)
        rt = await _create_runtime(db_session, user_id)
        lease_id, run_id, token = await _create_batch_run_with_lease(db_session, rt.id)

        svc = DaemonService(db_session)
        result = await svc.complete_lease(
            lease_id,
            token,
            {
                "status": "completed",
                "stats": {
                    "input_tokens": 100,
                    "output_tokens": 40,
                    "cache_read_tokens": 7,
                    "cache_creation_tokens": 3,
                    "num_turns": 5,
                    "model": "claude-sonnet-4-5",
                    "api_requests": 9,
                },
            },
        )

        assert result.status == "completed"
        rows = await _fetch_usage_rows(db_session, run_id)
        assert len(rows) == 1
        row = rows[0]
        assert row.run_id == run_id
        assert row.model == "claude-sonnet-4-5"
        assert row.input_tokens == 100
        assert row.output_tokens == 40
        assert row.cache_read_tokens == 7
        assert row.cache_creation_tokens == 3
        assert row.api_requests == 9

        run = await db_session.get(AgentRun, run_id)
        assert run is not None
        assert run.model == "claude-sonnet-4-5"
        # run 级既有四维覆盖语义不动（taskCard constraints）
        assert run.input_tokens == 100
        assert run.output_tokens == 40
        assert run.num_turns == 5

    @pytest.mark.asyncio
    async def test_stats_without_model_zero_change(self, db_session: AsyncSession) -> None:
        """b) stats 不带 model/api_requests（老 daemon，N-01）→ 零变化。

        无明细行、run.model 不动；既有四维仍照常应用（stats 消费不受本任务影响）。
        """
        user_id = await _create_user(db_session)
        rt = await _create_runtime(db_session, user_id)
        lease_id, run_id, token = await _create_batch_run_with_lease(db_session, rt.id)

        svc = DaemonService(db_session)
        result = await svc.complete_lease(
            lease_id,
            token,
            {
                "status": "completed",
                "stats": {"input_tokens": 100, "output_tokens": 40},
            },
        )

        assert result.status == "completed"
        assert await _fetch_usage_rows(db_session, run_id) == []
        run = await db_session.get(AgentRun, run_id)
        assert run is not None
        assert run.model is None
        assert run.llm_provider_id is None  # lease metadata 无 provider 键 → 不造关联
        assert run.input_tokens == 100
        assert run.output_tokens == 40

    @pytest.mark.asyncio
    async def test_replay_idempotent_single_row(self, db_session: AsyncSession) -> None:
        """c) 终态重放 → delete+insert 幂等：同 run 仍一行，值为最新一次上报。"""
        user_id = await _create_user(db_session)
        rt = await _create_runtime(db_session, user_id)
        lease_id, run_id, token = await _create_batch_run_with_lease(db_session, rt.id)

        svc = DaemonService(db_session)
        stats_first = {
            "input_tokens": 100,
            "output_tokens": 40,
            "model": "claude-sonnet-4-5",
            "api_requests": 9,
        }
        await svc.complete_lease(
            lease_id, token, {"status": "completed", "stats": dict(stats_first)}
        )
        # 重放（retryTerminal / outbox 补发）：第二次上报值不同（累加口径漂移模拟）
        stats_replay = {
            "input_tokens": 120,
            "output_tokens": 50,
            "model": "claude-sonnet-4-5",
            "api_requests": 11,
        }
        await svc.complete_lease(
            lease_id, token, {"status": "completed", "stats": dict(stats_replay)}
        )

        rows = await _fetch_usage_rows(db_session, run_id)
        assert len(rows) == 1  # 幂等：不因重放翻倍
        assert rows[0].input_tokens == 120
        assert rows[0].output_tokens == 50
        assert rows[0].api_requests == 11

    @pytest.mark.asyncio
    async def test_stats_model_missing_dims_coalesce_zero(self, db_session: AsyncSession) -> None:
        """四维缺省 → 明细行 COALESCE 0；api_requests 缺省按 1（行存在即至少一次调用）。"""
        user_id = await _create_user(db_session)
        rt = await _create_runtime(db_session, user_id)
        lease_id, run_id, token = await _create_batch_run_with_lease(db_session, rt.id)

        svc = DaemonService(db_session)
        await svc.complete_lease(
            lease_id,
            token,
            {"status": "completed", "stats": {"model": "glm-4.7", "input_tokens": 10}},
        )

        rows = await _fetch_usage_rows(db_session, run_id)
        assert len(rows) == 1
        assert rows[0].model == "glm-4.7"
        assert rows[0].input_tokens == 10
        assert rows[0].output_tokens == 0
        assert rows[0].cache_read_tokens == 0
        assert rows[0].cache_creation_tokens == 0
        assert rows[0].api_requests == 1


# ── R-08：run.llm_provider_id 仅空时回填 ─────────────────────────────────────


class TestCompleteLeaseProviderFill:
    """task-04 / R-08（design §1.2）：llm_provider_id 终态仅空时按 lease 键回填。"""

    @pytest.mark.asyncio
    async def test_llm_provider_id_filled_from_lease_meta_when_empty(
        self, db_session: AsyncSession
    ) -> None:
        """run.llm_provider_id 空 + lease metadata.llm_provider_id（档案绑定键）→ 回填。"""
        user_id = await _create_user(db_session)
        rt = await _create_runtime(db_session, user_id)
        provider = LlmProvider(
            id=uuid.uuid4(),
            user_id=user_id,
            name="bound-provider",
            agent_kind="claude_code",
            encrypted_api_key=b"dummy",
            key_id="dummy-key",
        )
        db_session.add(provider)
        await db_session.commit()

        lease_id, run_id, token = await _create_batch_run_with_lease(
            db_session, rt.id, lease_meta_extra={"llm_provider_id": str(provider.id)}
        )

        svc = DaemonService(db_session)
        # stats 不带 model 也回填（provider 归因不依赖新字段，design §1.2 终态语义）
        await svc.complete_lease(
            lease_id, token, {"status": "completed", "stats": {"input_tokens": 1}}
        )

        run = await db_session.get(AgentRun, run_id)
        assert run is not None
        assert run.llm_provider_id == provider.id

    @pytest.mark.asyncio
    async def test_llm_provider_id_not_overwritten_when_set(self, db_session: AsyncSession) -> None:
        """R-08：dispatch 时点已写入的 llm_provider_id 不被终态覆盖（切供应商竞态防错归因）。"""
        user_id = await _create_user(db_session)
        rt = await _create_runtime(db_session, user_id)
        dispatch_provider = LlmProvider(
            id=uuid.uuid4(),
            user_id=user_id,
            name="dispatch-provider",
            agent_kind="claude_code",
            encrypted_api_key=b"dummy",
            key_id="dummy-key",
        )
        meta_provider = LlmProvider(
            id=uuid.uuid4(),
            user_id=user_id,
            name="meta-provider",
            agent_kind="claude_code",
            encrypted_api_key=b"dummy",
            key_id="dummy-key",
        )
        db_session.add_all([dispatch_provider, meta_provider])
        await db_session.commit()

        lease_id, run_id, token = await _create_batch_run_with_lease(
            db_session,
            rt.id,
            run_llm_provider_id=dispatch_provider.id,
            lease_meta_extra={"llm_provider_id": str(meta_provider.id)},
        )

        svc = DaemonService(db_session)
        await svc.complete_lease(
            lease_id,
            token,
            {
                "status": "completed",
                "stats": {"input_tokens": 1, "model": "claude-sonnet-4-5"},
            },
        )

        run = await db_session.get(AgentRun, run_id)
        assert run is not None
        # dispatch 值保留，不被 metadata 指向的供应商覆盖
        assert run.llm_provider_id == dispatch_provider.id

    @pytest.mark.asyncio
    async def test_llm_provider_id_missing_provider_row_skipped(
        self, db_session: AsyncSession
    ) -> None:
        """metadata 指向的 provider 行已删 → 跳过回填（防 PG FK 违反 + 不造悬空关联）。"""
        user_id = await _create_user(db_session)
        rt = await _create_runtime(db_session, user_id)
        ghost_id = uuid.uuid4()  # 从不落库的 provider id

        lease_id, run_id, token = await _create_batch_run_with_lease(
            db_session, rt.id, lease_meta_extra={"llm_provider_id": str(ghost_id)}
        )

        svc = DaemonService(db_session)
        result = await svc.complete_lease(
            lease_id, token, {"status": "completed", "stats": {"input_tokens": 1}}
        )

        assert result.status == "completed"  # best-effort：跳过不阻塞 close
        run = await db_session.get(AgentRun, run_id)
        assert run is not None
        assert run.llm_provider_id is None
