"""notification router 测试（task-07 / design §7.2）.

fixture 惯例：root ``conftest.db_engine/db_session``（SQLite in-memory）+
本地 httpx 客户端（dependency_overrides 覆盖 ``get_session``，照
``file/tests/conftest.py`` 模式）；用户走真实 JWT（``create_access_token``，
照 root ``auth_admin_token`` 惯例），保证 ``get_current_user`` 生产链路。

service 构造用 ``channels=[]`` 屏蔽 Redis（写路径经 service 落库，
读路径本就不投递）。覆盖：列表仅本人+分页+unread_only、未读数、
单条已读（本人/他人 404/不存在 404）、全部已读返回行数、
DTO 契约字段齐全（provides 逐字段断言）。
"""

from __future__ import annotations

import uuid
from collections.abc import AsyncIterator
from typing import Any

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.core.db import get_session
from app.modules.auth.model import User
from app.modules.notification.service import NotificationService
from app.modules.workspace.model import Workspace

# ---------------------------------------------------------------------------
# helpers / fixtures
# ---------------------------------------------------------------------------


async def _make_user(session: AsyncSession) -> User:
    user = User(
        id=uuid.uuid4(),
        email=f"user-{uuid.uuid4().hex[:8]}@example.com",
        password_hash="x",
        display_name="u",
        status="active",
    )
    session.add(user)
    await session.commit()
    return user


async def _make_workspace(session: AsyncSession) -> Workspace:
    ws = Workspace(
        id=uuid.uuid4(),
        name="ws",
        slug=f"ws-{uuid.uuid4().hex[:8]}",
        root_path="/tmp/ws",
    )
    session.add(ws)
    await session.commit()
    return ws


def _token(user: User) -> str:
    from app.core.config import get_settings
    from app.core.security import create_access_token

    token, _ = create_access_token(
        user_id=user.id,
        email=user.email,
        is_admin=user.is_platform_admin,
        settings=get_settings(),
    )
    return token


@pytest.fixture()
async def notify_client(db_engine: Any) -> AsyncIterator[AsyncClient]:
    """挂载通知路由依赖覆盖（测试 DB session）的 HTTP 客户端。"""
    from app.main import app

    factory = async_sessionmaker(bind=db_engine, class_=AsyncSession, expire_on_commit=False)

    async def _override_session() -> AsyncIterator[AsyncSession]:
        async with factory() as session:
            try:
                yield session
            except Exception:
                await session.rollback()
                raise

    app.dependency_overrides[get_session] = _override_session
    try:
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as ac:
            yield ac
    finally:
        app.dependency_overrides.pop(get_session, None)


async def _seed_rows(session: AsyncSession, ws_id: uuid.UUID, user_id: uuid.UUID, n: int) -> None:
    """经 service 落 n 条本人未读通知（channels=[] 屏蔽 Redis）。"""
    service = NotificationService(session, channels=[])
    for i in range(n):
        await service.notify_user(
            workspace_id=ws_id,
            recipient_user_id=user_id,
            type="approval_result",
            title=f"n{i}",
            body=f"审批结果 {i}",
            link=f"/changes/c{i}",
            ref_type="change",
            ref_id=f"c{i}",
        )


def _headers(user: User) -> dict[str, str]:
    return {"Authorization": f"Bearer {_token(user)}"}


# ---------------------------------------------------------------------------
# GET /api/notifications
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_list_only_own_rows_with_pagination(
    notify_client: AsyncClient, db_session: AsyncSession
) -> None:
    """列表仅返回本人行；limit/offset 分页；total 为本人总数。"""
    ws = await _make_workspace(db_session)
    user = await _make_user(db_session)
    other = await _make_user(db_session)
    await _seed_rows(db_session, ws.id, user.id, 5)
    await _seed_rows(db_session, ws.id, other.id, 1)

    page1 = await notify_client.get(
        "/api/notifications", params={"limit": 2, "offset": 0}, headers=_headers(user)
    )
    assert page1.status_code == 200, page1.text
    body = page1.json()
    assert body["total"] == 5 and len(body["items"]) == 2

    page3 = await notify_client.get(
        "/api/notifications", params={"limit": 2, "offset": 4}, headers=_headers(user)
    )
    assert page3.json()["total"] == 5 and len(page3.json()["items"]) == 1

    # 他人行不出现（隔离）。
    titles = {item["title"] for item in body["items"]}
    assert titles <= {f"n{i}" for i in range(5)}
    other_view = await notify_client.get("/api/notifications", headers=_headers(other))
    assert other_view.json()["total"] == 1


