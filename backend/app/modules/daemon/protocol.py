"""WebSocket message protocol constants and structures for daemon communication."""

from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel

# ── Message type constants ──────────────────────────────────────────────────

# Server → Daemon
DAEMON_MSG_TASK_AVAILABLE = "daemon:task_available"
DAEMON_MSG_HEARTBEAT = "daemon:heartbeat"

# Daemon → Server
DAEMON_MSG_REGISTER = "daemon:register"
DAEMON_MSG_HEARTBEAT_ACK = "daemon:heartbeat_ack"
DAEMON_MSG_LEASE_CLAIM = "daemon:lease_claim"
DAEMON_MSG_LEASE_START = "daemon:lease_start"
DAEMON_MSG_LEASE_COMPLETE = "daemon:lease_complete"
DAEMON_MSG_LEASE_MESSAGES = "daemon:lease_messages"


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
