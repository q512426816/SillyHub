"""HTTP routes for workspace member management.

6 endpoints mounted at ``/workspaces/{workspace_id}/members`` (task-03 of
change ``2026-06-16-workspace-members``). All routes rely on
``require_permission(Permission.WORKSPACE_*)`` so the path ``{workspace_id}``
is auto-injected into the RBAC closure (see ``app/core/auth_deps.py``).

Business logic lives in :mod:`app.modules.workspace.members_service` (task-02).
This module is intentionally thin: it maps service-layer exceptions to HTTP
errors, wraps raw ``UserWorkspaceRole`` rows into ``WorkspaceMemberView``
DTOs, and converts the ``created: bool`` upsert flag into a 201 vs 200 status
code override.

Exception translation (task-03 §3.5):

* ``ValueError("invalid_role_key")``          → 400 ``invalid_role_key``
* ``ValueError("cannot_remove_last_owner")``  → 400 ``cannot_remove_last_owner``
* ``LookupError("user_not_found")``           → 404 ``HTTP_404_USER_NOT_FOUND`` (or
  ``HTTP_404_MEMBER_NOT_FOUND`` when the caller is mutating an existing row).
* ``LookupError("role_not_seeded")``          → 500 ``internal_error`` (defensive).
* ``WorkspaceNotFound`` (AppError)            → 404 ``HTTP_404_WORKSPACE_NOT_FOUND`` —
  handled by the global AppError handler.
* 403 ``HTTP_403_PERMISSION_DENIED`` is raised by ``require_permission`` itself.
"""

from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Path, Query, Response, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import col, select

from app.core.auth_deps import require_permission
from app.core.db import get_session
from app.core.errors import AppError
from app.modules.auth.model import Role, User, UserWorkspaceRole
from app.modules.auth.permissions import Permission
from app.modules.workspace import members_service
from app.modules.workspace.schema import (
    UserSearchHit,
    UserSearchResponse,
    WorkspaceMemberAddRequest,
    WorkspaceMemberListResponse,
    WorkspaceMemberUpdateRequest,
    WorkspaceMemberView,
)

router = APIRouter(
    prefix="/workspaces/{workspace_id}/members",
    tags=["workspace-members"],
)

SessionDep = Annotated[AsyncSession, Depends(get_session)]


# ────────────────────────────────────────────────────────────────────────────
# Local helpers — exception translation + row→view mapping.
# ────────────────────────────────────────────────────────────────────────────


def _translate_service_error(
    exc: Exception,
    *,
    mutating_existing_member: bool = False,
) -> AppError:
    """Map a :mod:`members_service` exception to an :class:`AppError`.

    ``mutating_existing_member`` disambiguates the two 404 paths surfaced by
    the service layer:

    * ``False`` (POST add): ``LookupError("user_not_found")`` means the target
      ``user_id`` does not exist in the ``users`` table at all.
    * ``True`` (PATCH / DELETE / transfer): the same exception means an
      otherwise-valid user is not a member of this workspace.

    Returns an :class:`AppError` so the global ``AppError`` handler renders
    the domain ``code`` (e.g. ``invalid_role_key`` /
    ``cannot_remove_last_owner``) at the top level of the JSON body, where
    the test suite (and the frontend) can assert against it. Returning a
    raw :class:`fastapi.HTTPException` would lose the ``code`` because the
    global ``HTTPException`` handler serialises ``detail`` via ``str(...)``.
    """
    if isinstance(exc, ValueError):
        if str(exc) == "invalid_role_key":
            return AppError(
                "Role key is not in the workspace whitelist.",
                code="invalid_role_key",
                http_status=status.HTTP_400_BAD_REQUEST,
            )
        if str(exc) == "cannot_remove_last_owner":
            return AppError(
                "Cannot remove the last workspace owner.",
                code="cannot_remove_last_owner",
                http_status=status.HTTP_400_BAD_REQUEST,
            )
    if isinstance(exc, LookupError):
        if str(exc) == "user_not_found":
            code = (
                "HTTP_404_MEMBER_NOT_FOUND"
                if mutating_existing_member
                else "HTTP_404_USER_NOT_FOUND"
            )
            message = (
                "User is not a member of this workspace."
                if mutating_existing_member
                else "Target user does not exist or is not active."
            )
            return AppError(message, code=code, http_status=status.HTTP_404_NOT_FOUND)
        if str(exc) == "role_not_seeded":
            # Defensive — a whitelisted role must be seeded by migration.
            return AppError(
                "Workspace role is not seeded in the database.",
                code="internal_error",
                http_status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )
    # Re-raise anything we did not handle (AppError subclasses like
    # WorkspaceNotFound are caught by the global handler).
    raise exc


