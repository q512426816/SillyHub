"""Skills bundle service: platform sillyspec skills scan, manifest, and tar.gz packaging.

Used by the daemon skill-manager (task-03) to synchronise sillyspec skills
from the backend to daemon-side ``.claude/skills/`` at start-up.

Implementation uses only Python stdlib (``tarfile`` + ``hashlib``) — no new
pip dependencies.

Change 2026-07-07-skills-mcp-management-ui (task-03): merged DB ``CustomSkill``
rows into manifest/bundle (D-001 单文件 DB). 每个 CustomSkill → ``<name>/SKILL.md``，
content = ``CustomSkill.content``。version hash 含 DB content（编辑/增删 → version
变 → daemon 重拉）。``session`` 参数可选传，不传时跳过 DB 合并（向后兼容旧调用）。
"""

from __future__ import annotations

import hashlib
import io
import tarfile
from pathlib import Path
from typing import TYPE_CHECKING, Any

from sqlalchemy import select

from app.core.config import get_settings
from app.modules.skills.model import CustomSkill

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession

SKILLS_GLOB = "sillyspec-*"
"""Glob pattern to match sillyspec skill directories under the bundle root."""


def _collect_skill_files(skills_dir: Path) -> list[tuple[Path, bytes]]:
    """Recursively collect all regular files from ``sillyspec-*`` subdirectories.

    Returns a list of ``(relative_path, content_bytes)`` tuples sorted by
    relative path for deterministic ordering. Returns empty list when no
    ``sillyspec-*`` directories exist or when none of them contain files.

    Note: returns in-memory bytes (not absolute paths) so DB-backed custom
    skills (no filesystem path) can be merged into the same list uniformly.
    """
    files: list[tuple[Path, bytes]] = []
    for skill_dir in sorted(skills_dir.glob(SKILLS_GLOB)):
        if not skill_dir.is_dir():
            continue
        for fpath in sorted(skill_dir.rglob("*")):
            if fpath.is_file():
                rel_path = fpath.relative_to(skills_dir)
                files.append((rel_path, fpath.read_bytes()))
    return files


async def _collect_custom_skills(
    session: "AsyncSession | None",
) -> list[tuple[Path, bytes]]:
    """Merge DB ``CustomSkill`` rows into the same ``(relpath, content)`` shape.

    Each CustomSkill → ``<name>/SKILL.md``（D-001 单文件）。content = DB body
    utf-8 encoded. ``name`` 排序保证确定性。当 ``session`` 为 ``None`` 时跳过
    （向后兼容旧调用方/不依赖 DB 的纯代码库扫描场景）。
    """
    if session is None:
        return []
    rows = (await session.execute(select(CustomSkill).order_by(CustomSkill.name))).scalars().all()
    out: list[tuple[Path, bytes]] = []
    for row in rows:
        rel_path = Path(row.name) / "SKILL.md"
        out.append((rel_path, row.content.encode("utf-8")))
    return out


def _compute_version(
    files: list[tuple[Path, bytes]],
    skills_dir: Path,
) -> str:
    """Compute a content-derived version string.

    Feeds each file's relative path + content into a cumulative SHA-256, then
    returns the first 12 hex characters of the final digest. This guarantees
    that any file change (incl. DB custom-skill edit/add/delete) produces a
    different version.
    """
    digest = hashlib.sha256()
    # Include the directory name itself for cross-machine determinism
    digest.update(skills_dir.name.encode("utf-8"))
    for rel_path, content in files:
        # Also hash the relative path so renames change the version
        digest.update(str(rel_path).encode("utf-8"))
        digest.update(content)
    return digest.hexdigest()[:12]


async def _gather_all_files(
    skills_dir: Path,
    session: "AsyncSession | None",
) -> list[tuple[Path, bytes]]:
    """Combine codebase sillyspec-* files + DB custom skills (deterministic order).

    Both lists are individually sorted; codebase files first, then DB custom
    skills (so a codebase-only caller with ``session=None`` gets the original
    ordering unchanged).
    """
    fs_files = _collect_skill_files(skills_dir)
    db_files = await _collect_custom_skills(session)
    return fs_files + db_files


async def build_skills_manifest(
    skills_dir: Path | None = None,
    session: "AsyncSession | None" = None,
) -> dict[str, Any]:
    """Scan ``skills_dir`` + DB ``CustomSkill`` rows and return a manifest dict.

    The manifest contains:

    * ``version`` — content-derived SHA-256 prefix (12 hex chars); empty string
      when no skills are found.
    * ``files`` — list of ``{path, sha256}`` entries, one per file.
    * ``message`` — informational string (only present on error/empty states).

    When ``skills_dir`` is ``None`` (default) the value from
    ``Settings.skills_bundle_dir`` is used. When the directory does not exist
    an empty manifest is returned (non-error) so the daemon side can detect
    "no skills" vs "error". ``session`` is optional — when ``None`` the DB
    custom-skills merge is skipped (backward-compatible pure-codebase behavior).
    """
    if skills_dir is None:
        skills_dir = get_settings().skills_bundle_dir

    if not skills_dir.is_dir():
        # Directory missing is an error state regardless of DB content — daemon
        # expects codebase skills to exist; do not silently fall back to DB-only.
        return {"version": "", "files": [], "message": "skills directory not found"}

    files = await _gather_all_files(skills_dir, session)
    if not files:
        return {"version": "", "files": [], "message": "no sillyspec skills found"}

    file_entries: list[dict[str, str]] = []
    for rel_path, content in files:
        file_hash = hashlib.sha256(content).hexdigest()
        file_entries.append(
            {
                "path": str(rel_path).replace("\\", "/"),
                "sha256": file_hash,
            }
        )

    version = _compute_version(files, skills_dir)
    return {"version": version, "files": file_entries}


async def build_skills_bundle(
    skills_dir: Path | None = None,
    session: "AsyncSession | None" = None,
) -> bytes:
    """Build a gzipped tar archive of all sillyspec-* skill files + DB custom skills.

    Returns the raw bytes of the ``.tar.gz`` archive. When the source directory
    does not exist or contains no skills an empty ``b""`` is returned.
    ``session`` is optional — when ``None`` the DB custom-skills merge is
    skipped (backward-compatible pure-codebase behavior).
    """
    if skills_dir is None:
        skills_dir = get_settings().skills_bundle_dir

    if not skills_dir.is_dir():
        return b""

    files = await _gather_all_files(skills_dir, session)
    if not files:
        return b""

    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode="w:gz") as tar:
        for rel_path, content in files:
            arcname = str(rel_path).replace("\\", "/")
            tarinfo = tarfile.TarInfo(name=arcname)
            tarinfo.size = len(content)
            tar.addfile(tarinfo, io.BytesIO(content))
    return buf.getvalue()
