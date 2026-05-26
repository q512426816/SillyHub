"""YAML → ProjectComponent parser.

Pure function module: no DB, no FastAPI. Given a workspace root, scans
``.sillyspec/projects/*.yaml`` and returns a structured :class:`ParseResult`
that the service layer is free to persist or surface in HTTP responses.

Edge cases (task-03 §3.5):

* Missing top-level ``id``                 → skip file, warn ``missing_id``
* Duplicate ``id`` across files            → keep first, warn ``duplicate_id``
* YAML syntax error / unreadable file      → skip file, error ``yaml_error``
* Unknown top-level keys                   → preserved on ``extra``
* ``path`` points at a missing directory   → ``status='path_missing'``
* ``relations[].target`` references an
  unknown component                        → relation dropped, warn
                                             ``unknown_relation_target``
* ``relations`` malformed (not a list or
  missing ``target``/``type``)             → relation dropped, warn
                                             ``invalid_relation``
"""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import yaml

KNOWN_COMPONENT_KEYS = frozenset(
    [
        "id",
        "name",
        "type",
        "role",
        "path",
        "repo_url",
        "default_branch",
        "tech_stack",
        "commands",
        "relations",
    ]
)

ALLOWED_RELATION_TYPES = frozenset(
    [
        "consumes_api_from",
        "depends_on",
        "tests",
        "publishes_to",
        "documents",
    ]
)


@dataclass(slots=True)
class ParsedComponent:
    """One component derived from a single ``projects/*.yaml`` file."""

    component_key: str
    name: str
    type: str | None
    role: str | None
    path: str | None
    repo_url: str | None
    default_branch: str | None
    tech_stack: list[str]
    build_command: str | None
    test_command: str | None
    source_yaml_path: str
    status: str
    extra: dict[str, Any]


@dataclass(slots=True)
class ParsedRelation:
    """One edge between two components, by component_key (UUIDs come later)."""

    source_key: str
    target_key: str
    relation_type: str
    description: str | None = None


@dataclass(slots=True)
class ParseIssue:
    """Structured diagnostic surfaced to the API."""

    code: str
    file: str | None
    detail: str
    severity: str  # "warning" | "error"


@dataclass(slots=True)
class ParseResult:
    components: list[ParsedComponent] = field(default_factory=list)
    relations: list[ParsedRelation] = field(default_factory=list)
    warnings: list[ParseIssue] = field(default_factory=list)
    errors: list[ParseIssue] = field(default_factory=list)


