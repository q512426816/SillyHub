"""HTTP routes for the daemon filesystem-policy audit trail (D-006@v1 / task-10).

design refs:
- §7.3 ``POST /daemon/audit/batch`` — daemon batch upload (claim_token auth).
- §7.3 ``GET .../policy-audit`` — paginated + filtered read for the audit page.

Mounting: this router is ``include_router``-ed by ``app.modules.daemon.router``
(allowed_paths forbids editing ``app/main.py``), so it inherits the daemon
router's ``/daemon`` prefix. Consequence / deviation from design §7.3:

- ``POST /audit/batch``              → ``/api/daemon/audit/batch``       (matches design)
- ``GET /workspaces/{wid}/runtimes/{rid}/policy-audit``
                                     → ``/api/daemon/workspaces/{wid}/runtimes/{rid}/policy-audit``
  (design wrote ``/api/workspaces/...``; the ``/daemon`` segment is added by
  the inherited prefix because the audit router cannot be mounted at app root
  without touching ``main.py``). Front-end must use the ``/daemon``-prefixed
  path until ``main.py`` mounts the audit router at root (out of task-10 scope).
"""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth_deps import require_permission_any
from app.core.db import get_session
from app.modules.auth.model import User
from app.modules.auth.permissions import Permission
from app.modules.daemon.audit.schema import (
    AUDIT_BATCH_MAX_EVENTS,
    AuditBatchRequest,
    AuditBatchResponse,
    AuditLogRead,
    AuditPageResponse,
)
from app.modules.daemon.audit.service import AuditService

router = APIRouter(tags=["daemon"])

SessionDep = Annotated[AsyncSession, Depends(get_session)]
# Audit page is a runtime-admin surface (write-behaviour audit). Reuses the
# existing RUNTIME_ADMIN permission gate like the other runtime admin reads.
RuntimeAdminUser = Annotated[User, Depends(require_permission_any(Permission.RUNTIME_ADMIN))]


@router.post(
    "/audit/batch",
    response_model=AuditBatchResponse,
)
async def post_audit_batch(
    data: AuditBatchRequest,
    session: SessionDep,
    # daemon X-API-Key (long-lived) resolves the principal; the per-batch
    # claim_token in the body authorises the specific runtime. Mirrors how the
    # lease lifecycle endpoints pair get_current_principal + body claim_token.
    user: Annotated[User, Depends(require_permission_any(Permission.TASK_RUN_AGENT))],
) -> AuditBatchResponse:
    """Daemon batch upload of policy audit events (design §7.3 lifecycle audit_batch).

    Authenticates the runtime via its current ``claim_token`` (a claimed lease
    for ``runtime_id`` must carry the matching token), then bulk-inserts the
    events. Batch is capped at ``AUDIT_BATCH_MAX_EVENTS`` (enforced by the
    schema's ``max_length`` — over-cap requests 422 before reaching the service).
    """
    svc = AuditService(session)
    await svc._verify_claim_token(data.runtime_id, data.claim_token)
    inserted = await svc.batch_insert(
        data.runtime_id,
        data.events,
        workspace_id=data.workspace_id,
    )
    return AuditBatchResponse(accepted=inserted, runtime_id=data.runtime_id)


@router.get(
    "/workspaces/{workspace_id}/runtimes/{runtime_id}/policy-audit",
    response_model=AuditPageResponse,
)
async def list_policy_audit(
    workspace_id: uuid.UUID,
    runtime_id: uuid.UUID,
    session: SessionDep,
    user: RuntimeAdminUser,
    decision: str | None = Query(default=None, max_length=16),
    provider: str | None = Query(default=None, max_length=50),
    tool: str | None = Query(default=None, max_length=128),
    path: str | None = Query(default=None, max_length=512, description="substring match"),
    since: datetime | None = Query(default=None),
    until: datetime | None = Query(default=None),
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
) -> AuditPageResponse:
    """Paginated + filtered read of policy audit log (design §7.3).

    Filters by workspace + runtime (both from the path) and optional
    decision/provider/tool/path/time. Ordered by created_at DESC.
    """
    svc = AuditService(session)
    items, total = await svc.query(
        workspace_id=workspace_id,
        runtime_id=runtime_id,
        decision=decision,
        provider=provider,
        tool=tool,
        path_contains=path,
        since=since,
        until=until,
        limit=limit,
        offset=offset,
    )
    return AuditPageResponse(
        items=items,
        total=total,
        limit=limit,
        offset=offset,
    )


# Re-export so callers can reference the cap without importing the schema.
__all__ = ["AUDIT_BATCH_MAX_EVENTS", "AuditLogRead", "router"]
