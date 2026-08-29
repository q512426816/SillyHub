"""端到端整合用例（task-12 / FR-01..08 串联）.

一条贯通链路：notify_broadcast 落库多行 → 未读数正确 → 同 ref 再广播幂等 0 行 →
resolve_pending 消解 → 再广播放行 → mark_read / mark_all_read → list_for_user
只见本人。fixture 惯例照 ``test_service.py``（root ``conftest.db_session``，
SQLite in-memory），通道注入假 channel（不依赖 Redis）。
"""

from __future__ import annotations

import uuid
from typing import Any

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.auth.model import Role, RolePermission, User, UserWorkspaceRole
from app.modules.auth.permissions import Permission
from app.modules.notification.model import Notification
from app.modules.notification.service import (
    NotificationNotFound,
    NotificationService,
)


class _FakeChannel:
    """记录投递行数的假通道。"""

    def __init__(self) -> None:
        self.calls: list[list[Notification]] = []

    async def deliver(self, rows: list[Notification]) -> None:
        self.calls.append(list(rows))


async def _make_user(session: AsyncSession) -> User:
    user = User(
        id=uuid.uuid4(),
        email=f"user-{uuid.uuid4().hex[:8]}@example.com",
        password_hash="x",
        display_name="u",
        status="active",
        is_platform_admin=False,
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


async def _broadcast(service: NotificationService, *, workspace_id: uuid.UUID, ref_id: str) -> int:
    return await service.notify_broadcast(
        workspace_id=workspace_id,
        permission=Permission.CHANGE_CREATE,
        type="approval_pending",
        title="变更「x」等待平台审核",
        body=None,
        link=None,
        ref_type="change",
        ref_id=ref_id,
        dedupe_key="c:platform",
    )


@pytest.mark.asyncio
async def test_end_to_end_broadcast_idempotent_resolve_read(
    db_session: AsyncSession,
) -> None:
    """端到端贯通：触发→落库→幂等→消解→放行→已读→列表隔离。"""
    ws = await _make_workspace(db_session)
    u1 = await _make_user(db_session)
    u2 = await _make_user(db_session)
    outsider = await _make_user(db_session)  # 无权限收件人，验证隔离
    await _grant_permission(db_session, workspace_id=ws.id, users=[u1, u2])

    fake = _FakeChannel()
    service = NotificationService(db_session, channels=[fake])
    ref_id = uuid.uuid4().hex

    # 1) 触发：广播落库多行（每收件人一行），投递一次（多行合并一批）。
    assert await _broadcast(service, workspace_id=ws.id, ref_id=ref_id) == 2
    rows = (
        (await db_session.execute(select(Notification).where(Notification.ref_id == ref_id)))
        .scalars()
        .all()
    )
    assert {r.recipient_user_id for r in rows} == {u1.id, u2.id}
    assert all(r.read_at is None for r in rows)
    assert len(fake.calls) == 1 and len(fake.calls[0]) == 2

    # 2) 未读数正确（收件人各 1，局外人 0）。
    assert await service.unread_count(user_id=u1.id) == 1
    assert await service.unread_count(user_id=u2.id) == 1
    assert await service.unread_count(user_id=outsider.id) == 0

    # 3) 同 ref 再广播：幂等 0 行、不再投递。
    assert await _broadcast(service, workspace_id=ws.id, ref_id=ref_id) == 0
    assert len(fake.calls) == 1
    assert await service.unread_count(user_id=u1.id) == 1

    # 4) resolve_pending 消解后，同 ref 可再次广播放行（驳回重跑路径）。
    resolved = await service.resolve_pending(
        ref_type="change", ref_id=ref_id, types=("approval_pending",)
    )
    assert resolved == 2
    assert await service.unread_count(user_id=u1.id) == 0
    assert await _broadcast(service, workspace_id=ws.id, ref_id=ref_id) == 2
    assert await service.unread_count(user_id=u1.id) == 1
    assert await service.unread_count(user_id=u2.id) == 1

    # 5) mark_read：本人标记已读 + 越权拒绝。
    u1_rows, u1_total = await service.list_for_user(user_id=u1.id)
    assert u1_total == 2
    latest = u1_rows[0]  # created_at DESC → 重跑轮在前
    assert latest.read_at is None
    got = await service.mark_read(user_id=u1.id, notification_id=latest.id)
    assert got.read_at is not None
    assert await service.unread_count(user_id=u1.id) == 0
    assert await service.unread_count(user_id=u2.id) == 1, "u2 不受 u1 已读影响"
    with pytest.raises(NotificationNotFound):
        await service.mark_read(user_id=u2.id, notification_id=latest.id)

    # 6) mark_all_read：u2 剩余未读清零且幂等（首轮已被消解，仅重跑轮未读）。
    assert await service.mark_all_read(user_id=u2.id) == 1
    assert await service.mark_all_read(user_id=u2.id) == 0

    # 7) list_for_user 只见本人：u1 看不到 u2 的任何行。
    u2_all, _ = await service.list_for_user(user_id=u2.id)
    u1_ids = {r.id for r in u1_rows}
    assert all(r.id not in u1_ids for r in u2_all)
    outsider_rows, outsider_total = await service.list_for_user(user_id=outsider.id)
    assert outsider_total == 0 and outsider_rows == []
