"""Tests for ``PlatformSyncTokenService.get_or_issue`` — init-provision 签发语义。

Change 2026-08-12-init-provision-local-yaml task-08 / FR-02 / D-001。

覆盖四个场景（design §5.2 §7.1，task-01 contract）：
- 空表 ``get_or_issue`` 直接签新：返回 row+明文，DB 恰一条 ``revoked_at`` 为空记录。
- 同维度已有活 token：``get_or_issue`` 内联吊销旧行（``revoked_at`` 非空）再签新，
  新行 ``revoked_at`` 为空，DB 至多一条活 token。
- 多次调用同 workspace+created_by 维度：始终仅一条活 token，活 token 不堆积。
- 吊销后的旧明文 ``authenticate`` 返 None；新明文返非空 Principal。

复用 ``platform_sync/tests/conftest.py`` 的 autouse 建表 fixture + 根 conftest 的
``db_session``；明文断言一律用 ``get_or_issue`` 返回值（sha256 不可逆，不查 DB 比对 hash），
DB 断言只查行数与 ``revoked_at`` 是否为空——与 task-08 acceptance 一致。
写法镜像 ``test_workspace_router.py`` 的 ``_make_user`` / ``_make_workspace``。
"""

from __future__ import annotations

import uuid

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import col

from app.core.config import get_settings
from app.core.security import password_hasher
from app.modules.auth.model import User
from app.modules.platform_sync.token_model import PlatformSyncTokenORM
from app.modules.platform_sync.token_service import (
    PLATFORM_SYNC_TOKEN_PREFIX,
    PlatformSyncTokenService,
)
from app.modules.workspace.model import Workspace


async def _make_user(session: AsyncSession) -> User:
    """造一个普通 User（platform_sync token 绑 created_by，不关心 admin 状态）。"""
    user = User(
        id=uuid.uuid4(),
        email=f"user-{uuid.uuid4().hex[:6]}@example.com",
        password_hash=password_hasher.hash("x"),
        status="active",
    )
    session.add(user)
    await session.commit()
    await session.refresh(user)
    return user


async def _make_workspace(session: AsyncSession) -> Workspace:
    ws = Workspace(
        id=uuid.uuid4(),
        name=f"ws-{uuid.uuid4().hex[:6]}",
        slug=f"ws-{uuid.uuid4().hex[:6]}",
        root_path=f"/tmp/ws-{uuid.uuid4().hex[:8]}",
        status="active",
    )
    session.add(ws)
    await session.commit()
    await session.refresh(ws)
    return ws


def _svc(session: AsyncSession) -> PlatformSyncTokenService:
    return PlatformSyncTokenService(session, settings=get_settings())


async def _active_tokens(
    session: AsyncSession, *, workspace_id: uuid.UUID
) -> list[PlatformSyncTokenORM]:
    stmt = (
        select(PlatformSyncTokenORM)
        .where(col(PlatformSyncTokenORM.workspace_id) == workspace_id)
        .where(col(PlatformSyncTokenORM.revoked_at).is_(None))
    )
    return list((await session.execute(stmt)).scalars().all())


async def _all_tokens(
    session: AsyncSession, *, workspace_id: uuid.UUID
) -> list[PlatformSyncTokenORM]:
    stmt = select(PlatformSyncTokenORM).where(
        col(PlatformSyncTokenORM.workspace_id) == workspace_id
    )
    return list((await session.execute(stmt)).scalars().all())


# ── 场景 1：空表签新 ────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_empty_table_issues_new(db_session: AsyncSession) -> None:
    """空表 → get_or_issue 直接签新；返回 row+明文，DB 恰一条 revoked_at IS NULL 记录。"""
    ws = await _make_workspace(db_session)
    user = await _make_user(db_session)

    row, plaintext = await _svc(db_session).get_or_issue(workspace_id=ws.id, created_by=user.id)

    # 明文仅本次返回 + shpsync_ 前缀；返回 row 未吊销且绑定正确维度
    assert plaintext.startswith(PLATFORM_SYNC_TOKEN_PREFIX)
    assert row.revoked_at is None
    assert row.workspace_id == ws.id
    assert row.created_by == user.id

    # DB 恰一条记录，且未吊销
    all_rows = await _all_tokens(db_session, workspace_id=ws.id)
    assert len(all_rows) == 1
    assert all_rows[0].revoked_at is None


