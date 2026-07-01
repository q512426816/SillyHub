"""Member binding exceptions (change 2026-07-01-collaborative-workspace)."""

from __future__ import annotations

import uuid

from app.core.errors import AppError


class MemberBindingNotFound(AppError):
    """Raised when no ``workspace_member_runtimes`` row exists for the actor.

    HTTP 409, code ``member_binding_not_found`` — the frontend catches this to
    display the "configure your daemon + local path" access guide (FR-003).
    """

    def __init__(
        self,
        *,
        workspace_id: uuid.UUID | None = None,
        user_id: uuid.UUID | None = None,
    ) -> None:
        details: dict[str, str] = {}
        if workspace_id:
            details["workspace_id"] = str(workspace_id)
        if user_id:
            details["user_id"] = str(user_id)
        super().__init__(
            "请先配置自己的 daemon 和本地路径，然后才能使用此工作空间。",
            code="member_binding_not_found",
            http_status=409,
            details=details,
        )
