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
    """YAML without required field (e.g. id) -> error."""

    def test_missing_id(self, validator: SpecValidator, tmp_path: Path) -> None:
        projects_dir = tmp_path / ".sillyspec" / "projects"
        _write_yaml(
            projects_dir / "bad.yaml",
            "name: MissingID\ntype: service\n",
        )
        report = validator.validate(tmp_path)

        assert report.passed is False
        assert any("id" in e.message for e in report.errors)

    def test_missing_multiple_fields(self, validator: SpecValidator, tmp_path: Path) -> None:
        projects_dir = tmp_path / ".sillyspec" / "projects"
        _write_yaml(
            projects_dir / "empty.yaml",
            "description: no required fields\n",
        )
        report = validator.validate(tmp_path)

        assert report.passed is False
        error_msgs = " ".join(e.message for e in report.errors)
        assert "id" in error_msgs
        assert "name" in error_msgs
        assert "type" in error_msgs


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