class ComponentParser:
    """Parses ``.sillyspec/projects/*.yaml`` under a workspace root."""

    def __init__(self, *, projects_subdir: str = ".sillyspec/projects") -> None:
        self._subdir = projects_subdir

    def parse(self, workspace_root: str | Path) -> ParseResult:
        result = ParseResult()
        root = Path(workspace_root).resolve()
        projects_dir = root / self._subdir
        if not projects_dir.is_dir():
            result.warnings.append(
                ParseIssue(
                    code="missing_projects_dir",
                    file=None,
                    detail=f"{projects_dir} does not exist",
                    severity="warning",
                )
            )
            return result

        seen_keys: dict[str, str] = {}  # key -> first yaml path that defined it
        relation_buffer: list[tuple[str, dict[str, Any], str]] = []  # (source, raw, file)

        for yaml_path in sorted(projects_dir.glob("*.yaml")) + sorted(projects_dir.glob("*.yml")):
            rel = yaml_path.relative_to(root).as_posix()
            try:
                with yaml_path.open("r", encoding="utf-8") as fh:
                    raw = yaml.safe_load(fh)
            except (yaml.YAMLError, OSError) as exc:
                result.errors.append(
                    ParseIssue(
                        code="yaml_error",
                        file=rel,
                        detail=f"{type(exc).__name__}: {exc}",
                        severity="error",
                    )
                )
                continue

            if not isinstance(raw, dict):
                result.errors.append(
                    ParseIssue(
                        code="yaml_not_mapping",
                        file=rel,
                        detail="Top-level YAML must be a mapping",
                        severity="error",
                    )
                )
                continue

            component_key = raw.get("id")
            if not isinstance(component_key, str) or not component_key.strip():
                result.warnings.append(
                    ParseIssue(
                        code="missing_id",
                        file=rel,
                        detail="Top-level 'id' is required",
                        severity="warning",
                    )
                )
                continue
            component_key = component_key.strip()

            if component_key in seen_keys:
                result.warnings.append(
                    ParseIssue(
                        code="duplicate_id",
                        file=rel,
                        detail=(
                            f"id '{component_key}' already defined by "
                            f"{seen_keys[component_key]}; skipped"
                        ),
                        severity="warning",
                    )
                )
                continue
            seen_keys[component_key] = rel

            component = self._parse_component(component_key, raw, root, rel)
            result.components.append(component)

            for rel_raw in raw.get("relations") or []:
                if not isinstance(rel_raw, dict):
                    result.warnings.append(
                        ParseIssue(
                            code="invalid_relation",
                            file=rel,
                            detail=f"relations entries must be mappings, got {type(rel_raw).__name__}",
                            severity="warning",
                        )
                    )
                    continue
                relation_buffer.append((component_key, rel_raw, rel))

        for source_key, rel_raw, rel_file in relation_buffer:
            self._collect_relation(source_key, rel_raw, rel_file, seen_keys, result)

        return result

    @staticmethod
    def _parse_component(
        component_key: str,
        raw: dict[str, Any],
        workspace_root: Path,
        source_yaml_path: str,
    ) -> ParsedComponent:
        name = str(raw.get("name") or component_key)
        type_ = _opt_str(raw.get("type"))
        role = _opt_str(raw.get("role"))
        path = _opt_str(raw.get("path"))
        repo_url = _opt_str(raw.get("repo_url"))
        default_branch = _opt_str(raw.get("default_branch")) or "main"

        tech_stack_raw = raw.get("tech_stack") or []
        tech_stack: list[str] = (
            [str(t) for t in tech_stack_raw] if isinstance(tech_stack_raw, list) else []
        )

        commands = raw.get("commands") or {}
        if not isinstance(commands, dict):
            commands = {}
        build_command = _opt_str(commands.get("build"))
        test_command = _opt_str(commands.get("test"))

        extra: dict[str, Any] = {k: v for k, v in raw.items() if k not in KNOWN_COMPONENT_KEYS}
        # Commands beyond build/test (e.g. dev, lint) survive on extra.commands.
        extra_commands = {k: v for k, v in commands.items() if k not in {"build", "test"}}
        if extra_commands:
            extra["commands"] = extra_commands

        status = "active"
        if path:
            resolved = (workspace_root / path).resolve()
            if not resolved.exists():
                status = "path_missing"

        return ParsedComponent(
            component_key=component_key,
            name=name,
            type=type_,
            role=role,
            path=path,
            repo_url=repo_url,
            default_branch=default_branch,
            tech_stack=tech_stack,
            build_command=build_command,
            test_command=test_command,
            source_yaml_path=source_yaml_path,
            status=status,
            extra=extra,
        )

    @staticmethod
    def _collect_relation(
        source_key: str,
        raw: dict[str, Any],
        source_file: str,
        seen_keys: dict[str, str],
        result: ParseResult,
    ) -> None:
        target = _opt_str(raw.get("target"))
        rel_type = _opt_str(raw.get("type"))
        description = _opt_str(raw.get("description"))

        if not target or not rel_type:
            result.warnings.append(
                ParseIssue(
                    code="invalid_relation",
                    file=source_file,
                    detail="relations[].target and relations[].type are required",
                    severity="warning",
                )
            )
            return
        if rel_type not in ALLOWED_RELATION_TYPES:
            result.warnings.append(
                ParseIssue(
                    code="unknown_relation_type",
                    file=source_file,
                    detail=(
                        f"relation_type '{rel_type}' is not one of {sorted(ALLOWED_RELATION_TYPES)}"
                    ),
                    severity="warning",
                )
            )
            return
        if target not in seen_keys:
            result.warnings.append(
                ParseIssue(
                    code="unknown_relation_target",
                    file=source_file,
                    detail=f"relations[].target '{target}' has no matching component",
                    severity="warning",
                )
            )
            return
        if target == source_key:
            result.warnings.append(
                ParseIssue(
                    code="self_relation",
                    file=source_file,
                    detail=f"component '{source_key}' relates to itself; ignored",
                    severity="warning",
                )
            )
            return

        result.relations.append(
            ParsedRelation(
                source_key=source_key,
                target_key=target,
                relation_type=rel_type,
                description=description,
            )
        )


def _opt_str(value: Any) -> str | None:
    if value is None:
        return None
    if isinstance(value, str):
        v = value.strip()
        return v or None
    return str(value)
