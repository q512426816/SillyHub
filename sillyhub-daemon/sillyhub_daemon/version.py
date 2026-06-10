"""Semver parsing and minimum version checking for agent binaries."""

from __future__ import annotations

import re

__all__ = ["MIN_VERSIONS", "parse_semver", "format_semver", "check_min_version"]

_SEMVER_RE = re.compile(r"(\d+)\.(\d+)\.(\d+)")

MIN_VERSIONS: dict[str, tuple[int, int, int]] = {
    "claude": (2, 0, 0),
    "codex": (0, 100, 0),
    "copilot": (1, 0, 0),
}


def parse_semver(raw: str | None) -> tuple[int, int, int] | None:
    """Extract first semver triple from an arbitrary string.

    Uses ``re.search`` so that leading text such as ``"Claude Code 2.1.5"``
    is handled naturally.  Returns ``None`` when *raw* is ``None``/empty or
    no ``major.minor.patch`` pattern is found.
    """
    if not raw:
        return None
    match = _SEMVER_RE.search(raw)
    if not match:
        return None
    return (int(match.group(1)), int(match.group(2)), int(match.group(3)))


def format_semver(triple: tuple[int, int, int]) -> str:
    """Format a semver triple as ``'major.minor.patch'``."""
    return f"{triple[0]}.{triple[1]}.{triple[2]}"


def check_min_version(provider: str, version: str) -> str | None:
    """Return a warning message if *version* is below the minimum for *provider*.

    Returns ``None`` when:
    - *provider* has no entry in :data:`MIN_VERSIONS` (no requirement), or
    - *version* cannot be parsed (nothing to compare), or
    - the parsed version meets or exceeds the minimum.

    Otherwise returns a human-readable warning string.
    """
    min_ver = MIN_VERSIONS.get(provider)
    if min_ver is None:
        return None

    parsed = parse_semver(version)
    if parsed is None:
        return None

    if parsed < min_ver:
        return (
            f"{provider} version {version} is below minimum"
            f" required version {format_semver(min_ver)}"
        )

    return None
