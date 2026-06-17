"""``UserService`` moved to :mod:`app.modules.admin.users_service`.

This module re-exports the class for backwards compatibility with
historical imports (tests, other modules). New code should import from
``app.modules.admin.users_service`` directly.

Change ``2026-06-16-admin-org-role-center`` task-06.
"""

from __future__ import annotations

from app.modules.admin.users_service import UserService

__all__ = ["UserService"]
