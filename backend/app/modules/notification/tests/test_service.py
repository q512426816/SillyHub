"""NotificationService 单测（task-02 / FR-02 / D-003@v2 D-006@v1 D-009@v2）.

fixture 惯例照 ``tests/modules/auth/test_rbac_broadcast.py``（root
``conftest.db_session``，SQLite in-memory create_all）。Redis 不可用路径：
monkeypatch ``events.get_redis`` 注入 fake（照
``tests/modules/daemon/test_session_sse.py`` 先例），InAppChannel 之外的场景
一律用假 channel 屏蔽 Redis。

覆盖：
  1. 广播扇出多行 + InAppChannel 合并为一次 publish（payload 收件人并集）；
  2. 幂等跳过：同 ref 未消解第二次调用返回 0 且不新增行、不投递；
  3. resolve_pending 消解后同 ref 可再广播（驳回重跑路径）；
  4. 空收件人返回 0；
  5. 定向通知 notify_user；
  6. mark_read 越权/不存在 → NotificationNotFound；
  7. unread_count / mark_all_read；
  8. 通道 deliver 抛异常不阻塞落库（仅 warning）；
  9. list_for_user 分页 / unread_only；
 10. Redis publish 抛异常仅 warning 不上抛（events 兜底）。
"""

from __future__ import annotations

import json
import uuid
from typing import Any

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.auth.model import Role, RolePermission, User, UserWorkspaceRole
from app.modules.auth.permissions import Permission
from app.modules.notification import events
from app.modules.notification.model import Notification
from app.modules.notification.service import (
    InAppChannel,
    NotificationNotFound,
    NotificationService,
)

# ---------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------


class _FakeChannel:
    """记录投递行数的假通道（publish 计数语义由调用方检查）。"""

    def __init__(self) -> None:
        self.calls: list[list[Notification]] = []

    async def deliver(self, rows: list[Notification]) -> None:
        self.calls.append(list(rows))


class _RaisingChannel:
    """deliver 必抛的假通道（best-effort 容错验证）。"""

    async def deliver(self, rows: list[Notification]) -> None:
        raise RuntimeError("channel down")


class _FakeRedis:
    """记录 publish 调用的假 Redis（照 daemon 测试先例）。"""

    def __init__(self) -> None:
        self.published: list[tuple[str, str]] = []

    async def publish(self, channel: str, message: str) -> int:
        self.published.append((channel, message))
        return 1


class _BrokenRedis:
    """publish 必抛的假 Redis。"""

    async def publish(self, channel: str, message: str) -> int:
        raise ConnectionError("redis unavailable")


async def _make_user(session: AsyncSession, *, admin: bool = False) -> User:
    user = User(
        id=uuid.uuid4(),
        email=f"user-{uuid.uuid4().hex[:8]}@example.com",
        password_hash="x",
        display_name="u",
        status="active",
        is_platform_admin=admin,
    )
    session.add(user)
    await session.commit()
    return user


async def _grant_permission(
    session: AsyncSession, *, workspace_id: uuid.UUID, users: list[User]
) -> None:
    role = Role(id=uuid.uuid4(), key=f"role-{uuid.uuid4().hex[:8]}", name="t")
    session.add(role)
    await session.flush()
    session.add(RolePermission(role_id=role.id, permission=Permission.CHANGE_CREATE.value))
    for u in users:
        session.add(UserWorkspaceRole(user_id=u.id, workspace_id=workspace_id, role_id=role.id))
    await session.commit()


async def _make_workspace(session: AsyncSession) -> Any:
    from app.modules.workspace.model import Workspace

    ws = Workspace(
        id=uuid.uuid4(),
        name="ws",
        slug=f"ws-{uuid.uuid4().hex[:8]}",
        root_path="/tmp/ws",
    )
    session.add(ws)
    await session.commit()
    return ws


async def _broadcast_once(
    service: NotificationService,
    *,
    workspace_id: uuid.UUID,
    permission: Permission = Permission.CHANGE_CREATE,
    ref_id: str | None = None,
) -> int:
    return await service.notify_broadcast(
        workspace_id=workspace_id,
        permission=permission,
        type="approval_pending",
        title="变更「x」等待平台审核",
        body=None,
        link=None,
        ref_type="change",
        ref_id=ref_id or uuid.uuid4().hex,
        dedupe_key="c:platform",
    )


