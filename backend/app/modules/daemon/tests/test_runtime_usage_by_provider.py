"""task-05: get_runtimes_usage by_provider 分组查询测试（FR-04-1 / design §4.3）。

核心目标:
- 明细表 agent_run_model_usage 按 供应商×模型 聚合分组正确（同模型跨供应商
  分属不同组;provider NULL → provider_name=「未记录」）。
- 同窗同 COALESCE 去重:双挂 session+lease 的 run 明细只计入 session.runtime_id,
  不重复计（沿用 test_runtime_usage_service 的 R-03/D-003@v2 语义）。
- 无明细行（老 daemon / 老数据）→ by_provider 空列表,summary/daily 不受影响。
- summary 仍取 run 级列,不混入明细行口径（FR-04-3 零回归语义）。

⚠️ 方言:单测走 SQLite in-memory（conftest db_session）,SQL 函数不绑死
（生产 PG 走 ``_build_by_provider_sql`` 的 postgresql 分支,纯 GROUP BY 无桶）。
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.agent.model import AgentRun, AgentRunModelUsage, AgentSession
from app.modules.daemon.model import DaemonRuntime, DaemonTaskLease
from app.modules.daemon.runtime.service import RuntimeService
from app.modules.llm_provider.model import LlmProvider

# ── Helpers ──────────────────────────────────────────────────────────────────


async def _create_user(session: AsyncSession) -> uuid.UUID:
    """Insert a User row so FK constraints on daemon_runtimes/llm_providers hold."""
    from app.modules.auth.model import User

    uid = uuid.uuid4()
    user = User(
        id=uid,
        email=f"by-provider-{uid}@example.com",
        password_hash="irrelevant",
        display_name="ByProviderTest",
        status="active",
    )
    session.add(user)
    await session.commit()
    return uid


async def _create_runtime(session: AsyncSession, user_id: uuid.UUID) -> DaemonRuntime:
    rt = DaemonRuntime(
        id=uuid.uuid4(),
        user_id=user_id,
        name=f"rt-{uuid.uuid4().hex[:6]}",
        provider="claude_code",
        status="online",
        last_heartbeat_at=datetime.now(UTC),
    )
    session.add(rt)
    await session.commit()
    await session.refresh(rt)
    return rt


async def _create_provider(session: AsyncSession, user_id: uuid.UUID, name: str) -> LlmProvider:
    p = LlmProvider(
        id=uuid.uuid4(),
        user_id=user_id,
        name=name,
        agent_kind="claude_code",
        encrypted_api_key=b"irrelevant",
        key_id=f"key-{uuid.uuid4().hex[:8]}",
    )
    session.add(p)
    await session.commit()
    await session.refresh(p)
    return p


async def _create_session(
    session: AsyncSession,
    *,
    user_id: uuid.UUID,
    runtime_id: uuid.UUID,
    lease_id: uuid.UUID | None = None,
) -> AgentSession:
    s = AgentSession(
        id=uuid.uuid4(),
        user_id=user_id,
        runtime_id=runtime_id,
        lease_id=lease_id,
        provider="claude_code",
        status="active",
    )
    session.add(s)
    await session.commit()
    await session.refresh(s)
    return s


async def _create_lease(
    session: AsyncSession,
    *,
    runtime_id: uuid.UUID,
    kind: str = "batch",
) -> DaemonTaskLease:
    now = datetime.now(UTC)
    lease = DaemonTaskLease(
        id=uuid.uuid4(),
        runtime_id=runtime_id,
        status="claimed",
        kind=kind,
        claimed_at=now,
        lease_expires_at=None if kind == "interactive" else now + timedelta(seconds=60),
        metadata_={"claim_token": "tok"},
        created_at=now,
        updated_at=now,
    )
    session.add(lease)
    await session.commit()
    await session.refresh(lease)
    return lease


async def _create_run(
    session: AsyncSession,
    *,
    agent_session_id: uuid.UUID | None = None,
    lease_id: uuid.UUID | None = None,
    llm_provider_id: uuid.UUID | None = None,
    input_tokens: int | None = None,
    output_tokens: int | None = None,
    total_cost_usd: float | None = None,
    created_at: datetime | None = None,
) -> AgentRun:
    run = AgentRun(
        id=uuid.uuid4(),
        agent_type="claude_code",
        status="completed",
        agent_session_id=agent_session_id,
        lease_id=lease_id,
        llm_provider_id=llm_provider_id,
        input_tokens=input_tokens,
        output_tokens=output_tokens,
        total_cost_usd=total_cost_usd,
        created_at=created_at or datetime.now(UTC),
    )
    session.add(run)
    await session.commit()
    await session.refresh(run)
    return run


async def _create_model_usage(
    session: AsyncSession,
    *,
    run_id: uuid.UUID,
    model: str,
    input_tokens: int = 0,
    output_tokens: int = 0,
    cache_read_tokens: int = 0,
    cache_creation_tokens: int = 0,
    api_requests: int = 1,
) -> AgentRunModelUsage:
    u = AgentRunModelUsage(
        id=uuid.uuid4(),
        run_id=run_id,
        model=model,
        input_tokens=input_tokens,
        output_tokens=output_tokens,
        cache_read_tokens=cache_read_tokens,
        cache_creation_tokens=cache_creation_tokens,
        api_requests=api_requests,
    )
    session.add(u)
    await session.commit()
    return u


def _rid_key(rid: object) -> str:
    """归一化 runtime_id 为无连字符 hex（SQLite TEXT / PG UUID 双方言兼容）。"""
    return str(rid).replace("-", "")


def _by_rid(result: list) -> dict[str, object]:
    return {_rid_key(r.runtime_id): r for r in result}


def _rid_of(rt: DaemonRuntime) -> str:
    return _rid_key(rt.id)


def _groups_by_key(usage_read: object) -> dict[tuple[str | None, str], object]:
    """by_provider 列表按 (provider_id hex, model) 建索引,断言不依赖顺序。"""
    return {
        (g.provider_id.hex if g.provider_id is not None else None, g.model): g
        for g in usage_read.by_provider
    }


# ── Tests ────────────────────────────────────────────────────────────────────


class TestByProviderAggregation:
    """明细行按 供应商×模型 聚合分组（FR-04-1 AC:窗口内明细聚合正确）。"""

    @pytest.mark.asyncio
    async def test_groups_by_provider_and_model(self, db_session: AsyncSession) -> None:
        """两供应商 × 两模型 + 无供应商 run → 4 个分组,各维 SUM 正确。

        - P1 有 model-a / model-b 两个模型行（不同 run 同 run 均可,此处不同 run）;
        - P2 与 P1 同模型名 model-a → 分属两组（model 不是全局去重键）;
        - run.llm_provider_id=NULL → provider_name=「未记录」,provider_id=None。
        """
        user_id = await _create_user(db_session)
        rt = await _create_runtime(db_session, user_id)
        s = await _create_session(db_session, user_id=user_id, runtime_id=rt.id)
        p1 = await _create_provider(db_session, user_id, "ProviderA")
        p2 = await _create_provider(db_session, user_id, "ProviderB")

        run1 = await _create_run(db_session, agent_session_id=s.id, llm_provider_id=p1.id)
        await _create_model_usage(
            db_session,
            run_id=run1.id,
            model="model-a",
            input_tokens=100,
            output_tokens=10,
            api_requests=2,
        )
        await _create_model_usage(
            db_session,
            run_id=run1.id,
            model="model-b",
            input_tokens=50,
            output_tokens=5,
            cache_read_tokens=7,
            api_requests=1,
        )
        run2 = await _create_run(db_session, agent_session_id=s.id, llm_provider_id=p2.id)
        await _create_model_usage(
            db_session,
            run_id=run2.id,
            model="model-a",
            input_tokens=200,
            output_tokens=20,
            api_requests=3,
        )
        # run3:未记录供应商(老 run llm_provider_id=NULL)
        run3 = await _create_run(db_session, agent_session_id=s.id)
        await _create_model_usage(
            db_session,
            run_id=run3.id,
            model="model-a",
            input_tokens=7,
            output_tokens=1,
            cache_creation_tokens=3,
            api_requests=1,
        )

        svc = RuntimeService(db_session)
        result = await svc.get_runtimes_usage("7d")

        by_rid = _by_rid(result)
        assert _rid_of(rt) in by_rid
        groups = _groups_by_key(by_rid[_rid_of(rt)])
        assert len(groups) == 4, f"应 4 组(P1×2 模型 + P2×1 + 未记录×1),实际 {len(groups)}"

        g_p1_a = groups[(p1.id.hex, "model-a")]
        assert g_p1_a.provider_name == "ProviderA"
        assert (g_p1_a.input_tokens, g_p1_a.output_tokens, g_p1_a.api_requests) == (100, 10, 2)

        g_p1_b = groups[(p1.id.hex, "model-b")]
        assert g_p1_b.cache_read_tokens == 7
        assert g_p1_b.cache_creation_tokens == 0, "未上报维归 0(表列 NOT NULL default 0)"
        assert g_p1_b.api_requests == 1

        g_p2_a = groups[(p2.id.hex, "model-a")]
        assert g_p2_a.provider_name == "ProviderB"
        assert g_p2_a.input_tokens == 200, "同模型名跨供应商分属两组,不合并"
        assert g_p2_a.api_requests == 3

        g_unknown = groups[(None, "model-a")]
        assert g_unknown.provider_name == "未记录", "provider NULL → provider_name=未记录"
        assert g_unknown.provider_id is None
        assert g_unknown.input_tokens == 7
        assert g_unknown.cache_creation_tokens == 3
        assert g_unknown.api_requests == 1

    @pytest.mark.asyncio
    async def test_same_model_multi_run_sums_across_runs(self, db_session: AsyncSession) -> None:
        """同 (provider, model) 的多个 run 明细行 → SUM 聚合到一组。"""
        user_id = await _create_user(db_session)
        rt = await _create_runtime(db_session, user_id)
        s = await _create_session(db_session, user_id=user_id, runtime_id=rt.id)
        p = await _create_provider(db_session, user_id, "ProviderA")

        for _ in range(3):
            run = await _create_run(db_session, agent_session_id=s.id, llm_provider_id=p.id)
            await _create_model_usage(
                db_session,
                run_id=run.id,
                model="model-a",
                input_tokens=10,
                output_tokens=2,
                api_requests=1,
            )

        svc = RuntimeService(db_session)
        result = await svc.get_runtimes_usage("7d")

        by_rid = _by_rid(result)
        groups = _groups_by_key(by_rid[_rid_of(rt)])
        assert list(groups) == [(p.id.hex, "model-a")], "3 个 run 同模型聚成一组"
        g = groups[(p.id.hex, "model-a")]
        assert (g.input_tokens, g.output_tokens, g.api_requests) == (30, 6, 3)

    @pytest.mark.asyncio
    async def test_window_excludes_old_runs(self, db_session: AsyncSession) -> None:
        """8 天前的明细行不计入 7d 窗（since 过滤对 by_provider 同样生效）。"""
        user_id = await _create_user(db_session)
        rt = await _create_runtime(db_session, user_id)
        s = await _create_session(db_session, user_id=user_id, runtime_id=rt.id)
        p = await _create_provider(db_session, user_id, "ProviderA")

        old_run = await _create_run(
            db_session,
            agent_session_id=s.id,
            llm_provider_id=p.id,
            created_at=datetime.now(UTC) - timedelta(days=8),
        )
        await _create_model_usage(db_session, run_id=old_run.id, model="model-a", input_tokens=999)
        recent_run = await _create_run(db_session, agent_session_id=s.id, llm_provider_id=p.id)
        await _create_model_usage(
            db_session, run_id=recent_run.id, model="model-a", input_tokens=11
        )

        svc = RuntimeService(db_session)
        result = await svc.get_runtimes_usage("7d")

        by_rid = _by_rid(result)
        groups = _groups_by_key(by_rid[_rid_of(rt)])
        g = groups[(p.id.hex, "model-a")]
        assert g.input_tokens == 11, "8 天前的明细行应被 since 过滤"


class TestByProviderDualPathDedup:
    """双挂 session+lease 的 run 明细不重复计（同 summary 的 COALESCE 去重语义）。"""

    @pytest.mark.asyncio
    async def test_dual_attach_run_counts_once_under_session_runtime(
        self, db_session: AsyncSession
    ) -> None:
        """interactive run 同时挂 session(→R1) + lease(→R2):明细只进 R1,R2 不出现。

        LEFT JOIN 两路各命中一次但每 run 仍唯一一行（u JOIN r 是 N:1,JOIN 展开
        不会翻倍明细行）,token/api_requests 只算一次。
        """
        user_id = await _create_user(db_session)
        rt_session = await _create_runtime(db_session, user_id)  # R1
        rt_lease = await _create_runtime(db_session, user_id)  # R2

        lease = await _create_lease(db_session, runtime_id=rt_lease.id, kind="interactive")
        session = await _create_session(
            db_session, user_id=user_id, runtime_id=rt_session.id, lease_id=lease.id
        )
        run = await _create_run(db_session, agent_session_id=session.id, lease_id=lease.id)
        await _create_model_usage(
            db_session,
            run_id=run.id,
            model="model-a",
            input_tokens=500,
            output_tokens=50,
            api_requests=5,
        )

        svc = RuntimeService(db_session)
        result = await svc.get_runtimes_usage("7d")

        by_rid = _by_rid(result)
        assert _rid_of(rt_session) in by_rid, "明细应归 session.runtime_id"
        assert _rid_of(rt_lease) not in by_rid, "COALESCE 优先 session,lease 侧不重复计"

        r1_groups = _groups_by_key(by_rid[_rid_of(rt_session)])
        g = r1_groups[(None, "model-a")]
        assert g.input_tokens == 500, "明细只算一次(非翻倍 1000)"
        assert g.api_requests == 5


class TestByProviderEmptyAndSummaryRegression:
    """无明细 → by_provider 空列表;summary/daily 口径零回归（FR-04-3）。"""

    @pytest.mark.asyncio
    async def test_no_detail_rows_yields_empty_by_provider(self, db_session: AsyncSession) -> None:
        """有 run（summary 有数）但无 agent_run_model_usage 行 → by_provider=[]（老数据零回归）。"""
        user_id = await _create_user(db_session)
        rt = await _create_runtime(db_session, user_id)
        s = await _create_session(db_session, user_id=user_id, runtime_id=rt.id)
        await _create_run(
            db_session,
            agent_session_id=s.id,
            input_tokens=100,
            output_tokens=40,
            total_cost_usd=0.02,
        )

        svc = RuntimeService(db_session)
        result = await svc.get_runtimes_usage("7d")

        by_rid = _by_rid(result)
        assert _rid_of(rt) in by_rid
        read = by_rid[_rid_of(rt)]
        assert read.by_provider == [], "无明细行时 by_provider 为空列表(非 None)"
        assert read.summary.input_tokens == 100, "summary 照常从 run 级列聚合"
        assert len(read.daily) == 1, "daily 时间桶照常产出"

    @pytest.mark.asyncio
    async def test_summary_still_uses_run_level_columns_not_detail(
        self, db_session: AsyncSession
    ) -> None:
        """明细行数值 ≠ run 级列时,summary 仍取 run 级列（明细不泄漏进口径）。"""
        user_id = await _create_user(db_session)
        rt = await _create_runtime(db_session, user_id)
        s = await _create_session(db_session, user_id=user_id, runtime_id=rt.id)
        p = await _create_provider(db_session, user_id, "ProviderA")

        # run 级 input=100,明细行 input=1000:两者口径独立,summary 必须是 100
        run = await _create_run(
            db_session,
            agent_session_id=s.id,
            llm_provider_id=p.id,
            input_tokens=100,
            output_tokens=40,
        )
        await _create_model_usage(
            db_session,
            run_id=run.id,
            model="model-a",
            input_tokens=1000,
            output_tokens=400,
            api_requests=9,
        )

        svc = RuntimeService(db_session)
        result = await svc.get_runtimes_usage("7d")

        by_rid = _by_rid(result)
        read = by_rid[_rid_of(rt)]
        assert read.summary.input_tokens == 100, "summary 用 run 级列,不混明细口径"
        assert read.summary.output_tokens == 40
        g = _groups_by_key(read)[(p.id.hex, "model-a")]
        assert g.input_tokens == 1000, "by_provider 用明细表口径"
        assert g.api_requests == 9
