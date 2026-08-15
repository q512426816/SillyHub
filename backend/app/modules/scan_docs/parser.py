"""Filesystem parser for ``.sillyspec/docs/`` tree.

Recursively walks all files under the docs directory and returns structured
records ready for DB persistence.
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from stat import S_ISLNK, S_ISREG

from app.core.logging import get_logger
from app.modules.change.parser import _safe_mtime

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


def _stat_target(file_path: Path, root_resolved: Path) -> os.stat_result | None:
    """task-06（perf-remediation）：路径守卫 + stat 合并为单次系统调用。

    原实现 ``is_file()`` + ``resolve()`` + ``stat(size)`` + ``stat(mtime)`` 每文件
    4 次 stat（Windows bind mount 单次 ≈1.45ms）。这里单次 ``os.lstat`` 同时承担：
    - 常规文件判定（``S_ISREG``；symlink 因 lstat 不是 REG 被排除——比旧实现更严格，
      根外的 symlink 不再需要二次 stat 去 resolve，行为收紧为安全侧）
    - 路径穿越守卫（symlink → resolve 后必须仍在根内，与旧语义一致：根内 symlink
      指向根内文件仍被拒——旧 ``resolve`` + ``startswith`` 对 symlink 判的是 target，
      target 在根内则放行且 ``stat(mtime)`` 跟随读 target；为避免歧义，symlink 一律
      拒绝并返回 None，与根外 target 的旧行为一致）
    - size（读内容截断判定）与 mtime（``_safe_mtime`` 防御转换）取自同一 stat_result

    失败（不存在 / 权限 / 越界）返回 None，调用方跳过该文件。
    """
    try:
        st = os.lstat(file_path)
    except OSError:
        return None
    if not S_ISREG(st.st_mode):
        # symlink（或其它非常规文件）：resolve 后仍在根内才跟随旧语义放行，
        # 此时用跟随的 os.stat（target 的 size/mtime，与旧实现一致）
        if not S_ISLNK(st.st_mode):
            return None
        try:
            resolved = file_path.resolve()
            if not str(resolved).startswith(str(root_resolved)):
                return None
            return os.stat(file_path)
        except (OSError, ValueError):
            return None
    return st


def _read_file_statted(path: Path, st_size: int) -> tuple[str, bool]:
    """按已知 size 读文件内容（不再重复 stat），返回 (content, truncated)。

    task-06（perf-remediation）：与调用方共用同一 stat_result——调用方已经 stat
    过一次（拿 size + mtime），这里直接用传入的 st_size，消除 ``_read_file_safe``
    的重复 stat。截断语义与原版完全一致。
    """
    truncated = st_size > MAX_CONTENT_BYTES
    content = path.read_text(encoding="utf-8", errors="replace")
    if truncated:
        content = content[: MAX_CONTENT_BYTES // 4]
    return content, truncated


def _extract_title(content: str) -> str | None:
    """Extract the first ``# Title`` from markdown content."""
    for line in content.splitlines():
        stripped = line.strip()
        if stripped.startswith("#"):
            return stripped.lstrip("# ").strip() or None
    return None


class ScanDocsParser:
    """Parses all files under ``.sillyspec/docs/`` recursively."""

    def parse_docs_tree(
        self,
        sillyspec_root: Path,
        *,
        platform_managed: bool = False,
    ) -> ScanDocsResult:
        """Recursively parse all docs under .sillyspec/docs/.

        Parameters
        ----------
        sillyspec_root:
            Path to the workspace root (where ``.sillyspec/`` lives) — or, when
            ``platform_managed`` is True, the ``.sillyspec`` content root itself
            (扁平布局：``docs/`` 直接在其下，D-005@v1)。
        platform_managed:
            True 时按扁平布局解析（``sillyspec_root/docs/``，省略 ``.sillyspec`` 段），
            用于 platform-managed / daemon-client workspace。默认 False（包裹语义）。
        """
        result = ScanDocsResult(component_key=None)
        docs_dir = (
            sillyspec_root / "docs" if platform_managed else sillyspec_root / ".sillyspec" / "docs"
        )

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
            # Only parse .md and .yaml/.yml files（task-06：后缀预筛在 stat 前）
            if file_path.suffix not in (".md", ".yaml", ".yml"):
                continue

            rel_path = file_path.relative_to(sillyspec_root)
            rel_str = str(rel_path).replace("\\", "/")

            doc_type = _doc_type_from_filename(file_path.name)

            # For yaml files, use a derived doc_type
            if file_path.suffix in (".yaml", ".yml"):
                doc_type = file_path.stem

            # task-06：单文件 stat 收敛为 1 次（is_file/resolve/stat 合并进
            # _stat_target），size 与 mtime 取自同一 stat_result
            st = _stat_target(file_path, sillyspec_resolved)
            if st is None:
                continue
            mtime = _safe_mtime(st.st_mtime)

            try:
                content, truncated = _read_file_statted(file_path, st.st_size)
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
        *,
        platform_managed: bool = False,
    ) -> ScanDocsResult:
        """Parse docs for a single component under .sillyspec/docs/{component_key}/scan/.

        ``platform_managed`` True 时按扁平布局解析（``sillyspec_root/docs/{component_key}/scan/``）。
        """
        result = ScanDocsResult(component_key=component_key)
        docs_base = sillyspec_root if platform_managed else sillyspec_root / ".sillyspec"
        scan_dir = docs_base / "docs" / component_key / "scan"
        sillyspec_resolved = sillyspec_root.resolve()

        found_types: dict[str, ParsedDoc] = {}

        if scan_dir.is_dir():
            for file_path in sorted(scan_dir.iterdir()):
                if file_path.suffix not in (".md", ".yaml", ".yml"):
                    continue

                rel_path = file_path.relative_to(sillyspec_root)
                rel_str = str(rel_path).replace("\\", "/")

                doc_type = _doc_type_from_filename(file_path.name)
                if file_path.suffix in (".yaml", ".yml"):
                    doc_type = file_path.stem

                if doc_type not in STANDARD_DOC_TYPES:
                    doc_type = "OTHER"

                # task-06：单文件 stat 收敛为 1 次（_stat_target 合并
                # is_file/resolve/size/mtime），mtime 防御统一走 _safe_mtime
                st = _stat_target(file_path, sillyspec_resolved)
                if st is None:
                    continue
                mtime = _safe_mtime(st.st_mtime)

                try:
                    content, truncated = _read_file_statted(file_path, st.st_size)
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
