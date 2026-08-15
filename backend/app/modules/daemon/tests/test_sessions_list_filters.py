"""task-06（change 2026-08-14-sessions-portal）``GET /sessions`` 过滤参数单测.

覆盖 FR-02 / D-003@v1：runtime_id / machine_id（经 daemon_runtimes 关联）/
provider / q（标题模糊，实现为 user_input 内容 ilike）四个过滤参数的单独
命中与不命中、组合过滤、q 特殊字符（% _ \\）字面转义、不传参数与现状一致
（零回归）、分页 + 过滤组合（total 为过滤后总数）、machine_id 对无 runtime
旧会话的边界（不匹配任何机器）。

夹具范式镜像 ``test_session_history.py``（in-memory SQLite + httpx client）。
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta

from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.agent.model import AgentRun, AgentRunLog, AgentSession
from app.modules.auth.model import User
from app.modules.daemon.model import DaemonInstance, DaemonRuntime

# ── Helpers ──────────────────────────────────────────────────────────────────


async def _get_admin(db_session: AsyncSession) -> User:
    admin = (
        (await db_session.execute(select(User).where(User.email == "admin@example.com")))
        .scalars()
        .first()
    )
    assert admin is not None
    return admin


async def _make_user(session: AsyncSession, email: str) -> User:
    from app.core.config import get_settings
    from app.core.security import password_hasher

    settings = get_settings()
    password_hasher.configure(settings.auth_bcrypt_rounds)
    user = User(
        id=uuid.uuid4(),
        email=email,
        password_hash=password_hasher.hash("Admin123!@#"),
        display_name=email.split("@")[0],
        status="active",
        is_platform_admin=True,
    )
    session.add(user)
    await session.commit()
    await session.refresh(user)
    return user


async def _make_instance(
    session: AsyncSession,
    user_id: uuid.UUID,
    hostname: str,
) -> DaemonInstance:
    inst = DaemonInstance(
        id=uuid.uuid4(),
        user_id=user_id,
        hostname=hostname,
        server_url="https://sillyhub.example.com",
        status="online",
        last_heartbeat_at=datetime.now(UTC),
    )
    session.add(inst)
    await session.commit()
    return inst


async def _make_runtime(
    session: AsyncSession,
    user_id: uuid.UUID,
    *,
    provider: str = "claude",
    instance: DaemonInstance | None = None,
) -> DaemonRuntime:
    rt = DaemonRuntime(
        id=uuid.uuid4(),
        user_id=user_id,
        daemon_instance_id=instance.id if instance else None,
        name="daemon",
        provider=provider,
        status="online",
        last_heartbeat_at=datetime.now(UTC),
    )
    session.add(rt)
    await session.commit()
    return rt


async def _make_session(
    session: AsyncSession,
    user_id: uuid.UUID,
    runtime_id: uuid.UUID | None,
    *,
    status: str = "ended",
    provider: str = "claude",
    last_active_at: datetime | None = None,
    created_at: datetime | None = None,
) -> AgentSession:
    now = datetime.now(UTC)
    sess = AgentSession(
        id=uuid.uuid4(),
        user_id=user_id,
        runtime_id=runtime_id,
        lease_id=None,
        provider=provider,
        status=status,
        agent_session_id=None,
        turn_count=1,
        created_at=created_at or now,
        last_active_at=last_active_at,
        ended_at=now if status in ("ended", "failed") else None,
    )
    session.add(sess)
    await session.commit()
    return sess


async def _make_run_with_input(
    session: AsyncSession,
    agent_session_id: uuid.UUID,
    *,
    user_inputs: list[str],
    started_at: datetime | None = None,
) -> None:
    """Seed one AgentRun whose logs carry the given user_input contents."""
    run = AgentRun(
        id=uuid.uuid4(),
        agent_type="claude_code",
        provider="claude",
        status="completed",
        agent_session_id=agent_session_id,
        session_id=None,
        started_at=started_at or datetime.now(UTC),
    )
    session.add(run)
    base = started_at or datetime.now(UTC)
    for i, content in enumerate(user_inputs):
        session.add(
            AgentRunLog(
                id=uuid.uuid4(),
                run_id=run.id,
                timestamp=base + timedelta(seconds=i),
                channel="user_input",
                content_redacted=content,
            )
        )
    await session.commit()


# ── runtime_id 过滤 ─────────────────────────────────────────────────────────


class TestRuntimeIdFilter:
    async def test_hit_and_miss(
        self,
        client: AsyncClient,
        auth_headers: dict[str, str],
        db_session: AsyncSession,
    ) -> None:
        admin = await _get_admin(db_session)
        rt_a = await _make_runtime(db_session, admin.id)
        rt_b = await _make_runtime(db_session, admin.id)
        s_a = await _make_session(db_session, admin.id, rt_a.id)
        s_b = await _make_session(db_session, admin.id, rt_b.id)

        resp = await client.get(
            "/api/daemon/sessions", params={"runtime_id": str(rt_a.id)}, headers=auth_headers
        )
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["total"] == 1
        assert [i["id"] for i in body["items"]] == [str(s_a.id)]

        # 不存在的 runtime → 空结果（不是 500）
        resp_miss = await client.get(
            "/api/daemon/sessions",
            params={"runtime_id": str(uuid.uuid4())},
            headers=auth_headers,
        )
        assert resp_miss.status_code == 200
        assert resp_miss.json()["total"] == 0
        assert str(s_b.id) not in [i["id"] for i in resp.json()["items"]]

    async def test_invalid_uuid_422(
        self, client: AsyncClient, auth_headers: dict[str, str]
    ) -> None:
        resp = await client.get(
            "/api/daemon/sessions", params={"runtime_id": "not-a-uuid"}, headers=auth_headers
        )
        assert resp.status_code == 422


# ── machine_id 过滤（join daemon_runtimes）──────────────────────────────────


class TestMachineIdFilter:
    async def test_hit_and_miss(
        self,
        client: AsyncClient,
        auth_headers: dict[str, str],
        db_session: AsyncSession,
    ) -> None:
        admin = await _get_admin(db_session)
        inst_a = await _make_instance(db_session, admin.id, "host-a")
        inst_b = await _make_instance(db_session, admin.id, "host-b")
        rt_a = await _make_runtime(db_session, admin.id, instance=inst_a)
        rt_b = await _make_runtime(db_session, admin.id, instance=inst_b)
        s_a = await _make_session(db_session, admin.id, rt_a.id)
        await _make_session(db_session, admin.id, rt_b.id)

        resp = await client.get(
            "/api/daemon/sessions", params={"machine_id": str(inst_a.id)}, headers=auth_headers
        )
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["total"] == 1
        assert [i["id"] for i in body["items"]] == [str(s_a.id)]

        # 不存在的 machine → 空结果
        resp_miss = await client.get(
            "/api/daemon/sessions",
            params={"machine_id": str(uuid.uuid4())},
            headers=auth_headers,
        )
        assert resp_miss.status_code == 200
        assert resp_miss.json()["total"] == 0

    async def test_legacy_runtime_without_instance_never_matches(
        self,
        client: AsyncClient,
        auth_headers: dict[str, str],
        db_session: AsyncSession,
    ) -> None:
        """无 runtime / runtime 未绑 instance 的旧会话不匹配任何 machine_id。"""
        admin = await _get_admin(db_session)
        inst = await _make_instance(db_session, admin.id, "host-a")
        rt_bound = await _make_runtime(db_session, admin.id, instance=inst)
        rt_legacy = await _make_runtime(db_session, admin.id)  # daemon_instance_id=None
        s_bound = await _make_session(db_session, admin.id, rt_bound.id)
        s_legacy = await _make_session(db_session, admin.id, rt_legacy.id)
        s_no_runtime = await _make_session(db_session, admin.id, None)  # runtime_id=None

        resp = await client.get(
            "/api/daemon/sessions", params={"machine_id": str(inst.id)}, headers=auth_headers
        )
        assert resp.status_code == 200, resp.text
        ids = [i["id"] for i in resp.json()["items"]]
        assert ids == [str(s_bound.id)]
        assert str(s_legacy.id) not in ids
        assert str(s_no_runtime.id) not in ids


# ── provider 过滤 ───────────────────────────────────────────────────────────


class TestProviderFilter:
    async def test_hit_and_miss(
        self,
        client: AsyncClient,
        auth_headers: dict[str, str],
        db_session: AsyncSession,
    ) -> None:
        admin = await _get_admin(db_session)
        rt = await _make_runtime(db_session, admin.id)
        s_claude = await _make_session(db_session, admin.id, rt.id, provider="claude")
        await _make_session(db_session, admin.id, rt.id, provider="codex")

        resp = await client.get(
            "/api/daemon/sessions", params={"provider": "claude"}, headers=auth_headers
        )
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["total"] == 1
        assert [i["id"] for i in body["items"]] == [str(s_claude.id)]

    async def test_unknown_provider_422(
        self, client: AsyncClient, auth_headers: dict[str, str]
    ) -> None:
        resp = await client.get(
            "/api/daemon/sessions", params={"provider": "gpt"}, headers=auth_headers
        )
        assert resp.status_code == 422


# ── q 标题模糊过滤 ──────────────────────────────────────────────────────────


class TestQFilter:
    async def test_hit_case_insensitive_and_miss(
        self,
        client: AsyncClient,
        auth_headers: dict[str, str],
        db_session: AsyncSession,
    ) -> None:
        admin = await _get_admin(db_session)
        rt = await _make_runtime(db_session, admin.id)
        s_hit = await _make_session(db_session, admin.id, rt.id)
        await _make_run_with_input(db_session, s_hit.id, user_inputs=["Refactor the Login module"])
        s_miss = await _make_session(db_session, admin.id, rt.id)
        await _make_run_with_input(db_session, s_miss.id, user_inputs=["写个部署脚本"])

        resp = await client.get("/api/daemon/sessions", params={"q": "login"}, headers=auth_headers)
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["total"] == 1
        assert [i["id"] for i in body["items"]] == [str(s_hit.id)]

    async def test_matches_later_user_input_too(
        self,
        client: AsyncClient,
        auth_headers: dict[str, str],
        db_session: AsyncSession,
    ) -> None:
        """q 语义 = user_input 内容搜索（title 的超集）：后续轮输入同样命中。"""
        admin = await _get_admin(db_session)
        rt = await _make_runtime(db_session, admin.id)
        s = await _make_session(db_session, admin.id, rt.id)
        await _make_run_with_input(
            db_session, s.id, user_inputs=["先看下现状", "现在开始做性能优化"]
        )

        resp = await client.get(
            "/api/daemon/sessions", params={"q": "性能优化"}, headers=auth_headers
        )
        assert resp.status_code == 200
        assert resp.json()["total"] == 1

    async def test_non_user_input_channel_not_matched(
        self,
        client: AsyncClient,
        auth_headers: dict[str, str],
        db_session: AsyncSession,
    ) -> None:
        """关键词只出现在 assistant/stdout 日志 → 不命中（q 只搜 user_input）。"""
        admin = await _get_admin(db_session)
        rt = await _make_runtime(db_session, admin.id)
        s = await _make_session(db_session, admin.id, rt.id)
        run = AgentRun(
            id=uuid.uuid4(),
            agent_type="claude_code",
            provider="claude",
            status="completed",
            agent_session_id=s.id,
            session_id=None,
            started_at=datetime.now(UTC),
        )
        db_session.add(run)
        db_session.add(
            AgentRunLog(
                id=uuid.uuid4(),
                run_id=run.id,
                timestamp=datetime.now(UTC),
                channel="stdout",
                content_redacted="Refactor the Login module",
            )
        )
        await db_session.commit()

        resp = await client.get("/api/daemon/sessions", params={"q": "login"}, headers=auth_headers)
        assert resp.status_code == 200
        assert resp.json()["total"] == 0

    async def test_special_chars_percent_literal(
        self,
        client: AsyncClient,
        auth_headers: dict[str, str],
        db_session: AsyncSession,
    ) -> None:
        """q 含 % 按字面匹配：『100%』命中『100% done』，不当作通配匹配『1000 done』。"""
        admin = await _get_admin(db_session)
        rt = await _make_runtime(db_session, admin.id)
        s_pct = await _make_session(db_session, admin.id, rt.id)
        await _make_run_with_input(db_session, s_pct.id, user_inputs=["进度 100% done"])
        s_num = await _make_session(db_session, admin.id, rt.id)
        await _make_run_with_input(db_session, s_num.id, user_inputs=["进度 1000 done"])

        resp = await client.get("/api/daemon/sessions", params={"q": "100%"}, headers=auth_headers)
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["total"] == 1
        assert [i["id"] for i in body["items"]] == [str(s_pct.id)]

    async def test_special_chars_underscore_literal(
        self,
        client: AsyncClient,
        auth_headers: dict[str, str],
        db_session: AsyncSession,
    ) -> None:
        """q 含 _ 按字面匹配：『task_01』不匹配『taskX01』（_ 不作单字通配）。"""
        admin = await _get_admin(db_session)
        rt = await _make_runtime(db_session, admin.id)
        s_us = await _make_session(db_session, admin.id, rt.id)
        await _make_run_with_input(db_session, s_us.id, user_inputs=["fix task_01 bug"])
        s_x = await _make_session(db_session, admin.id, rt.id)
        await _make_run_with_input(db_session, s_x.id, user_inputs=["fix taskX01 bug"])

        resp = await client.get(
            "/api/daemon/sessions", params={"q": "task_01"}, headers=auth_headers
        )
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["total"] == 1
        assert [i["id"] for i in body["items"]] == [str(s_us.id)]

    async def test_empty_q_same_as_no_filter(
        self,
        client: AsyncClient,
        auth_headers: dict[str, str],
        db_session: AsyncSession,
    ) -> None:
        admin = await _get_admin(db_session)
        rt = await _make_runtime(db_session, admin.id)
        await _make_session(db_session, admin.id, rt.id)
        await _make_session(db_session, admin.id, rt.id)

        resp = await client.get("/api/daemon/sessions", params={"q": ""}, headers=auth_headers)
        assert resp.status_code == 200
        assert resp.json()["total"] == 2

    async def test_q_too_long_422(self, client: AsyncClient, auth_headers: dict[str, str]) -> None:
        resp = await client.get(
            "/api/daemon/sessions", params={"q": "x" * 101}, headers=auth_headers
        )
        assert resp.status_code == 422


# ── 组合过滤 + 分页 + 零回归 ─────────────────────────────────────────────────


class TestCombinedAndPaging:
    async def test_combined_filters(
        self,
        client: AsyncClient,
        auth_headers: dict[str, str],
        db_session: AsyncSession,
    ) -> None:
        admin = await _get_admin(db_session)
        inst = await _make_instance(db_session, admin.id, "host-a")
        rt_claude = await _make_runtime(db_session, admin.id, provider="claude", instance=inst)
        rt_codex = await _make_runtime(db_session, admin.id, provider="codex", instance=inst)

        s_target = await _make_session(
            db_session, admin.id, rt_claude.id, status="active", provider="claude"
        )
        await _make_run_with_input(db_session, s_target.id, user_inputs=["重构登录模块"])
        # 各差一个维度：同机同引擎但 ended / 同机 active 但 codex / 同状态同引擎但另一机
        await _make_session(db_session, admin.id, rt_claude.id, status="ended", provider="claude")
        await _make_session(db_session, admin.id, rt_codex.id, status="active", provider="codex")
        inst_b = await _make_instance(db_session, admin.id, "host-b")
        rt_claude_b = await _make_runtime(db_session, admin.id, provider="claude", instance=inst_b)
        s_other_machine = await _make_session(
            db_session, admin.id, rt_claude_b.id, status="active", provider="claude"
        )
        await _make_run_with_input(db_session, s_other_machine.id, user_inputs=["重构登录模块"])

        resp = await client.get(
            "/api/daemon/sessions",
            params={
                "status": "active",
                "machine_id": str(inst.id),
                "provider": "claude",
                "q": "登录",
            },
            headers=auth_headers,
        )
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["total"] == 1
        assert [i["id"] for i in body["items"]] == [str(s_target.id)]

    async def test_runtime_id_combined_with_q(
        self,
        client: AsyncClient,
        auth_headers: dict[str, str],
        db_session: AsyncSession,
    ) -> None:
        admin = await _get_admin(db_session)
        rt_a = await _make_runtime(db_session, admin.id)
        rt_b = await _make_runtime(db_session, admin.id)
        s_a = await _make_session(db_session, admin.id, rt_a.id)
        await _make_run_with_input(db_session, s_a.id, user_inputs=["部署到生产"])
        s_b = await _make_session(db_session, admin.id, rt_b.id)
        await _make_run_with_input(db_session, s_b.id, user_inputs=["部署到测试"])

        resp = await client.get(
            "/api/daemon/sessions",
            params={"runtime_id": str(rt_b.id), "q": "部署"},
            headers=auth_headers,
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["total"] == 1
        assert [i["id"] for i in body["items"]] == [str(s_b.id)]

    async def test_paging_after_filter_total_is_filtered_count(
        self,
        client: AsyncClient,
        auth_headers: dict[str, str],
        db_session: AsyncSession,
    ) -> None:
        """过滤后 total 为命中总数，limit/offset 作用于过滤结果（R-04 真分页）。"""
        admin = await _get_admin(db_session)
        rt_claude = await _make_runtime(db_session, admin.id, provider="claude")
        rt_codex = await _make_runtime(db_session, admin.id, provider="codex")
        base = datetime.now(UTC)
        matched_ids = []
        for i in range(3):
            s = await _make_session(
                db_session,
                admin.id,
                rt_claude.id,
                status="ended",
                provider="claude",
                last_active_at=base - timedelta(minutes=i),
            )
            matched_ids.append(str(s.id))
        # 1 个 codex 会话不参与 provider=claude 分页
        await _make_session(db_session, admin.id, rt_codex.id, provider="codex")

        resp1 = await client.get(
            "/api/daemon/sessions",
            params={"provider": "claude", "limit": 2, "offset": 0},
            headers=auth_headers,
        )
        assert resp1.status_code == 200
        body1 = resp1.json()
        assert body1["total"] == 3
        assert [i["id"] for i in body1["items"]] == matched_ids[:2]

        resp2 = await client.get(
            "/api/daemon/sessions",
            params={"provider": "claude", "limit": 2, "offset": 2},
            headers=auth_headers,
        )
        assert resp2.status_code == 200
        body2 = resp2.json()
        assert body2["total"] == 3
        assert [i["id"] for i in body2["items"]] == matched_ids[2:]

    async def test_no_filters_matches_baseline(
        self,
        client: AsyncClient,
        auth_headers: dict[str, str],
        db_session: AsyncSession,
    ) -> None:
        """不传任何过滤参数 = 现状查询（owner 全量 + 软删过滤 + 稳定排序）。"""
        admin = await _get_admin(db_session)
        other = await _make_user(db_session, f"other-{uuid.uuid4()}@example.com")
        rt = await _make_runtime(db_session, admin.id)
        rt_other = await _make_runtime(db_session, other.id)
        expected = [
            (await _make_session(db_session, admin.id, rt.id, status="ended")).id,
            (await _make_session(db_session, admin.id, rt.id, status="active")).id,
            (await _make_session(db_session, admin.id, None)).id,  # 旧会话无 runtime
        ]
        await _make_session(db_session, other.id, rt_other.id)  # 他人会话不泄漏

        resp = await client.get("/api/daemon/sessions", headers=auth_headers)
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["total"] == 3
        assert sorted(i["id"] for i in body["items"]) == sorted(str(x) for x in expected)
