"""Unit tests for audit_hooks — SQLAlchemy event hook audit logging."""

from __future__ import annotations

import json
import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import col

from app.core.audit_hooks import register_audit_hooks
from app.modules.auth.model import User
from app.modules.change.model import Change
from app.modules.workflow.model import AuditLog
from app.modules.workspace.model import Workspace

# ---------------------------------------------------------------------------
# Fixed IDs for reproducible test data
# ---------------------------------------------------------------------------
_USER_ID = uuid.UUID("00000000-0000-0000-0000-000000000002")
_WS_ID = uuid.UUID("00000000-0000-0000-0000-000000000001")


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


async def _ensure_user(session: AsyncSession) -> User:
    """Create a real User row (needed for AuditLog.actor_id FK)."""
    existing = await session.get(User, _USER_ID)
    if existing is not None:
        return existing
    user = User(
        id=_USER_ID,
        email="audit-test@example.com",
        password_hash="$2b$04$dummyhashnotforproduction",
        display_name="Audit Test User",
        status="active",
    )
    session.add(user)
    await session.flush()
    return user


async def _ensure_workspace(session: AsyncSession) -> Workspace:
    """Create a real Workspace row (needed for AuditLog.workspace_id FK)."""
    existing = await session.get(Workspace, _WS_ID)
    if existing is not None:
        return existing
    ws = Workspace(
        id=_WS_ID,
        name="Audit Test WS",
        slug="audit-test",
        root_path="/tmp/audit-test",
        status="active",
    )
    session.add(ws)
    await session.flush()
    return ws


async def _setup_audit_env(session: AsyncSession) -> tuple[User, Workspace]:
    """Create prerequisite User + Workspace WITHOUT audit_context.

    The hook silently skips when audit_context is absent, so these
    prerequisite rows are created without generating audit logs.
    """
    user = await _ensure_user(session)
    ws = await _ensure_workspace(session)
    await session.commit()
    return user, ws


async def _make_change(session: AsyncSession, **overrides) -> Change:
    """Insert a Change row (caller must set audit_context beforehand)."""
    ws = await _ensure_workspace(session)
    defaults = dict(
        id=uuid.uuid4(),
        workspace_id=ws.id,
        change_key=f"test-{uuid.uuid4().hex[:8]}",
        title="Test Change",
        status="draft",
        location="change",
        path=".sillyspec/changes/test",
    )
    defaults.update(overrides)
    change = Change(**defaults)
    session.add(change)
    await session.commit()
    await session.refresh(change)
    return change


async def _get_audit_logs(session: AsyncSession, **filters) -> list[AuditLog]:
    stmt = select(AuditLog).order_by(col(AuditLog.timestamp))
    for key, value in filters.items():
        stmt = stmt.where(col(getattr(AuditLog, key)) == value)
    result = await session.execute(stmt)
    return list(result.scalars().all())


def _set_audit_context(session: AsyncSession, actor_id: uuid.UUID, workspace_id: uuid.UUID) -> None:
    session.info["audit_context"] = {
        "actor_id": actor_id,
        "workspace_id": workspace_id,
    }


def _clear_audit_context(session: AsyncSession) -> None:
    session.info.pop("audit_context", None)


# ---------------------------------------------------------------------------
# Register hooks once per test module
# Mapper-level events are global — the engine param is just for API compat.
# ---------------------------------------------------------------------------
_hooks_registered = False


def _maybe_register_hooks(db_session: AsyncSession) -> None:
    global _hooks_registered
    if _hooks_registered:
        return
    from sqlalchemy.ext.asyncio import create_async_engine

    _engine = create_async_engine("sqlite+aiosqlite:///:memory:", future=True)
    register_audit_hooks(_engine)
    _hooks_registered = True


# -- Tests --


async def test_after_insert_creates_audit_log(db_session: AsyncSession) -> None:
    """after_insert hook should create an AuditLog record."""
    _maybe_register_hooks(db_session)
    user, ws = await _setup_audit_env(db_session)
    _set_audit_context(db_session, user.id, ws.id)

    change = await _make_change(db_session)

    logs = await _get_audit_logs(db_session, resource_type="change", action="change.insert")
    assert len(logs) == 1
    log = logs[0]

    assert log.resource_id == change.id
    assert log.actor_id == user.id
    assert log.workspace_id == ws.id
    assert log.details_json is not None
    details = json.loads(log.details_json)
    assert "fields" in details
    assert details["fields"]["status"] == "draft"
    assert log.timestamp is not None


async def test_after_update_creates_audit_log(db_session: AsyncSession) -> None:
    """after_update hook should record changed fields."""
    _maybe_register_hooks(db_session)
    user, ws = await _setup_audit_env(db_session)
    _set_audit_context(db_session, user.id, ws.id)

    change = await _make_change(db_session)

    # Update status
    change.status = "proposed"
    db_session.add(change)
    await db_session.commit()

    logs = await _get_audit_logs(db_session, action="change.update")
    assert len(logs) >= 1
    log = logs[-1]

    assert log.resource_type == "change"
    assert log.resource_id == change.id
    assert log.actor_id == user.id
    details = json.loads(log.details_json)
    assert "changed_fields" in details
    assert "status" in details["changed_fields"]
    assert details["from"]["status"] == "draft"
    assert details["to"]["status"] == "proposed"


