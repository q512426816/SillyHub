---
id: task-17
title: "单测 — STAGE_AGENT_CONFIG 配置完整性"
priority: P0
estimated_hours: 1
depends_on: [task-03]
blocks: []
allowed_paths:
  - backend/tests/test_dispatch_config.py
author: qinyi
created_at: 2026-06-01 19:30:00
---

# task-17: 单测 — STAGE_AGENT_CONFIG 配置完整性

## 修改文件
- `backend/tests/test_dispatch_config.py`（新建）

## 实现要求

根据 design.md Phase 3、requirements.md FR-04 和 task-03 的配置补齐：

1. 验证 STAGE_AGENT_CONFIG 包含全部 8 个 SillySpec 阶段（scan/brainstorm/propose/plan/execute/verify/archive/quick）
2. 验证所有 8 个阶段的 `read_only` 标记正确：根据 design.md Phase 3 配置表，全部为 `False`
3. 验证键使用 `StageEnum` 常量（`StageEnum.spec_stages()` 的 value 集合与 config 键集合一致）
4. 验证每个阶段配置包含 `prompt_template` 字段且非空
5. 验证每个阶段配置包含 `phase` 字段且非空
6. 验证每个阶段配置的 `enabled` 为 `True`
7. 遵循项目测试约定（pytest-asyncio、同步测试、无 DB 依赖的纯配置断言）

## 接口定义

### 完整测试代码 — `backend/tests/test_dispatch_config.py`

