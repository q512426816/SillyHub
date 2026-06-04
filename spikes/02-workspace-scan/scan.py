"""Spike 02 — SillySpec Workspace 扫描验证。

用法:
    python scan.py <repo_root>
"""

from __future__ import annotations

import json
import sys
import time
from pathlib import Path

import frontmatter
import yaml
from pydantic import BaseModel, Field


DOC_TYPES = [
    "MASTER",
    "proposal",
    "requirements",
    "design",
    "plan",
    "tasks",
    "verification",
]


class ProjectComponent(BaseModel):
    component_key: str
    name: str
    type: str | None = None
    role: str | None = None
    path: str | None = None
    tech_stack: list[str] = Field(default_factory=list)
    relations: list[dict] = Field(default_factory=list)
    source_yaml: str

    warnings: list[str] = Field(default_factory=list)


class Change(BaseModel):
    change_key: str
    location: str  # active / archive
    path: str
    title: str | None = None
    status: str | None = None
    change_type: str | None = None
    owner: str | None = None
    affected_components: list[str] = Field(default_factory=list)
    docs: dict[str, bool] = Field(default_factory=dict)
    warnings: list[str] = Field(default_factory=list)


class WorkspaceScan(BaseModel):
    root: str
    sillyspec_path: str
    is_sillyspec: bool
    components: list[ProjectComponent] = Field(default_factory=list)
    changes: list[Change] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)
    elapsed_ms: float = 0.0


def parse_component(yaml_path: Path) -> ProjectComponent:
    warnings: list[str] = []
    try:
        data = yaml.safe_load(yaml_path.read_text(encoding="utf-8")) or {}
    except yaml.YAMLError as exc:
        return ProjectComponent(
            component_key=yaml_path.stem,
            name=yaml_path.stem,
            source_yaml=str(yaml_path),
            warnings=[f"yaml_parse_error:{exc}"],
        )

    if "id" not in data:
        warnings.append("missing_id_field_use_filename")

    component_key = data.get("id") or yaml_path.stem
    return ProjectComponent(
        component_key=component_key,
        name=data.get("name") or component_key,
        type=data.get("type"),
        role=data.get("role"),
        path=data.get("path"),
        tech_stack=list(data.get("tech_stack") or []),
        relations=list(data.get("relations") or []),
        source_yaml=str(yaml_path),
        warnings=warnings,
    )


def parse_change(dir_path: Path, location: str) -> Change:
    warnings: list[str] = []
    master = dir_path / "MASTER.md"
    meta: dict = {}
    if master.exists():
        try:
            post = frontmatter.load(master)
            meta = dict(post.metadata or {})
        except Exception as exc:  # noqa: BLE001
            warnings.append(f"master_parse_error:{exc}")
    else:
        warnings.append("missing_master")

    docs = {dt: (dir_path / f"{dt}.md").exists() for dt in DOC_TYPES}

    return Change(
        change_key=dir_path.name,
        location=location,
        path=str(dir_path),
        title=meta.get("title"),
        status=meta.get("status"),
        change_type=meta.get("change_type"),
        owner=meta.get("owner"),
        affected_components=list(meta.get("affected_components") or []),
        docs=docs,
        warnings=warnings,
    )


def scan(root: Path) -> WorkspaceScan:
    t0 = time.perf_counter()
    sillyspec = root / ".sillyspec"

    if not sillyspec.is_dir():
        return WorkspaceScan(
            root=str(root),
            sillyspec_path=str(sillyspec),
            is_sillyspec=False,
            warnings=["no_sillyspec_dir"],
            elapsed_ms=(time.perf_counter() - t0) * 1000,
        )

    components: list[ProjectComponent] = []
    seen_keys: set[str] = set()
    projects_dir = sillyspec / "projects"
    if projects_dir.is_dir():
        for yml in sorted(projects_dir.glob("*.yaml")):
            comp = parse_component(yml)
            if comp.component_key in seen_keys:
                comp.warnings.append("duplicate_id_skipped")
                continue
            seen_keys.add(comp.component_key)
            components.append(comp)

    changes: list[Change] = []
    for location in ("change", "archive"):
        base = sillyspec / "changes" / location
        if not base.is_dir():
            continue
        for d in sorted(base.iterdir()):
            if not d.is_dir():
                continue
            changes.append(
                parse_change(d, "active" if location == "change" else "archive")
            )

    elapsed = (time.perf_counter() - t0) * 1000
    return WorkspaceScan(
        root=str(root),
        sillyspec_path=str(sillyspec),
        is_sillyspec=True,
        components=components,
        changes=changes,
        elapsed_ms=elapsed,
    )


def main() -> int:
    if len(sys.argv) != 2:
        print("usage: python scan.py <repo_root>", file=sys.stderr)
        return 2
    root = Path(sys.argv[1]).resolve()
    result = scan(root)
    print(json.dumps(result.model_dump(), indent=2, ensure_ascii=False))
    print(
        f"\n[spike02] components={len(result.components)} "
        f"changes={len(result.changes)} elapsed={result.elapsed_ms:.1f}ms",
        file=sys.stderr,
    )
    if not result.is_sillyspec:
        print("[spike02] WARNING: target is not a SillySpec workspace", file=sys.stderr)
        return 1
    if result.elapsed_ms > 500:
        print(
            f"[spike02] FAIL: scan too slow ({result.elapsed_ms:.0f}ms > 500ms)",
            file=sys.stderr,
        )
        return 1
    print("[spike02] SPIKE PASSED", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
