"""ToolPolicy model, helpers, and ToolPolicyService.

Workspace-level tool execution policy that controls which tools an agent can
use and their constraints (allowed tools, blocked commands, path/domain
restrictions, resource limits).
"""

from __future__ import annotations

import ipaddress
import socket
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from urllib.parse import urlparse

from sqlalchemy import JSON, Column, DateTime, ForeignKey, Index, Integer, String, Uuid
from sqlmodel import Field

from app.core.errors import AppError
from app.core.logging import get_logger
from app.models.base import BaseModel

log = get_logger(__name__)

# All supported tool types — used as default for allowed_tools.
ALL_TOOLS: list[str] = [
    "file_read",
    "file_write",
    "file_list",
    "file_search",
    "shell_exec",
    "run_tests",
    "http_get",
]


# ── Model ────────────────────────────────────────────────────────────────────


class ToolPolicy(BaseModel, table=True):
    """Workspace-level tool execution policy.

    Controls which tools an agent can use and their constraints.
    """

    __tablename__ = "tool_policies"
    __table_args__ = (
        Index("ux_tool_policy_workspace_name", "workspace_id", "name", unique=True),
        Index("ix_tool_policy_workspace", "workspace_id"),
    )

    id: uuid.UUID = Field(
        default_factory=uuid.uuid4,
        sa_column=Column(Uuid(as_uuid=True), primary_key=True, nullable=False),
    )
    workspace_id: uuid.UUID = Field(
        sa_column=Column(
            Uuid(as_uuid=True),
            ForeignKey("workspaces.id", ondelete="CASCADE"),
            nullable=False,
        ),
    )
    name: str = Field(
        max_length=50,
        sa_column=Column(String(50), nullable=False),
    )
    allowed_tools: list[str] = Field(
        default_factory=lambda: list(ALL_TOOLS),
        sa_column=Column(JSON, nullable=False, default=lambda: list(ALL_TOOLS)),
    )
    blocked_commands: list[str] = Field(
        default_factory=list,
        sa_column=Column(JSON, nullable=False, default=list),
    )
    allowed_paths: list[str] = Field(
        default_factory=lambda: ["."],
        sa_column=Column(JSON, nullable=False, default=lambda: ["."]),
    )
    allowed_domains: list[str] = Field(
        default_factory=list,
        sa_column=Column(JSON, nullable=False, default=list),
    )
    max_timeout: int = Field(
        default=30,
        sa_column=Column(Integer, nullable=False, default=30),
    )
    max_output_size: int = Field(
        default=64000,
        sa_column=Column(Integer, nullable=False, default=64000),
    )
    created_at: datetime = Field(
        default_factory=lambda: datetime.now(UTC),
        sa_column=Column(
            DateTime(timezone=True),
            nullable=False,
            default=lambda: datetime.now(UTC),
        ),
    )
    updated_at: datetime = Field(
        default_factory=lambda: datetime.now(UTC),
        sa_column=Column(
            DateTime(timezone=True),
            nullable=False,
            default=lambda: datetime.now(UTC),
            onupdate=lambda: datetime.now(UTC),
        ),
    )


def default_policy() -> ToolPolicy:
    """Create a non-persisted ToolPolicy with permissive defaults.

    Used when an AgentRun has no tool_policy_id set.
    The returned object is NOT added to any session.
    """
    return ToolPolicy(
        id=uuid.uuid4(),
        workspace_id=uuid.UUID("00000000-0000-0000-0000-000000000000"),
        name="__default__",
        allowed_tools=list(ALL_TOOLS),
        blocked_commands=[],
        allowed_paths=["."],
        allowed_domains=[],
        max_timeout=30,
        max_output_size=64000,
    )


# ── Error ────────────────────────────────────────────────────────────────────


class ToolOperationForbidden(AppError):
    """Raised when a tool call violates the workspace policy."""

    code = "TOOL_OPERATION_FORBIDDEN"
    http_status = 403


# ── Data class ───────────────────────────────────────────────────────────────


@dataclass(frozen=True)
class PolicyLimits:
    """Resolved resource limits after applying policy constraints."""

    effective_timeout: int
    max_output_size: int


# ── Service ──────────────────────────────────────────────────────────────────


