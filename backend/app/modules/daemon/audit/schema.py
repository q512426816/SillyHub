"""Pydantic DTOs for the daemon filesystem-policy audit trail (D-006@v1).

design refs:
- §5.1.5 ``audit-sink.ts`` AuditEvent shape (daemon TS) ↔ AuditEventIn.
- §7.3 ``POST /daemon/audit/batch`` body (claim_token + runtime_id + events[]).
- §7.3 ``GET /workspaces/{wid}/runtimes/{rid}/policy-audit`` query params.
- §7.4 PolicyAuditLog read DTO (AuditLogRead).
"""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

# Batch size cap: daemon flushes in chunks (design §5.1.5 maxSize≈100); the
# backend caps a single batch at 500 to bound insert cost (task-10 constraint).
AUDIT_BATCH_MAX_EVENTS = 500

DecisionLiteral = Literal["ALLOW", "DENY"]


class AuditEventIn(BaseModel):
    """Single audit event as emitted by the daemon AuditSink (design §5.1.5).

    Field names mirror the TS ``AuditEvent`` interface (camelCase kept for the
    raw payload is normalised to snake_case here); ``ts`` carries the daemon
    wall-clock timestamp of the policy decision.
    """

    model_config = ConfigDict(extra="forbid")

    decision: DecisionLiteral = Field(description='"ALLOW" | "DENY"')
    provider: str = Field(min_length=1, max_length=50, description="agent provider")
    tool: str = Field(min_length=1, max_length=128, description="originating tool name")
    path: str = Field(min_length=1, description="normalised filesystem path")
    reason: str = Field(default="", max_length=2000, description="deny reason / note")
    ts: datetime = Field(description="daemon wall-clock decision time")


class AuditBatchRequest(BaseModel):
    """Body for ``POST /daemon/audit/batch`` (design §7.3 lifecycle: audit_batch).

    The daemon authenticates with ``get_current_principal`` (X-API-Key) and
    additionally presents the runtime's current ``claim_token`` (lease-scoped
    secret) so a leaked X-API-Key alone cannot forge audit rows. ``runtime_id``
    is the source runtime; ``workspace_id`` is optional (resolved best-effort
    server-side, see service.batch_insert).
    """

    model_config = ConfigDict(extra="forbid")

    runtime_id: uuid.UUID
    claim_token: str = Field(min_length=1, max_length=128)
    workspace_id: uuid.UUID | None = None
    events: list[AuditEventIn] = Field(
        default_factory=list,
        max_length=AUDIT_BATCH_MAX_EVENTS,
        description="batch of audit events (<=500)",
    )


class AuditBatchResponse(BaseModel):
    """Response for the batch insert endpoint."""

    accepted: int = Field(description="number of rows actually inserted")
    runtime_id: uuid.UUID


class AuditLogRead(BaseModel):
    """Read DTO for a persisted ``PolicyAuditLog`` row (design §7.4)."""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    runtime_id: uuid.UUID
    workspace_id: uuid.UUID | None = None
    decision: str
    provider: str
    tool: str
    path: str
    reason: str
    created_at: datetime


class AuditPageResponse(BaseModel):
    """Paginated response for the audit query endpoint."""

    items: list[AuditLogRead]
    total: int
    limit: int
    offset: int
