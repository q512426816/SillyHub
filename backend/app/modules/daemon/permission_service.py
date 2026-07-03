"""Session-level canUseTool permission orchestration (task-08 / FR-07 / D-007@v1).

This service lives between the daemon WS uplink (PERMISSION_REQUEST) and the
daemon WS downlink (PERMISSION_RESPONSE). It handles two flavors of request:

* **Ordinary canUseTool approval** (``dialog_kind is None``): ephemeral, in-memory
  ``_timers`` registry + a 5-minute timeout enforcer that auto-denies any
  request the user never answered. Stateless across process restarts — the
  daemon-side ``PermissionResolver`` fallback timer + SDK AbortSignal are the
  final fail-closed safety net (D-007@v1). No DB row is written for this path.

* **AskUserQuestion dialog** (``dialog_kind`` set): long-lived, user-facing
  question that may wait indefinitely. Persisted in ``session_dialog_requests``
  so it survives a frontend page refresh; the 5min timeout is *not* armed. The
  REST ``GET /sessions/{id}/dialogs`` endpoint replays pending rows.

Reuses DaemonService helpers verbatim (task-05):
  - ``_publish_session_event(session_id, payload)`` → ``agent_session:{id}`` Redis
  - ``_get_owned_session_for_update(session_id, user_id)`` for REST response auth
  - ``_get_current_run(session_id)`` for run_id / active-turn validation
"""

from __future__ import annotations

import asyncio
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import TYPE_CHECKING, Any, Literal

from sqlalchemy import select

from app.core.errors import AppError
from app.core.logging import get_logger
from app.modules.daemon.model import SessionDialogRequest
from app.modules.daemon.protocol import (
    PermissionRequestPayload,
)
from app.modules.daemon.service import (
    ACTIVE_SESSION_STATUSES,
    ACTIVE_TURN_STATUSES,
    DaemonRuntimeOffline,
    DaemonService,
    DaemonSessionNotActive,
)

if TYPE_CHECKING:
    from app.modules.daemon.ws_hub import DaemonWsHub

log = get_logger(__name__)

# D-007@v1: 5 minutes — backend main timeout. Daemon fallback is 5min + 5s
# tolerance, so a missing/dropped backend deny still fail-closes on the daemon.
PERMISSION_TIMEOUT_SEC = 5 * 60


# ── Domain errors ────────────────────────────────────────────────────────────


class DaemonPermissionNotFound(AppError):
    """REST response arrived for a request_id that has no pending timer."""

    code = "HTTP_404_DAEMON_PERMISSION_NOT_FOUND"
    http_status = 404


class DaemonPermissionAlreadyResolved(AppError):
    """REST response arrived after the request was already resolved (manual or timeout)."""

    code = "HTTP_409_DAEMON_PERMISSION_ALREADY_RESOLVED"
    http_status = 409


class DaemonPermissionManualDisabled(AppError):
    """session.config.manual_approval is not True (FR-07 not enabled for this session)."""

    code = "HTTP_409_DAEMON_PERMISSION_MANUAL_DISABLED"
    http_status = 409


class DaemonDialogNotFound(AppError):
    """REST response arrived for a dialog request_id that has no pending DB row.

    Distinct from ``DaemonPermissionNotFound`` (ephemeral timer miss): dialogs
    are persisted, so this fires only when the row was already answered,
    cancelled, or never existed (client race / stale card after refresh).
    """

    code = "HTTP_404_DAEMON_DIALOG_NOT_FOUND"
    http_status = 404


class DaemonDialogAlreadyResolved(AppError):
    """REST response arrived for a dialog request that was already answered."""

    code = "HTTP_409_DAEMON_DIALOG_ALREADY_RESOLVED"
    http_status = 409


@dataclass(frozen=True, slots=True)
class PermissionResponseRead:
    """REST response body for POST /sessions/{id}/permissions/{req}/response."""

    session_id: uuid.UUID
    request_id: str
    decision: Literal["allow", "deny"]
    accepted: bool