class ToolPolicyService:
    """Stateless policy validation engine.

    All methods are static — the policy object is passed in each call.
    No DB access is performed; the ToolPolicy instance is expected to be
    loaded by the caller (e.g., ToolGatewayService._load_policy).
    """

    # ── Private IP ranges (SSRF protection) ──
    _PRIVATE_NETWORKS: list[ipaddress.IPv4Network] = [
        ipaddress.IPv4Network("10.0.0.0/8"),
        ipaddress.IPv4Network("172.16.0.0/12"),
        ipaddress.IPv4Network("192.168.0.0/16"),
        ipaddress.IPv4Network("127.0.0.0/8"),
        ipaddress.IPv4Network("169.254.0.0/16"),
        ipaddress.IPv4Network("0.0.0.0/8"),
    ]

    @staticmethod
    def check(
        policy: ToolPolicy,
        tool_type: str,
        params: dict,
        lease_root: Path | None = None,
    ) -> None:
        """Validate a tool call against the given policy.

        Raises:
            ToolOperationForbidden: if the tool call violates the policy.
        """
        # Step 1: Tool whitelist
        ToolPolicyService._check_tool_allowed(policy, tool_type)

        # Step 2: Command blacklist (shell_exec / run_tests only)
        if tool_type in ("shell_exec", "run_tests"):
            ToolPolicyService._check_command_not_blocked(policy, params)

        # Step 3: Domain whitelist + SSRF (http_get only)
        if tool_type == "http_get":
            ToolPolicyService._check_domain_allowed(policy, params)

    @staticmethod
    def apply_limits(
        policy: ToolPolicy,
        params: dict,
        default_timeout: int = 30,
    ) -> PolicyLimits:
        """Compute effective resource limits from policy + params.

        Does NOT modify params. Returns a PolicyLimits dataclass with
        the capped values.
        """
        requested_timeout = params.get("timeout", default_timeout)
        effective_timeout = min(requested_timeout, policy.max_timeout)
        return PolicyLimits(
            effective_timeout=effective_timeout,
            max_output_size=policy.max_output_size,
        )

    # ── Private helpers ──

    @staticmethod
    def _check_tool_allowed(policy: ToolPolicy, tool_type: str) -> None:
        """Raise ToolOperationForbidden if tool_type not in allowed_tools."""
        if tool_type not in policy.allowed_tools:
            raise ToolOperationForbidden(
                f"Tool '{tool_type}' not allowed by policy '{policy.name}'",
                details={
                    "tool_type": tool_type,
                    "allowed_tools": policy.allowed_tools,
                    "policy_name": policy.name,
                },
            )

    @staticmethod
    def _check_command_not_blocked(policy: ToolPolicy, params: dict) -> None:
        """Raise ToolOperationForbidden if command matches blocked_commands."""
        if not policy.blocked_commands:
            return

        command = params.get("command", "")
        args = params.get("args", [])
        combined = f"{command} {' '.join(args)}"

        for blocked in policy.blocked_commands:
            if blocked in combined:
                raise ToolOperationForbidden(
                    f"Command blocked by policy: '{blocked}'",
                    details={
                        "command": command,
                        "args": args,
                        "blocked_pattern": blocked,
                        "policy_name": policy.name,
                    },
                )

    @staticmethod
    def _check_domain_allowed(policy: ToolPolicy, params: dict) -> None:
        """Raise ToolOperationForbidden if domain not in allowed_domains
        or domain resolves to a private IP (SSRF protection).
        """
        url = params.get("url", "")
        domain = _extract_domain(url)

        # SSRF protection — always enforced regardless of allowed_domains
        ToolPolicyService._check_not_private_ip(domain, url)

        # Domain whitelist — only enforced if allowed_domains is non-empty
        if policy.allowed_domains and domain not in policy.allowed_domains:
            raise ToolOperationForbidden(
                f"Domain '{domain}' not in allowed_domains",
                details={
                    "domain": domain,
                    "allowed_domains": policy.allowed_domains,
                    "url": url,
                    "policy_name": policy.name,
                },
            )

    @staticmethod
    def _check_not_private_ip(domain: str, url: str) -> None:
        """Raise ToolOperationForbidden if domain resolves to a private/internal IP."""
        if not domain:
            return

        try:
            addrinfos = socket.getaddrinfo(domain, None, socket.AF_INET)
        except (socket.gaierror, OSError):
            raise ToolOperationForbidden(
                f"Cannot resolve domain '{domain}' — rejected for safety",
                details={"domain": domain, "url": url},
            ) from None

        for _, _, _, _, addr in addrinfos:
            ip_str = addr[0]
            try:
                ip = ipaddress.ip_address(ip_str)
                for network in ToolPolicyService._PRIVATE_NETWORKS:
                    if ip in network:
                        raise ToolOperationForbidden(
                            f"Domain '{domain}' resolves to private IP '{ip_str}' — SSRF blocked",
                            details={"domain": domain, "ip": ip_str, "url": url},
                        )
            except ValueError:
                continue


def _extract_domain(url: str) -> str:
    """Extract hostname from a URL string.

    Returns empty string if URL is malformed or has no hostname.
    """
    try:
        parsed = urlparse(url)
        return parsed.hostname or ""
    except Exception:
        return ""