async def _row_to_view(
    session: AsyncSession,
    *,
    row: UserWorkspaceRole,
    current_user_id: uuid.UUID | None,
) -> WorkspaceMemberView:
    """Join a ``UserWorkspaceRole`` row with its ``User`` + ``Role`` to build
    a ``WorkspaceMemberView`` DTO.

    The service layer returns raw rows because it owns the SQL; the router is
    the only place that knows the requesting ``current_user_id`` so the
    ``is_current_user`` flag is computed here.
    """
    user = await session.get(User, row.user_id)
    role = await session.get(Role, row.role_id)
    if user is None or role is None:
        # Defensive — refresh() guarantees both rows exist post-commit.
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail={"code": "internal_error", "message": "Inconsistent member row."},
        )
    return WorkspaceMemberView(
        user_id=row.user_id,
        email=user.email,
        display_name=user.display_name,
        role_key=role.key,
        role_name=role.name,
        granted_at=row.granted_at,
        is_current_user=(current_user_id is not None and row.user_id == current_user_id),
    )


async def _is_existing_member(
    session: AsyncSession,
    *,
    workspace_id: uuid.UUID,
    user_id: uuid.UUID,
) -> bool:
    """Return ``True`` iff ``(user_id, workspace_id)`` already has at least one
    membership row. Used to derive the ``created`` flag for the POST add upsert.
    """
    stmt = (
        select(col(UserWorkspaceRole.user_id))
        .where(col(UserWorkspaceRole.user_id) == user_id)
        .where(col(UserWorkspaceRole.workspace_id) == workspace_id)
        .limit(1)
    )
    found = (await session.execute(stmt)).first()
    return found is not None


# ────────────────────────────────────────────────────────────────────────────
# Endpoint 1: GET "" — list members
# ────────────────────────────────────────────────────────────────────────────


@router.get("", response_model=WorkspaceMemberListResponse)
async def list_members(
    workspace_id: Annotated[uuid.UUID, Path(...)],
    session: SessionDep,
    user: Annotated[User, Depends(require_permission(Permission.WORKSPACE_READ))],
) -> WorkspaceMemberListResponse:
    """List every (user, role) row in this workspace.

    Permission: ``WORKSPACE_READ`` — any member (owner/developer/viewer) can
    read the roster; non-members are blocked at the dependency layer (403).
    """
    try:
        items = await members_service.list_members(
            session, workspace_id=workspace_id, current_user_id=user.id
        )
        return WorkspaceMemberListResponse(items=items)
    except Exception as exc:
        raise _translate_service_error(exc) from exc


# ────────────────────────────────────────────────────────────────────────────
# Endpoint 2: GET "/search" — fuzzy search non-member users
# ────────────────────────────────────────────────────────────────────────────


@router.get("/search", response_model=UserSearchResponse)
async def search_users(
    workspace_id: Annotated[uuid.UUID, Path(...)],
    session: SessionDep,
    _user: Annotated[User, Depends(require_permission(Permission.WORKSPACE_MEMBER_MANAGE))],
    q: Annotated[
        str,
        Query(
            min_length=2,
            max_length=100,
            description="email or display_name fragment (case-insensitive)",
        ),
    ],
    limit: Annotated[int, Query(ge=1, le=50)] = 10,
) -> UserSearchResponse:
    """Search active users by email/display_name fragment, excluding members
    of this workspace.

    Permission: ``WORKSPACE_MEMBER_MANAGE`` (owner / platform admin) — search
    exposes other users' emails. ``q`` length is validated by FastAPI Query
    (422 when ``len < 2`` or ``len > 100``); ``limit`` is clamped to 1..50.
    """
    try:
        hits: list[UserSearchHit] = await members_service.search_users_for_invite(
            session, workspace_id=workspace_id, q=q, limit=limit
        )
    except Exception as exc:
        raise _translate_service_error(exc) from exc
    return UserSearchResponse(items=hits)


# ────────────────────────────────────────────────────────────────────────────
# Endpoint 3: POST "" — add or idempotently update a member
# ────────────────────────────────────────────────────────────────────────────