```python
"""Tests for STAGE_AGENT_CONFIG completeness.

Validates that the stage agent configuration covers all 8 SillySpec
stages with correct read_only flags, StageEnum keys, and required fields.

Depends on: task-03 (STAGE_AGENT_CONFIG completion)
"""

from __future__ import annotations

import pytest

from app.modules.change.dispatch import STAGE_AGENT_CONFIG, StageAgentConfig
from app.modules.change.model import StageEnum


# ---------------------------------------------------------------------------
# Expected stage set from StageEnum
# ---------------------------------------------------------------------------

_EXPECTED_SPEC_STAGES: set[str] = {e.value for e in StageEnum.spec_stages()}
_EXPECTED_STAGE_NAMES: list[str] = [e.value for e in StageEnum.spec_stages()]


# ===================================================================
# 1. Configuration cardinality
# ===================================================================


class TestConfigCardinality:
    """Verify the total number of stage configurations."""

    def test_config_has_eight_entries(self) -> None:
        """AC-01: STAGE_AGENT_CONFIG must contain exactly 8 entries."""
        assert len(STAGE_AGENT_CONFIG) == 8, (
            f"Expected 8 stage configs, got {len(STAGE_AGENT_CONFIG)}. "
            f"Present keys: {sorted(STAGE_AGENT_CONFIG.keys())}"
        )

    def test_config_keys_match_spec_stages(self) -> None:
        """AC-07: Config keys must equal StageEnum.spec_stages() values."""
        config_keys = set(STAGE_AGENT_CONFIG.keys())
        assert config_keys == _EXPECTED_SPEC_STAGES, (
            f"Key mismatch. "
            f"Missing: {_EXPECTED_SPEC_STAGES - config_keys}, "
            f"Extra: {config_keys - _EXPECTED_SPEC_STAGES}"
        )


# ===================================================================
# 2. StageEnum key validation
# ===================================================================


class TestStageEnumKeys:
    """Verify that every config key is a valid StageEnum value."""

    def test_all_keys_are_valid_stage_enum_values(self) -> None:
        """AC-03: Every key must be a valid StageEnum.spec_stages() value."""
        valid_values = {e.value for e in StageEnum.spec_stages()}
        for key in STAGE_AGENT_CONFIG:
            assert key in valid_values, (
                f"Key '{key}' is not a valid StageEnum spec stage value. "
                f"Valid values: {sorted(valid_values)}"
            )

    def test_all_keys_are_strings(self) -> None:
        """All keys must be strings (dict[str, StageAgentConfig])."""
        for key in STAGE_AGENT_CONFIG:
            assert isinstance(key, str), f"Key {key!r} is {type(key).__name__}, expected str"

    def test_no_hub_stages_in_config(self) -> None:
        """Hub-only stages (draft, rework_required, accepted) must NOT appear."""
        hub_values = {e.value for e in StageEnum.hub_stages()}
        for key in STAGE_AGENT_CONFIG:
            assert key not in hub_values, (
                f"Hub stage '{key}' should not be in STAGE_AGENT_CONFIG"
            )


# ===================================================================
# 3. read_only flags
# ===================================================================


class TestReadOnlyFlags:
    """Verify read_only flags match design.md Phase 3 specification.

    According to design.md Phase 3, all 8 stages are read_only=False
    because each stage writes files:
    - scan: writes scan documents to .sillyspec/docs/
    - brainstorm: writes question lists / decision records
    - propose: writes four-piece proposal set
    - plan: writes plan.md + task blueprints
    - execute: writes code
    - verify: writes verify-result.md
    - archive: writes module-impact analysis
    - quick: writes quicklog and may modify code
    """

    @pytest.mark.parametrize(
        "stage",
        _EXPECTED_STAGE_NAMES,
    )
    def test_all_stages_read_only_false(self, stage: str) -> None:
        """AC-02/AC-09: All 8 stages must have read_only=False."""
        config = STAGE_AGENT_CONFIG[stage]
        assert config.read_only is False, (
            f"Stage '{stage}' has read_only={config.read_only}, expected False"
        )

    def test_read_only_is_bool_type(self) -> None:
        """read_only must be a bool, not truthy/falsy non-bool values."""
        for stage, config in STAGE_AGENT_CONFIG.items():
            assert isinstance(config.read_only, bool), (
                f"Stage '{stage}' read_only is {type(config.read_only).__name__}, expected bool"
            )


# ===================================================================
# 4. enabled flags
# ===================================================================


class TestEnabledFlags:
    """Verify all stages are enabled."""

    @pytest.mark.parametrize(
        "stage",
        _EXPECTED_STAGE_NAMES,
    )
    def test_all_stages_enabled(self, stage: str) -> None:
        """AC-08: All 8 stages must have enabled=True."""
        config = STAGE_AGENT_CONFIG[stage]
        assert config.enabled is True, (
            f"Stage '{stage}' has enabled={config.enabled}, expected True"
        )

    def test_enabled_is_bool_type(self) -> None:
        """enabled must be a bool."""
        for stage, config in STAGE_AGENT_CONFIG.items():
            assert isinstance(config.enabled, bool), (
                f"Stage '{stage}' enabled is {type(config.enabled).__name__}, expected bool"
            )


# ===================================================================
# 5. Required fields (prompt_template, phase)
# ===================================================================


class TestRequiredFields:
    """Verify every stage config has non-empty prompt_template and phase."""

    @pytest.mark.parametrize(
        "stage",
        _EXPECTED_STAGE_NAMES,
    )
    def test_prompt_template_non_empty(self, stage: str) -> None:
        """AC-04: Every stage must have a non-empty prompt_template."""
        config = STAGE_AGENT_CONFIG[stage]
        assert config.prompt_template, (
            f"Stage '{stage}' has empty prompt_template"
        )
        assert isinstance(config.prompt_template, str), (
            f"Stage '{stage}' prompt_template is {type(config.prompt_template).__name__}, expected str"
        )

    @pytest.mark.parametrize(
        "stage",
        _EXPECTED_STAGE_NAMES,
    )
    def test_phase_non_empty(self, stage: str) -> None:
        """Every stage must have a non-empty phase label."""
        config = STAGE_AGENT_CONFIG[stage]
        assert config.phase, (
            f"Stage '{stage}' has empty phase"
        )
        assert isinstance(config.phase, str), (
            f"Stage '{stage}' phase is {type(config.phase).__name__}, expected str"
        )

    @pytest.mark.parametrize(
        "stage",
        _EXPECTED_STAGE_NAMES,
    )
    def test_description_non_empty(self, stage: str) -> None:
        """Every stage must have a non-empty description."""
        config = STAGE_AGENT_CONFIG[stage]
        assert config.description, (
            f"Stage '{stage}' has empty description"
        )


# ===================================================================
# 6. requires_worktree flags
# ===================================================================


class TestRequiresWorktree:
    """Verify requires_worktree flags match design.md Phase 3.

    According to design.md Phase 3:
    - scan: requires_worktree=False
    - all others: requires_worktree=True
    """

    def test_scan_does_not_require_worktree(self) -> None:
        """scan stage does not require worktree (writes to workspace root)."""
        config = STAGE_AGENT_CONFIG[StageEnum.SCAN.value]
        assert config.requires_worktree is False

    @pytest.mark.parametrize(
        "stage",
        [s for s in _EXPECTED_STAGE_NAMES if s != StageEnum.SCAN.value],
    )
    def test_non_scan_stages_require_worktree(self, stage: str) -> None:
        """AC-04/AC-05: All non-scan stages require worktree."""
        config = STAGE_AGENT_CONFIG[stage]
        assert config.requires_worktree is True, (
            f"Stage '{stage}' requires_worktree={config.requires_worktree}, expected True"
        )

    def test_requires_worktree_is_bool_type(self) -> None:
        """requires_worktree must be a bool."""
        for stage, config in STAGE_AGENT_CONFIG.items():
            assert isinstance(config.requires_worktree, bool), (
                f"Stage '{stage}' requires_worktree is {type(config.requires_worktree).__name__}, expected bool"
            )


# ===================================================================
# 7. Config type consistency
# ===================================================================


class TestConfigTypeConsistency:
    """Verify all config values are StageAgentConfig instances."""

    def test_all_values_are_stage_agent_config(self) -> None:
        """Every value in STAGE_AGENT_CONFIG must be a StageAgentConfig instance."""
        for stage, config in STAGE_AGENT_CONFIG.items():
            assert isinstance(config, StageAgentConfig), (
                f"Stage '{stage}' value is {type(config).__name__}, expected StageAgentConfig"
            )


# ===================================================================
# 8. Individual stage existence checks
# ===================================================================


class TestIndividualStagePresence:
    """Verify each of the 8 SillySpec stages is present by StageEnum."""

    @pytest.mark.parametrize(
        "stage_enum",
        list(StageEnum.spec_stages()),
    )
    def test_stage_present(self, stage_enum: StageEnum) -> None:
        """Each SillySpec stage must be present in STAGE_AGENT_CONFIG."""
        assert stage_enum.value in STAGE_AGENT_CONFIG, (
            f"Stage '{stage_enum.value}' ({stage_enum.name}) missing from STAGE_AGENT_CONFIG"
        )


# ===================================================================
# 9. Specific stage value checks (FR-04 acceptance criteria)
# ===================================================================


class TestFR04AcceptanceCriteria:
    """Verify FR-04 acceptance criteria from requirements.md."""

    def test_ac01_eight_entries(self) -> None:
        """AC-01: STAGE_AGENT_CONFIG contains 8 entries."""
        assert len(STAGE_AGENT_CONFIG) == 8

    def test_ac02_propose_read_only_false(self) -> None:
        """AC-02: propose.read_only == False."""
        assert STAGE_AGENT_CONFIG[StageEnum.PROPOSE.value].read_only is False

    def test_ac03_plan_read_only_false(self) -> None:
        """AC-03: plan.read_only == False."""
        assert STAGE_AGENT_CONFIG[StageEnum.PLAN.value].read_only is False

    def test_ac04_archive_requires_worktree_true(self) -> None:
        """AC-04: archive.requires_worktree == True."""
        assert STAGE_AGENT_CONFIG[StageEnum.ARCHIVE.value].requires_worktree is True

    def test_ac05_quick_requires_worktree_true(self) -> None:
        """AC-05: quick.requires_worktree == True."""
        assert STAGE_AGENT_CONFIG[StageEnum.QUICK.value].requires_worktree is True

    def test_ac06_scan_read_only_false(self) -> None:
        """AC-06: scan.read_only == False."""
        assert STAGE_AGENT_CONFIG[StageEnum.SCAN.value].read_only is False

    def test_ac07_keys_match_spec_stages(self) -> None:
        """AC-07: Config keys == StageEnum.spec_stages() values."""
        assert set(STAGE_AGENT_CONFIG.keys()) == _EXPECTED_SPEC_STAGES

    def test_ac08_all_enabled(self) -> None:
        """AC-08: All 8 stages enabled == True."""
        for stage, config in STAGE_AGENT_CONFIG.items():
            assert config.enabled is True, f"Stage '{stage}' not enabled"

    def test_ac09_all_read_only_false(self) -> None:
        """AC-09: All 8 stages read_only == False."""
        for stage, config in STAGE_AGENT_CONFIG.items():
            assert config.read_only is False, f"Stage '{stage}' has read_only=True"
```

