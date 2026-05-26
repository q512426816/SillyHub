"""Filesystem parser for ``.sillyspec/changes/{location}/{change_key}/``.

Walks both ``change/`` (active) and ``archive/`` directories, reads each
MASTER.md frontmatter, and returns structured records for DB persistence.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path

import frontmatter

from app.core.logging import get_logger

log = get_logger(__name__)

STANDARD_DOC_TYPES: frozenset[str] = frozenset(
    {
        "MASTER",
        "proposal",
        "requirements",
        "design",
        "plan",
        "tasks",
        "verification",
    }
)

STANDARD_FILENAMES: dict[str, str] = {
    "MASTER": "MASTER.md",
    "proposal": "proposal.md",
    "requirements": "requirements.md",
    "design": "design.md",
    "plan": "plan.md",
    "tasks": "tasks.md",
    "verification": "verification.md",
}


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
        changes_base = sillyspec_root / ".sillyspec" / "changes"

        for dir_name, location in (("change", "active"), ("archive", "archive")):
            location_dir = changes_base / dir_name
            if not location_dir.is_dir():
                result.warnings.append(
                    ParseWarning(
                        code="CHANGES_DIR_MISSING",
                        detail=f"No changes/{location} directory",
                    )
                )
                continue

            for entry in sorted(location_dir.iterdir()):
                if entry.name.startswith(".") or not entry.is_dir():
                    continue

                # Path traversal guard
                try:
                    resolved = entry.resolve()
                    base_resolved = sillyspec_root.resolve()
                    if not str(resolved).startswith(str(base_resolved)):
                        result.warnings.append(
                            ParseWarning(
                                code="PATH_TRAVERSAL",
                                detail=f"Skipping directory outside root: {entry}",
                                change_key=entry.name,
                            )
                        )
                        continue
                except (OSError, ValueError):
                    continue

                parsed = self._parse_change(sillyspec_root, entry, dir_name, location)
                result.changes.append(parsed)
                result.warnings.extend(parsed.warnings)

        return result

    def _parse_change(
        self,
        sillyspec_root: Path,
        change_dir: Path,
        dir_name: str,
        location: str,
    ) -> ParsedChange:
        change_key = change_dir.name
        rel_path = f".sillyspec/changes/{dir_name}/{change_key}"

        parsed = ParsedChange(
            change_key=change_key,
            location=location,
            path=rel_path,
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

        # Scan standard documents
        for doc_type in STANDARD_DOC_TYPES:
            filename = STANDARD_FILENAMES[doc_type]
            filepath = change_dir / filename
            if filepath.is_file():
                mtime = datetime.utcfromtimestamp(filepath.stat().st_mtime)
                parsed.docs.append(
                    ParsedDoc(
                        doc_type=doc_type,
                        path=f"{rel_path}/{filename}",
                        exists=True,
                        filename=filename,
                        last_modified_at=mtime,
                    )
                )
            else:
                parsed.docs.append(
                    ParsedDoc(
                        doc_type=doc_type,
                        path=f"{rel_path}/{filename}",
                        exists=False,
                        filename=filename,
                    )
                )

        # Scan prototypes
        for proto in sorted(change_dir.glob("prototype-*.html")):
            parsed.docs.append(
                ParsedDoc(
                    doc_type="prototype",
                    path=f"{rel_path}/{proto.name}",
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
                            path=f"{rel_path}/references/{ref.name}",
                            exists=True,
                            filename=ref.name,
                            last_modified_at=datetime.utcfromtimestamp(ref.stat().st_mtime),
                        )
                    )

        return parsed
