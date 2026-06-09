"""Agent detection: discover available coding agents on the host."""

from __future__ import annotations

import asyncio
import logging
import re
import shutil
from dataclasses import dataclass

logger = logging.getLogger(__name__)


@dataclass
class AgentInfo:
    """Information about a detected agent."""

    name: str
    command: str
    version: str | None = None
    available: bool = False


class AgentDetector:
    """Detect locally installed agents (Claude Code, SillySpec)."""

    AGENT_DEFS: dict[str, dict] = {
        "claude-code": {
            "commands": ["claude"],
            "version_flag": "--version",
            "version_pattern": r"Claude Code (\d+\.\d+\.\d+)",
        },
        "sillyspec": {
            "commands": ["sillyspec"],
            "version_flag": "--version",
            "version_pattern": r"sillyspec (\d+\.\d+\.\d+)",
        },
    }

    async def detect_all(self) -> list[AgentInfo]:
        """Detect all known agents."""
        results = []
        for name, definition in self.AGENT_DEFS.items():
            info = await self._detect_agent(name, definition)
            results.append(info)
        return results

    async def _detect_agent(self, name: str, definition: dict) -> AgentInfo:
        """Detect a single agent."""
        for cmd in definition["commands"]:
            if shutil.which(cmd):
                version = await self._get_version(cmd, definition)
                return AgentInfo(
                    name=name,
                    command=cmd,
                    version=version,
                    available=True,
                )
        return AgentInfo(name=name, command="", available=False)

    async def _get_version(self, cmd: str, definition: dict) -> str | None:
        """Get agent version by running command."""
        try:
            proc = await asyncio.create_subprocess_exec(
                cmd,
                definition["version_flag"],
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=10)
            output = (stdout or b"").decode() + (stderr or b"").decode()
            match = re.search(definition["version_pattern"], output)
            return match.group(1) if match else None
        except (FileNotFoundError, asyncio.TimeoutError, OSError) as e:
            logger.debug("version_detect_failed agent=%s error=%s", cmd, e)
            return None

    def is_available(self, agent_name: str) -> bool:
        """Check whether a specific agent is available on the system.

        This is a synchronous convenience wrapper. For async detection use
        ``detect_all()`` instead.
        """
        definition = self.AGENT_DEFS.get(agent_name)
        if definition is None:
            return False
        return any(shutil.which(cmd) for cmd in definition["commands"])

    def get_capabilities(self, agents: list[AgentInfo]) -> dict:
        """Build capabilities dict from detected agents."""
        return {
            "agents": [a.name for a in agents if a.available],
            "max_concurrent_tasks": 5,
        }
