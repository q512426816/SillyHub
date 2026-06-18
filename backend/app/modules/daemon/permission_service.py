"""Session-level canUseTool permission orchestration (task-08 / FR-07 / D-007@v1).

This service lives between the daemon WS uplink (PERMISSION_REQUEST) and the
daemon WS downlink (PERMISSION_RESPONSE), with a 5-minute timeout enforcer that
auto-denies any request the user never answered. It is **stateless across
process restarts** — the in-memory ``_timers`` dict tracks pending requests
only for the lifetime of this process; the daemon-side ``PermissionResolver``
fallback timer + SDK AbortSignal are the final fail-closed safety net
(D-007@v1). No permission DB table is introduced: approvals are ephemeral and
the daemon resolver is the source of truth for whether a tool call proceeded.

Reuses DaemonService helpers verbatim (task-05):
  - ``_publish_session_event(session_id, payload)`` → ``agent_session:{id}`` Redis
  - ``_get_owned_session_for_update(session_id, user_id)`` for REST response auth
  - ``_get_current_run(session_id)`` for run_id / active-turn validation
"""

from __future__ import annotations

import asyncio
import uuid
from dataclasses import dataclass
from typing import TYPE_CHECKING, Literal

from app.core.errors import AppError
from app.core.logging import get_logger
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


@dataclass(frozen=True, slots=True)
class PermissionResponseRead:
    """REST response body for POST /sessions/{id}/permissions/{req}/response."""

    session_id: uuid.UUID
    request_id: str
    decision: Literal["allow", "deny"]
    accepted: bool


# ── Service ──────────────────────────────────────────────────────────────────


class DaemonPermissionService:
    """Session-level canUseTool approval orchestration (task-08 / D-007@v1)."""

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
        # request_id → asyncio.Task (5min timeout enforcer). In-memory only;
        # process restart clears it; daemon resolver is the fail-closed net.
        self._timers: dict[str, asyncio.Task[None]] = {}

    # ── WS uplink: PERMISSION_REQUEST (daemon → server) ──────────────────────

    async def handle_permission_request(
        self,
        runtime_id: uuid.UUID,
        payload: PermissionRequestPayload,
    ) -> None:
        """WS PERMISSION_REQUEST handler: validate + publish SSE + arm 5min timer.

        Validation (fail-soft: warn + drop, never close the WS — task-03 NFR-05):
          1. session exists (read-only; lock lives in the REST response endpoint)
          2. session.runtime_id matches the daemon that sent the request
          3. session.status ∈ ACTIVE_SESSION_STATUSES
          4. session.config.get("manual_approval") is True (FR-07 gate)
          5. current run exists, status ∈ ACTIVE_TURN_STATUSES,
             and run.id == payload.run_id

        On success: publish ``permission_request`` SSE + arm 5min timer.
        """
        session_id = payload.session_id
        run_id = payload.run_id
        request_id = payload.request_id

        # Reuse DaemonService's read-only current-run lookup; session fetch is
        # also read-only here — write-side locking is the REST response path's job.
        from sqlalchemy import select

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
        if session_obj.runtime_id != runtime_id:
            log.warning(
                "permission_request_runtime_mismatch",
                session_id=str(session_id),
                request_id=request_id,
                expected_runtime_id=str(session_obj.runtime_id),
                received_runtime_id=str(runtime_id),
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

        # Publish permission_request SSE for the frontend approval card.
        await self._svc._publish_session_event(  # type: ignore[attr-defined]
            session_id,
            {
                "event": "permission_request",
                "session_id": str(session_id),
                "run_id": str(run_id),
                "request_id": request_id,
                "tool_name": payload.tool_name,
                "input": payload.input,
                **({"tool_use_id": payload.tool_use_id} if payload.tool_use_id else {}),
            },
        )

        # Arm 5min timeout. Use a fresh task so a daemon disconnect can't cancel it.
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

    # ── REST downlink: POST .../permissions/{request_id}/response ────────────

    async def respond_permission(
        self,
        user_id: uuid.UUID,
        session_id: uuid.UUID,
        request_id: str,
        decision: Literal["allow", "deny"],
        message: str | None = None,
    ) -> PermissionResponseRead:
        """REST response from the user: send PERMISSION_RESPONSE to the daemon.

        Validation order:
          1. session owned by user (404 if not, no existence leak);
          2. session.status active; session.config.manual_approval is True;
          3. current run exists;
          4. request_id has a pending timer (404 if missing → already timed out
             or never existed; 409 already_resolved is not raised here because
             timers are cancelled atomically);
          5. cancel the timer, send WS downlink (504 if runtime offline),
             publish permission_resolved SSE.
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

        # request_id lifecycle: cancel timer under no lock (single-event-loop access).
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

        sent = await self._hub.send_permission_response(session_obj.runtime_id, ws_payload)
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

        if runtime_id is None:
            log.warning(
                "permission_timeout_no_runtime",
                session_id=str(session_id),
                request_id=request_id,
            )
            return

        ws_payload = {
            "session_id": str(session_id),
            "request_id": request_id,
            "decision": "deny",
            "message": "permission request timed out (5min)",
        }
        sent = await self._hub.send_permission_response(runtime_id, ws_payload)
        if not sent:
            log.warning(
                "permission_timeout_send_failed",
                session_id=str(session_id),
                request_id=request_id,
                runtime_id=str(runtime_id),
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
