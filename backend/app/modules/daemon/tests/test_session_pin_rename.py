"""task-06（2026-09-07-session-pin-rename-scheduled-send）：置顶/取消置顶/重命名端点测试.

覆盖 FR-01 / FR-02 / FR-03 / FR-06（design §接口定义·测试清单）：

- pin/unpin：204 往返 + ``publish_sessions_changed("status_changed", ...)`` 广播
  断言（FR-06 SSE 多端秒级同步，捕获桩镜像 test_session_review_fixes.py）；
- 幂等：已置顶再 pin 仍 204 但**不刷新 pinned_at**、零发布；未置顶 unpin 同理；
- 归属 404：非属主与不存在同形 404（不泄露存在性，对齐 archive 口径）；
- 排序（D-002@v1 分组内置顶）：置顶行排服务端返回序最前；多置顶之间按
  最近活跃排（前端分组桶保序插入 → 分组内置顶语义）；
- rename：strip 落库 + 列表标题 title 优先派生；空 / 超 255 → 422 不落库；
  同值重命名 204 幂等零广播（task-02 留的口径）。

HTTP 层范式镜像 test_sessions_list_filters.py（in-memory SQLite + httpx client）。
"""

from __future__ import annotations

import asyncio
import uuid
from datetime import UTC, datetime, timedelta

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.agent.model import AgentRun, AgentRunLog, AgentSession
from app.modules.auth.model import User
from app.modules.daemon.model import DaemonRuntime

# ── Helpers（镜像 test_sessions_list_filters.py 造数范式）───────────────────


async def _get_admin(db_session: AsyncSession) -> User:
    admin = (
        (await db_session.execute(select(User).where(User.email == "admin@example.com")))
        .scalars()
        .first()
    )
    assert admin is not None
    return admin


async def _make_user(db: AsyncSession, email: str) -> User:
    user = User(
        id=uuid.uuid4(),
        email=email,
        password_hash="x",
        display_name=email.split("@")[0],
        status="active",
    )
    db.add(user)
    await db.commit()
    return user


async def _make_runtime(db: AsyncSession, user_id: uuid.UUID) -> DaemonRuntime:
    rt = DaemonRuntime(
        id=uuid.uuid4(),
        user_id=user_id,
        name="daemon",
        provider="claude",
        status="online",
        last_heartbeat_at=datetime.now(UTC),
    )
    db.add(rt)
    await db.commit()
    return rt


async def _make_session(
    db: AsyncSession,
    user_id: uuid.UUID,
    runtime_id: uuid.UUID | None,
    *,
    status: str = "active",
    last_active_at: datetime | None = None,
) -> AgentSession:
    now = datetime.now(UTC)
    sess = AgentSession(
        id=uuid.uuid4(),
        user_id=user_id,
        runtime_id=runtime_id,
        lease_id=None,
        provider="claude",
        status=status,
        agent_session_id=None,
        turn_count=1,
        created_at=now,
        last_active_at=last_active_at,
        ended_at=now if status in ("ended", "failed") else None,
    )
    db.add(sess)
    await db.commit()
    return sess


async def _make_run_with_input(
    db: AsyncSession,
    agent_session_id: uuid.UUID,
    *,
    user_inputs: list[str],
) -> None:
    """Seed one completed AgentRun whose logs carry the given user_input contents."""
    run = AgentRun(
        id=uuid.uuid4(),
        agent_type="claude_code",
        provider="claude",
        status="completed",
        agent_session_id=agent_session_id,
        session_id=None,
        started_at=datetime.now(UTC),
    )
    db.add(run)
    base = datetime.now(UTC)
    for i, content in enumerate(user_inputs):
        db.add(
            AgentRunLog(
                id=uuid.uuid4(),
                run_id=run.id,
                timestamp=base + timedelta(seconds=i),
                channel="user_input",
                content_redacted=content,
            )
        )
    await db.commit()


def _capture_publish(monkeypatch: pytest.MonkeyPatch) -> list[tuple]:
    """捕获 service 层 ``publish_sessions_changed`` 调用（镜像 review_fixes 先例）。

    HTTP 请求内的 SessionService 经模块全局符号调用本函数，monkeypatch 后即走桩。
    """
    calls: list[tuple] = []

    async def _fake_publish(event, session_id, user_id, **kwargs):
        calls.append((event, session_id, user_id))

    monkeypatch.setattr(
        "app.modules.daemon.session.service.publish_sessions_changed", _fake_publish
    )
    return calls


