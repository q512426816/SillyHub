"""Filesystem parser for ``.sillyspec/changes/<change_key>/``.

Walks both active and ``archive/`` directories, reads each
MASTER.md frontmatter, and returns structured records for DB persistence.

Supports legacy ``changes/change/<key>/`` layout with deprecation warnings.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path

import frontmatter

from app.core.logging import get_logger
from app.core.spec_paths import SpecPathResolver

log = get_logger(__name__)

# Re-export constants from SpecPathResolver for backward compatibility
STANDARD_DOC_TYPES: frozenset[str] = SpecPathResolver.STANDARD_DOC_TYPES

STANDARD_FILENAMES: dict[str, str] = dict(SpecPathResolver.STANDARD_FILENAMES)


@dataclass
class ParsedDoc:
    doc_type: str
    path: str
    exists: bool
    filename: str | None = None
    status: str | None = None
    last_modified_at: datetime | None = None


@dataclass
class ParseWarning:
    code: str
    detail: str
    change_key: str | None = None
    doc_type: str | None = None


@dataclass
class ParsedChange:
    change_key: str
    title: str | None = None
    status: str = "draft"
    location: str = "active"
    path: str = ""
    change_type: str | None = None
    owner: str | None = None
    affected_components: list[str] = field(default_factory=list)
    docs: list[ParsedDoc] = field(default_factory=list)
    warnings: list[ParseWarning] = field(default_factory=list)


@dataclass
class ChangeParserResult:
    changes: list[ParsedChange] = field(default_factory=list)
    warnings: list[ParseWarning] = field(default_factory=list)


class ChangeParser:
    """Parses ``.sillyspec/changes/{active|archive}/{change_key}/`` directories."""

    def parse_workspace(self, sillyspec_root: Path) -> ChangeParserResult:
        result = ChangeParserResult()
        resolver = SpecPathResolver(sillyspec_root)
        changes_base = resolver.changes_root()

        # --- 1. Scan active changes: changes/<name>/ (excluding archive/) ---
        if changes_base.is_dir():
            for entry in sorted(changes_base.iterdir()):
                if entry.name.startswith(".") or not entry.is_dir():
                    continue
                # Skip the archive directory itself
                if entry.name == "archive":
                    continue

                if not self._is_safe_path(sillyspec_root, entry, result):
                    continue

                parsed = self._parse_change(
                    sillyspec_root,
                    entry,
                    location="active",
                    rel_prefix=f".sillyspec/changes/{entry.name}",
                )
                result.changes.append(parsed)
                result.warnings.extend(parsed.warnings)

        # --- 2. Scan archived changes: changes/archive/<name>/ ---
        archive_base = resolver.archive_dir()
        if archive_base.is_dir():
            for entry in sorted(archive_base.iterdir()):
                if entry.name.startswith(".") or not entry.is_dir():
                    continue

                if not self._is_safe_path(sillyspec_root, entry, result):
                    continue

                parsed = self._parse_change(
                    sillyspec_root,
                    entry,
                    location="archive",
                    rel_prefix=f".sillyspec/changes/archive/{entry.name}",
                )
                result.changes.append(parsed)
                result.warnings.extend(parsed.warnings)

        # --- 3. Legacy: scan changes/change/<key>/ with deprecation warning ---
        legacy_base = changes_base / "change"
        if legacy_base.is_dir():
            log.warning(
                "legacy_changes_dir_found",
                detail="Found legacy 'changes/change/' directory. Please migrate to v4 layout.",
            )
            result.warnings.append(
                ParseWarning(
                    code="LEGACY_CHANGE_DIR",
                    detail="Legacy 'changes/change/' directory found. Migrate to changes/<name>/ layout.",
                )
            )
            for entry in sorted(legacy_base.iterdir()):
                if entry.name.startswith(".") or not entry.is_dir():
                    continue

                if not self._is_safe_path(sillyspec_root, entry, result):
                    continue

                parsed = self._parse_change(
                    sillyspec_root,
                    entry,
                    location="active",
                    rel_prefix=f".sillyspec/changes/change/{entry.name}",
                    is_legacy=True,
                )
                result.changes.append(parsed)
                result.warnings.extend(parsed.warnings)

        return result

    # ------------------------------------------------------------------
    # Internals
    # ------------------------------------------------------------------

    @staticmethod
    def _is_safe_path(root: Path, entry: Path, result: ChangeParserResult) -> bool:
        """Path traversal guard. Returns True if safe."""
        try:
            resolved = entry.resolve()
            base_resolved = root.resolve()
            if not str(resolved).startswith(str(base_resolved)):
                result.warnings.append(
                    ParseWarning(
                        code="PATH_TRAVERSAL",
                        detail=f"Skipping directory outside root: {entry}",
                        change_key=entry.name,
                    )
                )
                return False
        except (OSError, ValueError):
            return False
        return True

    def _parse_change(
        self,
        sillyspec_root: Path,
        change_dir: Path,
        *,
        location: str,
        rel_prefix: str,
        is_legacy: bool = False,
    ) -> ParsedChange:
        change_key = change_dir.name

        parsed = ParsedChange(
            change_key=change_key,
            location=location,
            path=rel_prefix,
        )

        if is_legacy:
            parsed.warnings.append(
                ParseWarning(
                    code="LEGACY_CHANGE_PATH",
                    detail=f"Change '{change_key}' is at legacy path 'changes/change/{change_key}'. "
                    "Migrate to 'changes/{change_key}'.",
                    change_key=change_key,
                )
            )

        # Parse MASTER.md frontmatter
        master_path = change_dir / "MASTER.md"
        if not master_path.is_file():
            parsed.status = "unknown"
            parsed.title = change_key
            parsed.warnings.append(
                ParseWarning(
                    code="MASTER_MISSING",
                    detail=f"No MASTER.md for change '{change_key}'",
                    change_key=change_key,
                )
            )
        else:
            try:
                post = frontmatter.load(str(master_path))
                meta = post.metadata
                parsed.title = meta.get("title") or change_key
                parsed.status = meta.get("status", "draft")
                parsed.change_type = meta.get("change_type")
                parsed.owner = meta.get("owner")
                parsed.affected_components = meta.get("affected_components", [])
            except Exception as exc:
                parsed.status = "unknown"
                parsed.title = change_key
                parsed.warnings.append(
                    ParseWarning(
                        code="FRONTMATTER_PARSE_ERROR",
                        detail=f"Cannot parse MASTER.md for '{change_key}': {exc}",
                        change_key=change_key,
                    )
                )

        # Scan standard documents using SpecPathResolver constants
        for doc_type, filename in STANDARD_FILENAMES.items():
            filepath = change_dir / filename
            if filepath.is_file():
                mtime = datetime.utcfromtimestamp(filepath.stat().st_mtime)
                parsed.docs.append(
                    ParsedDoc(
                        doc_type=doc_type,
                        path=f"{rel_prefix}/{filename}",
                        exists=True,
                        filename=filename,
                        last_modified_at=mtime,
                    )
                )
            else:
                # Check legacy alias (e.g. verification.md → verify-result.md)
                legacy_found = False
                for legacy_name, canonical_name in SpecPathResolver.LEGACY_FILENAME_MAP.items():
                    if canonical_name == filename:
                        legacy_path = change_dir / legacy_name
                        if legacy_path.is_file():
                            mtime = datetime.utcfromtimestamp(legacy_path.stat().st_mtime)
                            parsed.docs.append(
                                ParsedDoc(
                                    doc_type=doc_type,
                                    path=f"{rel_prefix}/{legacy_name}",
                                    exists=True,
                                    filename=legacy_name,
                                    last_modified_at=mtime,
                                )
                            )
                            parsed.warnings.append(
                                ParseWarning(
                                    code="LEGACY_FILENAME",
                                    detail=f"Found legacy '{legacy_name}', expected '{canonical_name}' "
                                    f"for change '{change_key}'.",
                                    change_key=change_key,
                                    doc_type=doc_type,
                                )
                            )
                            legacy_found = True
                            break
                if not legacy_found:
                    parsed.docs.append(
                        ParsedDoc(
                            doc_type=doc_type,
                            path=f"{rel_prefix}/{filename}",
                            exists=False,
                            filename=filename,
                        )
                    )

        # Scan prototypes
        for proto in sorted(change_dir.glob("prototype-*.html")):
            parsed.docs.append(
                ParsedDoc(
                    doc_type="prototype",
                    path=f"{rel_prefix}/{proto.name}",
                    exists=True,
                    filename=proto.name,
                    last_modified_at=datetime.utcfromtimestamp(proto.stat().st_mtime),
                )
            )

        # Scan references
        ref_dir = change_dir / "references"
        if ref_dir.is_dir():
            for ref in sorted(ref_dir.iterdir()):
                if ref.is_file() and not ref.name.startswith("."):
                    parsed.docs.append(
                        ParsedDoc(
                            doc_type="reference",
                            path=f"{rel_prefix}/references/{ref.name}",
                            exists=True,
                            filename=ref.name,
                            last_modified_at=datetime.utcfromtimestamp(ref.stat().st_mtime),
                        )
                    )

        return parsed
