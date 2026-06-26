"""Tests for SpecValidator — validates .sillyspec directory structure and content.

author: qinyi
created_at: 2026-05-27
"""

from __future__ import annotations

from pathlib import Path

import pytest

from app.modules.spec_workspace.validator import SpecValidator


@pytest.fixture()
def validator() -> SpecValidator:
    return SpecValidator()


def _write_yaml(path: Path, content: str) -> Path:
    """Helper: write a YAML file and return its path."""
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")
    return path


# ── Directory structure checks ─────────────────────────────────────────────────


class TestValidateEmptyDirectory:
    """Non-existent directory returns error."""

    def test_returns_not_passed(self, validator: SpecValidator, tmp_path: Path) -> None:
        nonexistent = tmp_path / "no-such-dir"
        report = validator.validate(nonexistent)

        assert report.passed is False

    def test_has_structure_error(self, validator: SpecValidator, tmp_path: Path) -> None:
        nonexistent = tmp_path / "no-such-dir"
        report = validator.validate(nonexistent)

        errors = report.errors
        assert len(errors) == 1
        assert errors[0].severity == "error"
        assert errors[0].category == "structure"
        assert "does not exist" in errors[0].message


class TestValidateMissingProjectsDir:
    """Root exists but .sillyspec/projects/ is absent -> error."""

    def test_returns_not_passed(self, validator: SpecValidator, tmp_path: Path) -> None:
        # Create the root but NOT .sillyspec/projects/
        (tmp_path / ".sillyspec").mkdir()
        report = validator.validate(tmp_path)

        assert report.passed is False

    def test_has_structure_error(self, validator: SpecValidator, tmp_path: Path) -> None:
        (tmp_path / ".sillyspec").mkdir()
        report = validator.validate(tmp_path)

        errors = report.errors
        assert len(errors) == 1
        assert errors[0].category == "structure"
        assert ".sillyspec/projects/" in errors[0].message


class TestValidateEmptyProjectsDir:
    """.sillyspec/projects/ exists but has no YAML files -> warning (not error)."""

    def test_passes_with_warning(self, validator: SpecValidator, tmp_path: Path) -> None:
        (tmp_path / ".sillyspec" / "projects").mkdir(parents=True)
        report = validator.validate(tmp_path)

        # No errors -> passed; but warnings should exist
        assert report.passed is True
        assert len(report.warnings) == 1
        assert "No YAML files" in report.warnings[0].message


class TestValidatePlatformManagedProjectsDir:
    """platform_managed=True validates flat ``projects/`` without a .sillyspec wrapper."""

    def test_flat_projects_dir_passes(self, validator: SpecValidator, tmp_path: Path) -> None:
        projects_dir = tmp_path / "projects"
        _write_yaml(
            projects_dir / "backend.yaml",
            "id: backend\nname: Backend\ntype: service\n",
        )

        report = validator.validate(tmp_path, platform_managed=True)

        assert report.passed is True
        assert report.errors == []

    def test_wrapped_only_fails_in_flat_mode(
        self, validator: SpecValidator, tmp_path: Path
    ) -> None:
        projects_dir = tmp_path / ".sillyspec" / "projects"
        _write_yaml(
            projects_dir / "backend.yaml",
            "id: backend\nname: Backend\ntype: service\n",
        )

        report = validator.validate(tmp_path, platform_managed=True)

        assert report.passed is False
        assert any(issue.path.endswith("projects") for issue in report.errors)


# ── YAML schema checks ────────────────────────────────────────────────────────


class TestValidateValidYaml:
    """Valid YAML with id/name/type -> passed."""

    def test_passes(self, validator: SpecValidator, tmp_path: Path) -> None:
        projects_dir = tmp_path / ".sillyspec" / "projects"
        _write_yaml(
            projects_dir / "backend.yaml",
            "id: backend\nname: Backend\ntype: service\n",
        )
        report = validator.validate(tmp_path)

        assert report.passed is True
        assert len(report.errors) == 0

    def test_collects_component_id(self, validator: SpecValidator, tmp_path: Path) -> None:
        projects_dir = tmp_path / ".sillyspec" / "projects"
        _write_yaml(
            projects_dir / "backend.yaml",
            "id: backend\nname: Backend\ntype: service\n",
        )
        # Re-validate to confirm id is collected (tested indirectly via references)
        report = validator.validate(tmp_path)
        assert report.passed is True