async def _session_row(db: AsyncSession, session_id: uuid.UUID) -> tuple:
    """列级直查（绕开 identity map——HTTP 请求经共享连接已 commit）。"""
    return (
        await db.execute(
            select(AgentSession.pinned_at, AgentSession.title).where(AgentSession.id == session_id)
        )
    ).one()


async def _list_ids(
    client: AsyncClient, auth_headers: dict[str, str]
) -> list[tuple[str, str | None]]:
    """GET /sessions → [(id, pinned_at)]（服务端返回序即前端分组桶插入序）。"""
    resp = await client.get("/api/daemon/sessions", params={"limit": 50}, headers=auth_headers)
    assert resp.status_code == 200, resp.text
    return [(i["id"], i["pinned_at"]) for i in resp.json()["items"]]


async def _list_items(client: AsyncClient, auth_headers: dict[str, str]) -> dict[uuid.UUID, dict]:
    """GET /sessions → {session_id: item}（title 断言用）。"""
    resp = await client.get("/api/daemon/sessions", params={"limit": 50}, headers=auth_headers)
    assert resp.status_code == 200, resp.text
    return {uuid.UUID(i["id"]): i for i in resp.json()["items"]}


# ── pin / unpin：往返 + SSE 广播 + 幂等 + 归属 404 ──────────────────────────


