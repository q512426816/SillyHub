"""SQLAlchemy event hooks for automatic audit logging.

Captures all BaseModel(table=True) mutations and writes to AuditLog.

Design reference: .sillyspec/changes/2026-05-30-workflow-state-machine/design.md AD-1
"""

from __future__ import annotations

import json
import logging
import uuid
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import event, inspect
from sqlalchemy.ext.asyncio import AsyncEngine

logger = logging.getLogger("audit_hooks")

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

_EXCLUDED_TABLES: frozenset[str] = frozenset({"audit_logs"})
"""Tables that should NOT trigger audit hooks (recursion protection)."""


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _should_audit(instance: object) -> bool:
    """Return True if this instance should be audited."""
    table_name = getattr(instance, "__tablename__", None)
    if table_name is None:
        return False
    if table_name in _EXCLUDED_TABLES:
        return False
    return True


def _singularize(table_name: str) -> str:
    """Convert plural table name to singular for action/resource_type."""
    if table_name.endswith("ses"):
        return table_name[:-2]
    if table_name.endswith("s"):
        return table_name[:-1]
    return table_name


def _serialize_value(val: Any) -> Any:
    """Serialize a field value to JSON-safe format."""
    if val is None:
        return None
    if isinstance(val, uuid.UUID):
        return str(val)
    if isinstance(val, datetime):
        return val.isoformat()
    return val


def _get_resource_id(instance: object) -> uuid.UUID:
    """Get the primary key ID from an instance."""
    return instance.id


def _get_audit_context(connection: Any, target: object = None) -> dict | None:
    """Extract audit_context from connection.info, falling back to session.info.

    SQLAlchemy Mapper events (after_insert etc.) receive a sync Connection,
    while our audit_context is set on AsyncSession.info (which proxies to the
    underlying sync Session.info).  The two ``.info`` dicts are distinct, so
    we need to bridge them via ``inspect(target).session``.
    """
    # 1. Try connection.info (if context was injected directly on the connection)
    info = getattr(connection, "info", None)
    if info is not None:
        ctx = info.get("audit_context")
        if ctx is not None:
            return ctx

    # 2. Fall back to the target's session.info (AsyncSession.info → sync Session.info)
    if target is not None:
        try:
            state = inspect(target)
            session = state.session
            if session is not None:
                return session.info.get("audit_context")
        except Exception:
            pass

    return None


def _collect_all_fields(instance: object) -> dict[str, Any]:
    """Collect all column field values from an instance as a dict."""
    mapper = inspect(instance.__class__)
    result = {}
    for col in mapper.columns:
        key = col.key
        if hasattr(instance, key):
            result[key] = _serialize_value(getattr(instance, key))
    return result


def _collect_changed_fields(instance: object) -> dict[str, dict[str, Any]]:
    """Collect only changed fields with old/new values."""
    state = inspect(instance)
    changed = {}
    for attr in state.mapper.column_attrs:
        key = attr.key
        history = state.get_history(key, passive=True)
        if history.added or history.deleted:
            old_val = history.deleted[0] if history.deleted else None
            new_val = history.added[0] if history.added else None
            if old_val != new_val:
                changed[key] = {
                    "from": _serialize_value(old_val),
                    "to": _serialize_value(new_val),
                }
    return changed


def _write_audit_log(
    connection: Any,
    *,
    actor_id: uuid.UUID | None,
    workspace_id: uuid.UUID | None,
    action: str,
    resource_type: str,
    resource_id: uuid.UUID,
    details_json: str | None,
) -> None:
    """Insert an AuditLog record using Core SQL."""
    from app.modules.workflow.model import AuditLog

    now = datetime.now(timezone.utc)
    log_id = uuid.uuid4()

    connection.execute(
        AuditLog.__table__.insert(),
        {
            "id": log_id,
            "workspace_id": workspace_id,
            "actor_id": actor_id,
            "action": action,
            "resource_type": resource_type,
            "resource_id": resource_id,
            "details_json": details_json,
            "timestamp": now,
        },
    )


