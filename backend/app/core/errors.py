"""Centralised error handling.

All API errors are serialised to the shape documented in
``references/18-error-recovery.md``::

    {
        "code": "<short.snake.code>",
        "message": "<human readable>",
        "request_id": "<uuid|null>",
        "details": { ... } | null
    }
"""

from __future__ import annotations

import uuid
from typing import Any

from fastapi import FastAPI, HTTPException, Request, status
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

from app.core.logging import get_logger

log = get_logger(__name__)


class AppError(Exception):
    """Base class for domain errors raised inside the application."""

    code: str = "internal_error"
    http_status: int = status.HTTP_500_INTERNAL_SERVER_ERROR

    def __init__(
        self,
        message: str | None = None,
        *,
        details: dict[str, Any] | None = None,
    ) -> None:
        super().__init__(message or self.code)
        self.message = message or self.code
        self.details = details


# ── Workspace errors ─────────────────────────────────────────────────────────


class WorkspacePathNotFound(AppError):
    code = "HTTP_400_WORKSPACE_PATH_NOT_FOUND"
    http_status = status.HTTP_400_BAD_REQUEST


class WorkspacePathNotDir(AppError):
    code = "HTTP_400_WORKSPACE_PATH_NOT_DIR"
    http_status = status.HTTP_400_BAD_REQUEST


class WorkspaceNotSillyspec(AppError):
    code = "HTTP_400_WORKSPACE_NOT_SILLYSPEC"
    http_status = status.HTTP_400_BAD_REQUEST


class WorkspacePathDuplicate(AppError):
    code = "HTTP_409_WORKSPACE_PATH_DUPLICATE"
    http_status = status.HTTP_409_CONFLICT


class WorkspacePermissionDenied(AppError):
    code = "HTTP_403_WORKSPACE_PERMISSION_DENIED"
    http_status = status.HTTP_403_FORBIDDEN


class WorkspaceNotFound(AppError):
    code = "HTTP_404_WORKSPACE_NOT_FOUND"
    http_status = status.HTTP_404_NOT_FOUND


class WorkspaceSlugDuplicate(AppError):
    code = "HTTP_409_WORKSPACE_SLUG_DUPLICATE"
    http_status = status.HTTP_409_CONFLICT


class SpecWorkspaceNotFound(AppError):
    code = "HTTP_404_SPEC_WORKSPACE_NOT_FOUND"
    http_status = status.HTTP_404_NOT_FOUND


class ScanDocNotFound(AppError):
    code = "HTTP_404_SCAN_DOC_NOT_FOUND"
    http_status = status.HTTP_404_NOT_FOUND


class SpecConflictNotFound(AppError):
    code = "HTTP_404_SPEC_CONFLICT_NOT_FOUND"
    http_status = status.HTTP_404_NOT_FOUND


# ── Relation errors ──────────────────────────────────────────────────────────


class RelationNotFound(AppError):
    code = "HTTP_404_RELATION_NOT_FOUND"
    http_status = status.HTTP_404_NOT_FOUND


class RelationSelfLoop(AppError):
    code = "HTTP_400_RELATION_SELF_LOOP"
    http_status = status.HTTP_400_BAD_REQUEST


class RelationDuplicate(AppError):
    code = "HTTP_409_RELATION_DUPLICATE"
    http_status = status.HTTP_409_CONFLICT


# ── Agent errors ──────────────────────────────────────────────────────────────


class AgentRunNotFound(AppError):
    code = "HTTP_404_AGENT_RUN_NOT_FOUND"
    http_status = status.HTTP_404_NOT_FOUND


class AgentRunNotRunning(AppError):
    code = "HTTP_409_AGENT_RUN_NOT_RUNNING"
    http_status = status.HTTP_409_CONFLICT


# ── Change errors ────────────────────────────────────────────────────────────


class ChangeNotFound(AppError):
    code = "HTTP_404_CHANGE_NOT_FOUND"
    http_status = status.HTTP_404_NOT_FOUND


class ChangeDocNotFound(AppError):
    code = "HTTP_404_CHANGE_DOC_NOT_FOUND"
    http_status = status.HTTP_404_NOT_FOUND


# ── Task errors ──


class TaskNotFound(AppError):
    code = "HTTP_404_TASK_NOT_FOUND"
    http_status = status.HTTP_404_NOT_FOUND


# ── Auth errors ──────────────────────────────────────────────────────────────


class AuthTokenMissing(AppError):
    code = "HTTP_401_AUTH_TOKEN_MISSING"
    http_status = status.HTTP_401_UNAUTHORIZED