class TestPinUnpin:
    async def test_pin_unpin_roundtrip_publishes_status_changed(
        self,
        client: AsyncClient,
        auth_headers: dict[str, str],
        db_session: AsyncSession,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        """pin → 204 + pinned_at 落库 + status_changed 广播；unpin 对称清空再广播。"""
        admin = await _get_admin(db_session)
        rt = await _make_runtime(db_session, admin.id)
        sess = await _make_session(db_session, admin.id, rt.id)
        calls = _capture_publish(monkeypatch)

        resp = await client.patch(f"/api/daemon/sessions/{sess.id}/pin", headers=auth_headers)
        assert resp.status_code == 204, resp.text
        assert calls == [("status_changed", sess.id, admin.id)]
        pinned_at, _ = await _session_row(db_session, sess.id)
        assert pinned_at is not None

        resp_un = await client.patch(f"/api/daemon/sessions/{sess.id}/unpin", headers=auth_headers)
        assert resp_un.status_code == 204, resp_un.text
        assert calls == [
            ("status_changed", sess.id, admin.id),
            ("status_changed", sess.id, admin.id),
        ]
        pinned_after, _ = await _session_row(db_session, sess.id)
        assert pinned_after is None

    async def test_pin_idempotent_keeps_timestamp_and_skips_publish(
        self,
        client: AsyncClient,
        auth_headers: dict[str, str],
        db_session: AsyncSession,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        """已置顶再 pin：仍 204，但 pinned_at 不刷新（FR-02 口径）且零发布。"""
        admin = await _get_admin(db_session)
        rt = await _make_runtime(db_session, admin.id)
        sess = await _make_session(db_session, admin.id, rt.id)
        calls = _capture_publish(monkeypatch)

        assert (
            await client.patch(f"/api/daemon/sessions/{sess.id}/pin", headers=auth_headers)
        ).status_code == 204
        first_ts, _ = await _session_row(db_session, sess.id)
        assert first_ts is not None
        assert len(calls) == 1

        await asyncio.sleep(0.01)  # 若误刷时间戳，二次 now(UTC) 至少差 10ms
        assert (
            await client.patch(f"/api/daemon/sessions/{sess.id}/pin", headers=auth_headers)
        ).status_code == 204
        second_ts, _ = await _session_row(db_session, sess.id)
        assert second_ts == first_ts  # 幂等不刷时间戳
        assert len(calls) == 1  # 零发布

    async def test_unpin_idempotent_no_publish(
        self,
        client: AsyncClient,
        auth_headers: dict[str, str],
        db_session: AsyncSession,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        """未置顶会话 unpin：204 幂等，零发布（行本来就在最近活跃序，无信号）。"""
        admin = await _get_admin(db_session)
        rt = await _make_runtime(db_session, admin.id)
        sess = await _make_session(db_session, admin.id, rt.id)
        calls = _capture_publish(monkeypatch)

        resp = await client.patch(f"/api/daemon/sessions/{sess.id}/unpin", headers=auth_headers)
        assert resp.status_code == 204, resp.text
        assert calls == []
        pinned_at, _ = await _session_row(db_session, sess.id)
        assert pinned_at is None

    async def test_pin_unpin_not_owner_and_missing_404_no_leak(
        self,
        client: AsyncClient,
        auth_headers: dict[str, str],
        db_session: AsyncSession,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        """非属主 / 不存在：pin 与 unpin 均 404 同形（不泄露存在性），零发布。"""
        other = await _make_user(db_session, f"other-{uuid.uuid4()}@example.com")
        rt_other = await _make_runtime(db_session, other.id)
        others_sess = await _make_session(db_session, other.id, rt_other.id)
        missing = uuid.uuid4()
        calls = _capture_publish(monkeypatch)

        for path in ("pin", "unpin"):
            resp_other = await client.patch(
                f"/api/daemon/sessions/{others_sess.id}/{path}", headers=auth_headers
            )
            resp_missing = await client.patch(
                f"/api/daemon/sessions/{missing}/{path}", headers=auth_headers
            )
            assert resp_other.status_code == 404, resp_other.text
            assert resp_missing.status_code == 404, resp_missing.text

        assert calls == []  # 失败路径零广播
        pinned_at, _ = await _session_row(db_session, others_sess.id)
        assert pinned_at is None  # 他人会话未被改动


# ── 排序（D-002@v1：分组内置顶 + 多置顶按最近活跃）────────────────────────


class TestPinOrdering:
    async def test_pinned_first_and_multi_pinned_by_recent_activity(
        self,
        client: AsyncClient,
        auth_headers: dict[str, str],
        db_session: AsyncSession,
    ) -> None:
        """置顶行排返回序最前；两个置顶之间按最近活跃降序（D-002@v1）。

        基线（未置顶）：[s_new(1 分钟前), s_mid(30 分钟前), s_old(3 小时前)]；
        pin s_old → [s_old, s_new, s_mid]（最老的置顶反超全部未置顶）；
        再 pin s_mid → [s_mid, s_old, s_new]（置顶组内按最近活跃）。
        """
        admin = await _get_admin(db_session)
        rt = await _make_runtime(db_session, admin.id)
        base = datetime.now(UTC)
        s_new = await _make_session(
            db_session, admin.id, rt.id, last_active_at=base - timedelta(minutes=1)
        )
        s_mid = await _make_session(
            db_session, admin.id, rt.id, last_active_at=base - timedelta(minutes=30)
        )
        s_old = await _make_session(
            db_session, admin.id, rt.id, last_active_at=base - timedelta(hours=3)
        )

        ids = [i[0] for i in await _list_ids(client, auth_headers)]
        assert ids == [str(s_new.id), str(s_mid.id), str(s_old.id)]  # 基线：最近活跃序

        assert (
            await client.patch(f"/api/daemon/sessions/{s_old.id}/pin", headers=auth_headers)
        ).status_code == 204
        rows = await _list_ids(client, auth_headers)
        assert [i[0] for i in rows] == [str(s_old.id), str(s_new.id), str(s_mid.id)]
        assert rows[0][1] is not None  # 置顶行带 pinned_at（前端徽标/按钮切换依据）

        assert (
            await client.patch(f"/api/daemon/sessions/{s_mid.id}/pin", headers=auth_headers)
        ).status_code == 204
        rows2 = await _list_ids(client, auth_headers)
        # 多置顶组内按最近活跃：s_mid(30 分钟前) 先于 s_old(3 小时前)，未置顶殿后
        assert [i[0] for i in rows2] == [str(s_mid.id), str(s_old.id), str(s_new.id)]
        assert rows2[0][1] is not None and rows2[1][1] is not None and rows2[2][1] is None


# ── rename（FR-03）─────────────────────────────────────────────────────────


class TestRename:
    async def test_rename_updates_list_title_and_publishes(
        self,
        client: AsyncClient,
        auth_headers: dict[str, str],
        db_session: AsyncSession,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        """rename → 204 + strip 落库 + 列表标题立即更新（title 优先于派生）+ 广播。"""
        admin = await _get_admin(db_session)
        rt = await _make_runtime(db_session, admin.id)
        sess = await _make_session(db_session, admin.id, rt.id)
        derived = "首条输入派生的会话标题"
        await _make_run_with_input(db_session, sess.id, user_inputs=[derived])
        calls = _capture_publish(monkeypatch)

        # 基线：无 title 列时列表回落首条 user_input 派生标题
        before = await _list_items(client, auth_headers)
        assert before[sess.id]["title"] == derived

        resp = await client.patch(
            f"/api/daemon/sessions/{sess.id}/title",
            json={"title": "  手动命名  "},
            headers=auth_headers,
        )
        assert resp.status_code == 204, resp.text
        assert calls == [("status_changed", sess.id, admin.id)]

        _, title = await _session_row(db_session, sess.id)
        assert title == "手动命名"  # strip 后落库
        after = await _list_items(client, auth_headers)
        assert after[sess.id]["title"] == "手动命名"  # title 优先派生立即生效

    async def test_rename_empty_or_whitespace_422_not_persisted(
        self,
        client: AsyncClient,
        auth_headers: dict[str, str],
        db_session: AsyncSession,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        """strip 后为空（空串 / 全空白）→ 422 不落库、零广播。"""
        admin = await _get_admin(db_session)
        rt = await _make_runtime(db_session, admin.id)
        sess = await _make_session(db_session, admin.id, rt.id)
        calls = _capture_publish(monkeypatch)

        for bad in ("", "   "):
            resp = await client.patch(
                f"/api/daemon/sessions/{sess.id}/title",
                json={"title": bad},
                headers=auth_headers,
            )
            assert resp.status_code == 422, f"title={bad!r}: {resp.text}"

        _, title = await _session_row(db_session, sess.id)
        assert title is None  # 非法值不落库
        assert calls == []

    async def test_rename_over_255_422_and_boundary_255_ok(
        self,
        client: AsyncClient,
        auth_headers: dict[str, str],
        db_session: AsyncSession,
    ) -> None:
        """256 字 → 422；恰好 255 字（String(255) 上界）→ 204 落库。"""
        admin = await _get_admin(db_session)
        rt = await _make_runtime(db_session, admin.id)
        sess = await _make_session(db_session, admin.id, rt.id)

        resp_bad = await client.patch(
            f"/api/daemon/sessions/{sess.id}/title",
            json={"title": "标" * 256},
            headers=auth_headers,
        )
        assert resp_bad.status_code == 422, resp_bad.text
        _, title = await _session_row(db_session, sess.id)
        assert title is None

        resp_ok = await client.patch(
            f"/api/daemon/sessions/{sess.id}/title",
            json={"title": "标" * 255},
            headers=auth_headers,
        )
        assert resp_ok.status_code == 204, resp_ok.text
        _, title_ok = await _session_row(db_session, sess.id)
        assert title_ok == "标" * 255

    async def test_rename_same_value_idempotent_no_publish(
        self,
        client: AsyncClient,
        auth_headers: dict[str, str],
        db_session: AsyncSession,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        """同值重命名：仍 204 但标题未变，免事务免广播（task-02 留的口径）。"""
        admin = await _get_admin(db_session)
        rt = await _make_runtime(db_session, admin.id)
        sess = await _make_session(db_session, admin.id, rt.id)
        calls = _capture_publish(monkeypatch)

        assert (
            await client.patch(
                f"/api/daemon/sessions/{sess.id}/title",
                json={"title": "名字"},
                headers=auth_headers,
            )
        ).status_code == 204
        assert len(calls) == 1

        resp = await client.patch(
            f"/api/daemon/sessions/{sess.id}/title",
            json={"title": "名字"},
            headers=auth_headers,
        )
        assert resp.status_code == 204, resp.text
        assert len(calls) == 1  # 同值幂等：零广播

    async def test_rename_not_owner_and_missing_404(
        self,
        client: AsyncClient,
        auth_headers: dict[str, str],
        db_session: AsyncSession,
    ) -> None:
        """非属主 / 不存在 → 404 同形不泄露；他人 title 列不被写入。"""
        other = await _make_user(db_session, f"other-{uuid.uuid4()}@example.com")
        rt_other = await _make_runtime(db_session, other.id)
        others_sess = await _make_session(db_session, other.id, rt_other.id)

        resp_other = await client.patch(
            f"/api/daemon/sessions/{others_sess.id}/title",
            json={"title": "越权改名"},
            headers=auth_headers,
        )
        resp_missing = await client.patch(
            f"/api/daemon/sessions/{uuid.uuid4()}/title",
            json={"title": "改名"},
            headers=auth_headers,
        )
        assert resp_other.status_code == 404, resp_other.text
        assert resp_missing.status_code == 404, resp_missing.text

        _, title = await _session_row(db_session, others_sess.id)
        assert title is None
