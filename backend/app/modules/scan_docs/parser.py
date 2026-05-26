"""Filesystem parser for ``.sillyspec/docs/{component_key}/scan/*.md``.

Walks the scan directory, reads each markdown file, and returns structured
records ready for DB persistence.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path

from app.core.logging import get_logger

log = get_logger(__name__)

MAX_CONTENT_BYTES = 1_000_000  # 1 MB

STANDARD_DOC_TYPES: frozenset[str] = frozenset(
    {
        "ARCHITECTURE",
        "CONVENTIONS",
        "CONCERNS",
        "INTEGRATIONS",
        "PROJECT",
        "STRUCTURE",
        "TESTING",
    }
)


@dataclass
class ParsedDoc:
    """One parsed scan document."""

    doc_type: str
    filename: str
    path: str
    title: str | None = None
    content: str | None = None
    exists: bool = True
    last_modified_at: datetime | None = None
    truncated: bool = False


@dataclass
class ParseWarning:
    code: str
    detail: str
    component_key: str | None = None
    doc_type: str | None = None


@dataclass
class ScanDocsResult:
    """Result of parsing one component's scan directory."""

    component_key: str
    docs: list[ParsedDoc] = field(default_factory=list)
    warnings: list[ParseWarning] = field(default_factory=list)


def _doc_type_from_filename(filename: str) -> str:
    """Map filename (without extension) to doc_type.

    Standard names map directly; anything else becomes OTHER.
    """
    stem = Path(filename).stem.upper()
    return stem if stem in STANDARD_DOC_TYPES else "OTHER"


def _extract_title(content: str) -> str | None:
    """Extract the first ``# Title`` from markdown content."""
    for line in content.splitlines():
        stripped = line.strip()
        if stripped.startswith("#"):
            return stripped.lstrip("# ").strip() or None
    return None


def _read_file_safe(path: Path) -> tuple[str, bool]:
    """Read file content with size check. Returns (content, truncated)."""
    size = path.stat().st_size
    truncated = False
    if size > MAX_CONTENT_BYTES:
        truncated = True
        content = path.read_text(encoding="utf-8", errors="replace")[
            : MAX_CONTENT_BYTES // 4  # char approximation
        ]
    else:
        content = path.read_text(encoding="utf-8", errors="replace")
    return content, truncated


class ScanDocsParser:
    """Parses ``.sillyspec/docs/{component_key}/scan/`` directories."""

    def parse_component(
        self,
        sillyspec_root: Path,
        component_key: str,
    ) -> ScanDocsResult:
        """Parse scan docs for a single component.

        Parameters
        ----------
        sillyspec_root:
            Path to the workspace root (where ``.sillyspec/`` lives).
        component_key:
            The component key, e.g. ``silly``, ``silly-admin-ui``.
        """
        result = ScanDocsResult(component_key=component_key)
        docs_dir = sillyspec_root / ".sillyspec" / "docs" / component_key / "scan"

        if not docs_dir.is_dir():
            result.warnings.append(
                ParseWarning(
                    code="SCAN_DIR_MISSING",
                    detail=f"No scan docs directory for component '{component_key}'",
                    component_key=component_key,
                )
            )
            # Still emit placeholder rows for all standard types
            for dt in sorted(STANDARD_DOC_TYPES):
                result.docs.append(
                    ParsedDoc(
                        doc_type=dt,
                        filename=f"{dt}.md",
                        path=f".sillyspec/docs/{component_key}/scan/{dt}.md",
                        exists=False,
                    )
                )
            return result

        found_types: dict[str, ParsedDoc] = {}

        for md_file in sorted(docs_dir.glob("*.md")):
            # Path traversal guard
            try:
                resolved = md_file.resolve()
                sillyspec_resolved = sillyspec_root.resolve()
                if not str(resolved).startswith(str(sillyspec_resolved)):
                    result.warnings.append(
                        ParseWarning(
                            code="PATH_TRAVERSAL",
                            detail=f"Skipping file outside sillyspec root: {md_file}",
                            component_key=component_key,
                        )
                    )
                    continue
            except (OSError, ValueError):
                continue

            if not md_file.is_file():
                continue

            doc_type = _doc_type_from_filename(md_file.name)
            rel_path = f".sillyspec/docs/{component_key}/scan/{md_file.name}"

            try:
                content, truncated = _read_file_safe(md_file)
            except OSError as exc:
                result.warnings.append(
                    ParseWarning(
                        code="READ_ERROR",
                        detail=f"Cannot read {md_file.name}: {exc}",
                        component_key=component_key,
                        doc_type=doc_type,
                    )
                )
                found_types[doc_type] = ParsedDoc(
                    doc_type=doc_type,
                    filename=md_file.name,
                    path=rel_path,
                    exists=False,
                )
                continue

            title = _extract_title(content)
            mtime = datetime.utcfromtimestamp(md_file.stat().st_mtime)

            parsed = ParsedDoc(
                doc_type=doc_type,
                filename=md_file.name,
                path=rel_path,
                title=title,
                content=content,
                exists=True,
                last_modified_at=mtime,
                truncated=truncated,
            )

            if truncated:
                result.warnings.append(
                    ParseWarning(
                        code="CONTENT_TRUNCATED",
                        detail=f"{md_file.name} exceeds 1 MB, truncated",
                        component_key=component_key,
                        doc_type=doc_type,
                    )
                )

            # For OTHER type, allow multiple; for standard types, last wins
            if doc_type == "OTHER":
                found_types[f"OTHER:{md_file.name}"] = parsed
            else:
                found_types[doc_type] = parsed

        # Add placeholders for missing standard types
        for dt in sorted(STANDARD_DOC_TYPES):
            if dt not in found_types:
                found_types[dt] = ParsedDoc(
                    doc_type=dt,
                    filename=f"{dt}.md",
                    path=f".sillyspec/docs/{component_key}/scan/{dt}.md",
                    exists=False,
                )

        result.docs = list(found_types.values())
        return result
