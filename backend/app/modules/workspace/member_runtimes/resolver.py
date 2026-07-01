"""``MemberBindingResolver`` — single dispatch-time entry for per-member binding."""

from __future__ import annotations

import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.workspace.member_runtimes.exceptions import MemberBindingNotFound
from app.modules.workspace.member_runtimes.model import WorkspaceMemberRuntime


class MemberBindingResolver:
    """Lookup a member's binding row at dispatch time."""

    @staticmethod
    async def resolve_member_binding(
        session: AsyncSession,
        workspace_id: uuid.UUID,
        actor_user_id: uuid.UUID,
    ) -> WorkspaceMemberRuntime:
        """Return the binding row for ``(workspace_id, actor_user_id)``.

        Raises :class:`MemberBindingNotFound` (409) when no row exists.
        """
        row = await session.get(WorkspaceMemberRuntime, (workspace_id, actor_user_id))
        if row is None:
            raise MemberBindingNotFound(workspace_id=workspace_id, user_id=actor_user_id)
        return row
