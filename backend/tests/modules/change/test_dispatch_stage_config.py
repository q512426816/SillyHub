"""Tests for STAGE_AGENT_CONFIG completeness and correctness.

Validates all 8 SillySpec stages are configured with correct values
per design.md Phase 3.
"""

from app.modules.change.dispatch import STAGE_AGENT_CONFIG
from app.modules.change.model import StageEnum


def test_config_has_eight_entries():
    """STAGE_AGENT_CONFIG must have exactly 8 entries (all SillySpec stages)."""
    assert len(STAGE_AGENT_CONFIG) == 8


def test_config_keys_match_spec_stages():
    """All keys must be StageEnum.XXX.value for the 8 spec stages."""
    expected_keys = {e.value for e in StageEnum.spec_stages()}
    actual_keys = set(STAGE_AGENT_CONFIG.keys())
    assert actual_keys == expected_keys


def test_all_stages_enabled():
    """All 8 stages must have enabled=True."""
    for stage, config in STAGE_AGENT_CONFIG.items():
        assert config.enabled is True, f"Stage '{stage}' is not enabled"


def test_all_stages_read_only_false():
    """All 8 stages must have read_only=False (every stage writes files)."""
    for stage, config in STAGE_AGENT_CONFIG.items():
        assert config.read_only is False, (
            f"Stage '{stage}' has read_only=True, expected False"
        )


def test_propose_read_only_false():
    """propose stage must have read_only=False."""
    assert STAGE_AGENT_CONFIG[StageEnum.PROPOSE.value].read_only is False


def test_plan_read_only_false():
    """plan stage must have read_only=False."""
    assert STAGE_AGENT_CONFIG[StageEnum.PLAN.value].read_only is False


def test_scan_read_only_false():
    """scan stage must have read_only=False."""
    assert STAGE_AGENT_CONFIG[StageEnum.SCAN.value].read_only is False


def test_archive_exists_and_requires_worktree():
    """archive stage must exist and require worktree."""
    assert StageEnum.ARCHIVE.value in STAGE_AGENT_CONFIG
    assert STAGE_AGENT_CONFIG[StageEnum.ARCHIVE.value].requires_worktree is True


def test_quick_exists_and_requires_worktree():
    """quick stage must exist and require worktree."""
    assert StageEnum.QUICK.value in STAGE_AGENT_CONFIG
    assert STAGE_AGENT_CONFIG[StageEnum.QUICK.value].requires_worktree is True


def test_all_stages_have_prompt_template():
    """Every stage must have a non-empty prompt_template."""
    for stage, config in STAGE_AGENT_CONFIG.items():
        assert config.prompt_template, f"Stage '{stage}' missing prompt_template"


def test_all_stages_have_phase():
    """Every stage must have a non-empty phase."""
    for stage, config in STAGE_AGENT_CONFIG.items():
        assert config.phase, f"Stage '{stage}' missing phase"


def test_all_stages_have_description():
    """Every stage must have a non-empty description."""
    for stage, config in STAGE_AGENT_CONFIG.items():
        assert config.description, f"Stage '{stage}' missing description"


def test_execute_requires_worktree():
    """execute stage must require worktree."""
    assert STAGE_AGENT_CONFIG[StageEnum.EXECUTE.value].requires_worktree is True


def test_verify_requires_worktree():
    """verify stage must require worktree."""
    assert STAGE_AGENT_CONFIG[StageEnum.VERIFY.value].requires_worktree is True


def test_brainstorm_requires_worktree():
    """brainstorm stage must require worktree."""
    assert STAGE_AGENT_CONFIG[StageEnum.BRAINSTORM.value].requires_worktree is True


def test_propose_requires_worktree():
    """propose stage must require worktree."""
    assert STAGE_AGENT_CONFIG[StageEnum.PROPOSE.value].requires_worktree is True


def test_plan_requires_worktree():
    """plan stage must require worktree."""
    assert STAGE_AGENT_CONFIG[StageEnum.PLAN.value].requires_worktree is True