# ── 场景 2：有旧同维度则吊销 + 签新 ─────────────────────────────────────────


@pytest.mark.asyncio
async def test_existing_active_token_revoked_and_reissued(
    db_session: AsyncSession,
) -> None:
    """同维度已有一条 create 出的活 token → get_or_issue 吊销旧行 + 签新；
    旧行 revoked_at 非空、新行 revoked_at 为空、DB 至多一条活 token。"""
    ws = await _make_workspace(db_session)
    user = await _make_user(db_session)
    svc = _svc(db_session)

    # 先 create 一条同维度活 token（模拟 init-provision 之前已手工签发）
    old_row, _old_plaintext = await svc.create(
        workspace_id=ws.id, name="manual", created_by=user.id, scope=None
    )
    assert old_row.revoked_at is None  # 前置：旧 token 确实活着

    new_row, new_plaintext = await svc.get_or_issue(workspace_id=ws.id, created_by=user.id)

    # 新行未吊销 + 明文带前缀 + 新旧行 id 不同（确是新签发，不是复用旧 row）
    assert new_row.revoked_at is None
    assert new_plaintext.startswith(PLATFORM_SYNC_TOKEN_PREFIX)
    assert new_row.id != old_row.id

    # refresh 重新从 DB 拉，确认旧行吊销状态确已落盘（不只 in-memory 假象）
    await db_session.refresh(old_row)
    assert old_row.revoked_at is not None

    # 同维度至多一条活 token，且就是新行
    active = await _active_tokens(db_session, workspace_id=ws.id)
    assert len(active) == 1
    assert active[0].id == new_row.id


# ── 场景 3：多次调用同维度仅一条活 token ────────────────────────────────────


@pytest.mark.asyncio
async def test_repeated_calls_keep_single_active(db_session: AsyncSession) -> None:
    """同 workspace+created_by 多次 get_or_issue → 始终仅一条活 token，活 token 不堆积。"""
    ws = await _make_workspace(db_session)
    user = await _make_user(db_session)
    svc = _svc(db_session)

    last_plaintext: str | None = None
    for _ in range(4):
        row, plaintext = await svc.get_or_issue(workspace_id=ws.id, created_by=user.id)
        assert plaintext.startswith(PLATFORM_SYNC_TOKEN_PREFIX)
        assert row.revoked_at is None  # 每次返回的新行都未吊销
        last_plaintext = plaintext

    # 4 次签发 → 4 条历史记录，但活 token 仅 1 条（不堆积）
    all_rows = await _all_tokens(db_session, workspace_id=ws.id)
    assert len(all_rows) == 4
    active = await _active_tokens(db_session, workspace_id=ws.id)
    assert len(active) == 1

    # 最后一次签发的明文即当前活 token，可鉴权
    principal = await svc.authenticate(last_plaintext)
    assert principal is not None
    assert principal.workspace_id == ws.id


# ── 场景 4：吊销后旧明文 authenticate 返 None，新明文返非空 Principal ──────


@pytest.mark.asyncio
async def test_revoked_old_token_authenticates_none(
    db_session: AsyncSession,
) -> None:
    """get_or_issue 再调用吊销旧 token 后：旧明文 authenticate 返 None，
    新明文返非空 Principal（user=created_by, workspace_id）。"""
    ws = await _make_workspace(db_session)
    user = await _make_user(db_session)
    svc = _svc(db_session)

    # 第一次签发（随后会被第二次 get_or_issue 内联吊销）
    _old_row, old_plaintext = await svc.get_or_issue(workspace_id=ws.id, created_by=user.id)
    # 旧明文此刻可鉴权（前置：未吊销时 authenticate 命中）
    assert await svc.authenticate(old_plaintext) is not None

    # 第二次签发 → 旧 token 被内联吊销 + 签新
    new_row, new_plaintext = await svc.get_or_issue(workspace_id=ws.id, created_by=user.id)
    assert new_plaintext != old_plaintext

    # 旧明文：旧行已吊销（revoked_at 非空）→ authenticate 返 None
    assert await svc.authenticate(old_plaintext) is None
    # 新明文：非空 Principal，派生 user=created_by / workspace_id / token_id
    principal = await svc.authenticate(new_plaintext)
    assert principal is not None
    assert principal.workspace_id == ws.id
    assert principal.user.id == user.id
    assert principal.token_id == new_row.id
