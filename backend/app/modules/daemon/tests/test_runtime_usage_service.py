"""task-08: RuntimeService.get_runtimes_usage(window) 聚合去重测试。

核心目标:
- R-03/D-003@v2 双路径去重:interactive run 同时挂 agent_session_id + lease_id,
  LEFT JOIN + COALESCE 单查询每 run 唯一一行,token 只算一次(不会 UNION 翻倍)。
- D-002@v1 分组粒度:1d 按小时桶(≤24 点),7d/30d 按日桶。
- D-004@v1 since:1d 本地自然日 00:00 转 UTC;7d/30d now-Nd。
- FR-05 NULL cache/cost 被 SUM(COALESCE) 归 0。
- WHERE COALESCE IS NOT NULL 排除孤儿 run。

⚠️ 测试不绑死 SQL 函数名(SQLite 单测用 strftime / 生产 PG 用 date_trunc,见 R-05
方言分支),按「行数 + ts 整点」断言。
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.agent.model import AgentRun, AgentSession
from app.modules.daemon.model import DaemonRuntime, DaemonTaskLease
from app.modules.daemon.runtime.service import RuntimeService

# ── Helpers ──────────────────────────────────────────────────────────────────


async def _create_user(session: AsyncSession) -> uuid.UUID:
    """Insert a User row so FK constraints on daemon_runtimes are satisfied."""
    from app.modules.auth.model import User

    uid = uuid.uuid4()
    user = User(
        id=uid,
        email=f"usage-{uid}@example.com",
        password_hash="irrelevant",
        display_name="UsageTest",
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


async def _create_session(
    session: AsyncSession,
    *,
    user_id: uuid.UUID,
    runtime_id: uuid.UUID,
    lease_id: uuid.UUID | None = None,
    provider: str = "claude_code",
) -> AgentSession:
    s = AgentSession(
        id=uuid.uuid4(),
        user_id=user_id,
        runtime_id=runtime_id,
        lease_id=lease_id,
        provider=provider,
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
    agent_run_id: uuid.UUID | None = None,
    kind: str = "batch",
) -> DaemonTaskLease:
    now = datetime.now(UTC)
    lease = DaemonTaskLease(
        id=uuid.uuid4(),
        runtime_id=runtime_id,
        agent_run_id=agent_run_id,
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
    input_tokens: int | None = None,
    output_tokens: int | None = None,
    cache_read_tokens: int | None = None,
    cache_creation_tokens: int | None = None,
    total_cost_usd: float | None = None,
    created_at: datetime | None = None,
) -> AgentRun:
    """Insert an AgentRun row with explicit created_at (naive UTC OK in SQLite)."""
    run = AgentRun(
        id=uuid.uuid4(),
        agent_type="claude_code",
        status="completed",
        agent_session_id=agent_session_id,
        lease_id=lease_id,
        input_tokens=input_tokens,
        output_tokens=output_tokens,
        cache_read_tokens=cache_read_tokens,
        cache_creation_tokens=cache_creation_tokens,
        total_cost_usd=total_cost_usd,
        created_at=created_at or datetime.now(UTC),
    )
    session.add(run)
    await session.commit()
    await session.refresh(run)
    return run


def _normalize_ts(ts: datetime | None) -> datetime:
    """SQLite/PG may return naive datetimes; normalize to aware UTC for assertions."""
    if ts is None:
        raise AssertionError("ts 不应为 None")
    return ts if ts.tzinfo is not None else ts.replace(tzinfo=UTC)


def _rid_key(rid: object) -> str:
    """归一化 runtime_id 为无连字符 hex,兼容方言差异。

    PostgreSQL 的 ``Uuid`` 列经 COALESCE 返回原生 UUID 对象(或带连字符 str);
    SQLite 的 aiosqlite 把 UUID 存成无连字符 hex TEXT,COALESCE 原样返回。
    统一转 hex 比较避免测试绑定具体格式。
    """
    return str(rid).replace("-", "")


def _by_rid(result: list) -> dict[str, object]:
    """结果列表按归一化 hex rid 建索引。"""
    return {_rid_key(r.runtime_id): r for r in result}


def _rid_of(rt: DaemonRuntime) -> str:
    return _rid_key(rt.id)


# ── Tests ────────────────────────────────────────────────────────────────────


class TestGetRuntimesUsageDualPathDedup:
    """R-03 / D-003@v2 核心:interactive run 同时挂 session+lease 只算一次。"""

    @pytest.mark.asyncio
    async def test_dual_path_dedup_interactive_run_counts_once(
        self, db_session: AsyncSession
    ) -> None:
        """AC-01 核心:1 个 interactive run 同时挂 agent_session_id(→session R1)
        + lease_id(→lease R2),LEFT JOIN+COALESCE 优先 session.runtime_id,
        该 run 的 token 只计入 R1,R2 不出现(天然去重,替代 UNION 翻倍)。
        """
        user_id = await _create_user(db_session)
        rt_session = await _create_runtime(db_session, user_id)  # R1
        rt_lease = await _create_runtime(db_session, user_id)  # R2 (不同 runtime)

        # 1 个 interactive lease 绑到 R2(模拟 interactive run 同时挂 session+lease,
        # 但两者绑定不同 runtime,验证 COALESCE 优先 session)
        lease = await _create_lease(db_session, runtime_id=rt_lease.id, kind="interactive")
        # session 绑到 R1
        session = await _create_session(
            db_session,
            user_id=user_id,
            runtime_id=rt_session.id,
            lease_id=lease.id,
        )
        # interactive run 同时挂 session + lease
        await _create_run(
            db_session,
            agent_session_id=session.id,
            lease_id=lease.id,
            input_tokens=100,
            output_tokens=50,
            total_cost_usd=0.01,
        )

        svc = RuntimeService(db_session)
        result = await svc.get_runtimes_usage("7d")

        # 断言:结果按 runtime_id 索引
        by_rid = _by_rid(result)
        assert _rid_of(rt_session) in by_rid, "interactive run 应归到 session.runtime_id"
        assert _rid_of(rt_lease) not in by_rid, (
            "COALESCE 优先 session,lease.runtime_id 不应重复计入"
        )
        r1 = by_rid[_rid_of(rt_session)]
        assert r1.summary.input_tokens == 100, "token 只算一次(非翻倍 200)"
        assert r1.summary.output_tokens == 50
        assert r1.summary.total_cost_usd == pytest.approx(0.01)

    @pytest.mark.asyncio
    async def test_batch_run_attributed_via_lease_runtime(self, db_session: AsyncSession) -> None:
        """AC-02:batch run(agent_session_id IS NULL,只有 lease_id)经 lease.runtime_id 归属。"""
        user_id = await _create_user(db_session)
        rt3 = await _create_runtime(db_session, user_id)

        lease = await _create_lease(db_session, runtime_id=rt3.id, kind="batch")
        # batch run 只挂 lease_id,无 agent_session_id
        await _create_run(
            db_session,
            agent_session_id=None,
            lease_id=lease.id,
            output_tokens=200,
        )

        svc = RuntimeService(db_session)
        result = await svc.get_runtimes_usage("7d")

        by_rid = _by_rid(result)
        assert _rid_of(rt3) in by_rid, "batch run 经 lease.runtime_id 归属"
        assert by_rid[_rid_of(rt3)].summary.output_tokens == 200


class TestGetRuntimesUsageGrouping:
    """分组粒度:1d→20min 桶 / 7d→hour 桶 / 30d→day 桶。"""

    @pytest.mark.asyncio
    async def test_window_1d_20min_buckets(self, db_session: AsyncSession) -> None:
        """1d 窗跨 3 个 20 分钟桶的 run → daily 有 3 个 point,ts 分钟为 0/20/40。"""
        user_id = await _create_user(db_session)
        rt = await _create_runtime(db_session, user_id)
        session = await _create_session(db_session, user_id=user_id, runtime_id=rt.id)

        # 用本地自然日内的 3 个点(今天 09:05 / 09:25 / 10:45),分属 3 个 20 分钟桶
        now_local = datetime.now().astimezone()
        today_local = now_local.replace(hour=0, minute=0, second=0, microsecond=0)
        base = today_local.replace(hour=9)
        for minute in (5, 25, 105):  # 09:05→09:00桶, 09:25→09:20桶, 10:45→10:40桶
            ts = base + timedelta(minutes=minute)
            await _create_run(
                db_session,
                agent_session_id=session.id,
                input_tokens=10,
                created_at=ts,
            )

        svc = RuntimeService(db_session)
        result = await svc.get_runtimes_usage("1d")

        by_rid = _by_rid(result)
        assert _rid_of(rt) in by_rid
        points = by_rid[_rid_of(rt)].daily
        assert len(points) == 3, f"跨 3 个 20 分钟桶应 3 桶,实际 {len(points)}"
        # ts 分钟对齐到 0/20/40,秒微秒全 0
        for p in points:
            ts = _normalize_ts(p.ts)
            assert ts.minute in (0, 20, 40), f"20 分钟桶 ts 分钟应为 0/20/40,实际 {ts}"
            assert ts.second == 0 and ts.microsecond == 0
        # 升序
        ts_list = [_normalize_ts(p.ts) for p in points]
        assert ts_list == sorted(ts_list)

    @pytest.mark.asyncio
    async def test_window_7d_hourly_buckets(self, db_session: AsyncSession) -> None:
        """7d 窗跨 2 小时的 run → daily 有 2 个 point,ts 为 hour-truncated(分钟秒归零)。"""
        user_id = await _create_user(db_session)
        rt = await _create_runtime(db_session, user_id)
        session = await _create_session(db_session, user_id=user_id, runtime_id=rt.id)

        now = datetime.now(UTC)
        # 今天 + 3 小时前(同一天不同小时)
        await _create_run(
            db_session,
            agent_session_id=session.id,
            input_tokens=5,
            created_at=now,
        )
        await _create_run(
            db_session,
            agent_session_id=session.id,
            input_tokens=7,
            created_at=now - timedelta(hours=3),
        )

        svc = RuntimeService(db_session)
        result = await svc.get_runtimes_usage("7d")

        by_rid = _by_rid(result)
        assert _rid_of(rt) in by_rid
        points = by_rid[_rid_of(rt)].daily
        assert len(points) == 2, f"跨 2 小时应 2 桶,实际 {len(points)}"
        for p in points:
            ts = _normalize_ts(p.ts)
            assert ts.minute == 0 and ts.second == 0, f"小时桶 ts 分秒归零,实际 {ts}"

    @pytest.mark.asyncio
    async def test_window_1d_max_72_20min_buckets(self, db_session: AsyncSession) -> None:
        """1d 窗 daily 最多 72 个 20 分钟桶(不会无限多)。"""
        user_id = await _create_user(db_session)
        rt = await _create_runtime(db_session, user_id)
        session = await _create_session(db_session, user_id=user_id, runtime_id=rt.id)

        now_local = datetime.now().astimezone()
        today_local = now_local.replace(hour=0, minute=0, second=0, microsecond=0)
        # 今天每个 20 分钟桶各一个 run(最多 72 桶,但今天可能还没到)
        for m in range(0, 24 * 60, 20):
            ts = today_local + timedelta(minutes=m)
            if ts <= now_local:
                await _create_run(
                    db_session,
                    agent_session_id=session.id,
                    input_tokens=1,
                    created_at=ts,
                )

        svc = RuntimeService(db_session)
        result = await svc.get_runtimes_usage("1d")

        by_rid = _by_rid(result)
        if _rid_of(rt) in by_rid:
            assert len(by_rid[_rid_of(rt)].daily) <= 72


class TestGetRuntimesUsageWindow:
    """D-004@v1 since 计算:1d 本地自然日 / 7d·30d now-Nd。"""

    @pytest.mark.asyncio
    async def test_window_1d_excludes_yesterday_late_run(self, db_session: AsyncSession) -> None:
        """1d 窗:昨天 23:59 的 run 不计入(本地自然日边界)。"""
        user_id = await _create_user(db_session)
        rt = await _create_runtime(db_session, user_id)
        session = await _create_session(db_session, user_id=user_id, runtime_id=rt.id)

        now_local = datetime.now().astimezone()
        yesterday_late = (
            now_local.replace(hour=0, minute=0, second=0, microsecond=0)
            - timedelta(minutes=1)  # 昨天 23:59:59 本地
        )
        await _create_run(
            db_session,
            agent_session_id=session.id,
            input_tokens=999,
            created_at=yesterday_late,
        )

        svc = RuntimeService(db_session)
        result = await svc.get_runtimes_usage("1d")

        by_rid = _by_rid(result)
        # 昨天 23:59 不在 1d 窗(本地自然日 today 00:00 起)
        if _rid_of(rt) in by_rid:
            assert by_rid[_rid_of(rt)].summary.input_tokens == 0, "昨天 23:59 的 run 不应计入 1d 窗"
        else:
            # 结果为空也符合预期(只有这一个 run 被过滤)
            assert _rid_of(rt) not in by_rid

    @pytest.mark.asyncio
    async def test_window_7d_includes_run_from_3_days_ago(self, db_session: AsyncSession) -> None:
        """7d 窗:3 天前的 run 计入(now - 7d 边界内)。"""
        user_id = await _create_user(db_session)
        rt = await _create_runtime(db_session, user_id)
        session = await _create_session(db_session, user_id=user_id, runtime_id=rt.id)

        await _create_run(
            db_session,
            agent_session_id=session.id,
            input_tokens=42,
            created_at=datetime.now(UTC) - timedelta(days=3),
        )

        svc = RuntimeService(db_session)
        result = await svc.get_runtimes_usage("7d")

        by_rid = _by_rid(result)
        assert _rid_of(rt) in by_rid
        assert by_rid[_rid_of(rt)].summary.input_tokens == 42


class TestGetRuntimesUsageNullHandling:
    """FR-05 NULL cache/cost 被 SUM(COALESCE) 归 0。"""

    @pytest.mark.asyncio
    async def test_null_tokens_sum_to_zero(self, db_session: AsyncSession) -> None:
        """cache_read/cache_creation/total_cost 全 NULL 的 run → summary 对应字段为 0。"""
        user_id = await _create_user(db_session)
        rt = await _create_runtime(db_session, user_id)
        session = await _create_session(db_session, user_id=user_id, runtime_id=rt.id)

        # 全 NULL 的 cache/cost 列,只有 input/output
        await _create_run(
            db_session,
            agent_session_id=session.id,
            input_tokens=10,
            output_tokens=20,
            cache_read_tokens=None,
            cache_creation_tokens=None,
            total_cost_usd=None,
        )

        svc = RuntimeService(db_session)
        result = await svc.get_runtimes_usage("7d")

        by_rid = _by_rid(result)
        assert _rid_of(rt) in by_rid
        summary = by_rid[_rid_of(rt)].summary
        assert summary.cache_read_tokens == 0
        assert summary.cache_creation_tokens == 0
        assert summary.total_cost_usd == 0.0

    @pytest.mark.asyncio
    async def test_orphan_run_excluded(self, db_session: AsyncSession) -> None:
        """AC-05:无 runtime 归属的 run(session+lease 均无 runtime_id)不计入。"""
        user_id = await _create_user(db_session)
        # 一个 runtime 没有任何 run
        await _create_runtime(db_session, user_id)

        # 孤儿 run:无 agent_session_id,无 lease_id
        await _create_run(
            db_session,
            agent_session_id=None,
            lease_id=None,
            input_tokens=999,
        )

        svc = RuntimeService(db_session)
        result = await svc.get_runtimes_usage("7d")

        assert result == [], "孤儿 run 应被 WHERE COALESCE IS NOT NULL 过滤掉"

    @pytest.mark.asyncio
    async def test_session_without_runtime_id_excluded(self, db_session: AsyncSession) -> None:
        """边界:run 挂了 session 但 session.runtime_id=NULL,且无 lease → COALESCE NULL 排除。"""
        user_id = await _create_user(db_session)
        session_no_rt = AgentSession(
            id=uuid.uuid4(),
            user_id=user_id,
            runtime_id=None,  # 关键:无 runtime 归属
            provider="claude_code",
            status="active",
        )
        db_session.add(session_no_rt)
        await db_session.commit()

        await _create_run(
            db_session,
            agent_session_id=session_no_rt.id,
            lease_id=None,
            input_tokens=100,
        )

        svc = RuntimeService(db_session)
        result = await svc.get_runtimes_usage("7d")

        assert result == [], "session.runtime_id=NULL 且无 lease 的 run 不计入"


class TestGetRuntimesUsageEmptyAndAggregation:
    """空窗 + 多 run 聚合。"""

    @pytest.mark.asyncio
    async def test_empty_window_returns_empty(self, db_session: AsyncSession) -> None:
        """AC-06:时间窗内无 run → 返回 [] 不抛异常。"""
        svc = RuntimeService(db_session)
        result = await svc.get_runtimes_usage("30d")
        assert result == []

    @pytest.mark.asyncio
    async def test_multiple_runs_same_runtime_aggregated(self, db_session: AsyncSession) -> None:
        """同一 runtime 多个 run → summary SUM 聚合。"""
        user_id = await _create_user(db_session)
        rt = await _create_runtime(db_session, user_id)
        session = await _create_session(db_session, user_id=user_id, runtime_id=rt.id)

        await _create_run(
            db_session,
            agent_session_id=session.id,
            input_tokens=100,
            output_tokens=50,
            cache_read_tokens=10,
            total_cost_usd=0.01,
        )
        await _create_run(
            db_session,
            agent_session_id=session.id,
            input_tokens=200,
            output_tokens=30,
            cache_creation_tokens=5,
            total_cost_usd=0.02,
        )

        svc = RuntimeService(db_session)
        result = await svc.get_runtimes_usage("7d")

        by_rid = _by_rid(result)
        assert _rid_of(rt) in by_rid
        summary = by_rid[_rid_of(rt)].summary
        assert summary.input_tokens == 300
        assert summary.output_tokens == 80
        assert summary.cache_read_tokens == 10
        assert summary.cache_creation_tokens == 5
        assert summary.total_cost_usd == pytest.approx(0.03)


class TestComputeSince:
    """D-004@v1 _compute_since 静态方法边界。"""

    def test_compute_since_1d_is_local_midnight_utc(self) -> None:
        """1d since = 本地自然日 today 00:00 转 UTC,aware。"""
        from datetime import UTC as _UTC

        since = RuntimeService._compute_since("1d")
        assert since.tzinfo is not None, "since 必须为 aware"
        # 本地午夜转 UTC:since 应等于本地 00:00 对应的 UTC 时刻
        now_local = datetime.now().astimezone()
        local_midnight = now_local.replace(hour=0, minute=0, second=0, microsecond=0)
        expected_utc = local_midnight.astimezone(_UTC)
        # 容差 1 秒(执行时间漂移)
        assert abs((since - expected_utc).total_seconds()) < 1

    def test_compute_since_7d_is_seven_days_ago(self) -> None:
        """7d since = now(UTC) - 7 天。"""
        before = datetime.now(UTC)
        since = RuntimeService._compute_since("7d")
        after = datetime.now(UTC)
        assert since.tzinfo is not None
        # since 应在 [now-7d-ε, now-7d+ε] 之间
        delta_low = (after - timedelta(days=7)) - since
        delta_high = since - (before - timedelta(days=7))
        assert delta_low.total_seconds() >= -1
        assert delta_high.total_seconds() >= -1

    def test_compute_since_30d_is_thirty_days_ago(self) -> None:
        """30d since = now(UTC) - 30 天。"""
        before = datetime.now(UTC)
        since = RuntimeService._compute_since("30d")
        after = datetime.now(UTC)
        delta_low = (after - timedelta(days=30)) - since
        delta_high = since - (before - timedelta(days=30))
        assert delta_low.total_seconds() >= -1
        assert delta_high.total_seconds() >= -1


class TestBucketUnit:
    """_bucket_unit 静态方法。"""

    def test_bucket_unit_1d_is_20min(self) -> None:
        assert RuntimeService._bucket_unit("1d") == "20min"

    def test_bucket_unit_7d_is_hour(self) -> None:
        assert RuntimeService._bucket_unit("7d") == "hour"

    def test_bucket_unit_30d_is_day(self) -> None:
        assert RuntimeService._bucket_unit("30d") == "day"