# ---------------------------------------------------------------------------
# notify_broadcast：扇出 / publish 合并 / 幂等 / 消解后放行 / 空收件人
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_broadcast_fanout_and_single_publish_merge(
    db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    """广播扇出多行（每收件人一行），InAppChannel 合并为一次 publish。"""
    ws = await _make_workspace(db_session)
    u1 = await _make_user(db_session)
    u2 = await _make_user(db_session)
    await _grant_permission(db_session, workspace_id=ws.id, users=[u1, u2])

    fake_redis = _FakeRedis()
    monkeypatch.setattr(events, "get_redis", lambda: fake_redis)
    service = NotificationService(db_session)  # 默认 channels=[InAppChannel()]

    ref_id = uuid.uuid4().hex
    created = await _broadcast_once(service, workspace_id=ws.id, ref_id=ref_id)
    assert created == 2

    rows = (
        (await db_session.execute(select(Notification).where(Notification.ref_id == ref_id)))
        .scalars()
        .all()
    )
    assert {r.recipient_user_id for r in rows} == {u1.id, u2.id}
    assert all(r.read_at is None for r in rows)

    # 广播两行合并为一次 publish；payload 含收件人并集 + 首行摘要。
    assert len(fake_redis.published) == 1
    channel, message = fake_redis.published[0]
    assert channel == events.NOTIFICATIONS_CHANNEL == "notifications:new"
    payload = json.loads(message)
    assert set(payload["recipient_user_ids"]) == {str(u1.id), str(u2.id)}
    assert payload["notification"]["type"] == "approval_pending"
    assert payload["notification"]["title"] == "变更「x」等待平台审核"


@pytest.mark.asyncio
async def test_broadcast_idempotent_skip_while_unresolved(db_session: AsyncSession) -> None:
    """同 (ref_type, ref_id, type) 存在未消解行 → 第二次返回 0，不落库不投递。"""
    ws = await _make_workspace(db_session)
    user = await _make_user(db_session)
    await _grant_permission(db_session, workspace_id=ws.id, users=[user])

    fake = _FakeChannel()
    service = NotificationService(db_session, channels=[fake])
    ref_id = uuid.uuid4().hex

    assert await _broadcast_once(service, workspace_id=ws.id, ref_id=ref_id) == 1
    assert await _broadcast_once(service, workspace_id=ws.id, ref_id=ref_id) == 0

    rows = (
        (await db_session.execute(select(Notification).where(Notification.ref_id == ref_id)))
        .scalars()
        .all()
    )
    assert len(rows) == 1, "幂等跳过不应新增行"
    assert len(fake.calls) == 1, "幂等跳过不应再次投递"


@pytest.mark.asyncio
async def test_resolve_pending_then_broadcast_again_allowed(db_session: AsyncSession) -> None:
    """驳回重跑路径：resolve_pending 消解后，同 ref 可再次广播（D-009@v2）。"""
    ws = await _make_workspace(db_session)
    user = await _make_user(db_session)
    await _grant_permission(db_session, workspace_id=ws.id, users=[user])

    service = NotificationService(db_session, channels=[])
    ref_id = uuid.uuid4().hex

    assert await _broadcast_once(service, workspace_id=ws.id, ref_id=ref_id) == 1
    resolved = await service.resolve_pending(
        ref_type="change", ref_id=ref_id, types=("approval_pending",)
    )
    assert resolved == 1

    # 消解后未消解检查不命中 → 放行再插入。
    assert await _broadcast_once(service, workspace_id=ws.id, ref_id=ref_id) == 1
    rows = (
        (
            await db_session.execute(
                select(Notification)
                .where(Notification.ref_id == ref_id)
                .order_by(Notification.created_at)
            )
        )
        .scalars()
        .all()
    )
    assert len(rows) == 2
    assert rows[0].read_at is not None, "首轮已被消解"
    assert rows[1].read_at is None, "重跑轮未读"


@pytest.mark.asyncio
async def test_broadcast_empty_recipients_returns_zero(db_session: AsyncSession) -> None:
    """无人持有权限 → 返回 0、不落库。"""
    ws = await _make_workspace(db_session)
    await _make_user(db_session)  # 存在用户但无 grant

    fake = _FakeChannel()
    service = NotificationService(db_session, channels=[fake])
    assert await _broadcast_once(service, workspace_id=ws.id) == 0
    assert fake.calls == []


# ---------------------------------------------------------------------------
# notify_user / mark_read / unread_count / mark_all_read / list_for_user
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_notify_user_persists_and_delivers(db_session: AsyncSession) -> None:
    """定向单条落库 + 投递，ref/dedupe 可缺省。"""
    ws = await _make_workspace(db_session)
    user = await _make_user(db_session)
    fake = _FakeChannel()
    service = NotificationService(db_session, channels=[fake])

    assert await service.notify_user(
        workspace_id=ws.id,
        recipient_user_id=user.id,
        type="approval_result",
        title="变更「x」已通过",
        body="审批人：admin",
        link="/changes/x",
        ref_type="change",
        ref_id="c1",
    )
    rows, total = await service.list_for_user(user_id=user.id)
    assert total == 1
    assert rows[0].type == "approval_result"
    assert rows[0].body == "审批人：admin"
    assert len(fake.calls) == 1 and len(fake.calls[0]) == 1


@pytest.mark.asyncio
async def test_mark_read_wrong_user_or_missing_raises(db_session: AsyncSession) -> None:
    """mark_read 越权 / 不存在 → NotificationNotFound。"""
    ws = await _make_workspace(db_session)
    owner = await _make_user(db_session)
    other = await _make_user(db_session)
    service = NotificationService(db_session, channels=[])

    await service.notify_user(
        workspace_id=ws.id,
        recipient_user_id=owner.id,
        type="permission_request",
        title="会话请求权限",
        body=None,
        link=None,
    )
    row = (await service.list_for_user(user_id=owner.id))[0][0]

    with pytest.raises(NotificationNotFound):
        await service.mark_read(user_id=other.id, notification_id=row.id)
    with pytest.raises(NotificationNotFound):
        await service.mark_read(user_id=owner.id, notification_id=uuid.uuid4())

    got = await service.mark_read(user_id=owner.id, notification_id=row.id)
    assert got.read_at is not None
    # 重复标记幂等。
    again = await service.mark_read(user_id=owner.id, notification_id=row.id)
    assert again.read_at is not None


@pytest.mark.asyncio
async def test_unread_count_and_mark_all_read(db_session: AsyncSession) -> None:
    ws = await _make_workspace(db_session)
    user = await _make_user(db_session)
    service = NotificationService(db_session, channels=[])

    for i in range(3):
        await service.notify_user(
            workspace_id=ws.id,
            recipient_user_id=user.id,
            type="permission_timeout",
            title=f"超时 {i}",
            body=None,
            link=None,
        )
    assert await service.unread_count(user_id=user.id) == 3

    updated = await service.mark_all_read(user_id=user.id)
    assert updated == 3
    assert await service.unread_count(user_id=user.id) == 0
    assert await service.mark_all_read(user_id=user.id) == 0  # 幂等


@pytest.mark.asyncio
async def test_list_for_user_pagination_and_unread_only(db_session: AsyncSession) -> None:
    ws = await _make_workspace(db_session)
    user = await _make_user(db_session)
    other = await _make_user(db_session)
    service = NotificationService(db_session, channels=[])

    for i in range(5):
        await service.notify_user(
            workspace_id=ws.id,
            recipient_user_id=user.id,
            type="permission_request",
            title=f"n{i}",
            body=None,
            link=None,
        )
    await service.notify_user(
        workspace_id=ws.id,
        recipient_user_id=other.id,
        type="permission_request",
        title="别人的通知",
        body=None,
        link=None,
    )

    # 分页。
    page1, total = await service.list_for_user(user_id=user.id, limit=2, offset=0)
    assert total == 5 and len(page1) == 2
    page3, total3 = await service.list_for_user(user_id=user.id, limit=2, offset=4)
    assert total3 == 5 and len(page3) == 1

    # unread_only 过滤 + 隔离（other 的行不出现）。
    rows, unread_total = await service.list_for_user(user_id=user.id, unread_only=True)
    assert unread_total == 5
    assert {r.title for r in rows} <= {f"n{i}" for i in range(5)}


# ---------------------------------------------------------------------------
# best-effort：通道/Redis 故障不阻塞落库
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_raising_channel_does_not_block_persist(db_session: AsyncSession) -> None:
    """通道 deliver 抛异常：落库结果不受影响，service 不上抛（D-006@v1）。"""
    ws = await _make_workspace(db_session)
    user = await _make_user(db_session)
    await _grant_permission(db_session, workspace_id=ws.id, users=[user])

    service = NotificationService(db_session, channels=[_RaisingChannel()])
    created = await _broadcast_once(service, workspace_id=ws.id)
    assert created == 1

    _rows, total = await service.list_for_user(user_id=user.id)
    assert total == 1, "通道故障不影响落库"


@pytest.mark.asyncio
async def test_inapp_channel_redis_failure_only_warns(
    db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Redis publish 抛异常：events 兜底仅 log.warning，deliver 不上抛。"""
    monkeypatch.setattr(events, "get_redis", lambda: _BrokenRedis())
    channel = InAppChannel()
    row = Notification(
        workspace_id=uuid.uuid4(),
        recipient_user_id=uuid.uuid4(),
        type="approval_result",
        title="t",
    )
    # 不应抛出。
    await channel.deliver([row])