async def test_after_delete_creates_audit_log(db_session: AsyncSession) -> None:
    """after_delete hook should record deletion."""
    _maybe_register_hooks(db_session)
    user, ws = await _setup_audit_env(db_session)
    _set_audit_context(db_session, user.id, ws.id)

    change = await _make_change(db_session)
    change_id = change.id

    await db_session.delete(change)
    await db_session.commit()

    logs = await _get_audit_logs(db_session, action="change.delete")
    assert len(logs) >= 1
    log = logs[-1]

    assert log.resource_type == "change"
    assert log.resource_id == change_id
    assert log.actor_id == user.id
    details = json.loads(log.details_json)
    assert details.get("deleted") is True


async def test_audit_log_does_not_trigger_hook(db_session: AsyncSession) -> None:
    """AuditLog writes should NOT trigger new hooks (recursion protection)."""
    _maybe_register_hooks(db_session)
    user, ws = await _setup_audit_env(db_session)
    _set_audit_context(db_session, user.id, ws.id)

    _change = await _make_change(db_session)

    all_logs = await _get_audit_logs(db_session)
    change_logs = [line for line in all_logs if line.resource_type == "change"]
    audit_self_logs = [line for line in all_logs if line.resource_type == "audit_log"]

    assert len(change_logs) >= 1
    assert len(audit_self_logs) == 0  # recursion protection


async def test_no_audit_context_silent_skip(db_session: AsyncSession) -> None:
    """Without audit_context, hook should silently skip."""
    _maybe_register_hooks(db_session)
    _clear_audit_context(db_session)

    # Must create workspace without audit_context, same as production skip path
    ws = await _ensure_workspace(db_session)
    await db_session.commit()

    change_id = uuid.uuid4()
    change = Change(
        id=change_id,
        workspace_id=ws.id,
        change_key="test-no-ctx",
        title="No Context",
        status="draft",
        location="change",
        path=".sillyspec/changes/test",
    )
    db_session.add(change)
    await db_session.commit()

    all_logs = await _get_audit_logs(db_session)
    assert len(all_logs) == 0

    assert change.id is not None  # Change was created normally


async def test_actor_id_and_workspace_id_recorded(db_session: AsyncSession) -> None:
    """audit_context actor_id and workspace_id should propagate correctly."""
    _maybe_register_hooks(db_session)
    user, ws = await _setup_audit_env(db_session)

    # Create a second real user (needed for FK on audit_logs.actor_id)
    user_b_id = uuid.UUID("00000000-0000-0000-0000-000000000003")
    user_b = await db_session.get(User, user_b_id)
    if user_b is None:
        user_b = User(
            id=user_b_id,
            email="audit-test-b@example.com",
            password_hash="$2b$04$dummyhashnotforproduction",
            display_name="Audit Test User B",
            status="active",
        )
        db_session.add(user_b)
        await db_session.commit()

    _set_audit_context(db_session, user.id, ws.id)
    change = await _make_change(db_session)

    # Switch actor
    _set_audit_context(db_session, user_b_id, ws.id)
    change.status = "proposed"
    db_session.add(change)
    await db_session.commit()

    all_logs = await _get_audit_logs(db_session)
    insert_logs = [line for line in all_logs if line.action == "change.insert"]
    update_logs = [line for line in all_logs if line.action == "change.update"]

    assert len(insert_logs) >= 1
    assert insert_logs[0].actor_id == user.id
    assert len(update_logs) >= 1
    assert update_logs[0].actor_id == user_b_id

    for log in all_logs:
        assert log.workspace_id == ws.id


async def test_no_update_log_when_field_unchanged(db_session: AsyncSession) -> None:
    """Setting field to same value should not produce update audit record."""
    _maybe_register_hooks(db_session)
    user, ws = await _setup_audit_env(db_session)
    _set_audit_context(db_session, user.id, ws.id)

    change = await _make_change(db_session, title="Original Title")

    update_count_before = len(await _get_audit_logs(db_session, action="change.update"))

    change.title = "Original Title"  # same value
    db_session.add(change)
    await db_session.commit()

    update_count_after = len(await _get_audit_logs(db_session, action="change.update"))
    assert update_count_after == update_count_before


async def test_multiple_inserts_in_same_session(db_session: AsyncSession) -> None:
    """Multiple inserts in same session should each produce audit record."""
    _maybe_register_hooks(db_session)
    user, ws = await _setup_audit_env(db_session)
    _set_audit_context(db_session, user.id, ws.id)

    changes = []
    for i in range(3):
        change = await _make_change(db_session, change_key=f"test-{i}")
        changes.append(change)

    logs = await _get_audit_logs(db_session, action="change.insert")
    assert len(logs) == 3

    logged_ids = {log.resource_id for log in logs}
    expected_ids = {c.id for c in changes}
    assert logged_ids == expected_ids