## 边界处理（共 9 条）

1. **阶段缺失时的错误信息**：`test_config_has_eight_entries` 在断言失败时输出实际键列表，明确告知缺少哪些阶段
2. **键集合不匹配时的错误信息**：`test_config_keys_match_spec_stages` 分别输出 Missing 和 Extra 集合，精确定位差异
3. **read_only 值不是 bool 的情况**：`test_read_only_is_bool_type` 独立验证类型，防止用 0/1 代替 True/False
4. **键类型不是 StageEnum value 的情况**：`test_all_keys_are_valid_stage_enum_values` 验证每个键都是合法的 StageEnum spec stage value
5. **Hub 阶段混入配置的情况**：`test_no_hub_stages_in_config` 确保 draft/rework_required/accepted 不出现在配置中
6. **新增阶段时的测试维护**：使用 `StageEnum.spec_stages()` 动态生成期望集合，新增阶段到枚举后测试自动感知（通过 `_EXPECTED_SPEC_STAGES`）
7. **空配置的防护**：`test_config_has_eight_entries` 在配置为空时给出明确的计数断言失败
8. **enabled=False 的阶段不应 dispatch**：`test_all_stages_enabled` 验证所有阶段均为 enabled=True
9. **requires_worktree 类型不是 bool**：`test_requires_worktree_is_bool_type` 验证类型安全