class AuthTokenInvalid(AppError):
    code = "HTTP_401_AUTH_TOKEN_INVALID"
    http_status = status.HTTP_401_UNAUTHORIZED


class AuthTokenExpired(AppError):
    code = "HTTP_401_AUTH_TOKEN_EXPIRED"
    http_status = status.HTTP_401_UNAUTHORIZED


class AuthInvalidCredentials(AppError):
    code = "HTTP_401_AUTH_INVALID_CREDENTIALS"
    http_status = status.HTTP_401_UNAUTHORIZED


class AuthRefreshReused(AppError):
    """Old refresh token reused → reuse attack; all sessions get killed."""

    code = "HTTP_401_AUTH_REFRESH_REUSED"
    http_status = status.HTTP_401_UNAUTHORIZED


class AuthUserInactive(AppError):
    code = "HTTP_401_AUTH_USER_INACTIVE"
    http_status = status.HTTP_401_UNAUTHORIZED


class PermissionDenied(AppError):
    code = "HTTP_403_PERMISSION_DENIED"
    http_status = status.HTTP_403_FORBIDDEN


class InvalidTransition(AppError):
    code = "HTTP_422_INVALID_TRANSITION"
    http_status = status.HTTP_422_UNPROCESSABLE_ENTITY


# ── Worktree errors ──


class WorktreeLeaseNotFound(AppError):
    code = "HTTP_404_WORKTREE_LEASE_NOT_FOUND"
    http_status = status.HTTP_404_NOT_FOUND


class WorktreeLeaseAlreadyReleased(AppError):
    code = "WORKTREE_LEASE_ALREADY_RELEASED"
    http_status = status.HTTP_409_CONFLICT


class WorktreeAcquireFailed(AppError):
    code = "WORKTREE_ACQUIRE_FAILED"
    http_status = status.HTTP_503_SERVICE_UNAVAILABLE


# ── Spec errors ──────────────────────────────────────────────────────────────────


class SpecConflictNotFound(AppError):
    code = "HTTP_404_SPEC_CONFLICT_NOT_FOUND"
    http_status = status.HTTP_404_NOT_FOUND


def _request_id(request: Request) -> str:
    rid = request.headers.get("x-request-id")
    if rid:
        return rid
    rid = str(uuid.uuid4())
    return rid


def _error_payload(
    *,
    code: str,
    message: str,
    request_id: str,
    details: Any | None = None,
) -> dict[str, Any]:
    return {
        "code": code,
        "message": message,
        "request_id": request_id,
        "details": details,
    }


def register_exception_handlers(app: FastAPI) -> None:
    """Attach the shared exception handlers to a FastAPI app."""

    @app.exception_handler(AppError)
    async def _app_error(request: Request, exc: AppError) -> JSONResponse:
        rid = _request_id(request)
        log.warning("app_error", code=exc.code, request_id=rid, message=exc.message)
        return JSONResponse(
            status_code=exc.http_status,
            content=_error_payload(
                code=exc.code,
                message=exc.message,
                request_id=rid,
                details=exc.details,
            ),
        )

    @app.exception_handler(HTTPException)
    async def _http_exc(request: Request, exc: HTTPException) -> JSONResponse:
        rid = _request_id(request)
        return JSONResponse(
            status_code=exc.status_code,
            content=_error_payload(
                code=f"http_{exc.status_code}",
                message=str(exc.detail),
                request_id=rid,
            ),
            headers=getattr(exc, "headers", None),
        )

    @app.exception_handler(RequestValidationError)
    async def _validation_exc(request: Request, exc: RequestValidationError) -> JSONResponse:
        rid = _request_id(request)
        # ``RequestValidationError.errors()`` may embed live Python exception
        # objects inside ``ctx`` (notably ``ValueError`` raised by custom
        # validators) which are not JSON-serialisable. Stringify the offenders.
        sanitised: list[dict[str, Any]] = []
        for err in exc.errors():
            entry = {k: v for k, v in err.items() if k != "ctx"}
            ctx = err.get("ctx")
            if isinstance(ctx, dict):
                entry["ctx"] = {k: str(v) for k, v in ctx.items()}
            sanitised.append(entry)
        return JSONResponse(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            content=_error_payload(
                code="validation_error",
                message="Request validation failed.",
                request_id=rid,
                details={"errors": sanitised},
            ),
        )

    @app.exception_handler(Exception)
    async def _unhandled(request: Request, exc: Exception) -> JSONResponse:
        rid = _request_id(request)
        log.exception("unhandled_error", request_id=rid)
        return JSONResponse(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            content=_error_payload(
                code="internal_error",
                message="Internal server error.",
                request_id=rid,
            ),
        )
