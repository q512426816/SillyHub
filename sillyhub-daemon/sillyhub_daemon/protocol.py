"""Message protocol constants for daemon ↔ server communication.

These constants must stay in sync with
``backend/app/modules/daemon/protocol.py`` on the server side.
"""

# ── Message type constants ──────────────────────────────────────────────────

# Server → Daemon
MSG_TASK_AVAILABLE = "daemon:task_available"
MSG_HEARTBEAT = "daemon:heartbeat"

# Daemon → Server
MSG_REGISTER = "daemon:register"
MSG_HEARTBEAT_ACK = "daemon:heartbeat_ack"
MSG_LEASE_CLAIM = "daemon:lease_claim"
MSG_LEASE_START = "daemon:lease_start"
MSG_LEASE_COMPLETE = "daemon:lease_complete"
MSG_LEASE_MESSAGES = "daemon:lease_messages"

# ── Task states ─────────────────────────────────────────────────────────────

STATE_PENDING = "pending"
STATE_RUNNING = "running"
STATE_COMPLETED = "completed"
STATE_FAILED = "failed"
STATE_CANCELLED = "cancelled"
