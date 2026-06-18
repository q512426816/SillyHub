"""Pydantic schemas for daemon endpoints."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

# ── Register ────────────────────────────────────────────────────────────────


class DaemonRegisterRequest(BaseModel):
    """Request body for daemon runtime registration."""

    name: str | None = None
    provider: str = Field(max_length=50)  # "claude-code" | "sillyspec"
    version: str | None = Field(default=None, max_length=50)
    os: str | None = Field(default=None, max_length=50)
    arch: str | None = Field(default=None, max_length=50)
    capabilities: dict | None = None


class DaemonRuntimeRead(BaseModel):
    """Response body for daemon runtime info."""

    id: uuid.UUID
    name: str | None
    provider: str | None
    version: str | None
    status: str | None
    last_heartbeat_at: datetime | None
    capabilities: dict | None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


# ── Heartbeat ───────────────────────────────────────────────────────────────


class DaemonHeartbeatRequest(BaseModel):
    """Request body for HTTP heartbeat (WebSocket fallback)."""

    runtime_id: uuid.UUID


class DaemonHeartbeatResponse(BaseModel):
    """Response body for HTTP heartbeat."""

    runtime_id: uuid.UUID
    status: str
    pending_operations: dict | None = None


# ── Lease claim ─────────────────────────────────────────────────────────────


class LeaseClaimRequest(BaseModel):
    """Request body for claiming a task lease."""

    runtime_id: uuid.UUID


class LeaseClaimResponse(BaseModel):
    """Response body for a successful lease claim."""

    lease_id: uuid.UUID
    claim_token: str
    payload: dict  # execution context
    lease_expires_at: datetime


# ── Lease lifecycle ─────────────────────────────────────────────────────────


class LeaseStartRequest(BaseModel):
    """Request body for marking a lease as started."""

    claim_token: str


class LeaseStartResponse(BaseModel):
    """Response body for lease start."""

    lease_id: uuid.UUID
    status: str


class LeaseHeartbeatRequest(BaseModel):
    """Request body for lease heartbeat."""

    claim_token: str


class LeaseHeartbeatResponse(BaseModel):
    """Response body for lease heartbeat."""

    lease_id: uuid.UUID
    status: str


class LeaseCompleteRequest(BaseModel):
    """Request body for lease completion."""

    claim_token: str
    result: dict  # {status, patch?, stats?}


class LeaseCompleteResponse(BaseModel):
    """Response body for lease completion."""

    lease_id: uuid.UUID
    status: str


# ── Lease messages ──────────────────────────────────────────────────────────


class LeaseMessagesRequest(BaseModel):
    """Request body for submitting agent messages for a lease."""

    claim_token: str
    agent_run_id: uuid.UUID
    messages: list[dict]


class LeaseMessagesResponse(BaseModel):
    """Response body for lease messages submission."""

    accepted: bool
    count: int


# ── Lease read ──────────────────────────────────────────────────────────────


class DaemonTaskLeaseRead(BaseModel):
    """Response body for lease info."""

    id: uuid.UUID
    runtime_id: uuid.UUID | None
    agent_run_id: uuid.UUID | None
    status: str | None
    claimed_at: datetime | None
    lease_expires_at: datetime | None
    attempt_number: int | None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


# ── Lease sync ──────────────────────────────────────────────────────────────


class LeaseSyncRequest(BaseModel):
    """Request body for syncing AgentRun status from daemon."""

    claim_token: str
    status: str  # running, completed, failed, killed
    error: str | None = None


class LeaseSyncResponse(BaseModel):
    """Response body for lease status sync."""

    agent_run_id: uuid.UUID | None
    status: str


# ── list-dir (WS RPC forwarding, design §7.2 / task-04) ──────────────────────


class DirEntry(BaseModel):
    """A single directory entry returned by the daemon list_dir RPC."""

    name: str
    type: Literal["dir", "file"]


class ListDirRequest(BaseModel):
    """Request body for POST /runtimes/{runtime_id}/list-dir."""

    path: str = Field(min_length=1, description="daemon 客户端机器上的绝对路径")


class ListDirResponse(BaseModel):
    """Response body for POST /runtimes/{runtime_id}/list-dir."""

    entries: list[DirEntry]
