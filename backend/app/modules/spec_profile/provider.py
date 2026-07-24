"""SpecProfileProvider -- loads SillySpec profile manifests.

author: qinyi
created_at: 2026-05-27

This module defines the interface for discovering and loading SillySpec profile
manifests from the reference implementation at
``C:\\Users\\qinyi\\IdeaProjects\\sillyspec``. The current implementation is a
stub / placeholder; concrete loading logic will be added in a follow-up task.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from app.core.logging import get_logger

log = get_logger(__name__)


@dataclass
class ProfileManifestData:
    """In-memory representation of a parsed SillySpec profile manifest."""

    source_path: str
    version: str
    manifest: dict[str, Any] = field(default_factory=dict)

    @property
    def stages(self) -> list[dict[str, Any]]:
        """Return stage definitions from the manifest."""
        return self.manifest.get("stages", [])

    @property
    def documents(self) -> list[dict[str, Any]]:
        """Return document definitions from the manifest."""
        return self.manifest.get("documents", [])

    @property
    def gates(self) -> list[dict[str, Any]]:
        """Return gate definitions from the manifest."""
        return self.manifest.get("gates", [])

    @property
    def agent_contracts(self) -> list[dict[str, Any]]:
        """Return agent contract definitions from the manifest."""
        return self.manifest.get("agent_contracts", [])


class SpecProfileProvider:
    """Discover and load SillySpec profile manifests.

    The provider scans a given source directory for profile manifests,
    validates them, and returns structured ``ProfileManifestData`` objects.

    **Current status**: stub implementation. Methods return placeholder data
    so that downstream consumers (policy, service) can be wired up. Real file
    I/O and manifest parsing will be implemented in a subsequent task.
    """

    DEFAULT_SOURCE_PATH = r"C:\Users\qinyi\IdeaProjects\sillyspec"

    def __init__(self, source_path: str | None = None) -> None:
        self.source_path = Path(source_path or self.DEFAULT_SOURCE_PATH)

    async def get_active_manifest(self) -> ProfileManifestData | None:
        """Return the currently active manifest, if any.

        Stub: returns ``None``. Will consult the database to find the active
        ``SpecProfileManifest`` row and hydrate a ``ProfileManifestData``.
        """
        log.info("spec_profile.get_active_manifest")
        # TODO: implement in follow-up task
        return None