# ---------------------------------------------------------------------------
# Hook functions (synchronous - SQLAlchemy Mapper events are sync in async mode)
# ---------------------------------------------------------------------------


def _after_insert_hook(mapper: Any, connection: Any, target: object) -> None:
    """after_insert event handler."""
    if not _should_audit(target):
        return
    ctx = _get_audit_context(connection, target)
    if ctx is None:
        return

    table_name = target.__tablename__
    resource_type = _singularize(table_name)
    resource_id = _get_resource_id(target)
    action = f"{resource_type}.insert"

    fields = _collect_all_fields(target)
    details_json = json.dumps({"fields": fields}, default=str, ensure_ascii=False)

    _write_audit_log(
        connection,
        actor_id=ctx.get("actor_id"),
        workspace_id=ctx.get("workspace_id"),
        action=action,
        resource_type=resource_type,
        resource_id=resource_id,
        details_json=details_json,
    )


def _after_update_hook(mapper: Any, connection: Any, target: object) -> None:
    """after_update event handler."""
    if not _should_audit(target):
        return
    ctx = _get_audit_context(connection, target)
    if ctx is None:
        return

    changed_fields = _collect_changed_fields(target)
    if not changed_fields:
        return

    table_name = target.__tablename__
    resource_type = _singularize(table_name)
    resource_id = _get_resource_id(target)
    action = f"{resource_type}.update"

    from_fields = {k: v["from"] for k, v in changed_fields.items()}
    to_fields = {k: v["to"] for k, v in changed_fields.items()}
    details_json = json.dumps(
        {
            "changed_fields": list(changed_fields.keys()),
            "from": from_fields,
            "to": to_fields,
        },
        default=str,
        ensure_ascii=False,
    )

    _write_audit_log(
        connection,
        actor_id=ctx.get("actor_id"),
        workspace_id=ctx.get("workspace_id"),
        action=action,
        resource_type=resource_type,
        resource_id=resource_id,
        details_json=details_json,
    )


def _after_delete_hook(mapper: Any, connection: Any, target: object) -> None:
    """after_delete event handler."""
    if not _should_audit(target):
        return
    ctx = _get_audit_context(connection, target)
    if ctx is None:
        return

    table_name = target.__tablename__
    resource_type = _singularize(table_name)
    resource_id = _get_resource_id(target)
    action = f"{resource_type}.delete"

    details_json = json.dumps({"deleted": True}, default=str, ensure_ascii=False)

    _write_audit_log(
        connection,
        actor_id=ctx.get("actor_id"),
        workspace_id=ctx.get("workspace_id"),
        action=action,
        resource_type=resource_type,
        resource_id=resource_id,
        details_json=details_json,
    )


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


def register_audit_hooks(engine: AsyncEngine) -> None:
    """Register SQLAlchemy audit event hooks for all BaseModel table models.

    Must be called AFTER all models have been imported and mappers configured.
    Typical call site: app/main.py lifespan, after engine creation.
    """
    from app.models.base import BaseModel

    registered: list[str] = []

    def _collect_subclasses(cls: type) -> list[type]:
        result = []
        for sub in cls.__subclasses__():
            result.append(sub)
            result.extend(_collect_subclasses(sub))
        return result

    all_subclasses = _collect_subclasses(BaseModel)

    for cls in all_subclasses:
        table_name = getattr(cls, "__tablename__", None)
        if table_name is None:
            continue
        if table_name in _EXCLUDED_TABLES:
            continue

        # Skip if already registered (idempotent)
        if event.contains(cls, "after_insert", _after_insert_hook):
            registered.append(f"{table_name}(skipped)")
            continue

        event.listen(cls, "after_insert", _after_insert_hook)
        event.listen(cls, "after_update", _after_update_hook)
        event.listen(cls, "after_delete", _after_delete_hook)

        registered.append(table_name)

    logger.info("Audit hooks registered for %d tables: %s", len(registered), registered)
