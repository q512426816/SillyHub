"""Filesystem parser for ``.sillyspec/changes/<change_key>/``.

Walks both active and ``archive/`` directories, reads each
MASTER.md frontmatter, and returns structured records for DB persistence.

Supports legacy ``changes/change/<key>/`` layout with deprecation warnings.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path

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
    # ql-20260702-001：从文档存在性推断（sillyspec.db 未导入时的 fallback）
    current_stage: str | None = None


@dataclass
class ChangeParserResult:
    changes: list[ParsedChange] = field(default_factory=list)
    warnings: list[ParseWarning] = field(default_factory=list)


class ChangeParser:
    """Parses ``.sillyspec/changes/{active|archive}/{change_key}/`` directories."""

    def parse_workspace(
        self, sillyspec_root: Path, *, platform_managed: bool = False
    ) -> ChangeParserResult:
        result = ChangeParserResult()
        resolver = SpecPathResolver(sillyspec_root, platform_managed=platform_managed)
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

    @staticmethod
    def _extract_title(change_dir: Path) -> str | None:
        """Return the first ``# `` heading in proposal.md, or None."""
        proposal = change_dir / SpecPathResolver.PROPOSAL
        if not proposal.is_file():
            return None
        try:
            for line in proposal.read_text(encoding="utf-8", errors="replace").splitlines():
                stripped = line.strip()
                if stripped.startswith("# "):
                    return stripped[2:].strip() or None
        except OSError:
            return None
        return None

    @staticmethod
    def _infer_change_type(change_dir: Path) -> str:
        """从目录结构推断变更类型。

        推断规则（按优先级从高到低）：
        1. 有 prototype-*.html 文件 → "prototype"
        2. 目录名包含 "quick" → "quick"
        3. 有 tasks/ 子目录 且 有 (plan.md 或 design.md) → "feature"
        4. 仅有 MASTER.md + request.md（无 tasks/、无 design.md、无 plan.md）→ "quick"
        5. 默认 → "feature"

        Args:
            change_dir: 变更目录的 Path，例如 `.sillyspec/changes/2026-06-08-xxx/`

        Returns:
            字符串，取值为 "feature" / "quick" / "prototype"
        """
        # 规则 1: prototype 文件
        if any(change_dir.glob("prototype-*.html")):
            return "prototype"

        dir_name_lower = change_dir.name.lower()

        # 规则 2: 目录名含 "quick"
        if "quick" in dir_name_lower:
            return "quick"

        has_tasks_dir = (change_dir / "tasks").is_dir()
        has_design = (change_dir / "design.md").is_file()
        has_plan = (change_dir / "plan.md").is_file()

        # 规则 3: tasks/ + (plan.md 或 design.md)
        if has_tasks_dir and (has_plan or has_design):
            return "feature"

        # 规则 4: 仅 MASTER.md（无 tasks/、无 design.md、无 plan.md）
        has_master = (change_dir / "MASTER.md").is_file()
        if not has_tasks_dir and not has_design and not has_plan and has_master:
            return "quick"

        # 规则 5: 默认
        return "feature"

    # ------------------------------------------------------------------
    # Affected-components inference (task-02)
    # ------------------------------------------------------------------

    @staticmethod
    def _infer_affected_components(change_dir: Path, sillyspec_root: Path) -> list[str]:
        """从变更目录的文档中提取受影响的模块名列表。

        推断优先级:
          1. module-impact.md 存在 → 提取"模块影响矩阵"表中的模块名
          2. 否则扫描 tasks.md + tasks/*.md → 提取文件路径 → 匹配 module-map

        Args:
            change_dir: 变更目录路径 (如 .sillyspec/changes/xxx/)
            sillyspec_root: .sillyspec 根目录的父目录 (workspace root)

        Returns:
            模块名列表 (如 ["change", "frontend_app"])，去重且保持出现顺序。
            无匹配返回空列表 []。
        """
        # Path 1: module-impact.md
        module_impact_path = change_dir / "module-impact.md"
        if module_impact_path.is_file():
            try:
                content = module_impact_path.read_text(encoding="utf-8", errors="replace")
            except OSError:
                content = ""
            modules = ChangeParser._extract_from_impact_table(content)
            if modules:
                return modules

        # Path 2: tasks.md + tasks/*.md
        file_paths: set[str] = set()
        tasks_md = change_dir / "tasks.md"
        if tasks_md.is_file():
            try:
                file_paths |= ChangeParser._extract_file_paths(
                    tasks_md.read_text(encoding="utf-8", errors="replace")
                )
            except OSError:
                pass

        tasks_dir = change_dir / "tasks"
        if tasks_dir.is_dir():
            for task_file in sorted(tasks_dir.glob("*.md")):
                try:
                    file_paths |= ChangeParser._extract_file_paths(
                        task_file.read_text(encoding="utf-8", errors="replace")
                    )
                except OSError:
                    pass

        if not file_paths:
            return []

        # Path 3: match against module-map
        module_map = ChangeParser._load_module_map(sillyspec_root)
        if not module_map:
            return []

        return ChangeParser._match_paths_to_modules(file_paths, module_map)

    @staticmethod
    def _extract_from_impact_table(content: str) -> list[str]:
        """从 module-impact.md 的 Markdown 表格提取模块名。

        提取规则:
          - 找到含 "| 模块 |" 的表头行
          - 跳过紧随其后的分隔行 (|---|---|)
          - 后续每行取第 1 列（strip 空白）
          - 去重，保持出现顺序
        """
        modules: list[str] = []
        seen: set[str] = set()
        header_found = False
        separator_skipped = False

        for line in content.splitlines():
            stripped = line.strip()

            if not header_found:
                if "| 模块 |" in stripped:
                    header_found = True
                continue

            if not separator_skipped:
                # Skip the separator line (|---|---|...)
                if re.match(r"^\|[\s\-:|]+\|$", stripped):
                    separator_skipped = True
                continue

            # Data rows
            if not stripped.startswith("|"):
                break
            parts = stripped.split("|")
            # parts[0] is empty (before first |), parts[1] is first column
            if len(parts) >= 3:
                name = parts[1].strip()
                if name and name not in seen:
                    seen.add(name)
                    modules.append(name)

        return modules

    @staticmethod
    def _extract_file_paths(text: str) -> set[str]:
        """从 Markdown 文本中提取文件路径。

        匹配规则:
          1. 行内代码块中的路径: `backend/app/modules/xxx.py`
          2. 裸路径: 行首或空格后的 backend/xxx 或 frontend/xxx 路径

        Returns:
            文件路径集合。
        """
        pattern_core = (
            r"(?:backend|frontend|deploy|docs)"
            r"/[a-zA-Z0-9_/.-]+\.(?:py|ts|tsx|js|jsx|yaml|yml|json|html|css|md)"
        )

        # Backtick-wrapped paths
        backtick_pattern = r"`(" + pattern_core + r")`"
        backtick_matches = re.findall(backtick_pattern, text)

        # Bare paths (not preceded by a word character)
        bare_pattern = r"(?<!\w)(" + pattern_core + r")"
        bare_matches = re.findall(bare_pattern, text)

        return set(backtick_matches) | set(bare_matches)

    @staticmethod
    def _load_module_map(sillyspec_root: Path) -> dict[str, list[str]]:
        """加载 _module-map.yaml。

        查找路径: .sillyspec/docs/*/modules/_module-map.yaml
        取第一个存在的文件。

        Returns:
            {"agent": ["backend/app/modules/agent/"], ...}
            paths 中的 ** 通配符被去掉，尾部保留 /
        """
        try:
            import yaml
        except ImportError:
            return {}

        docs_dir = sillyspec_root / ".sillyspec" / "docs"
        if not docs_dir.is_dir():
            return {}

        # Scan project subdirectories for _module-map.yaml
        for project_dir in sorted(docs_dir.iterdir()):
            if not project_dir.is_dir():
                continue
            map_file = project_dir / "modules" / "_module-map.yaml"
            if not map_file.is_file():
                continue

            try:
                raw = yaml.safe_load(map_file.read_text(encoding="utf-8"))
            except (OSError, Exception):
                return {}

            if not isinstance(raw, dict) or "modules" not in raw:
                return {}

            result: dict[str, list[str]] = {}
            modules = raw["modules"]
            if not isinstance(modules, dict):
                return {}

            for mod_name, mod_data in modules.items():
                if not isinstance(mod_data, dict) or "paths" not in mod_data:
                    continue
                paths = mod_data["paths"]
                if not isinstance(paths, list):
                    continue
                # Strip ** suffix, keep trailing /
                cleaned: list[str] = []
                for p in paths:
                    p = p.rstrip("*")
                    if not p.endswith("/"):
                        p += "/"
                    cleaned.append(p)
                result[mod_name] = cleaned

            return result

        return {}

    @staticmethod
    def _match_paths_to_modules(
        file_paths: set[str], module_map: dict[str, list[str]]
    ) -> list[str]:
        """将文件路径匹配到模块名。

        匹配策略: 前缀匹配
          file_path.startswith(module_prefix) -> 命中该模块

        Returns:
            匹配到的模块名列表，去重保持出现顺序。
        """
        matched: list[str] = []
        seen: set[str] = set()

        for fp in sorted(file_paths):
            for mod_name, prefixes in module_map.items():
                if mod_name in seen:
                    continue
                for prefix in prefixes:
                    if fp.startswith(prefix):
                        if mod_name not in seen:
                            seen.add(mod_name)
                            matched.append(mod_name)
                        break

        return matched

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

        # Title resolution (no frontmatter parsing):
        #   1. First ``# `` heading in proposal.md
        #   2. Fallback to change_key (directory name)
        # Metadata fields (change_type / owner / affected_components / status)
        # are owned by the platform DB, not by files — see file-lifecycle.md.
        parsed.title = self._extract_title(change_dir) or change_key

        # Scan standard documents using SpecPathResolver constants
        for doc_type, filename in STANDARD_FILENAMES.items():
            filepath = change_dir / filename
            if filepath.is_file():
                mtime = datetime.fromtimestamp(filepath.stat().st_mtime, tz=UTC)
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
                            mtime = datetime.fromtimestamp(legacy_path.stat().st_mtime, tz=UTC)
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
                    last_modified_at=datetime.fromtimestamp(proto.stat().st_mtime, tz=UTC),
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
                            last_modified_at=datetime.fromtimestamp(ref.stat().st_mtime, tz=UTC),
                        )
                    )

        # --- Infer change_type and affected_components ---
        parsed.change_type = self._infer_change_type(change_dir)
        parsed.affected_components = self._infer_affected_components(change_dir, sillyspec_root)

        # ql-20260702-001：从文档存在性推断 current_stage（sillyspec.db 未导入时的 fallback）
        parsed.current_stage = self._infer_current_stage(change_dir, location)

        return parsed

    @staticmethod
    def _infer_current_stage(change_dir: Path, location: str) -> str:
        """从 change 目录文档存在性推断 current_stage（fallback，非权威）。

        sillyspec.db 是权威数据源（含 SillySpec CLI 记录的精确 stage），但 .runtime
        被导入排除（worktrees 太大），平台读不到。这里从 change 目录的文档产出推断
        大致 stage：archive → archive / verify-result → verify / plan+tasks → plan /
        proposal+design → propose / 否则 scan。
        """
        if location == "archive":
            return "archive"

        def has(f: str) -> bool:
            return (change_dir / f).is_file()

        if has("verify-result.md"):
            return "verify"
        if has("plan.md") or has("tasks.md") or (change_dir / "tasks").is_dir():
            return "plan"
        if has("proposal.md") or has("design.md"):
            return "propose"
        return "scan"
