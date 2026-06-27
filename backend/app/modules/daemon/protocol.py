"""WebSocket message protocol constants and structures for daemon communication."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel

# ── Message type constants ──────────────────────────────────────────────────

# Server → Daemon
DAEMON_MSG_TASK_AVAILABLE = "daemon:task_available"
DAEMON_MSG_HEARTBEAT = "daemon:heartbeat"
DAEMON_MSG_RPC = "daemon:rpc"  # RPC request with rpc_id correlation (e.g. list_dir)

# Daemon → Server
DAEMON_MSG_REGISTER = "daemon:register"
DAEMON_MSG_HEARTBEAT_ACK = "daemon:heartbeat_ack"
DAEMON_MSG_LEASE_CLAIM = "daemon:lease_claim"
DAEMON_MSG_LEASE_START = "daemon:lease_start"
DAEMON_MSG_LEASE_COMPLETE = "daemon:lease_complete"
DAEMON_MSG_LEASE_MESSAGES = "daemon:lease_messages"
DAEMON_MSG_RPC_RESULT = "daemon:rpc_result"  # RPC response (result OR error) keyed by rpc_id

# ── Interactive session / permission control (task-03, D-002@v3 SDK driver) ──
# Verbatim-aligned with sillyhub-daemon/src/protocol.ts MSG.SESSION_* / PERMISSION_*.
# Any character drift (case/underscore/colon prefix) → contract test red (NFR-05).
#
# v3 SDK turn semantics (NOT v2 per-turn spawn + resume):
#   - SESSION_INJECT:    inputQueue.push + SDK query(AsyncIterable) next turn (spike H2)
#   - SESSION_INTERRUPT: ClaudeSdkDriver.interrupt(query) → turn-level abort,
#                        result(subtype=error_during_execution) (spike D1)
#   - SESSION_END:       cleanup SessionStore + backend service.end_session single entry
#   - PERMISSION_*:      canUseTool callback → WS round-trip (spike D2, D-007)
#
# Direction:
#   - SESSION_INJECT / INTERRUPT / END / PERMISSION_RESPONSE: Server → Daemon
#   - PERMISSION_REQUEST: Daemon → Server
DAEMON_MSG_SESSION_INJECT = "daemon:session_inject"  # Server → Daemon, FR-02
DAEMON_MSG_SESSION_INTERRUPT = "daemon:session_interrupt"  # Server → Daemon, FR-04
DAEMON_MSG_SESSION_END = "daemon:session_end"  # Server → Daemon, FR-05
# task-06 / FR-2: reopen (resume) an ended claude session on the owning daemon.
# Daemon side runs SDK resume (task-08); echoed verbatim as
# `daemon:session_resume` in sillyhub-daemon/src/protocol.ts.
DAEMON_MSG_SESSION_RESUME = "daemon:session_resume"  # Server → Daemon, FR-2
DAEMON_MSG_PERMISSION_REQUEST = "daemon:permission_request"  # Daemon → Server, FR-07 / D-007
DAEMON_MSG_PERMISSION_RESPONSE = "daemon:permission_response"  # Server → Daemon, FR-07 / D-007
DAEMON_MSG_SELF_UPDATE = "daemon:self_update"  # Server → Daemon, 推送 daemon 自更新指令


# ── Message envelope ────────────────────────────────────────────────────────


class DaemonMessage(BaseModel):
    """Generic WebSocket message envelope for daemon communication."""

    type: str
    payload: dict | None = None


# ── Payload structures ──────────────────────────────────────────────────────


class TaskAvailablePayload(BaseModel):
    """Payload for task_available messages (server → daemon)."""

    runtime_id: uuid.UUID
    task_id: uuid.UUID | None = None
    lease_id: uuid.UUID | None = None


class HeartbeatPayload(BaseModel):
    """Payload for heartbeat messages (bidirectional)."""

    runtime_id: uuid.UUID


class HeartbeatAckPayload(BaseModel):
    """Payload for heartbeat_ack messages (server → daemon)."""

    runtime_id: uuid.UUID
    pending_operations: dict | None = None


class LeaseClaimPayload(BaseModel):
    """Payload for lease_claim messages (daemon → server)."""

    runtime_id: uuid.UUID
    lease_id: uuid.UUID


class LeaseClaimAckPayload(BaseModel):
    """Payload for lease claim acknowledgement (server → daemon)."""

    lease_id: uuid.UUID
    claim_token: str
    payload: dict  # execution context
    lease_expires_at: datetime


class LeaseCompletePayload(BaseModel):
    """Payload for lease_complete messages (daemon → server)."""

    lease_id: uuid.UUID
    claim_token: str
    result: dict  # {status, patch?, stats?}


class RpcRequestPayload(BaseModel):
    """RPC request payload (server → daemon), nested under DaemonMessage.payload."""

    rpc_id: str
    method: str  # currently only "list_dir"
    params: dict  # method=list_dir → {"path": str}


class RpcResultPayload(BaseModel):
    """RPC response payload (daemon → server); exactly one of result/error is set."""

    rpc_id: str
    result: dict | None = None  # success: list_dir → {"entries":[{"name","type"}]}
    error: dict | None = None  # failure: {"code":"forbidden"|"not_found"|..., "message": str}


# ── Interactive session / permission control payloads (task-03) ──────────────
# Verbatim-aligned with sillyhub-daemon/src/protocol.ts payload interfaces.
# Field names snake_case on both sides; UUID fields are uuid.UUID here (auto-parsed
# from string) and string in TS (serialized UUID).


class SessionInjectPayload(BaseModel):
    """SESSION_INJECT payload (Server → Daemon, FR-02).

    Daemon pushes prompt into inputQueue for SDK query(AsyncIterable) to
    consume the next turn (D-002@v3 SDK in-process multi-turn, spike H2).
    """

    session_id: uuid.UUID
    lease_id: uuid.UUID
    run_id: uuid.UUID
    prompt: str  # non-empty enforced by task-05 service layer
    # gap-2（D-002@v3 补丁 design §3）：lease 级 claim_token，daemon 存入
    # SessionState.claimToken，供 onTurnMessage→submitMessages + gap-3
    # notifyRunResult 复用。首 turn（create_session）+ 后续 inject_session 均携带。
    claim_token: str


class SessionControlPayload(BaseModel):
    """SESSION_INTERRUPT / SESSION_END payload (Server → Daemon, FR-04 / FR-05).

    INTERRUPT is turn-level only (session stays active); END terminates the
    session + lease (clears SessionStore + service.end_session).
    """

    session_id: uuid.UUID
    lease_id: uuid.UUID


class PermissionRequestPayload(BaseModel):
    """PERMISSION_REQUEST payload (Daemon → Server, FR-07 / D-007).

    Triggered by SDK canUseTool callback; backend forwards to frontend approval card.

    Dialog extension (AskUserQuestion-style): when ``dialog_kind`` is set the
    request is *not* a tool approval but a user-facing question that may wait
    indefinitely (no 5min auto-deny). ``dialog_kind`` is a stable discriminator
    (e.g. ``"ask_user_question"``); ``dialog_payload`` carries the full
    question+options blob, forwarded verbatim to the frontend card.
    """

    session_id: uuid.UUID
    run_id: uuid.UUID
    request_id: str  # daemon-generated; response echoes verbatim for correlation
    tool_name: str
    input: dict  # tool call args JSON, forwarded as-is
    tool_use_id: str | None = None
    # AskUserQuestion dialog extension. None → ordinary canUseTool approval
    # (5min timeout, ephemeral, no DB row). Set → long-lived dialog request
    # persisted in session_dialog_requests so it survives frontend refresh.
    dialog_kind: str | None = None
    dialog_payload: dict | None = None


class PermissionResponsePayload(BaseModel):
    """PERMISSION_RESPONSE payload (Server → Daemon, FR-07 / D-007).

    decision='deny' with 5min timeout backend-side (D-007).

    Dialog extension: for AskUserQuestion requests ``dialog_result`` carries
    the user's answer (selected option / free text / …) instead of an
    allow/deny decision; ``decision`` is still echoed as ``allow`` for
    contract uniformity on the daemon side.
    """

    session_id: uuid.UUID
    request_id: str
    decision: Literal["allow", "deny"]
    message: str | None = None
    # AskUserQuestion answer blob. Mirrors ``dialog_kind`` on the request side:
    # present iff the originating request was a dialog, absent for plain
    # canUseTool approvals.
    dialog_result: dict | None = None
