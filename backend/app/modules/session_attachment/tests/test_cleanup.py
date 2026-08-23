"""附件草稿清理单测（2026-08-24 会话审查 P3）。

修前 ``cleanup_expired_draft_attachments`` 用 ``delete(...).limit(n)``——
SQLAlchemy Core ``Delete`` 没有 ``.limit()``（且 PG 无 DELETE LIMIT 方言），
每小时执行必抛 AttributeError 被 ``_run_forever`` 吞成 warning，48h 草稿
从未被清过。本文件验证修后的子查询写法真的删得动行。
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.session_attachment.cleanup import (
    _BATCH_LIMIT,
    DRAFT_TTL,
    cleanup_expired_draft_attachments,
)
from app.modules.session_attachment.model import SessionAttachment


def _make_attachment(
    *,
    session_id: uuid.UUID | None,
    created_at: datetime,
) -> SessionAttachment:
    return SessionAttachment(
        id=uuid.uuid4(),
        user_id=uuid.uuid4(),
        session_id=session_id,
        kind="image",
        media_type="image/png",
        bytes=100,
        name="a.png",
        object_key=f"draft/{uuid.uuid4().hex}",
        sha256="0" * 64,
        created_at=created_at,
    )


async def test_deletes_only_expired_drafts(db_session: AsyncSession) -> None:
    """48h 外的草稿（session_id NULL）删除；48h 内草稿与已绑定会话的附件保留。"""
    old = datetime.now(UTC) - (DRAFT_TTL + timedelta(hours=1))
    fresh = datetime.now(UTC) - timedelta(hours=1)
    expired_draft = _make_attachment(session_id=None, created_at=old)
    fresh_draft = _make_attachment(session_id=None, created_at=fresh)
    bound_old = _make_attachment(session_id=uuid.uuid4(), created_at=old)
    db_session.add_all([expired_draft, fresh_draft, bound_old])
    await db_session.commit()

    deleted = await cleanup_expired_draft_attachments(lambda: _reuse(db_session))

    assert deleted == 1
    remaining = set((await db_session.execute(select(SessionAttachment.id))).scalars().all())
    assert expired_draft.id not in remaining
    assert fresh_draft.id in remaining
    assert bound_old.id in remaining


async def test_batch_limit_bounds_single_round(db_session: AsyncSession) -> None:
    """过期草稿超过 _BATCH_LIMIT 时单轮只删一批（对齐 lease expire limit 模式）。"""
    old = datetime.now(UTC) - (DRAFT_TTL + timedelta(hours=1))
    rows = [_make_attachment(session_id=None, created_at=old) for _ in range(_BATCH_LIMIT + 3)]
    db_session.add_all(rows)
    await db_session.commit()

    deleted = await cleanup_expired_draft_attachments(lambda: _reuse(db_session))

    assert deleted == _BATCH_LIMIT


def _reuse(session: AsyncSession):
    """session_factory 形参兼容垫片：测试复用当前 db_session（async with 兼容）。

    cleanup 用 ``async with session_factory() as s``——传一个返回异步上下文的
    可调用，复用测试 session 且不真正关闭。
    """

    class _Ctx:
        async def __aenter__(self):
            return session

        async def __aexit__(self, *exc):
            return False

    return _Ctx()