class TestValidateMissingRequiredFields:
    """YAML without required fields."""

    def test_missing_id_passes_when_name_present(
        self, validator: SpecValidator, tmp_path: Path
    ) -> None:
        """id is auto-derived from filename when missing; name present -> passes."""
        projects_dir = tmp_path / ".sillyspec" / "projects"
        _write_yaml(
            projects_dir / "my-service.yaml",
            "name: My Service\ntype: service\n",
        )
        report = validator.validate(tmp_path)

        assert report.passed is True

    def test_missing_type_passes(self, validator: SpecValidator, tmp_path: Path) -> None:
        """type is optional in parser, so validator should not reject it."""
        projects_dir = tmp_path / ".sillyspec" / "projects"
        _write_yaml(
            projects_dir / "backend.yaml",
            "id: backend\nname: Backend\n",
        )
        report = validator.validate(tmp_path)

        assert report.passed is True

    def test_missing_both_name_and_id(self, validator: SpecValidator, tmp_path: Path) -> None:
        """YAML with neither name nor id -> error."""
        projects_dir = tmp_path / ".sillyspec" / "projects"
        _write_yaml(
            projects_dir / "empty.yaml",
            "description: no name or id\n",
        )
        report = validator.validate(tmp_path)

        assert report.passed is False
        assert any("name" in e.message or "id" in e.message for e in report.errors)

    def test_id_only_passes(self, validator: SpecValidator, tmp_path: Path) -> None:
        """YAML with only id (no name) -> passes, name derived from id."""
        projects_dir = tmp_path / ".sillyspec" / "projects"
        _write_yaml(
            projects_dir / "svc.yaml",
            "id: my-svc\npath: ./svc\n",
        )
        report = validator.validate(tmp_path)

        assert report.passed is True

    def test_scan_generated_format_passes(self, validator: SpecValidator, tmp_path: Path) -> None:
        """Typical LLM-generated YAML with name/path/role but no id/type -> passes."""
        projects_dir = tmp_path / ".sillyspec" / "projects"
        _write_yaml(
            projects_dir / "frontend.yaml",
            "name: frontend\npath: ./frontend\nrole: Frontend App\ntech_stack:\n  - react\n",
        )
        report = validator.validate(tmp_path)

        assert report.passed is True


class TestValidateInvalidYamlSyntax:
    """Broken YAML syntax -> error."""

    def test_invalid_yaml(self, validator: SpecValidator, tmp_path: Path) -> None:
        projects_dir = tmp_path / ".sillyspec" / "projects"
        _write_yaml(
            projects_dir / "broken.yaml",
            "id: [\n  invalid yaml\n",
        )
        report = validator.validate(tmp_path)

        assert report.passed is False
        assert any("Failed to parse YAML" in e.message for e in report.errors)


class TestValidateNonDictYaml:
    """YAML that parses to a list (not dict) -> error."""

    def test_list_yaml(self, validator: SpecValidator, tmp_path: Path) -> None:
        projects_dir = tmp_path / ".sillyspec" / "projects"
        _write_yaml(
            projects_dir / "list.yaml",
            "- item1\n- item2\n",
        )
        report = validator.validate(tmp_path)

        assert report.passed is False
        assert any("not a mapping" in e.message for e in report.errors)


# ── Reference integrity checks ────────────────────────────────────────────────


class TestValidateReferenceIntegrityOk:
    """relations.target exists in the component list -> passed."""

    def test_valid_reference(self, validator: SpecValidator, tmp_path: Path) -> None:
        projects_dir = tmp_path / ".sillyspec" / "projects"
        _write_yaml(
            projects_dir / "backend.yaml",
            "id: backend\nname: Backend\ntype: service\n",
        )
        _write_yaml(
            projects_dir / "frontend.yaml",
            (
                "id: frontend\n"
                "name: Frontend\n"
                "type: webapp\n"
                "relations:\n"
                "  - target: backend\n"
                "    type: depends_on\n"
            ),
        )
        report = validator.validate(tmp_path)

        assert report.passed is True
        assert len(report.errors) == 0


class TestValidateReferenceIntegrityBroken:
    """relations.target references a non-existent component -> error."""

    def test_broken_reference(self, validator: SpecValidator, tmp_path: Path) -> None:
        projects_dir = tmp_path / ".sillyspec" / "projects"
        _write_yaml(
            projects_dir / "backend.yaml",
            "id: backend\nname: Backend\ntype: service\n",
        )
        _write_yaml(
            projects_dir / "frontend.yaml",
            (
                "id: frontend\n"
                "name: Frontend\n"
                "type: webapp\n"
                "relations:\n"
                "  - target: nonexistent-service\n"
                "    type: depends_on\n"
            ),
        )
        report = validator.validate(tmp_path)

        assert report.passed is False
        ref_errors = [e for e in report.errors if e.category == "reference"]
        assert len(ref_errors) == 1
        assert "nonexistent-service" in ref_errors[0].message
