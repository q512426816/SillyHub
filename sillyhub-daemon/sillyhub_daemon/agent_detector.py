"""Agent detection: discover available coding agents on the host.

Supports 12 agent providers with environment variable override,
version detection via ``--version`` flag, and minimum version checks.
"""

from __future__ import annotations

import asyncio
import logging
import os
import platform
import re
import shutil
import subprocess
from dataclasses import dataclass

from sillyhub_daemon.version import check_min_version, parse_semver

__all__ = [
    "AgentDef",
    "AgentDetector",
    "AgentInfo",
    "DetectedAgent",
    "check_min_version",
    "parse_semver",
]

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Data classes
# ---------------------------------------------------------------------------


@dataclass
class AgentDef:
    """Definition of a known agent binary."""

    bin: str
    env_path: str
    version_pattern: str
    protocol: str
    min_version: str | None = None


@dataclass
class DetectedAgent:
    """Result of detecting a single agent on the host."""

    name: str
    bin_path: str
    version: str | None
    protocol: str
    available: bool
    version_warning: str | None = None


# Deprecated — kept for backward compatibility.
@dataclass
class AgentInfo:
    """Information about a detected agent.

    .. deprecated::
        Use :class:`DetectedAgent` instead.
    """

    name: str
    command: str
    version: str | None = None
    available: bool = False


# ---------------------------------------------------------------------------
# Semver helpers (imported from version.py)
# ---------------------------------------------------------------------------


# ---------------------------------------------------------------------------
# AgentDetector
# ---------------------------------------------------------------------------


