"""SpecValidator — programmatic validation of .sillyspec directory structure and content.

author: qinyi
created_at: 2026-05-27
"""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path

import yaml

from app.core.logging import get_logger

log = get_logger(__name__)


@dataclass
class ValidationIssue:
    """A single validation problem found in spec files."""

    severity: str  # "error" or "warning"
    category: str  # "schema" | "reference" | "structure"
    path: str  # file path or "directory"
    message: str


@dataclass
class ValidationReport:
    """Result of validating a spec workspace directory."""

    passed: bool
    issues: list[ValidationIssue] = field(default_factory=list)

    @property
    def errors(self) -> list[ValidationIssue]:
        return [i for i in self.issues if i.severity == "error"]

    @property
    def warnings(self) -> list[ValidationIssue]:
        return [i for i in self.issues if i.severity == "warning"]


class SpecValidator:
    """Validates .sillyspec directory structure and content.

    Checks:
    1. Directory structure: at least `.sillyspec/projects/` must exist
    2. YAML schema: each `projects/*.yaml` must have `name` or `id` field
    3. Reference integrity: `relations.target` must reference an existing component
    """

    def validate(self, spec_root: str | Path) -> ValidationReport:
        """Validate the spec workspace at the given root path.

        Args:
            spec_root: Absolute path to the spec workspace directory
                       (e.g., /data/spec-workspaces/{workspace_id}/)

        Returns:
            ValidationReport with pass/fail status and list of issues.
        """
        root = Path(spec_root)
        issues: list[ValidationIssue] = []

        if not root.exists():
            issues.append(
                ValidationIssue(
                    severity="error",
                    category="structure",
                    path=str(root),
                    message="Spec root directory does not exist.",
                )
            )
            return ValidationReport(passed=False, issues=issues)

        # 1. Directory structure check
        issues.extend(self._check_directory_structure(root))

        # 2. YAML schema check
        component_ids: list[str] = []
        issues.extend(self._check_yaml_schema(root, component_ids))

        # 3. Reference integrity check
        issues.extend(self._check_references(root, component_ids))

        has_errors = any(i.severity == "error" for i in issues)
        report = ValidationReport(passed=not has_errors, issues=issues)

        log.info(
            "spec_validation_complete",
            spec_root=str(root),
            passed=report.passed,
            error_count=len(report.errors),
            warning_count=len(report.warnings),
        )
        return report

    def _check_directory_structure(self, root: Path) -> list[ValidationIssue]:
        """Check that required directories exist."""
        issues: list[ValidationIssue] = []
        projects_dir = root / ".sillyspec" / "projects"

        if not projects_dir.exists():
            issues.append(
                ValidationIssue(
                    severity="error",
                    category="structure",
                    path=str(projects_dir),
                    message="Required directory .sillyspec/projects/ does not exist.",
                )
            )
        elif not any(projects_dir.glob("*.yaml")) and not any(projects_dir.glob("*.yml")):
            issues.append(
                ValidationIssue(
                    severity="warning",
                    category="structure",
                    path=str(projects_dir),
                    message="No YAML files found in .sillyspec/projects/.",
                )
            )

        return issues

    def _check_yaml_schema(
        self,
        root: Path,
        component_ids: list[str],
    ) -> list[ValidationIssue]:
        """Check YAML schema of project component files."""
        issues: list[ValidationIssue] = []
        projects_dir = root / ".sillyspec" / "projects"

        if not projects_dir.exists():
            return issues

        for yaml_file in list(projects_dir.glob("*.yaml")) + list(projects_dir.glob("*.yml")):
            try:
                content = yaml_file.read_text(encoding="utf-8")
                data = yaml.safe_load(content)
            except (OSError, yaml.YAMLError) as exc:
                issues.append(
                    ValidationIssue(
                        severity="error",
                        category="schema",
                        path=str(yaml_file),
                        message=f"Failed to parse YAML: {exc}",
                    )
                )
                continue

            if not isinstance(data, dict):
                issues.append(
                    ValidationIssue(
                        severity="error",
                        category="schema",
                        path=str(yaml_file),
                        message="YAML content is not a mapping/dict.",
                    )
                )
                continue

            data_keys = set(data.keys())

            # name is the only truly required field — parser derives id from
            # filename stem and treats type as optional, so the validator
            # should match that leniency.
            if "name" not in data_keys and "id" not in data_keys:
                issues.append(
                    ValidationIssue(
                        severity="error",
                        category="schema",
                        path=str(yaml_file),
                        message="Missing 'name' or 'id' field.",
                    )
                )
                # Still collect id for reference checks
                component_ids.append(yaml_file.stem)
                continue

            # Collect component ID for reference checks — mirrors parser logic
            comp_id = data.get("id") or data.get("name") or yaml_file.stem
            component_ids.append(str(comp_id))

        return issues

    def _check_references(
        self,
        root: Path,
        component_ids: list[str],
    ) -> list[ValidationIssue]:
        """Check that relation targets reference existing components."""
        issues: list[ValidationIssue] = []
        projects_dir = root / ".sillyspec" / "projects"

        if not projects_dir.exists() or not component_ids:
            return issues

        id_set = set(component_ids)

        for yaml_file in list(projects_dir.glob("*.yaml")) + list(projects_dir.glob("*.yml")):
            try:
                content = yaml_file.read_text(encoding="utf-8")
                data = yaml.safe_load(content)
            except (OSError, yaml.YAMLError):
                continue

            if not isinstance(data, dict):
                continue

            relations = data.get("relations")
            if not isinstance(relations, list):
                continue

            for rel in relations:
                if not isinstance(rel, dict):
                    continue
                target = rel.get("target")
                if target and str(target) not in id_set:
                    issues.append(
                        ValidationIssue(
                            severity="error",
                            category="reference",
                            path=str(yaml_file),
                            message=f"Relation target '{target}' does not exist in component list.",
                        )
                    )

        return issues
