"""Base provider protocol for Git access checks."""

from __future__ import annotations

from dataclasses import dataclass


@dataclass
class AccessResult:
    accessible: bool
    reason: str | None = None


class GitProvider:
    """Base class for provider-specific access checks.

    Subclasses implement ``check_pat_access`` which verifies whether a PAT
    can reach a given repository.
    """

    async def check_pat_access(self, token: str, repo_url: str) -> AccessResult:
        raise NotImplementedError
