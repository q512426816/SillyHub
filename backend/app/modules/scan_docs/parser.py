"""Filesystem parser for ``.sillyspec/docs/`` tree.

Recursively walks all files under the docs directory and returns structured
records ready for DB persistence.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import UTC, datetime
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
    """Result of parsing the docs tree."""

    component_key: str | None
    docs: list[ParsedDoc] = field(default_factory=list)
    warnings: list[ParseWarning] = field(default_factory=list)


def _doc_type_from_filename(filename: str) -> str:
    """Map filename (without extension) to doc_type."""
    stem = Path(filename).stem.upper()
    return stem


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
        content = path.read_text(encoding="utf-8", errors="replace")[: MAX_CONTENT_BYTES // 4]
    else:
        content = path.read_text(encoding="utf-8", errors="replace")
    return content, truncated


class ScanDocsParser:
    """Parses all files under ``.sillyspec/docs/`` recursively."""

    def parse_docs_tree(
        self,
        sillyspec_root: Path,
    ) -> ScanDocsResult:
        """Recursively parse all docs under .sillyspec/docs/.

        Parameters
        ----------
        sillyspec_root:
            Path to the workspace root (where ``.sillyspec/`` lives).
        """
        result = ScanDocsResult(component_key=None)
        docs_dir = sillyspec_root / ".sillyspec" / "docs"

        if not docs_dir.is_dir():
            result.warnings.append(
                ParseWarning(
                    code="DOCS_DIR_MISSING",
                    detail="No .sillyspec/docs directory found",
                )
            )
            return result

        sillyspec_resolved = sillyspec_root.resolve()

        for file_path in sorted(docs_dir.rglob("*")):
            if not file_path.is_file():
                continue

            # Only parse .md and .yaml/.yml files
            if file_path.suffix not in (".md", ".yaml", ".yml"):
                continue

            # Path traversal guard
            try:
                resolved = file_path.resolve()
                if not str(resolved).startswith(str(sillyspec_resolved)):
                    continue
            except (OSError, ValueError):
                continue

            rel_path = file_path.relative_to(sillyspec_root)
            rel_str = str(rel_path).replace("\\", "/")

            doc_type = _doc_type_from_filename(file_path.name)

            # For yaml files, use a derived doc_type
            if file_path.suffix in (".yaml", ".yml"):
                doc_type = file_path.stem

            try:
                content, truncated = _read_file_safe(file_path)
            except OSError as exc:
                result.warnings.append(
                    ParseWarning(
                        code="READ_ERROR",
                        detail=f"Cannot read {rel_str}: {exc}",
                        doc_type=doc_type,
                    )
                )
                continue

            title = _extract_title(content) if file_path.suffix == ".md" else None
            mtime = datetime.fromtimestamp(file_path.stat().st_mtime, tz=UTC)

            parsed = ParsedDoc(
                doc_type=doc_type,
                filename=file_path.name,
                path=rel_str,
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
                        detail=f"{rel_str} exceeds 1 MB, truncated",
                        doc_type=doc_type,
                    )
                )

            result.docs.append(parsed)

        return result

    def parse_component(
        self,
        sillyspec_root: Path,
        component_key: str,
    ) -> ScanDocsResult:
        """Parse docs for a single component under .sillyspec/docs/{component_key}/scan/."""
        result = ScanDocsResult(component_key=component_key)
        scan_dir = sillyspec_root / ".sillyspec" / "docs" / component_key / "scan"
        sillyspec_resolved = sillyspec_root.resolve()

        found_types: dict[str, ParsedDoc] = {}

        if scan_dir.is_dir():
            for file_path in sorted(scan_dir.iterdir()):
                if not file_path.is_file():
                    continue
                if file_path.suffix not in (".md", ".yaml", ".yml"):
                    continue

                try:
                    resolved = file_path.resolve()
                    if not str(resolved).startswith(str(sillyspec_resolved)):
                        continue
                except (OSError, ValueError):
                    continue

                rel_path = file_path.relative_to(sillyspec_root)
                rel_str = str(rel_path).replace("\\", "/")

                doc_type = _doc_type_from_filename(file_path.name)
                if file_path.suffix in (".yaml", ".yml"):
                    doc_type = file_path.stem

                if doc_type not in STANDARD_DOC_TYPES:
                    doc_type = "OTHER"

                try:
                    content, truncated = _read_file_safe(file_path)
                except OSError as exc:
                    result.warnings.append(
                        ParseWarning(
                            code="READ_ERROR",
                            detail=f"Cannot read {rel_str}: {exc}",
                            component_key=component_key,
                            doc_type=doc_type,
                        )
                    )
                    continue

                title = _extract_title(content) if file_path.suffix == ".md" else None
                mtime = datetime.fromtimestamp(file_path.stat().st_mtime, tz=UTC)

                parsed = ParsedDoc(
                    doc_type=doc_type,
                    filename=file_path.name,
                    path=rel_str,
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
                            detail=f"{rel_str} exceeds 1 MB, truncated",
                            component_key=component_key,
                            doc_type=doc_type,
                        )
                    )

                found_types[doc_type] = parsed
        else:
            result.warnings.append(
                ParseWarning(
                    code="SCAN_DIR_MISSING",
                    detail=f"No .sillyspec/docs/{component_key}/scan/ directory found",
                    component_key=component_key,
                )
            )

        # Add placeholders for missing standard types
        for std_type in sorted(STANDARD_DOC_TYPES):
            if std_type not in found_types:
                found_types[std_type] = ParsedDoc(
                    doc_type=std_type,
                    filename="",
                    path="",
                    exists=False,
                )

        result.docs = list(found_types.values())
        return result
