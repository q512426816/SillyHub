"""Audit service for the daemon filesystem-policy audit trail (D-006@v1).

Owns the batch insert + paginated query over ``PolicyAuditLog`` (task-10).
The HTTP layer (audit/router.py) only does DTO mapping; all SQL lives here.

design refs:
- §7.4 PolicyAuditLog table; R-05 30-day cleanup.
- §5.1.5 AuditEvent batch flush shape (daemon → backend).
- claim_token authorisation: a claimed ``DaemonTaskLease`` for the runtime
  whose ``metadata_['claim_token']`` matches the supplied token.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta

from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import AppError
from app.modules.daemon.audit.model import PolicyAuditLog
from app.modules.daemon.audit.schema import AuditEventIn, AuditLogRead
from app.modules.daemon.model import DaemonTaskLease

# R-05: rows older than this are eligible for cleanup.
AUDIT_RETENTION_DAYS = 30


class DaemonAuditAuthDenied(AppError):
    """claim_token does not match any active lease for the runtime → 403."""

    code = "HTTP_403_DAEMON_AUDIT_AUTH_DENIED"
    http_status = 403


class DaemonAuditRuntimeMismatch(AppError):
    """The matched lease belongs to a different runtime → 403."""

    code = "HTTP_403_DAEMON_AUDIT_RUNTIME_MISMATCH"
    http_status = 403


class AuditService:
    """Batch insert + paginated query over ``PolicyAuditLog``."""

    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    # ── Auth ────────────────────────────────────────────────────────────────

    async def _verify_claim_token(
        self,
        runtime_id: uuid.UUID,
        claim_token: str,
    ) -> DaemonTaskLease:
        """Verify the daemon's claim_token against an active lease.

        A row in ``daemon_task_leases`` with ``status='claimed'`` whose
        ``metadata_['claim_token']`` equals the supplied token must exist for
        the runtime. Mirrors the lease ``_validate_claim_token`` semantics but
        looked up by runtime + token (the audit batch is runtime-scoped, not
        lease-scoped).

        Raises:
            DaemonAuditAuthDenied: no matching claimed lease.
            DaemonAuditRuntimeMismatch: token valid but for another runtime.
        """
        stmt = (
            select(DaemonTaskLease).where(DaemonTaskLease.status == "claimed")  # type: ignore[arg-type]
        )
        rows = (await self._session.execute(stmt)).scalars().all()
        matched: DaemonTaskLease | None = None
        other_runtime = False
        for lease in rows:
            meta = lease.metadata_ or {}
            if meta.get("claim_token") == claim_token:
                if lease.runtime_id == runtime_id:
                    matched = lease
                    break
                other_runtime = True
        if matched is None:
            if other_runtime:
                raise DaemonAuditRuntimeMismatch(
                    "claim_token is valid but bound to a different runtime.",
                    details={"runtime_id": str(runtime_id)},
                )
            raise DaemonAuditAuthDenied(
                "Invalid or expired claim_token for audit batch.",
                details={"runtime_id": str(runtime_id)},
            )
        return matched

    # ── Batch insert ────────────────────────────────────────────────────────

    async def batch_insert(
        self,
        runtime_id: uuid.UUID,
        events: list[AuditEventIn],
        *,
        workspace_id: uuid.UUID | None = None,
    ) -> int:
        """Insert a batch of audit events for the runtime.

        ``workspace_id`` is taken from the request when supplied (the GET
        endpoint path carries it explicitly); otherwise stored as ``None``.
        DaemonRuntime has no workspace FK, so the value is not server-resolved
        here — callers that know the workspace pass it through (design §7.4
        notes workspace_id is optional / best-effort).

        Returns:
            Number of rows inserted (== len(events)).
        """
        if not events:
            return 0
        now = datetime.now(UTC)
        rows: list[PolicyAuditLog] = []
        for ev in events:
            rows.append(
                PolicyAuditLog(
                    id=uuid.uuid4(),
                    runtime_id=runtime_id,
                    workspace_id=workspace_id,
                    decision=ev.decision,
                    provider=ev.provider,
                    tool=ev.tool,
                    path=ev.path,
                    reason=ev.reason,
                    # daemon-reported decision time stored on created_at so the
                    # ``(runtime_id, created_at DESC)`` hot-path index orders
                    # rows by when the policy decision actually happened.
                    created_at=ev.ts if ev.ts.tzinfo else ev.ts.replace(tzinfo=UTC),
                )
            )
        self._session.add_all(rows)
        await self._session.commit()
        # touch ``now`` so static analysers don't flag it unused; the timestamp
        # is reserved for future enqueue-vs-decide latency metrics.
        _ = now
        return len(rows)

    # ── Paginated query ────────────────────────────────────────────────────

    async def query(
        self,
        *,
        workspace_id: uuid.UUID | None = None,
        runtime_id: uuid.UUID | None = None,
        decision: str | None = None,
        provider: str | None = None,
        tool: str | None = None,
        path_contains: str | None = None,
        since: datetime | None = None,
        until: datetime | None = None,
        limit: int = 50,
        offset: int = 0,
    ) -> tuple[list[AuditLogRead], int]:
        """Paginated + filtered audit read, ordered by created_at DESC.

        Returns ``(items, total)`` where ``total`` is the unfiltered-by-page
        count for the same filter set (for the frontend pager).
        """
        conds = []
        if workspace_id is not None:
            conds.append(PolicyAuditLog.workspace_id == workspace_id)  # type: ignore[arg-type]
        if runtime_id is not None:
            conds.append(PolicyAuditLog.runtime_id == runtime_id)  # type: ignore[arg-type]
        if decision is not None:
            conds.append(PolicyAuditLog.decision == decision)  # type: ignore[arg-type]
        if provider is not None:
            conds.append(PolicyAuditLog.provider == provider)  # type: ignore[arg-type]
        if tool is not None:
            conds.append(PolicyAuditLog.tool == tool)  # type: ignore[arg-type]
        if path_contains is not None:
            conds.append(PolicyAuditLog.path.contains(path_contains))  # type: ignore[attr-defined]
        if since is not None:
            conds.append(PolicyAuditLog.created_at >= since)  # type: ignore[operator]
        if until is not None:
            conds.append(PolicyAuditLog.created_at <= until)  # type: ignore[operator]

        count_stmt = select(func.count()).select_from(PolicyAuditLog)
        if conds:
            count_stmt = count_stmt.where(*conds)
        total = int((await self._session.execute(count_stmt)).scalar_one())

        stmt = select(PolicyAuditLog)
        if conds:
            stmt = stmt.where(*conds)
        stmt = (
            stmt.order_by(PolicyAuditLog.created_at.desc())  # type: ignore[attr-defined]
            .limit(limit)
            .offset(offset)
        )
        rows = (await self._session.execute(stmt)).scalars().all()
        items = [AuditLogRead.model_validate(row) for row in rows]
        return items, total

    # ── Retention (R-05) ────────────────────────────────────────────────────

    async def cleanup_old(self, days: int = AUDIT_RETENTION_DAYS) -> int:
        """Delete audit rows older than ``days`` (R-05). Returns deleted count."""
        cutoff = datetime.now(UTC) - timedelta(days=days)
        stmt = delete(PolicyAuditLog).where(PolicyAuditLog.created_at < cutoff)  # type: ignore[operator]
        result = await self._session.execute(stmt)
        await self._session.commit()
        return int(result.rowcount or 0)