@dataclass(frozen=True, slots=True)
class SessionDialogRead:
    """REST DTO for a persisted dialog request (GET /sessions/{id}/dialogs)."""

    id: uuid.UUID
    session_id: uuid.UUID
    run_id: uuid.UUID
    request_id: str
    tool_name: str
    dialog_kind: str | None
    dialog_payload: dict | None
    status: str
    answer: dict | None
    created_at: datetime
    answered_at: datetime | None

    @classmethod
    def from_model(cls, row: SessionDialogRequest) -> "SessionDialogRead":
        return cls(
            id=row.id,
            session_id=row.session_id,
            run_id=row.run_id,
            request_id=row.request_id,
            tool_name=row.tool_name,
            dialog_kind=row.dialog_kind,
            dialog_payload=row.dialog_payload,
            status=row.status or "pending",
            answer=row.answer,
            created_at=row.created_at,
            answered_at=row.answered_at,
        )


# ── Service ──────────────────────────────────────────────────────────────────

# Module-level shared timer registry: per-request DaemonPermissionService instances
# must share the same dict so handle_permission_request (WS uplink) and
# respond_permission (REST downlink) see the same timers. Process restart clears it.
_permission_timers: dict[str, asyncio.Task[None]] = {}


class DaemonPermissionService:
    """Session-level canUseTool approval orchestration (task-08 / D-007@v1)."""

    @property
    def _timers(self) -> dict[str, asyncio.Task[None]]:
        """Delegate to module-level shared registry (not per-instance)."""
        return _permission_timers

    def __init__(
        self,
        daemon_service: DaemonService,
        ws_hub: "DaemonWsHub",
        *,
        timeout_sec: float = PERMISSION_TIMEOUT_SEC,
    ) -> None:
        self._svc = daemon_service
        self._hub = ws_hub
        # Per-instance timeout override (tests inject short values to bypass
        # the real 5min sleep; production uses PERMISSION_TIMEOUT_SEC).
        self._timeout_sec = timeout_sec

    # ── WS uplink: PERMISSION_REQUEST (daemon → server) ──────────────────────

    async def handle_permission_request(
        self,
        daemon_id: uuid.UUID,
        payload: PermissionRequestPayload,
    ) -> None:
        """WS PERMISSION_REQUEST handler: validate + publish SSE + (maybe) arm timer.

        ``daemon_id`` is the daemon entity id the request arrived on (= the WS
        connection key since task-06). Validation:

        Validation (fail-soft: warn + drop, never close the WS — task-03 NFR-05):
          1. session exists (read-only; lock lives in the REST response endpoint)
          2. session.runtime_id resolves to a runtime whose owning daemon entity
             id == ``daemon_id`` (migration window: runtime.daemon_instance_id
             is NULL → the runtime_id itself is the legacy routing key, so the
             check then expects ``daemon_id == session.runtime_id``).
          3. session.status ∈ ACTIVE_SESSION_STATUSES
          4. session.config.get("manual_approval") is True (FR-07 gate)
          5. current run exists, status ∈ ACTIVE_TURN_STATUSES,
             and run.id == payload.run_id

        On success:
          - **dialog** (``payload.dialog_kind`` set): persist a
            ``session_dialog_requests`` row (status=pending), publish a
            ``permission_request`` SSE carrying ``dialog_kind`` +
            ``dialog_payload``. The 5min timeout is **not** armed — dialogs
            may wait indefinitely for a human answer.
          - **plain approval**: publish ``permission_request`` SSE + arm the
            5min auto-deny timer (unchanged D-007@v1 behavior).
        """
        session_id = payload.session_id
        run_id = payload.run_id
        request_id = payload.request_id
        is_dialog = payload.dialog_kind is not None

        # Reuse DaemonService's read-only current-run lookup; session fetch is
        # also read-only here — write-side locking is the REST response path's job.
        from app.modules.agent.model import AgentSession

        session_obj = (
            await self._svc._session.execute(  # type: ignore[attr-defined]
                select(AgentSession).where(AgentSession.id == session_id)
            )
        ).scalar_one_or_none()
        if session_obj is None:
            log.warning(
                "permission_request_session_not_found",
                session_id=str(session_id),
                request_id=request_id,
            )
            return
        if session_obj.runtime_id is None:
            log.warning(
                "permission_request_no_runtime",
                session_id=str(session_id),
                request_id=request_id,
                daemon_id=str(daemon_id),
            )
            return
        expected_daemon_id = await self._resolve_daemon_id_for_runtime(session_obj.runtime_id)
        if expected_daemon_id != daemon_id:
            log.warning(
                "permission_request_daemon_mismatch",
                session_id=str(session_id),
                request_id=request_id,
                runtime_id=str(session_obj.runtime_id),
                expected_daemon_id=str(expected_daemon_id),
                received_daemon_id=str(daemon_id),
            )
            return
        if (session_obj.status or "") not in ACTIVE_SESSION_STATUSES:
            log.warning(
                "permission_request_session_not_active",
                session_id=str(session_id),
                request_id=request_id,
                status=session_obj.status,
            )
            return
        config = session_obj.config or {}
        if config.get("manual_approval") is not True:
            # daemon should never send PERMISSION_REQUEST for manual=false sessions
            log.warning(
                "permission_request_manual_disabled",
                session_id=str(session_id),
                request_id=request_id,
            )
            return

        current_run = await self._svc._get_current_run(session_id)  # type: ignore[attr-defined]
        if current_run is None or current_run.id != run_id:
            log.warning(
                "permission_request_run_mismatch",
                session_id=str(session_id),
                request_id=request_id,
                payload_run_id=str(run_id),
                current_run_id=str(current_run.id) if current_run else None,
            )
            return
        if (current_run.status or "") not in ACTIVE_TURN_STATUSES:
            log.warning(
                "permission_request_run_not_active_turn",
                session_id=str(session_id),
                request_id=request_id,
                run_status=current_run.status,
            )
            return

        # Publish permission_request SSE for the frontend approval card. For
        # dialogs the event carries dialog_kind + dialog_payload so the card
        # can render the question+options instead of an allow/deny prompt.
        sse_payload: dict[str, object] = {
            "event": "permission_request",
            "session_id": str(session_id),
            "run_id": str(run_id),
            "request_id": request_id,
            "tool_name": payload.tool_name,
            "input": payload.input,
        }
        if payload.tool_use_id:
            sse_payload["tool_use_id"] = payload.tool_use_id
        if is_dialog:
            sse_payload["dialog_kind"] = payload.dialog_kind
            sse_payload["dialog_payload"] = payload.dialog_payload
        await self._svc._publish_session_event(  # type: ignore[attr-defined]
            session_id, sse_payload
        )

        if is_dialog:
            # Persist the dialog so it survives a frontend refresh. Idempotent
            # on request_id (unique) — a daemon replay upserts the same row
            # instead of forking a second pending card.
            await self._upsert_dialog_row(payload)
            log.info(
                "permission_request_accepted_dialog",
                session_id=str(session_id),
                request_id=request_id,
                tool_name=payload.tool_name,
                dialog_kind=payload.dialog_kind,
            )
            return

        # Plain canUseTool approval: arm 5min timeout. Use a fresh task so a
        # daemon disconnect can't cancel it.
        if request_id in self._timers:
            # Duplicate request_id (UUID collision / daemon replay): replace.
            self._timers[request_id].cancel()
        self._timers[request_id] = asyncio.create_task(
            self._on_timeout(session_id, run_id, request_id, session_obj.runtime_id)
        )
        log.info(
            "permission_request_accepted",
            session_id=str(session_id),
            request_id=request_id,
            tool_name=payload.tool_name,
        )

    # ── daemon_id resolution (task-06 ws routes by daemon_instance_id) ───────

    async def _resolve_daemon_id_for_runtime(
        self,
        runtime_id: uuid.UUID,
    ) -> uuid.UUID | None:
        """Resolve the daemon_entity key the WS hub routes by, for a runtime.

        task-06 / design §5.3: ``DaemonWsHub`` connections are keyed by
        ``daemon_instance_id`` (one socket per daemon entity), but sessions +
        permission timers still carry ``runtime_id`` (the provider row). This
        mirrors ``session.service._resolve_daemon_id_for_runtime`` so the
        permission downlink addresses the right WS connection.

        Migration fallback (D-007 window): pre-existing runtime rows have
        ``daemon_instance_id=NULL`` until the daemon re-registers. For those we
        fall back to the ``runtime_id`` itself as the connection key (legacy
        routing surface) — this keeps existing tests that bind only a runtime
        row working and matches the session service's fallback 1:1. Returns
        ``None`` only when the runtime row is missing entirely.
        """
        from app.modules.daemon.model import DaemonRuntime

        rt = await self._svc._session.get(DaemonRuntime, runtime_id)  # type: ignore[attr-defined]
        if rt is None:
            return None
        if rt.daemon_instance_id is None:
            # D-007 migration window: no daemon entity yet -> route by runtime_id.
            return runtime_id
        return rt.daemon_instance_id

    # ── Dialog persistence helper ────────────────────────────────────────────

    async def _upsert_dialog_row(self, payload: PermissionRequestPayload) -> SessionDialogRequest:
        """Idempotently persist a pending dialog row keyed by ``request_id``.

        A daemon replay (same request_id sent twice) must not fork a second
        pending card, so we look up by the unique ``request_id`` first and
        refresh the mutable fields in place rather than inserting a duplicate.
        The row is committed immediately so a concurrent REST ``response``
        call (different request, same DB session) sees it.
        """
        assert payload.dialog_kind is not None  # caller guarantees this
        session = self._svc._session  # type: ignore[attr-defined]
        existing = (
            await session.execute(
                select(SessionDialogRequest).where(
                    SessionDialogRequest.request_id == payload.request_id
                )
            )
        ).scalar_one_or_none()
        if existing is not None:
            # Refresh mutable fields in case the daemon re-sent with updated
            # payload; keep status/answer untouched (a pending replay must not
            # clobber an in-flight or already-answered row).
            existing.dialog_payload = payload.dialog_payload
            existing.run_id = payload.run_id
            existing.session_id = payload.session_id
            existing.tool_name = payload.tool_name
            existing.dialog_kind = payload.dialog_kind
            await session.commit()
            await session.refresh(existing)
            return existing
        row = SessionDialogRequest(
            session_id=payload.session_id,
            run_id=payload.run_id,
            request_id=payload.request_id,
            tool_name=payload.tool_name,
            dialog_kind=payload.dialog_kind,
            dialog_payload=payload.dialog_payload,
            status="pending",
        )
        session.add(row)
        await session.commit()
        await session.refresh(row)
        return row

    async def list_pending_dialogs(
        self,
        user_id: uuid.UUID,
        session_id: uuid.UUID,
    ) -> list[SessionDialogRead]:
        """Return pending dialog requests for a session (page-refresh recovery).

        Ownership is enforced via ``_get_owned_session_for_update`` so a
        cross-user session surfaces as 404 without existence leak, mirroring
        the rest of the daemon REST surface.
        """
        # Read-only ownership check (the lock is harmless for a GET and keeps
        # the helper self-contained; we commit immediately to release it).
        await self._svc._get_owned_session_for_update(session_id, user_id)  # type: ignore[attr-defined]
        await self._svc._session.commit()  # type: ignore[attr-defined]

        rows = (
            (
                await self._svc._session.execute(  # type: ignore[attr-defined]
                    select(SessionDialogRequest)
                    .where(
                        SessionDialogRequest.session_id == session_id,
                        SessionDialogRequest.status == "pending",
                    )
                    .order_by(SessionDialogRequest.created_at)
                )
            )
            .scalars()
            .all()
        )
        return [SessionDialogRead.from_model(r) for r in rows]

    # ── REST downlink: POST .../permissions/{request_id}/response ────────────

    async def respond_permission(
        self,
        user_id: uuid.UUID,
        session_id: uuid.UUID,
        request_id: str,
        decision: Literal["allow", "deny"],
        message: str | None = None,
        dialog_result: dict | None = None,
    ) -> PermissionResponseRead:
        """REST response from the user: send PERMISSION_RESPONSE to the daemon.

        Two paths share this entry point (the REST surface is uniform so the
        frontend does not need to know which kind of card it is dismissing):

        * **Dialog** (``dialog_result`` is not None, or ``request_id`` matches a
          ``session_dialog_requests`` row): look up the persisted row, flip it
          to ``answered`` (404 if missing/unknown, 409 if already answered),
          send PERMISSION_RESPONSE carrying ``dialog_result``. No timer to
          cancel — dialogs are not timeout-enforced.

        * **Plain canUseTool approval**: the existing timer-based path.

        Validation order (shared):
          1. session owned by user (404 if not, no existence leak);
          2. session.status active; session.config.manual_approval is True;
          3. current run exists;
          4. resolve request_id → dialog row OR pending timer (404 otherwise);
          5. send WS downlink (504 if runtime offline), publish permission_resolved SSE.
        """
        session_obj = await self._svc._get_owned_session_for_update(  # type: ignore[attr-defined]
            session_id, user_id
        )
        if (session_obj.status or "") not in ACTIVE_SESSION_STATUSES:
            raise DaemonSessionNotActive(
                f"AgentSession '{session_id}' is not active (status={session_obj.status}).",
                details={"session_id": str(session_id), "status": session_obj.status},
            )
        config = session_obj.config or {}
        if config.get("manual_approval") is not True:
            raise DaemonPermissionManualDisabled(
                f"AgentSession '{session_id}' does not have manual_approval enabled.",
                details={"session_id": str(session_id)},
            )
        # Release the row lock ASAP — WS send / SSE publish are not DB work.
        await self._svc._session.commit()  # type: ignore[attr-defined]

        current_run = await self._svc._get_current_run(session_id)  # type: ignore[attr-defined]
        if current_run is None:
            raise DaemonSessionNotActive(
                f"AgentSession '{session_id}' has no active run to approve.",
                details={"session_id": str(session_id)},
            )

        # ── Resolve request_id → dialog row OR plain-approval timer ────────
        # A dialog response is signalled either by the caller passing
        # ``dialog_result`` explicitly, or by a matching pending DB row. We
        # check the DB first because dialogs are the persistent case; a plain
        # approval has no row and falls through to the timer lookup.
        dialog_row = (
            await self._svc._session.execute(  # type: ignore[attr-defined]
                select(SessionDialogRequest).where(SessionDialogRequest.request_id == request_id)
            )
        ).scalar_one_or_none()
        if dialog_row is not None:
            return await self._respond_dialog(
                session_obj=session_obj,
                dialog_row=dialog_row,
                decision=decision,
                message=message,
                dialog_result=dialog_result,
            )

        # Plain canUseTool approval: request_id lifecycle via the in-memory timer.
        timer = self._timers.pop(request_id, None)
        if timer is None:
            # Either already resolved/timeout, or daemon never sent a matching
            # request (client race / stale card). 404 — caller should drop the card.
            raise DaemonPermissionNotFound(
                f"Permission request '{request_id}' not found (already resolved or unknown).",
                details={"session_id": str(session_id), "request_id": request_id},
            )
        timer.cancel()

        if session_obj.runtime_id is None:
            # Should not happen for active sessions (placement bound), but guard.
            raise DaemonSessionNotActive(
                f"AgentSession '{session_id}' has no runtime binding.",
                details={"session_id": str(session_id)},
            )

        ws_payload = {
            "session_id": str(session_id),
            "request_id": request_id,
            "decision": decision,
        }
        if message is not None:
            ws_payload["message"] = message

        # task-06: WS hub routes by daemon_instance_id. Resolve the daemon
        # entity owning this runtime; migration-window fallback routes by
        # runtime_id (legacy surface). Resolve failure → 504.
        route_key = await self._resolve_daemon_id_for_runtime(session_obj.runtime_id)
        if route_key is None:
            raise DaemonRuntimeOffline(
                f"daemon runtime '{session_obj.runtime_id}' not found; "
                f"permission response could not be delivered.",
                details={
                    "runtime_id": str(session_obj.runtime_id),
                    "session_id": str(session_id),
                    "request_id": request_id,
                },
            )
        sent = await self._hub.send_permission_response(route_key, ws_payload)
        if not sent:
            # Re-arm: the daemon fallback timer will still deny; surface 504 so
            # the frontend can prompt retry. Re-create a fresh 5min timer so a
            # subsequent retry against the same request_id (user re-clicks
            # after 504) still finds it in _timers and can attempt another
            # send instead of getting a 404 (P1-2 fix: the previous code
            # popped the timer above and never re-inserted it, making the
            # 504-retry path dead — user could never re-respond). The old
            # timer was already cancelled above; create a new task so the
            # timeout enforcer stays live for the retry window.
            self._timers[request_id] = asyncio.create_task(
                self._on_timeout(session_id, current_run.id, request_id, session_obj.runtime_id)
            )
            raise DaemonRuntimeOffline(
                f"daemon runtime '{session_obj.runtime_id}' offline; "
                f"permission response could not be delivered.",
                details={
                    "runtime_id": str(session_obj.runtime_id),
                    "daemon_id": str(route_key),
                    "session_id": str(session_id),
                    "request_id": request_id,
                },
            )

        await self._svc._publish_session_event(  # type: ignore[attr-defined]
            session_id,
            {
                "event": "permission_resolved",
                "session_id": str(session_id),
                "request_id": request_id,
                "decision": decision,
                "reason": "manual",
            },
        )
        log.info(
            "permission_response_sent",
            session_id=str(session_id),
            request_id=request_id,
            decision=decision,
        )
        return PermissionResponseRead(
            session_id=session_id,
            request_id=request_id,
            decision=decision,
            accepted=True,
        )

    async def _respond_dialog(
        self,
        *,
        session_obj: Any,
        dialog_row: SessionDialogRequest,
        decision: Literal["allow", "deny"],
        message: str | None,
        dialog_result: dict | None,
    ) -> PermissionResponseRead:
        """Dialog branch of ``respond_permission`` (persisted, no timer)."""
        session_id = dialog_row.session_id
        request_id = dialog_row.request_id

        if dialog_row.status == "answered":
            raise DaemonDialogAlreadyResolved(
                f"Dialog request '{request_id}' was already answered.",
                details={"session_id": str(session_id), "request_id": request_id},
            )
        if dialog_row.status == "cancelled":
            raise DaemonDialogNotFound(
                f"Dialog request '{request_id}' was cancelled.",
                details={"session_id": str(session_id), "request_id": request_id},
            )
        if session_obj.runtime_id is None:
            raise DaemonSessionNotActive(
                f"AgentSession '{session_id}' has no runtime binding.",
                details={"session_id": str(session_id)},
            )

        ws_payload: dict[str, object] = {
            "session_id": str(session_id),
            "request_id": request_id,
            "decision": decision,
        }
        if message is not None:
            ws_payload["message"] = message
        if dialog_result is not None:
            ws_payload["dialog_result"] = dialog_result

        # task-06: WS hub routes by daemon_instance_id (migration-window
        # fallback routes by runtime_id). Resolve before sending.
        route_key = await self._resolve_daemon_id_for_runtime(session_obj.runtime_id)
        sent = (
            await self._hub.send_permission_response(route_key, ws_payload)
            if route_key is not None
            else False
        )
        if not sent:
            # Dialogs have no backend timeout to re-arm; surface 504 so the
            # frontend can retry. The DB row stays pending (untouched below)
            # so a retry against the same request_id is idempotent.
            raise DaemonRuntimeOffline(
                f"daemon runtime '{session_obj.runtime_id}' offline; "
                f"dialog response could not be delivered.",
                details={
                    "runtime_id": str(session_obj.runtime_id),
                    "daemon_id": str(route_key) if route_key is not None else None,
                    "session_id": str(session_id),
                    "request_id": request_id,
                },
            )

        # Flip the row to answered only after the WS send succeeded — a 504
        # must leave the dialog pending so the user can retry.
        dialog_row.status = "answered"
        dialog_row.answer = dialog_result
        dialog_row.answered_at = datetime.now(UTC)
        # answered_by is set by the caller via the user_id; threaded through
        # session_obj would require an extra param, so we read it off the
        # owned session's user_id (already validated upstream).
        dialog_row.answered_by = session_obj.user_id
        await self._svc._session.commit()  # type: ignore[attr-defined]

        await self._svc._publish_session_event(  # type: ignore[attr-defined]
            session_id,
            {
                "event": "permission_resolved",
                "session_id": str(session_id),
                "request_id": request_id,
                "decision": decision,
                "reason": "manual",
                "dialog_kind": dialog_row.dialog_kind,
            },
        )
        log.info(
            "dialog_response_sent",
            session_id=str(session_id),
            request_id=request_id,
            decision=decision,
            dialog_kind=dialog_row.dialog_kind,
        )
        return PermissionResponseRead(
            session_id=session_id,
            request_id=request_id,
            decision=decision,
            accepted=True,
        )

    # ── Timeout enforcer ─────────────────────────────────────────────────────

    async def _on_timeout(
        self,
        session_id: uuid.UUID,
        run_id: uuid.UUID,
        request_id: str,
        runtime_id: uuid.UUID | None,
    ) -> None:
        """5min elapsed with no user response → auto-deny (D-007@v1 fail-closed).

        Best-effort: send PERMISSION_RESPONSE(deny) via ws_hub + publish
        ``permission_resolved{reason:timeout}`` SSE so the frontend card can
        dismiss. Either failure is logged but not raised — the daemon-side
        fallback timer is the ultimate fail-closed safety net.
        """
        try:
            await asyncio.sleep(self._timeout_sec)
        except asyncio.CancelledError:
            # User responded in time → respond_permission already popped the timer.
            return

        # Pop self from _timers (it may have been replaced by a re-armed entry
        # after an offline retry; only delete if still us).
        current = self._timers.get(request_id)
        if current is not None and current.done() is False and current is asyncio.current_task():
            self._timers.pop(request_id, None)

        ws_payload = {
            "session_id": str(session_id),
            "request_id": request_id,
            "decision": "deny",
            "message": "permission request timed out (5min)",
        }
        # task-06: WS hub routes by daemon_instance_id (migration-window
        # fallback routes by runtime_id).
        route_key = (
            await self._resolve_daemon_id_for_runtime(runtime_id)
            if runtime_id is not None
            else None
        )
        if route_key is None:
            log.warning(
                "permission_timeout_no_runtime",
                session_id=str(session_id),
                request_id=request_id,
                runtime_id=str(runtime_id) if runtime_id is not None else None,
            )
            # Still publish the timeout SSE so the frontend card dismisses.
            await self._svc._publish_session_event(  # type: ignore[attr-defined]
                session_id,
                {
                    "event": "permission_resolved",
                    "session_id": str(session_id),
                    "request_id": request_id,
                    "decision": "deny",
                    "reason": "timeout",
                },
            )
            return
        sent = await self._hub.send_permission_response(route_key, ws_payload)
        if not sent:
            log.warning(
                "permission_timeout_send_failed",
                session_id=str(session_id),
                request_id=request_id,
                runtime_id=str(runtime_id),
                daemon_id=str(route_key),
            )

        await self._svc._publish_session_event(  # type: ignore[attr-defined]
            session_id,
            {
                "event": "permission_resolved",
                "session_id": str(session_id),
                "request_id": request_id,
                "decision": "deny",
                "reason": "timeout",
            },
        )
        log.warning(
            "permission_request_timed_out",
            session_id=str(session_id),
            run_id=str(run_id),
            request_id=request_id,
            delivered=sent,
        )
