"""Centralised path resolution for project-root-relative paths.

The core problem this module solves: ``SPEC_DATA_ROOT=./data/spec-storage``
is a relative path.  ``os.path.abspath()`` resolves it against the current
working directory, which in production is ``backend/``.  That produces

    <repo-root>/backend/data/spec-storage/{ws_id}   ← WRONG

instead of the intended

    <repo-root>/data/spec-storage/{ws_id}            ← CORRECT

All "relative to the repo root" resolution should go through
:func:`repo_root` and :func:`resolve_spec_data_root`.
"""

from __future__ import annotations

from pathlib import Path

# ---------------------------------------------------------------------------
# Repo root — derived from *this file*'s location
# ---------------------------------------------------------------------------
# backend/app/core/paths.py
#   parents[0] = backend/app/core/
#   parents[1] = backend/app/
#   parents[2] = backend/
#   parents[3] = repo root
REPO_ROOT: Path = Path(__file__).resolve().parents[3]


def repo_root() -> Path:
    """Return the project repository root as an absolute :class:`Path`.

    The value is computed once at import time from ``__file__`` so it is
    stable regardless of the current working directory.
    """
    return REPO_ROOT


def resolve_spec_data_root(raw: str) -> str:
    """Resolve the ``SPEC_DATA_ROOT`` value to an absolute path string.

    * **Absolute path** — returned unchanged.
    * **Relative path** — resolved against the repo root (not CWD).

    This function is intentionally pure (no I/O) so it can be used inside
    Pydantic validators without side effects.
    """
    p = Path(raw)
    # ``Path.is_absolute()`` does not recognise Windows drive-letter paths
    # (e.g. ``C:/data``) as absolute on POSIX, so we check explicitly.
    if p.is_absolute() or (len(raw) >= 2 and raw[1] == ":"):
        return str(p)
    return str(REPO_ROOT / p)
