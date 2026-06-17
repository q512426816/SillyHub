"""Admin module: users / organizations / roles.

Mounted at ``/api/admin/*`` (see :mod:`app.main`). Skeleton landed by
change ``2026-06-16-admin-org-role-center`` task-03; the three sub-services
are filled in by task-04 (roles), task-05 (organizations), task-06 (users).

Top-level package intentionally does NOT re-export the router here —
``main.py`` imports it explicitly from
:mod:`app.modules.admin.router` to keep the import graph lazy and avoid
circular dependencies against :mod:`app.modules.settings`.
"""

from __future__ import annotations
