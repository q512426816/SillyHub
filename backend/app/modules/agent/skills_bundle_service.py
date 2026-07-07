"""Skills bundle service: platform sillyspec skills scan, manifest, and tar.gz packaging.

Used by the daemon skill-manager (task-03) to synchronise sillyspec skills
from the backend to daemon-side ``.claude/skills/`` at start-up.

Implementation uses only Python stdlib (``tarfile`` + ``hashlib``) — no new
pip dependencies.
"""

from __future__ import annotations

import hashlib
import io
import tarfile
from pathlib import Path
from typing import Any

from app.core.config import get_settings

SKILLS_GLOB = "sillyspec-*"
"""Glob pattern to match sillyspec skill directories under the bundle root."""


def _collect_skill_files(skills_dir: Path) -> list[tuple[Path, Path]]:
    """Recursively collect all regular files from ``sillyspec-*`` subdirectories.

    Returns a list of ``(relative_path, absolute_path)`` tuples sorted by
    relative path for deterministic ordering. Returns empty list when no
    ``sillyspec-*`` directories exist or when none of them contain files.
    """
    files: list[tuple[Path, Path]] = []
    for skill_dir in sorted(skills_dir.glob(SKILLS_GLOB)):
        if not skill_dir.is_dir():
            continue
        for fpath in sorted(skill_dir.rglob("*")):
            if fpath.is_file():
                rel_path = fpath.relative_to(skills_dir)
                files.append((rel_path, fpath))
    return files


def _compute_version(files: list[tuple[Path, Path]], skills_dir: Path) -> str:
    """Compute a content-derived version string.

    Reads every file in order, feeding each into a cumulative SHA-256, then
    returns the first 12 hex characters of the final digest. This guarantees
    that any file change produces a different version.
    """
    digest = hashlib.sha256()
    # Include the directory name itself for cross-machine determinism
    digest.update(skills_dir.name.encode("utf-8"))
    for rel_path, abs_path in files:
        # Also hash the relative path so renames change the version
        digest.update(str(rel_path).encode("utf-8"))
        content = abs_path.read_bytes()
        digest.update(content)
    return digest.hexdigest()[:12]


def build_skills_manifest(
    skills_dir: Path | None = None,
) -> dict[str, Any]:
    """Scan ``skills_dir`` and return a manifest dict.

    The manifest contains:

    * ``version`` — content-derived SHA-256 prefix (12 hex chars); empty string
      when no skills are found.
    * ``files`` — list of ``{path, sha256}`` entries, one per file.
    * ``message`` — informational string (only present on error/empty states).

    When ``skills_dir`` is ``None`` (default) the value from
    ``Settings.skills_bundle_dir`` is used. When the directory does not exist
    or contains no ``sillyspec-*`` directories an empty manifest is returned
    (non-error) so the daemon side can detect "no skills" vs "error".
    """
    if skills_dir is None:
        skills_dir = get_settings().skills_bundle_dir

    if not skills_dir.is_dir():
        return {"version": "", "files": [], "message": "skills directory not found"}

    files = _collect_skill_files(skills_dir)
    if not files:
        return {"version": "", "files": [], "message": "no sillyspec skills found"}

    file_entries: list[dict[str, str]] = []
    for rel_path, abs_path in files:
        file_hash = hashlib.sha256(abs_path.read_bytes()).hexdigest()
        file_entries.append(
            {
                "path": str(rel_path).replace("\\", "/"),
                "sha256": file_hash,
            }
        )

    version = _compute_version(files, skills_dir)
    return {"version": version, "files": file_entries}


def build_skills_bundle(
    skills_dir: Path | None = None,
) -> bytes:
    """Build a gzipped tar archive of all sillyspec-* skill files.

    Returns the raw bytes of the ``.tar.gz`` archive. When the source directory
    does not exist or contains no skills an empty ``b""`` is returned.
    """
    if skills_dir is None:
        skills_dir = get_settings().skills_bundle_dir

    if not skills_dir.is_dir():
        return b""

    files = _collect_skill_files(skills_dir)
    if not files:
        return b""

    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode="w:gz") as tar:
        for rel_path, abs_path in files:
            arcname = str(rel_path).replace("\\", "/")
            tarinfo = tarfile.TarInfo(name=arcname)
            data = abs_path.read_bytes()
            tarinfo.size = len(data)
            tar.addfile(tarinfo, io.BytesIO(data))
    return buf.getvalue()
