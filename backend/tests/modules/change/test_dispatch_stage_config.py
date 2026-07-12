"""Tests for STAGE_AGENT_CONFIG completeness and correctness.

Validates all 5 变更流程 stages are configured with correct values.
2026-07-02-decouple-scan-from-change-flow：scan 从变更流程移除（回归 workspace 初始化），
仅保留 brainstorm/plan/execute/verify/archive。
"""

from app.modules.change.dispatch import STAGE_AGENT_CONFIG
from app.modules.change.model import StageEnum


def test_config_has_five_entries():
    """STAGE_AGENT_CONFIG must have exactly 5 entries (scan removed from change flow)."""
    assert len(STAGE_AGENT_CONFIG) == 5


def test_config_keys_match_spec_stages():
    """All keys must be StageEnum.XXX.value for the 6 spec stages."""
    expected_keys = {e.value for e in StageEnum.spec_stages()}
    actual_keys = set(STAGE_AGENT_CONFIG.keys())
    assert actual_keys == expected_keys


def test_all_stages_enabled():
    """All 6 stages must have enabled=True."""
    for stage, config in STAGE_AGENT_CONFIG.items():
        assert config.enabled is True, f"Stage '{stage}' is not enabled"


def test_all_stages_read_only_false():
    """All 6 stages must have read_only=False (every stage writes files)."""
    for stage, config in STAGE_AGENT_CONFIG.items():
        assert config.read_only is False, f"Stage '{stage}' has read_only=True, expected False"


def test_plan_read_only_false():
    """plan stage must have read_only=False."""
    assert STAGE_AGENT_CONFIG[StageEnum.PLAN.value].read_only is False


def test_archive_exists_and_requires_worktree():
    """archive stage must exist and require worktree."""
    assert StageEnum.ARCHIVE.value in STAGE_AGENT_CONFIG
    assert (
        STAGE_AGENT_CONFIG[StageEnum.ARCHIVE.value].requires_worktree is False
    )  # D-002: daemon-client 不用 worktree


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
    """execute stage requires_worktree is False (D-002: daemon-client 不用 worktree，dir 由 sillyspec 自建)."""
    assert (
        STAGE_AGENT_CONFIG[StageEnum.EXECUTE.value].requires_worktree is False
    )  # D-002: daemon-client 不用 worktree


def test_verify_requires_worktree():
    """verify stage does NOT require worktree (D-004: daemon-client + host-fs-delegate 定位 spec_root)."""
    assert STAGE_AGENT_CONFIG[StageEnum.VERIFY.value].requires_worktree is False


def test_brainstorm_requires_worktree():
    """brainstorm stage requires_worktree is False (D-002: daemon-client 不用 worktree，dir 由 sillyspec 自建)."""
    assert (
        STAGE_AGENT_CONFIG[StageEnum.BRAINSTORM.value].requires_worktree is False
    )  # D-002: daemon-client 不用 worktree


def test_plan_requires_worktree():
    """plan stage requires_worktree is False (D-002: daemon-client 不用 worktree，dir 由 sillyspec 自建)."""
    assert (
        STAGE_AGENT_CONFIG[StageEnum.PLAN.value].requires_worktree is False
    )  # D-002: daemon-client 不用 worktree