@router.post(
    "",
    response_model=WorkspaceMemberView,
    status_code=status.HTTP_201_CREATED,
)
async def add_member(
    workspace_id: Annotated[uuid.UUID, Path(...)],
    payload: WorkspaceMemberAddRequest,
    session: SessionDep,
    response: Response,
    user: Annotated[User, Depends(require_permission(Permission.WORKSPACE_MEMBER_MANAGE))],
) -> WorkspaceMemberView:
    """Upsert a membership. Returns 201 on insert, 200 on idempotent update.

    The ``response_model`` is shared across both paths; we override
    ``response.status_code`` when ``created=False`` so the OpenAPI schema can
    still declare a single 201 default (see task-03 §实现要求 方案 A).
    """
    # Snapshot membership BEFORE the upsert so we can derive ``created``.
    was_member = await _is_existing_member(
        session, workspace_id=workspace_id, user_id=payload.user_id
    )

    try:
        row = await members_service.add_or_update_member(
            session,
            workspace_id=workspace_id,
            user_id=payload.user_id,
            role_key=payload.role_key,
            granted_by=user.id,
        )
    except Exception as exc:
        raise _translate_service_error(exc) from exc

    if was_member:
        response.status_code = status.HTTP_200_OK

    return await _row_to_view(session, row=row, current_user_id=user.id)


# ────────────────────────────────────────────────────────────────────────────
# Endpoint 4: PATCH "/{user_id}" — change an existing member's role
# ────────────────────────────────────────────────────────────────────────────


@router.patch("/{user_id}", response_model=WorkspaceMemberView)
async def update_member_role(
    workspace_id: Annotated[uuid.UUID, Path(...)],
    user_id: Annotated[uuid.UUID, Path(...)],
    payload: WorkspaceMemberUpdateRequest,
    session: SessionDep,
    _user: Annotated[User, Depends(require_permission(Permission.WORKSPACE_MEMBER_MANAGE))],
) -> WorkspaceMemberView:
    """Update an existing member's role. Refuses to demote the last owner."""
    try:
        row = await members_service.update_member_role(
            session,
            workspace_id=workspace_id,
            user_id=user_id,
            role_key=payload.role_key,
        )
    except Exception as exc:
        raise _translate_service_error(exc, mutating_existing_member=True) from exc

    return await _row_to_view(session, row=row, current_user_id=user_id)


# ────────────────────────────────────────────────────────────────────────────
# Endpoint 5: DELETE "/{user_id}" — remove a member
# ────────────────────────────────────────────────────────────────────────────


@router.delete("/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
async def remove_member(
    workspace_id: Annotated[uuid.UUID, Path(...)],
    user_id: Annotated[uuid.UUID, Path(...)],
    session: SessionDep,
    _user: Annotated[User, Depends(require_permission(Permission.WORKSPACE_MEMBER_MANAGE))],
) -> None:
    """Remove every membership row for this ``(user_id, workspace_id)`` pair.

    Returns 204 on success. Service-layer ``LookupError("user_not_found")`` is
    translated to 404 ``HTTP_404_MEMBER_NOT_FOUND`` per FR-05 §边界 #7 — we
    deliberately do not silently return 204 to expose stale-state callers.
    """
    try:
        await members_service.remove_member(session, workspace_id=workspace_id, user_id=user_id)
    except Exception as exc:
        raise _translate_service_error(exc, mutating_existing_member=True) from exc

    return None


# ────────────────────────────────────────────────────────────────────────────
# Endpoint 6: POST "/{user_id}/transfer-ownership" — hand off ownership
# ────────────────────────────────────────────────────────────────────────────


@router.post("/{user_id}/transfer-ownership")
async def transfer_ownership(
    workspace_id: Annotated[uuid.UUID, Path(...)],
    user_id: Annotated[uuid.UUID, Path(...)],
    session: SessionDep,
    user: Annotated[User, Depends(require_permission(Permission.WORKSPACE_MEMBER_MANAGE))],
) -> dict:
    """Promote ``user_id`` to ``workspace_owner`` and demote the caller to
    ``developer`` inside a single transaction.

    Returns ``{"new_owner": "<user_id>", "demoted": "<current_user_id>"}``
    on success (FR-06 §1). The service layer is responsible for SELECT FOR
    UPDATE serialisation of concurrent transfers.
    """
    try:
        await members_service.transfer_ownership(
            session,
            workspace_id=workspace_id,
            target_user_id=user_id,
            current_user_id=user.id,
        )
    except Exception as exc:
        raise _translate_service_error(exc, mutating_existing_member=True) from exc

    return {
        "new_owner": str(user_id),
        "demoted": str(user.id),
    }
