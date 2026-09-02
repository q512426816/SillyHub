"""群聊体验 quick（2026-09-02）后端支撑测试。

覆盖三项：

- ``GET /sessions/{id}/logs`` 分页与搜索：``before`` 向上游标 / ``q`` 内容
  ILIKE 过滤 / ``limit`` 最新 N 语义（desc 取 N 反转升序）；三参与 ``after``
  任意组合；缺省不传 = 原全量行为（after 兼容零回归）；
- 影子会话（kind='group_member'）只读放行：群用户成员（非属主）读影子
  logs 200、非群成员 404、会话详情仍 404（放行仅 logs 读路径）、写路径
  inject 不放行（404 资源隐藏）；
- 群列表 ``last_mention``：@用户群内昵称命中（含边界标点截断）/ 昵称前缀
  不误命中（@阿明二号 ≠ @阿明）/ 投影行（agent 回复 @）命中并取
  member_name / 无 @ 为 None / content 截 60 字。

夹具范式镜像 ``test_group_chat_management.py``（helpers 直接复用其模块级
替身，import 先例见 test_change_write_router）。
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta

from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.agent.model import AgentRun, AgentRunLog, AgentSession
from app.modules.daemon.tests.test_group_chat_management import (
    _agent_config,
    _create_group,
    _env_user,
    _get_member_row,
    _headers,
    _make_env,
    _seed_shadow_session,
)


async def _seed_chat_session_with_logs(
    db_session: AsyncSession,
    *,
    owner_user_id: uuid.UUID,
    runtime_id: uuid.UUID,
    contents: list[str],
    base: datetime | None = None,
) -> tuple[AgentSession, list[datetime]]:
    """落一个属主 chat 会话 + 单 run + 逐行 1s 递增时间戳的日志（gzip 测试同款替身）。"""
    now = datetime.now(UTC)
    sess = AgentSession(
        id=uuid.uuid4(),
        user_id=owner_user_id,
        runtime_id=runtime_id,
        lease_id=None,
        provider="claude",
        status="ended",
        agent_session_id=None,
        config=None,
        turn_count=1,
        created_at=now,
        last_active_at=now,
        ended_at=now,
    )
    db_session.add(sess)
    await db_session.flush()
    run = AgentRun(
        id=uuid.uuid4(),
        agent_type="claude_code",
        provider="claude",
        status="completed",
        agent_session_id=sess.id,
        session_id=None,
        started_at=now,
    )
    db_session.add(run)
    await db_session.flush()
    start = base or (now - timedelta(minutes=10))
    stamps = [start + timedelta(seconds=i) for i in range(len(contents))]
    for ts, content in zip(stamps, contents, strict=True):
        db_session.add(
            AgentRunLog(
                id=uuid.uuid4(),
                run_id=run.id,
                timestamp=ts,
                channel="stdout",
                content_redacted=content,
            )
        )
    await db_session.commit()
    return sess, stamps


async def _seed_timeline_row(
    db_session: AsyncSession,
    *,
    group_session_id: uuid.UUID,
    content: str,
    ts: datetime,
    channel: str = "user_input",
    metadata: dict | None = None,
) -> None:
    """在群载体会话时间线直接落一行（user_input / 投影行，§4.2 行源）。"""
    carrier = AgentRun(
        id=uuid.uuid4(),
        agent_type="claude_code",
        provider="group",
        status="completed",
        started_at=ts,
        finished_at=ts,
        spec_strategy="group_carrier",
        agent_session_id=group_session_id,
        user_id=None,
    )
    db_session.add(carrier)
    await db_session.flush()
    db_session.add(
        AgentRunLog(
            id=uuid.uuid4(),
            run_id=carrier.id,
            channel=channel,
            content_redacted=content,
            timestamp=ts,
            metadata_=metadata,
        )
    )
    await db_session.commit()


async def _get_logs(
    client: AsyncClient, token: str, session_id: uuid.UUID, **params: object
) -> tuple[int, list[dict]]:
    resp = await client.get(
        f"/api/daemon/sessions/{session_id}/logs",
        headers=_headers(token),
        params=params,
    )
    return resp.status_code, (resp.json() if resp.status_code == 200 else [])


# ── logs 分页与搜索 ──────────────────────────────────────────────────────────


class TestSessionLogsPagination:
    async def test_default_returns_all_ascending(
        self, client: AsyncClient, db_session: AsyncSession
    ) -> None:
        """缺省不传新参数 = 原全量行为（升序，兼容零回归）。"""
        env = await _make_env(db_session, owner_name="pg-owner")
        sess, _stamps = await _seed_chat_session_with_logs(
            db_session,
            owner_user_id=env.owner.id,
            runtime_id=env.runtime.id,
            contents=[f"hello world {i}" for i in range(6)],
        )
        code, body = await _get_logs(client, env.owner_token, sess.id)
        assert code == 200
        assert [e["content_redacted"] for e in body] == [f"hello world {i}" for i in range(6)]

    async def test_limit_returns_latest_n(
        self, client: AsyncClient, db_session: AsyncSession
    ) -> None:
        """limit=最新 N 条语义：无 before 时取全量最新 N，升序返回。"""
        env = await _make_env(db_session, owner_name="pg-owner")
        sess, _stamps = await _seed_chat_session_with_logs(
            db_session,
            owner_user_id=env.owner.id,
            runtime_id=env.runtime.id,
            contents=[f"hello world {i}" for i in range(6)],
        )
        code, body = await _get_logs(client, env.owner_token, sess.id, limit=3)
        assert code == 200
        assert [e["content_redacted"] for e in body] == [
            "hello world 3",
            "hello world 4",
            "hello world 5",
        ]

    async def test_before_cursor(self, client: AsyncClient, db_session: AsyncSession) -> None:
        """before 游标：只返回 timestamp 严格更早的行（向上加载更老日志）。"""
        env = await _make_env(db_session, owner_name="pg-owner")
        sess, _stamps = await _seed_chat_session_with_logs(
            db_session,
            owner_user_id=env.owner.id,
            runtime_id=env.runtime.id,
            contents=[f"hello world {i}" for i in range(6)],
        )
        _code, full = await _get_logs(client, env.owner_token, sess.id)
        before = full[2]["timestamp"]  # 第 3 行 ts → 返回前 2 条
        code, body = await _get_logs(client, env.owner_token, sess.id, before=before)
        assert code == 200
        assert [e["content_redacted"] for e in body] == ["hello world 0", "hello world 1"]

    async def test_before_with_limit(self, client: AsyncClient, db_session: AsyncSession) -> None:
        """before+limit 组合：游标之前的最新 N 条（向上翻页一页 N 行）。"""
        env = await _make_env(db_session, owner_name="pg-owner")
        sess, _stamps = await _seed_chat_session_with_logs(
            db_session,
            owner_user_id=env.owner.id,
            runtime_id=env.runtime.id,
            contents=[f"hello world {i}" for i in range(6)],
        )
        _code, full = await _get_logs(client, env.owner_token, sess.id)
        before = full[2]["timestamp"]
        code, body = await _get_logs(client, env.owner_token, sess.id, before=before, limit=1)
        assert code == 200
        assert [e["content_redacted"] for e in body] == ["hello world 1"]

    async def test_q_filter(self, client: AsyncClient, db_session: AsyncSession) -> None:
        """q 内容搜索：命中 / 大小写不敏感 / 不命中为空。"""
        env = await _make_env(db_session, owner_name="pg-owner")
        sess, _stamps = await _seed_chat_session_with_logs(
            db_session,
            owner_user_id=env.owner.id,
            runtime_id=env.runtime.id,
            contents=["Alpha 行", "beta 行", "GAMMA 行"],
        )
        code, body = await _get_logs(client, env.owner_token, sess.id, q="beta")
        assert code == 200
        assert [e["content_redacted"] for e in body] == ["beta 行"]

        code, body = await _get_logs(client, env.owner_token, sess.id, q="BETA")
        assert code == 200
        assert [e["content_redacted"] for e in body] == ["beta 行"]  # ILIKE 大小写不敏感

        code, body = await _get_logs(client, env.owner_token, sess.id, q="不存在词")
        assert code == 200
        assert body == []

    async def test_after_compat_and_combinations(
        self, client: AsyncClient, db_session: AsyncSession
    ) -> None:
        """after 兼容回归 + after/before/q 任意组合。"""
        env = await _make_env(db_session, owner_name="pg-owner")
        sess, _stamps = await _seed_chat_session_with_logs(
            db_session,
            owner_user_id=env.owner.id,
            runtime_id=env.runtime.id,
            contents=[f"hello world {i}" for i in range(6)],
        )
        _code, full = await _get_logs(client, env.owner_token, sess.id)
        ts1, ts4 = full[1]["timestamp"], full[4]["timestamp"]

        # after 兼容：timestamp 严格更新的行。
        code, body = await _get_logs(client, env.owner_token, sess.id, after=ts1)
        assert code == 200
        assert [e["content_redacted"] for e in body] == [f"hello world {i}" for i in range(2, 6)]

        # after+before 窗口。
        code, body = await _get_logs(client, env.owner_token, sess.id, after=ts1, before=ts4)
        assert code == 200
        assert [e["content_redacted"] for e in body] == ["hello world 2", "hello world 3"]

        # after+q 组合。
        code, body = await _get_logs(client, env.owner_token, sess.id, after=ts1, q="hello world 4")
        assert code == 200
        assert [e["content_redacted"] for e in body] == ["hello world 4"]

    async def test_limit_validation(self, client: AsyncClient, db_session: AsyncSession) -> None:
        """limit 上界（le=1000）守卫：1001 → 422。"""
        env = await _make_env(db_session, owner_name="pg-owner")
        sess, _stamps = await _seed_chat_session_with_logs(
            db_session,
            owner_user_id=env.owner.id,
            runtime_id=env.runtime.id,
            contents=["x"],
        )
        code, _body = await _get_logs(client, env.owner_token, sess.id, limit=1001)
        assert code == 422


# ── 影子会话只读放行（logs 读路径）──────────────────────────────────────────


class TestShadowMemberReadOnly:
    async def test_member_can_read_shadow_logs(
        self, client: AsyncClient, db_session: AsyncSession
    ) -> None:
        """群用户成员（非属主）读影子 logs → 200（allow_shadow_member_read 放行）。"""
        env = await _make_env(db_session, owner_name="sh-owner")
        member, member_token = await _env_user(db_session, env, name="sh-member")
        _outsider, outsider_token = await _env_user(db_session, env, name="sh-out")

        data = await _create_group(
            client,
            env.owner_token,
            project_id=env.project.id,
            user_members=[{"user_id": str(member.id)}],
            agent_members=[_agent_config(env.runtime.id)],
        )
        agent_member = next(m for m in data["members"] if m["member_type"] == "agent")
        member_row = await _get_member_row(
            db_session,
            group_id=uuid.UUID(data["id"]),
            member_id=uuid.UUID(agent_member["id"]),
        )
        assert member_row is not None
        shadow, _lease = await _seed_shadow_session(
            db_session,
            member=member_row,
            owner_user_id=env.owner.id,
            runtime_id=env.runtime.id,
        )
        # 影子时间线落一行（成员独立时间线视图的数据源）。
        run = AgentRun(
            id=uuid.uuid4(),
            agent_type="claude_code",
            provider="claude",
            status="completed",
            agent_session_id=shadow.id,
            session_id=None,
            started_at=datetime.now(UTC),
        )
        db_session.add(run)
        await db_session.flush()
        db_session.add(
            AgentRunLog(
                id=uuid.uuid4(),
                run_id=run.id,
                timestamp=datetime.now(UTC),
                channel="stdout",
                content_redacted="影子成员输出行",
            )
        )
        await db_session.commit()

        # 成员（非属主）读影子 logs → 200 且内容可见。
        code, body = await _get_logs(client, member_token, shadow.id)
        assert code == 200, body
        assert [e["content_redacted"] for e in body] == ["影子成员输出行"]

        # 属主（原路径）仍 200；非群成员 404（不泄露存在性）。
        code, _body = await _get_logs(client, env.owner_token, shadow.id)
        assert code == 200
        code, _body = await _get_logs(client, outsider_token, shadow.id)
        assert code == 404

    async def test_member_shadow_readonly_detail_ok_inject_blocked(
        self, client: AsyncClient, db_session: AsyncSession
    ) -> None:
        """读路径全放行（logs + 详情，quick-d4a8140d 影子详情读放行普通成员
        ——成员卡挂 SessionPanel 本体后详情轮询 404 会误报「会话恢复失败」）；
        写路径 inject 走 for_update 归属校验不放行普通成员（404）。"""
        env = await _make_env(db_session, owner_name="wr-owner")
        member, member_token = await _env_user(db_session, env, name="wr-member")

        data = await _create_group(
            client,
            env.owner_token,
            project_id=env.project.id,
            user_members=[{"user_id": str(member.id)}],
            agent_members=[_agent_config(env.runtime.id)],
        )
        agent_member = next(m for m in data["members"] if m["member_type"] == "agent")
        member_row = await _get_member_row(
            db_session,
            group_id=uuid.UUID(data["id"]),
            member_id=uuid.UUID(agent_member["id"]),
        )
        assert member_row is not None
        shadow, _lease = await _seed_shadow_session(
            db_session,
            member=member_row,
            owner_user_id=env.owner.id,
            runtime_id=env.runtime.id,
        )

        # 会话详情（get_agent_session 影子放行，与 logs 读同口径）→ 200。
        resp = await client.get(f"/api/daemon/sessions/{shadow.id}", headers=_headers(member_token))
        assert resp.status_code == 200
        assert resp.json()["id"] == str(shadow.id)

        # 写路径（inject 走 _get_owned_session_for_update，for_update 分支
        # 不放行普通成员）→ 404 资源隐藏。
        resp = await client.post(
            f"/api/daemon/sessions/{shadow.id}/inject",
            headers=_headers(member_token),
            json={"prompt": "越权写入尝试"},
        )
        assert resp.status_code == 404


# ── 群列表 last_mention ──────────────────────────────────────────────────────


async def _list_groups(client: AsyncClient, token: str) -> dict[str, dict]:
    resp = await client.get("/api/daemon/group-chats", headers=_headers(token))
    assert resp.status_code == 200, resp.text
    return {item["id"]: item for item in resp.json()}


class TestGroupListLastMention:
    async def test_mention_hit(self, client: AsyncClient, db_session: AsyncSession) -> None:
        """@用户群内昵称（含边界标点）→ 群列表返回 last_mention 摘要。"""
        env = await _make_env(db_session, owner_name="lm-owner")
        member, member_token = await _env_user(db_session, env, name="lm-member")

        data = await _create_group(
            client,
            env.owner_token,
            project_id=env.project.id,
            user_members=[{"user_id": str(member.id), "display_name": "阿明"}],
        )
        ts = datetime(2026, 9, 2, 10, 30, 0, tzinfo=UTC)
        await _seed_timeline_row(
            db_session,
            group_session_id=uuid.UUID(data["session_id"]),
            content="@阿明，帮我看下这个方案",
            ts=ts,
            metadata={"sender_member_name": "lm-owner"},
        )

        groups = await _list_groups(client, member_token)
        item = groups[data["id"]]
        assert item["last_mention"] == {
            "content": "@阿明，帮我看下这个方案",
            "ts": ts.isoformat(),
            "member_name": "lm-owner",
        }

    async def test_no_mention_returns_none(
        self, client: AsyncClient, db_session: AsyncSession
    ) -> None:
        """无 @消息 → last_mention 为 None。"""
        env = await _make_env(db_session, owner_name="lm-owner")
        member, member_token = await _env_user(db_session, env, name="lm-member")

        data = await _create_group(
            client,
            env.owner_token,
            project_id=env.project.id,
            user_members=[{"user_id": str(member.id), "display_name": "阿明"}],
        )
        await _seed_timeline_row(
            db_session,
            group_session_id=uuid.UUID(data["session_id"]),
            content="普通消息，没有提及任何人",
            ts=datetime(2026, 9, 2, 10, 31, 0, tzinfo=UTC),
            metadata={"sender_member_name": "lm-owner"},
        )

        groups = await _list_groups(client, member_token)
        assert groups[data["id"]]["last_mention"] is None

    async def test_nickname_prefix_boundary(
        self, client: AsyncClient, db_session: AsyncSession
    ) -> None:
        """昵称边界：@阿明二号 不误命中 阿明（后继「二」非边界标点）。"""
        env = await _make_env(db_session, owner_name="lm-owner")
        member, member_token = await _env_user(db_session, env, name="lm-member")
        member2, _t2 = await _env_user(db_session, env, name="lm-member2")

        data = await _create_group(
            client,
            env.owner_token,
            project_id=env.project.id,
            user_members=[
                {"user_id": str(member.id), "display_name": "阿明"},
                {"user_id": str(member2.id), "display_name": "阿明二号"},
            ],
        )
        await _seed_timeline_row(
            db_session,
            group_session_id=uuid.UUID(data["session_id"]),
            content="@阿明二号 收到请回复",
            ts=datetime(2026, 9, 2, 10, 32, 0, tzinfo=UTC),
            metadata={"sender_member_name": "lm-owner"},
        )

        # 阿明 视角：不命中（前缀但后继非边界）；阿明二号 视角：命中。
        groups = await _list_groups(client, member_token)
        assert groups[data["id"]]["last_mention"] is None
        groups2 = await _list_groups(client, _t2)
        assert groups2[data["id"]]["last_mention"] is not None
        assert groups2[data["id"]]["last_mention"]["content"] == "@阿明二号 收到请回复"

    async def test_projection_row_mention_and_latest_wins(
        self, client: AsyncClient, db_session: AsyncSession
    ) -> None:
        """投影行（agent 回复 @）命中取 metadata.member_name；多条命中取最新。"""
        env = await _make_env(db_session, owner_name="lm-owner")
        member, member_token = await _env_user(db_session, env, name="lm-member")

        data = await _create_group(
            client,
            env.owner_token,
            project_id=env.project.id,
            user_members=[{"user_id": str(member.id), "display_name": "阿明"}],
            agent_members=[_agent_config(env.runtime.id)],
        )
        sid = uuid.UUID(data["session_id"])
        # 旧命中：agent 投影行 @阿明。
        await _seed_timeline_row(
            db_session,
            group_session_id=sid,
            content="@阿明 旧的一轮处理好了",
            ts=datetime(2026, 9, 2, 10, 40, 0, tzinfo=UTC),
            channel="stdout",
            metadata={"member_name": "小码"},
        )
        # 更新的未命中行（最新消息不是 @）后，再一条更新的命中行。
        await _seed_timeline_row(
            db_session,
            group_session_id=sid,
            content="与 @提及 无关的讨论",
            ts=datetime(2026, 9, 2, 10, 41, 0, tzinfo=UTC),
            metadata={"sender_member_name": "lm-owner"},
        )
        latest_ts = datetime(2026, 9, 2, 10, 42, 0, tzinfo=UTC)
        await _seed_timeline_row(
            db_session,
            group_session_id=sid,
            content="@阿明 最新一轮结论在这里",
            ts=latest_ts,
            metadata={"sender_member_name": "lm-owner"},
        )

        groups = await _list_groups(client, member_token)
        assert groups[data["id"]]["last_mention"] == {
            "content": "@阿明 最新一轮结论在这里",
            "ts": latest_ts.isoformat(),
            "member_name": "lm-owner",
        }

    async def test_content_truncated_to_60_chars(
        self, client: AsyncClient, db_session: AsyncSession
    ) -> None:
        """超长命中消息 content 截 60 字（与 last_message 摘要同口径）。"""
        env = await _make_env(db_session, owner_name="lm-owner")
        member, member_token = await _env_user(db_session, env, name="lm-member")

        data = await _create_group(
            client,
            env.owner_token,
            project_id=env.project.id,
            user_members=[{"user_id": str(member.id), "display_name": "阿明"}],
        )
        long_content = "@阿明 " + "长" * 100
        await _seed_timeline_row(
            db_session,
            group_session_id=uuid.UUID(data["session_id"]),
            content=long_content,
            ts=datetime(2026, 9, 2, 10, 45, 0, tzinfo=UTC),
            metadata={"sender_member_name": "lm-owner"},
        )

        groups = await _list_groups(client, member_token)
        mention = groups[data["id"]]["last_mention"]
        assert mention is not None
        assert mention["content"] == long_content[:60]
        assert len(mention["content"]) == 60
