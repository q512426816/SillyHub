"""Workspace member management — service-layer helpers.

Pure ``async def(session, ...)`` functions for the workspace members API
(task-02 of change ``2026-06-16-workspace-members``). They operate on the
existing ``UserWorkspaceRole`` + ``Role`` + ``User`` tables and never touch
HTTP — that translation is the router's job (task-03).

Business errors are expressed with three primitive exception shapes so the
router can map them deterministically:

* ``ValueError("invalid_role_key")`` — ``role_key`` not in the whitelist.
* ``ValueError("cannot_remove_last_owner")`` — mutation would leave the ws
  with zero ``workspace_owner`` rows.
* ``LookupError("user_not_found")`` — target ``user_id`` missing, disabled,
  or (in ``update`` / ``remove`` / ``transfer``) not a member of this ws.
* ``LookupError("role_not_seeded")`` — defensive: a whitelisted role key has
  no row in ``roles`` (should never happen post-migration).

Workspace existence uses :class:`app.core.errors.WorkspaceNotFound`.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import col

from app.core.errors import WorkspaceNotFound
from app.modules.auth.model import Role, User, UserWorkspaceRole
from app.modules.workspace.member_runtimes.model import WorkspaceMemberRuntime
from app.modules.workspace.model import Workspace
from app.modules.workspace.schema import UserSearchHit, WorkspaceMemberView

#: The only role keys that may be granted through this API. ``platform_admin``
#: / ``reviewer`` / ``qa`` / ``component_lead`` are deliberately excluded —
#: they are system / cross-workspace roles and must never be granted via the
#: per-workspace members endpoint.
ROLE_KEY_WHITELIST: frozenset[str] = frozenset({"workspace_owner", "developer", "viewer"})


# ────────────────────────────────────────────────────────────────────────────
# Internal helpers
# ────────────────────────────────────────────────────────────────────────────


async def _assert_workspace_exists(session: AsyncSession, *, workspace_id: uuid.UUID) -> None:
    """Raise :class:`WorkspaceNotFound` if the workspace is missing or soft-deleted.

    Done with a lightweight COUNT-style existence query rather than loading
    the full row — members operations never need the Workspace row itself.
    """
    stmt = (
        select(col(Workspace.id))
        .where(col(Workspace.id) == workspace_id)
        .where(col(Workspace.deleted_at).is_(None))
        .limit(1)
    )
    found = (await session.execute(stmt)).scalars().first()
    if found is None:
        raise WorkspaceNotFound(
            "Workspace not found.",
            details={"workspace_id": str(workspace_id)},
        )


async def _get_role_by_key(session: AsyncSession, *, role_key: str) -> Role:
    """Fetch a Role by its unique key. Raises ``LookupError("role_not_seeded")``
    if no row exists — defensive guard; the whitelist should guarantee a hit
    once migrations have seeded the seven system roles."""
    stmt = select(Role).where(col(Role.key) == role_key).limit(1)
    role = (await session.execute(stmt)).scalars().first()
    if role is None:
        raise LookupError("role_not_seeded")
    return role


async def _count_workspace_owners(session: AsyncSession, *, workspace_id: uuid.UUID) -> int:
    """Count ``workspace_owner`` rows in this workspace."""
    stmt = (
        select(func.count())
        .select_from(UserWorkspaceRole)
        .join(Role, col(Role.id) == col(UserWorkspaceRole.role_id))
        .where(col(UserWorkspaceRole.workspace_id) == workspace_id)
        .where(col(Role.key) == "workspace_owner")
    )
    return int((await session.execute(stmt)).scalar() or 0)


# ────────────────────────────────────────────────────────────────────────────
# 1) list_members
# ────────────────────────────────────────────────────────────────────────────


async def list_members(
    session: AsyncSession,
    *,
    workspace_id: uuid.UUID,
    current_user_id: uuid.UUID | None = None,
) -> list[WorkspaceMemberView]:
    """List every (user, role) row in this workspace, joined to users + roles.

    Read-only — does not commit. ``is_current_user`` is computed in Python
    (not in SQL) so callers can highlight the requesting user in the UI.

    Raises:
        WorkspaceNotFound: ``workspace_id`` is missing or soft-deleted.
    """
    await _assert_workspace_exists(session, workspace_id=workspace_id)

    stmt = (
        select(
            col(User.id),
            col(User.email),
            col(User.display_name),
            col(Role.key),
            col(Role.name),
            col(UserWorkspaceRole.granted_at),
        )
        .join(User, col(User.id) == col(UserWorkspaceRole.user_id))
        .join(Role, col(Role.id) == col(UserWorkspaceRole.role_id))
        .where(col(UserWorkspaceRole.workspace_id) == workspace_id)
        .where(col(User.status) == "active")
        .order_by(col(UserWorkspaceRole.granted_at).asc())
    )
    rows = (await session.execute(stmt)).all()

    views: list[WorkspaceMemberView] = []
    for uid, email, display_name, role_key, role_name, granted_at in rows:
        views.append(
            WorkspaceMemberView(
                user_id=uid,
                email=email,
                display_name=display_name,
                role_key=role_key,
                role_name=role_name,
                granted_at=granted_at,
                is_current_user=(current_user_id is not None and uid == current_user_id),
            )
        )
    return views


# ────────────────────────────────────────────────────────────────────────────
# 2) search_users_for_invite
# ────────────────────────────────────────────────────────────────────────────


async def search_users_for_invite(
    session: AsyncSession,
    *,
    workspace_id: uuid.UUID,
    q: str,
    limit: int = 10,
) -> list[UserSearchHit]:
    """Fuzzy search active users by display_name OR email, excluding those who
    are already members of this workspace.

    ``q`` is expected to be already validated (``min_length=2``) by the router
    via ``Query(min_length=2, le=50)``; this function additionally tolerates
    empty / whitespace input by returning ``[]`` so a stray call cannot
    surface a 500. Pattern matching uses ``func.lower().like()`` instead of
    ``ilike()`` so the query is portable between Postgres and the in-memory
    SQLite used by the test suite.

    Read-only — does not commit.

    Raises:
        WorkspaceNotFound: ``workspace_id`` is missing or soft-deleted.
    """
    await _assert_workspace_exists(session, workspace_id=workspace_id)

    if not q or not q.strip():
        return []

    pattern = f"%{q.strip()}%"
    lowered = pattern.lower()
    effective_limit = max(1, min(int(limit), 50))

    # LEFT JOIN user_workspace_roles for this workspace; the IS NULL filter
    # discards any user that already holds at least one role here.
    membership_subq = select(col(UserWorkspaceRole.user_id)).where(
        col(UserWorkspaceRole.workspace_id) == workspace_id
    )

    stmt = (
        select(
            col(User.id),
            col(User.email),
            col(User.display_name),
        )
        .where(col(User.status) == "active")
        .where(col(User.deleted_at).is_(None))
        .where(
            (func.lower(col(User.email)).like(lowered))
            | (func.lower(col(User.display_name)).like(lowered))
        )
        .where(col(User.id).not_in(membership_subq))
        .order_by(col(User.email).asc())
        .limit(effective_limit)
    )
    rows = (await session.execute(stmt)).all()

    return [
        UserSearchHit(
            user_id=uid,
            email=email,
            display_name=display_name,
            is_member=False,
        )
        for uid, email, display_name in rows
    ]


# ────────────────────────────────────────────────────────────────────────────
# 3) add_or_update_member
# ────────────────────────────────────────────────────────────────────────────


async def add_or_update_member(
    session: AsyncSession,
    *,
    workspace_id: uuid.UUID,
    user_id: uuid.UUID,
    role_key: str,
    granted_by: uuid.UUID | None,
) -> UserWorkspaceRole:
    """Idempotent upsert: if ``user_id`` is already a member of this workspace
    update their role, otherwise insert a new row.

    Raises:
        ValueError("invalid_role_key"): ``role_key`` not in the whitelist.
        LookupError("user_not_found"): user missing or not ``status='active'``.
        LookupError("role_not_seeded"): whitelisted role not in ``roles``.
        WorkspaceNotFound: ``workspace_id`` missing or soft-deleted.
    """
    await _assert_workspace_exists(session, workspace_id=workspace_id)

    if role_key not in ROLE_KEY_WHITELIST:
        raise ValueError("invalid_role_key")

    user_stmt = (
        select(User).where(col(User.id) == user_id).where(col(User.status) == "active").limit(1)
    )
    user = (await session.execute(user_stmt)).scalars().first()
    if user is None:
        raise LookupError("user_not_found")

    role = await _get_role_by_key(session, role_key=role_key)

    existing_stmt = (
        select(UserWorkspaceRole)
        .where(col(UserWorkspaceRole.user_id) == user_id)
        .where(col(UserWorkspaceRole.workspace_id) == workspace_id)
        .limit(1)
    )
    existing = (await session.execute(existing_stmt)).scalars().first()

    now = datetime.now(UTC)
    if existing is not None:
        # Update branch — keep the composite PK row, swap role_id in place.
        existing.role_id = role.id
        existing.granted_at = now
        existing.granted_by = granted_by
        row = existing
    else:
        row = UserWorkspaceRole(
            user_id=user_id,
            workspace_id=workspace_id,
            role_id=role.id,
            granted_by=granted_by,
            granted_at=now,
        )
        session.add(row)

    await session.commit()
    await session.refresh(row)
    return row


# ────────────────────────────────────────────────────────────────────────────
# 4) update_member_role
# ────────────────────────────────────────────────────────────────────────────


async def update_member_role(
    session: AsyncSession,
    *,
    workspace_id: uuid.UUID,
    user_id: uuid.UUID,
    role_key: str,
) -> UserWorkspaceRole:
    """Change an existing member's role. Refuses to demote the last
    ``workspace_owner`` (would orphan the workspace).

    Raises:
        ValueError("invalid_role_key"): ``role_key`` not in the whitelist.
        ValueError("cannot_remove_last_owner"): this user is the last owner
            and the new role is not ``workspace_owner``.
        LookupError("user_not_found"): this user is not a member of the ws.
        LookupError("role_not_seeded"): whitelisted role not in ``roles``.
        WorkspaceNotFound: ``workspace_id`` missing or soft-deleted.
    """
    await _assert_workspace_exists(session, workspace_id=workspace_id)

    if role_key not in ROLE_KEY_WHITELIST:
        raise ValueError("invalid_role_key")

    existing_stmt = (
        select(UserWorkspaceRole)
        .where(col(UserWorkspaceRole.user_id) == user_id)
        .where(col(UserWorkspaceRole.workspace_id) == workspace_id)
        .limit(1)
    )
    existing = (await session.execute(existing_stmt)).scalars().first()
    if existing is None:
        raise LookupError("user_not_found")

    new_role = await _get_role_by_key(session, role_key=role_key)

    # Last-owner guard: if the member currently holds workspace_owner and we
    # are about to take that away, count owners first.
    current_role_stmt = select(Role).where(col(Role.id) == existing.role_id).limit(1)
    current_role = (await session.execute(current_role_stmt)).scalars().first()
    if (
        current_role is not None
        and current_role.key == "workspace_owner"
        and role_key != "workspace_owner"
    ):
        owner_count = await _count_workspace_owners(session, workspace_id=workspace_id)
        if owner_count <= 1:
            raise ValueError("cannot_remove_last_owner")

    existing.role_id = new_role.id
    existing.granted_at = datetime.now(UTC)
    await session.commit()
    await session.refresh(existing)
    return existing


# ────────────────────────────────────────────────────────────────────────────
# 5) remove_member
# ────────────────────────────────────────────────────────────────────────────


async def remove_member(
    session: AsyncSession,
    *,
    workspace_id: uuid.UUID,
    user_id: uuid.UUID,
) -> None:
    """Delete every ``(user_id, workspace_id, *)`` row for this member (a user
    may legitimately hold several roles). Refuses to remove the last
    ``workspace_owner``.

    Raises:
        ValueError("cannot_remove_last_owner"): this user is the last owner.
        LookupError("user_not_found"): this user is not a member of the ws.
        WorkspaceNotFound: ``workspace_id`` missing or soft-deleted.
    """
    await _assert_workspace_exists(session, workspace_id=workspace_id)

    rows_stmt = (
        select(UserWorkspaceRole)
        .where(col(UserWorkspaceRole.user_id) == user_id)
        .where(col(UserWorkspaceRole.workspace_id) == workspace_id)
    )
    existing_rows = list((await session.execute(rows_stmt)).scalars().all())
    if not existing_rows:
        raise LookupError("user_not_found")

    # Does this member currently hold the workspace_owner role in any row?
    owner_role_ids_stmt = select(col(Role.id)).where(col(Role.key) == "workspace_owner")
    owner_role_ids = set((await session.execute(owner_role_ids_stmt)).scalars().all())
    has_owner_role = any(row.role_id in owner_role_ids for row in existing_rows)

    if has_owner_role:
        owner_count = await _count_workspace_owners(session, workspace_id=workspace_id)
        if owner_count <= 1:
            raise ValueError("cannot_remove_last_owner")

    for row in existing_rows:
        await session.delete(row)
    # task-09: cascade-clear the member's binding row (FR-008).
    await session.execute(
        delete(WorkspaceMemberRuntime).where(
            col(WorkspaceMemberRuntime.workspace_id) == workspace_id,
            col(WorkspaceMemberRuntime.user_id) == user_id,
        )
    )
    await session.commit()


# ────────────────────────────────────────────────────────────────────────────
# 6) transfer_ownership
# ────────────────────────────────────────────────────────────────────────────


async def transfer_ownership(
    session: AsyncSession,
    *,
    workspace_id: uuid.UUID,
    target_user_id: uuid.UUID,
    current_user_id: uuid.UUID,
) -> None:
    """Atomically promote ``target_user_id`` to ``workspace_owner`` and demote
    ``current_user_id`` to ``developer``.

    Single transaction: all owner rows of this workspace are locked via
    ``SELECT ... FOR UPDATE`` so two concurrent transfers cannot leave the
    workspace ownerless or grant a second owner unintentionally. Any error
    rolls the transaction back and leaves rows untouched.

    The ``current_user_id`` demotion is best-effort: if ``current_user_id``
    is not currently an owner (or not even a member) the loop is a no-op,
    which keeps the operation idempotent for the legitimate path where the
    router has already verified the caller holds ``member:manage``.

    Raises:
        LookupError("user_not_found"): ``target_user_id`` is not a member of
            this workspace (or, defensively, not an active user).
        LookupError("role_not_seeded"): ``workspace_owner`` or ``developer``
            missing from ``roles``.
        ValueError("cannot_remove_last_owner"): defensive — the ws currently
            has zero owners; cannot transfer from an empty set.
        WorkspaceNotFound: ``workspace_id`` missing or soft-deleted.
    """
    await _assert_workspace_exists(session, workspace_id=workspace_id)

    # Resolve the target's existing UWR row up-front so we can fail fast.
    target_stmt = (
        select(UserWorkspaceRole)
        .where(col(UserWorkspaceRole.user_id) == target_user_id)
        .where(col(UserWorkspaceRole.workspace_id) == workspace_id)
        .limit(1)
    )
    target_row = (await session.execute(target_stmt)).scalars().first()
    if target_row is None:
        raise LookupError("user_not_found")

    # Defensive: also reject inactive target users (caller should already have
    # filtered, but the membership row may outlive a disable).
    target_user_stmt = select(col(User.status)).where(col(User.id) == target_user_id).limit(1)
    target_status = (await session.execute(target_user_stmt)).scalar()
    if target_status != "active":
        raise LookupError("user_not_found")

    owner_role = await _get_role_by_key(session, role_key="workspace_owner")
    developer_role = await _get_role_by_key(session, role_key="developer")

    # The dependency ``get_session`` hands us an AsyncSession whose first
    # query auto-begins a transaction, so ``session.begin()`` here would raise
    # ``InvalidRequestError("A transaction is already begun on this Session")``.
    # ``begin_nested()`` opens a SAVEPOINT inside the active transaction —
    # same atomicity guarantee (rollback on error) without colliding with the
    # outer autobegin. On Postgres this still serialises concurrent transfers
    # because the ``SELECT … FOR UPDATE`` below takes real row locks inside
    # the savepoint; on SQLite ``with_for_update`` is a no-op (single writer).
    try:
        async with session.begin_nested():
            # Lock every current owner row in this workspace to serialise
            # concurrent transfers. ``with_for_update`` is a no-op on SQLite
            # (no row locks) but is the correct Postgres behaviour in prod.
            owner_rows_stmt = (
                select(UserWorkspaceRole)
                .join(Role, col(Role.id) == col(UserWorkspaceRole.role_id))
                .where(col(UserWorkspaceRole.workspace_id) == workspace_id)
                .where(col(Role.key) == "workspace_owner")
                .with_for_update()
            )
            owner_rows = list((await session.execute(owner_rows_stmt)).scalars().all())
            if not owner_rows:
                raise ValueError("cannot_remove_last_owner")  # defensive

            # Promote target.
            target_row.role_id = owner_role.id
            target_row.granted_at = datetime.now(UTC)
            await session.flush()

            # Demote the current user's owner rows (if any). Skip the row that
            # belongs to ``target_user_id`` so the self-transfer (target ==
            # current) edge case is a no-op: target is promoted and stays the
            # owner, the current-user loop has nothing to demote. See task-02
            # §边界 #14.
            current_rows_stmt = (
                select(UserWorkspaceRole)
                .where(col(UserWorkspaceRole.user_id) == current_user_id)
                .where(col(UserWorkspaceRole.workspace_id) == workspace_id)
            )
            current_rows = list((await session.execute(current_rows_stmt)).scalars().all())
            now = datetime.now(UTC)
            for row in current_rows:
                if row.user_id == target_user_id:
                    continue
                if row.role_id == owner_role.id:
                    row.role_id = developer_role.id
                    row.granted_at = now
            await session.flush()
        # Exit ``begin_nested`` block → SAVEPOINT released. Commit the outer
        # transaction so the writes are durable.
        await session.commit()
    except Exception:
        await session.rollback()
        raise