class AgentDetector:
    """Detect locally installed coding agents.

    Supports 12 agent providers.  Detection priority per agent:

    1. ``os.getenv(env_path)`` — if set and the file exists, use it directly
    2. ``shutil.which(bin)`` — find on ``PATH``
    3. Mark as unavailable

    Version is obtained by running ``<bin_path> --version`` and applying the
    provider-specific regex.
    """

    AGENT_DEFS: dict[str, AgentDef] = {
        "claude": AgentDef(
            bin="claude",
            env_path="SILLYHUB_CLAUDE_PATH",
            version_pattern=r"(?:Claude Code\s+)?(\d+\.\d+\.\d+)(?:\s+\(Claude Code\))?",
            protocol="stream_json",
            min_version="2.0.0",
        ),
        "codex": AgentDef(
            bin="codex",
            env_path="SILLYHUB_CODEX_PATH",
            version_pattern=r"(\d+\.\d+\.\d+)",
            protocol="json_rpc",
            min_version="0.100.0",
        ),
        "copilot": AgentDef(
            bin="copilot",
            env_path="SILLYHUB_COPILOT_PATH",
            version_pattern=r"(\d+\.\d+\.\d+)",
            protocol="jsonl",
            min_version="1.0.0",
        ),
        "opencode": AgentDef(
            bin="opencode",
            env_path="SILLYHUB_OPENCODE_PATH",
            version_pattern=r"(\d+\.\d+\.\d+)",
            protocol="ndjson",
        ),
        "openclaw": AgentDef(
            bin="openclaw",
            env_path="SILLYHUB_OPENCLAW_PATH",
            version_pattern=r"(\d+\.\d+\.\d+)",
            protocol="ndjson",
        ),
        "hermes": AgentDef(
            bin="hermes",
            env_path="SILLYHUB_HERMES_PATH",
            version_pattern=r"(\d+\.\d+\.\d+)",
            protocol="json_rpc",
        ),
        "gemini": AgentDef(
            bin="gemini",
            env_path="SILLYHUB_GEMINI_PATH",
            version_pattern=r"(\d+\.\d+\.\d+)",
            protocol="stream_json",
        ),
        "pi": AgentDef(
            bin="pi",
            env_path="SILLYHUB_PI_PATH",
            version_pattern=r"(\d+\.\d+\.\d+)",
            protocol="ndjson",
        ),
        "cursor": AgentDef(
            bin="cursor-agent",
            env_path="SILLYHUB_CURSOR_PATH",
            version_pattern=r"(\d+\.\d+\.\d+)",
            protocol="stream_json",
        ),
        "kimi": AgentDef(
            bin="kimi",
            env_path="SILLYHUB_KIMI_PATH",
            version_pattern=r"(\d+\.\d+\.\d+)",
            protocol="json_rpc",
        ),
        "kiro": AgentDef(
            bin="kiro-cli",
            env_path="SILLYHUB_KIRO_PATH",
            version_pattern=r"(\d+\.\d+\.\d+)",
            protocol="json_rpc",
        ),
        "antigravity": AgentDef(
            bin="agy",
            env_path="SILLYHUB_ANTIGRAVITY_PATH",
            version_pattern=r"(\d+\.\d+\.\d+)",
            protocol="text",
        ),
    }

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    async def detect_all(self) -> list[DetectedAgent]:
        """Detect all known agents and return their status."""
        results: list[DetectedAgent] = []
        for name, defn in self.AGENT_DEFS.items():
            results.append(await self._detect_single(name, defn))
        return results

    async def detect_one(self, name: str) -> DetectedAgent | None:
        """Detect a single agent by name.

        Returns ``None`` when *name* is not in :attr:`AGENT_DEFS`.
        """
        defn = self.AGENT_DEFS.get(name)
        if defn is None:
            return None
        return await self._detect_single(name, defn)

    def is_available(self, agent_name: str) -> bool:
        """Check whether a specific agent is available on the system.

        This is a synchronous convenience wrapper.  For full detection
        including version info use :meth:`detect_one` instead.
        """
        defn = self.AGENT_DEFS.get(agent_name)
        if defn is None:
            return False
        path = self._resolve_bin_path(defn)
        return path is not None

    def get_capabilities(self, agents: list[AgentInfo]) -> dict:
        """Build capabilities dict from detected agents.

        .. deprecated::
            Kept for backward compatibility with existing callers.
        """
        return {
            "agents": [a.name for a in agents if a.available],
            "max_concurrent_tasks": 5,
        }

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _resolve_bin_path(self, defn: AgentDef) -> str | None:
        """Resolve the binary path for an agent.

        Priority: ``os.getenv(env_path)`` (if file exists) → ``shutil.which(bin)`` → ``None``.

        On Windows, ``shutil.which`` may return npm-generated .cmd wrappers.
        Keep the wrapper path so version detection runs the real CLI command
        instead of accidentally treating ``node.exe`` as the agent binary.
        """
        env_val = os.getenv(defn.env_path)
        if env_val:
            if os.path.isfile(env_val):
                return env_val
            logger.debug(
                "env_path %s=%s does not exist, falling back to which(%s)",
                defn.env_path,
                env_val,
                defn.bin,
            )
        return shutil.which(defn.bin)

    async def _detect_version(self, bin_path: str, defn: AgentDef) -> str | None:
        """Run ``<bin_path> --version`` and extract version string."""
        try:
            if platform.system() == "Windows" and bin_path.lower().endswith(
                (".cmd", ".bat")
            ):
                command = subprocess.list2cmdline([bin_path, "--version"])
                proc = await asyncio.create_subprocess_shell(
                    command,
                    stdout=asyncio.subprocess.PIPE,
                    stderr=asyncio.subprocess.PIPE,
                )
            else:
                proc = await asyncio.create_subprocess_exec(
                    bin_path,
                    "--version",
                    stdout=asyncio.subprocess.PIPE,
                    stderr=asyncio.subprocess.PIPE,
                )
            stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=10)
            output = (stdout or b"").decode(errors="replace") + (stderr or b"").decode(
                errors="replace"
            )
            match = re.search(defn.version_pattern, output)
            return match.group(1) if match else None
        except (FileNotFoundError, asyncio.TimeoutError, OSError) as exc:
            logger.debug("version_detect_failed bin=%s error=%s", bin_path, exc)
            return None

    async def _detect_single(self, name: str, defn: AgentDef) -> DetectedAgent:
        """Full detection pipeline for a single agent."""
        bin_path = self._resolve_bin_path(defn)

        if bin_path is None:
            return DetectedAgent(
                name=name,
                bin_path="",
                version=None,
                protocol=defn.protocol,
                available=False,
            )

        version = await self._detect_version(bin_path, defn)
        version_warning: str | None = None
        if version is not None:
            version_warning = check_min_version(name, version)

        return DetectedAgent(
            name=name,
            bin_path=bin_path,
            version=version,
            protocol=defn.protocol,
            available=True,
            version_warning=version_warning,
        )