@pytest.mark.asyncio
async def test_list_unread_only_filter_and_desc_order(
    notify_client: AsyncClient, db_session: AsyncSession
) -> None:
    """unread_only 过滤已读行；列表按 created_at DESC（新在前）。"""
    ws = await _make_workspace(db_session)
    user = await _make_user(db_session)
    await _seed_rows(db_session, ws.id, user.id, 3)

    service = NotificationService(db_session, channels=[])
    rows, _ = await service.list_for_user(user_id=user.id)
    await service.mark_read(user_id=user.id, notification_id=rows[0].id)  # 最新的已读

    resp = await notify_client.get(
        "/api/notifications", params={"unread_only": "true"}, headers=_headers(user)
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["total"] == 2
    assert all(item["read_at"] is None for item in body["items"])

    all_resp = await notify_client.get("/api/notifications", headers=_headers(user))
    items = all_resp.json()["items"]
    assert [i["title"] for i in items] == ["n2", "n1", "n0"]  # DESC


# ---------------------------------------------------------------------------
# GET /api/notifications/unread-count
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_unread_count(notify_client: AsyncClient, db_session: AsyncSession) -> None:
    ws = await _make_workspace(db_session)
    user = await _make_user(db_session)
    await _seed_rows(db_session, ws.id, user.id, 3)

    resp = await notify_client.get("/api/notifications/unread-count", headers=_headers(user))
    assert resp.status_code == 200, resp.text
    assert resp.json() == {"count": 3}


# ---------------------------------------------------------------------------
# POST /api/notifications/{id}/read
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_mark_read_success(notify_client: AsyncClient, db_session: AsyncSession) -> None:
    ws = await _make_workspace(db_session)
    user = await _make_user(db_session)
    await _seed_rows(db_session, ws.id, user.id, 1)
    service = NotificationService(db_session, channels=[])
    row = (await service.list_for_user(user_id=user.id))[0][0]

    resp = await notify_client.post(f"/api/notifications/{row.id}/read", headers=_headers(user))
    assert resp.status_code == 200, resp.text
    assert resp.json()["read_at"] is not None


@pytest.mark.asyncio
async def test_mark_read_other_users_notification_404(
    notify_client: AsyncClient, db_session: AsyncSession
) -> None:
    """越权（他人通知）→ 404。"""
    ws = await _make_workspace(db_session)
    owner = await _make_user(db_session)
    attacker = await _make_user(db_session)
    await _seed_rows(db_session, ws.id, owner.id, 1)
    service = NotificationService(db_session, channels=[])
    row = (await service.list_for_user(user_id=owner.id))[0][0]

    resp = await notify_client.post(f"/api/notifications/{row.id}/read", headers=_headers(attacker))
    assert resp.status_code == 404, resp.text


@pytest.mark.asyncio
async def test_mark_read_missing_404(notify_client: AsyncClient, db_session: AsyncSession) -> None:
    user = await _make_user(db_session)
    resp = await notify_client.post(
        f"/api/notifications/{uuid.uuid4()}/read", headers=_headers(user)
    )
    assert resp.status_code == 404, resp.text


# ---------------------------------------------------------------------------
# POST /api/notifications/read-all
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_read_all_returns_updated_count(
    notify_client: AsyncClient, db_session: AsyncSession
) -> None:
    ws = await _make_workspace(db_session)
    user = await _make_user(db_session)
    other = await _make_user(db_session)
    await _seed_rows(db_session, ws.id, user.id, 3)
    await _seed_rows(db_session, ws.id, other.id, 2)

    resp = await notify_client.post("/api/notifications/read-all", headers=_headers(user))
    assert resp.status_code == 200, resp.text
    assert resp.json() == {"updated": 3}, "只更新本人行"

    # 他人的不受影响。
    other_resp = await notify_client.get("/api/notifications/unread-count", headers=_headers(other))
    assert other_resp.json() == {"count": 2}

    # 幂等：再次全部已读返回 0。
    again = await notify_client.post("/api/notifications/read-all", headers=_headers(user))
    assert again.json() == {"updated": 0}


@pytest.mark.asyncio
async def test_list_requires_auth(notify_client: AsyncClient) -> None:
    resp = await notify_client.get("/api/notifications")
    assert resp.status_code == 401, resp.text


# ---------------------------------------------------------------------------
# DTO 契约（provides 字段逐一断言，task-09/10 消费）
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_notification_read_dto_contract_fields(
    notify_client: AsyncClient, db_session: AsyncSession
) -> None:
    ws = await _make_workspace(db_session)
    user = await _make_user(db_session)
    service = NotificationService(db_session, channels=[])
    await service.notify_user(
        workspace_id=ws.id,
        recipient_user_id=user.id,
        type="approval_result",
        title="变更「x」已通过",
        body="审批人：admin",
        link="/changes/x",
        ref_type="change",
        ref_id="c1",
    )

    resp = await notify_client.get("/api/notifications", headers=_headers(user))
    assert resp.status_code == 200, resp.text
    item = resp.json()["items"][0]
    assert set(item.keys()) == {
        "id",
        "workspace_id",
        "type",
        "title",
        "body",
        "link",
        "ref_type",
        "ref_id",
        "read_at",
        "created_at",
    }
    assert item["workspace_id"] == str(ws.id)
    assert item["type"] == "approval_result"
    assert item["title"] == "变更「x」已通过"
    assert item["body"] == "审批人：admin"
    assert item["link"] == "/changes/x"
    assert item["ref_type"] == "change"
    assert item["ref_id"] == "c1"
    assert item["read_at"] is None
    assert item["created_at"] is not None

    # 单条已读端点返回同构 DTO。
    row = (await service.list_for_user(user_id=user.id))[0][0]
    read = await notify_client.post(f"/api/notifications/{row.id}/read", headers=_headers(user))
    assert set(read.json().keys()) == set(item.keys())
    assert read.json()["read_at"] is not None


# ---------------------------------------------------------------------------
# SSE GET /api/notifications/events（task-08 / FR-07 / design §7.2）
# ---------------------------------------------------------------------------


def _sse_payload(recipient_ids: list[str]) -> str:
    """构造一条与 InAppChannel.deliver 发布侧同构的 notifications:new 信号。"""
    import json

    return json.dumps(
        {
            "recipient_user_ids": recipient_ids,
            "notification": {
                "id": str(uuid.uuid4()),
                "type": "approval_result",
                "title": "变更「x」已通过",
                "body": "审批人：admin",
                "link": "/changes/x",
                "created_at": "2026-08-29T12:00:00+00:00",
            },
        }
    )


@pytest.fixture()
def instant_keepalive(monkeypatch: pytest.MonkeyPatch) -> None:
    """keepalive 间隔置 0——静默 / 跳过即触发，无真实 25s 等待。"""
    monkeypatch.setattr(
        "app.modules.notification.router.NOTIFICATIONS_EVENTS_KEEPALIVE_INTERVAL_SEC",
        0.0,
    )


def _build_mock_pubsub(
    messages: list[Any | None],
) -> tuple[Any, list[dict]]:
    """假 pubsub：get_message 依序吐出 messages，耗尽后永远返回 None。"""
    from unittest.mock import AsyncMock, MagicMock

    state = {"remaining": list(messages)}
    get_message_calls: list[dict] = []

    pubsub = MagicMock()
    pubsub.subscribe = AsyncMock()
    pubsub.unsubscribe = AsyncMock()
    pubsub.aclose = AsyncMock()

    async def fake_get_message(**kwargs: Any) -> Any:
        get_message_calls.append(kwargs)
        if state["remaining"]:
            return state["remaining"].pop(0)
        return None

    pubsub.get_message = fake_get_message
    return pubsub, get_message_calls


async def _collect_sse(gen: Any, limit: int) -> list[str]:
    """驱动生成器收集前 limit 帧后显式 aclose（触发 finally 清理）。"""
    collected: list[str] = []
    async for frame in gen:
        collected.append(frame)
        if len(collected) >= limit:
            break
    await gen.aclose()
    return collected


class TestStreamNotificationsEventsGenerator:
    @pytest.mark.asyncio
    async def test_recipient_hit_delivers_notification_event(self, instant_keepalive: None) -> None:
        """本人 ∈ recipient_user_ids → event: notification + data JSON 下发。"""
        import json
        from unittest.mock import MagicMock, patch

        from app.modules.notification.events import NOTIFICATIONS_CHANNEL
        from app.modules.notification.router import _stream_notifications_events

        me = str(uuid.uuid4())
        raw = _sse_payload([me, str(uuid.uuid4())])
        pubsub, _ = _build_mock_pubsub([{"type": "message", "data": raw}])
        redis = MagicMock()
        redis.pubsub.return_value = pubsub

        gen = _stream_notifications_events(me)
        with patch("app.modules.notification.router.get_redis", return_value=redis):
            collected = await _collect_sse(gen, limit=2)

        assert collected[0] == ": connected\n\n"
        frame = collected[1]
        assert frame.startswith("event: notification\ndata: ")
        assert frame.endswith("\n\n")
        data = json.loads(frame[len("event: notification\ndata: ") : -2])
        assert data["type"] == "approval_result"
        assert data["title"] == "变更「x」已通过"
        assert data["link"] == "/changes/x"
        pubsub.subscribe.assert_called_once_with(NOTIFICATIONS_CHANNEL)
        pubsub.unsubscribe.assert_called_once_with(NOTIFICATIONS_CHANNEL)
        pubsub.aclose.assert_called_once()

    @pytest.mark.asyncio
    async def test_non_recipient_filtered_out(self, instant_keepalive: None) -> None:
        """非 recipient 信号静默丢弃（R-06 服务端过滤），keepalive 兜底。"""
        from unittest.mock import MagicMock, patch

        from app.modules.notification.router import _stream_notifications_events

        me = str(uuid.uuid4())
        other_raw = _sse_payload([str(uuid.uuid4())])
        pubsub, _ = _build_mock_pubsub([{"type": "message", "data": other_raw}])
        redis = MagicMock()
        redis.pubsub.return_value = pubsub

        gen = _stream_notifications_events(me)
        with patch("app.modules.notification.router.get_redis", return_value=redis):
            collected = await _collect_sse(gen, limit=3)

        assert collected[0] == ": connected\n\n"
        assert collected[1] == ": keepalive\n\n"
        assert collected[2] == ": keepalive\n\n"
        assert "event: notification" not in "".join(collected)
        assert other_raw not in "".join(collected)

    @pytest.mark.asyncio
    async def test_keepalive_on_silence_and_malformed_payload(
        self, instant_keepalive: None
    ) -> None:
        """静默（timeout → None）与非 JSON / 非 dict payload 均不炸流。"""
        import json as json_mod
        from unittest.mock import MagicMock, patch

        from app.modules.notification.router import _stream_notifications_events

        me = str(uuid.uuid4())
        own_raw = _sse_payload([me])
        pubsub, _ = _build_mock_pubsub(
            [
                None,  # 静默
                {"type": "message", "data": "not-json{"},  # 坏 JSON
                {"type": "message", "data": "[1,2,3]"},  # 非 dict JSON
                {"type": "message", "data": own_raw},  # 本人信号仍透传
            ]
        )
        redis = MagicMock()
        redis.pubsub.return_value = pubsub

        gen = _stream_notifications_events(me)
        with patch("app.modules.notification.router.get_redis", return_value=redis):
            collected = await _collect_sse(gen, limit=5)

        assert collected[0] == ": connected\n\n"
        # 静默/坏帧后补 keepalive，随后本人信号正常下发。
        assert ": keepalive\n\n" in collected
        notification_frames = [f for f in collected if f.startswith("event: notification")]
        assert len(notification_frames) == 1
        data = json_mod.loads(notification_frames[0][len("event: notification\ndata: ") : -2])
        assert data["type"] == "approval_result"
        assert "not-json{" not in "".join(collected)
        pubsub.aclose.assert_called_once()

    @pytest.mark.asyncio
    async def test_unsubscribe_failure_still_closes_pubsub(self) -> None:
        """finally 两步清理隔离：unsubscribe 抛错时 aclose 仍执行（不泄漏）。"""
        from unittest.mock import AsyncMock, MagicMock, patch

        from app.modules.notification.router import _stream_notifications_events

        me = str(uuid.uuid4())
        pubsub, _ = _build_mock_pubsub([])
        pubsub.unsubscribe = AsyncMock(side_effect=ConnectionError("redis down"))
        redis = MagicMock()
        redis.pubsub.return_value = pubsub

        gen = _stream_notifications_events(me)
        with patch("app.modules.notification.router.get_redis", return_value=redis):
            assert await gen.__anext__() == ": connected\n\n"
            await gen.aclose()

        pubsub.unsubscribe.assert_called_once()
        pubsub.aclose.assert_called_once()


class TestNotificationsEventsEndpoint:
    @pytest.mark.asyncio
    async def test_endpoint_401_unauthenticated(self, notify_client: AsyncClient) -> None:
        """未登录 → 401，不进入流。"""
        resp = await notify_client.get("/api/notifications/events")
        assert resp.status_code == 401, resp.text

    @pytest.mark.asyncio
    async def test_streaming_response_metadata(self, db_session: AsyncSession) -> None:
        """路由函数返回 SSE StreamingResponse：media_type / headers 对齐先例。"""
        from unittest.mock import MagicMock, patch

        from app.modules.notification.router import stream_notifications_events

        user = await _make_user(db_session)
        raw = _sse_payload([str(user.id)])
        pubsub, _ = _build_mock_pubsub([{"type": "message", "data": raw}])
        redis = MagicMock()
        redis.pubsub.return_value = pubsub

        with patch("app.modules.notification.router.get_redis", return_value=redis):
            resp = await stream_notifications_events(user=user)
            # 生成器体在首个 __anext__ 才执行，redis patch 需覆盖消费窗口。
            it = resp.body_iterator
            frames = [await it.__anext__(), await it.__anext__()]
            await it.aclose()

        assert resp.media_type == "text/event-stream"
        assert resp.headers["cache-control"] == "no-cache, no-transform"
        assert resp.headers["connection"] == "keep-alive"
        assert resp.headers["x-accel-buffering"] == "no"
        assert frames[0] == ": connected\n\n"
        assert frames[1].startswith("event: notification\ndata: ")
        pubsub.aclose.assert_called_once()