## 非目标

- 不修改 dispatch.py 代码
- 不测试调度逻辑（task-20 负责）
- 不测试 prompt template 文件是否存在（`load_prompt_template` 已有 fallback）
- 不测试 dispatch() 函数行为
- 不测试 has_active_run() 或 get_config_for_stage() 辅助函数

## 参考

- design.md Phase 3 配置表（第 196-209 行）
- requirements.md FR-04（第 54-68 行）
- task-03 的 STAGE_AGENT_CONFIG 补齐实现
- TESTING.md 测试约定（pytest 8+、asyncio_mode=auto）
- `backend/app/modules/change/model.py` 第 19-43 行：StageEnum 定义
- `backend/app/modules/change/dispatch.py`：现有配置和 StageAgentConfig 定义

## TDD 步骤

纯测试任务：

1. **编写测试文件** `backend/tests/test_dispatch_config.py`，包含上述全部测试类和测试函数
2. **确认失败**：在 task-03 未实施前运行测试，预期因以下原因失败：
   - `len(STAGE_AGENT_CONFIG) == 8` 失败（当前只有 6 个）
   - `archive` / `quick` 阶段缺失
   - propose/plan 的 `read_only` 仍为 `True`
   - 键不是 `StageEnum` value 集合
3. **task-03 实施后**：重新运行测试，确认全部通过
4. **验收**：`pytest backend/tests/test_dispatch_config.py -v` 全部绿色

## 验收标准

| # | 验证步骤 | 通过标准 |
|---|---------|---------|
| AC-01 | 8 个阶段全部存在 | `assert len(STAGE_AGENT_CONFIG) == 8` |
| AC-02 | propose.read_only == False | `assert config.read_only is False` |
| AC-03 | plan.read_only == False | `assert config.read_only is False` |
| AC-04 | archive.requires_worktree == True | `assert config.requires_worktree is True` |
| AC-05 | quick.requires_worktree == True | `assert config.requires_worktree is True` |
| AC-06 | scan.read_only == False | `assert config.read_only is False` |
| AC-07 | 键集合 == StageEnum.spec_stages() values | `set(keys) == {e.value for e in StageEnum.spec_stages()}` |
| AC-08 | 所有 8 个阶段 enabled == True | 逐一断言 |
| AC-09 | 所有 8 个阶段 read_only == False | 逐一断言 |
| AC-10 | pytest 全部通过 | `pytest backend/tests/test_dispatch_config.py -v` 绿色，0 failures |
