---
id: task-18
title: 单测 — AgentSpecBundle stage 字段 + build_stage_bundle
author: qinyi
created_at: 2026-06-01 06:59:47
priority: P0
estimated_hours: 2
depends_on: [task-05]
blocks: []
allowed_paths:
  - backend/tests/test_agent_bundle.py
---

# task-18: 单测 — AgentSpecBundle stage 字段 + build_stage_bundle

## 修改文件
- `backend/tests/test_agent_bundle.py`（新建）

## 实现要求

本任务是纯测试任务，为 task-02（AgentSpecBundle 扩展）和 task-05（build_stage_bundle 函数）编写完整的单元测试。测试覆盖 AgentSpecBundle 新增的 6 个 stage_dispatch 字段的默认值、显式赋值、向后兼容性，以及 `build_stage_bundle()` 的正常流程和异常路径。

### 测试分区

**A 区：AgentSpecBundle stage_dispatch 字段（4 个测试）**
1. `test_stage_dispatch_default_values` — 不传 stage 字段时，6 个字段全部为默认值（`False`/`None`/`None`/`None`/`None`/`False`）
2. `test_stage_dispatch_fields_explicitly_set` — 传入所有 stage 字段时，值正确存储
3. `test_stage_dispatch_false_with_stage_fields_set` — `stage_dispatch=False` 但其他字段有值时，对象正常创建（忽略由 adapter 层负责）
4. `test_existing_bundle_construction_unchanged` — 现有最小构造方式不受影响

**B 区：build_stage_bundle 正常流程（4 个测试）**
5. `test_build_stage_bundle_returns_valid_bundle` — 完整场景：Change + 文档 + SpecWorkspace 全存在，返回正确的 bundle
6. `test_build_stage_bundle_no_documents` — 文档目录不存在/无文档时，文档字段全部为 `None`，不报错
7. `test_build_stage_bundle_with_step_prompt` — 传入 `step_prompt` 时正确填充
8. `test_build_stage_bundle_read_only_true` — `read_only=True` 时正确标记

**C 区：build_stage_bundle 异常路径（2 个测试）**
9. `test_build_stage_bundle_change_not_found` — Change 不存在时抛出 `ChangeNotFound`
10. `test_build_stage_bundle_workspace_not_found` — Workspace 不存在时抛出 `WorkspaceNotFound`

**D 区：边界与兼容（2 个测试）**
11. `test_build_stage_bundle_no_spec_workspace` — SpecWorkspace 不存在时 `spec_root` 为 `None`，不报错
12. `test_build_stage_bundle_title_none_fallback` — `change.title` 为 `None` 时，`change_summary` fallback 到 `change.change_key`

## 接口定义

完整测试代码如下，直接写入 `backend/tests/test_agent_bundle.py`：

```python
"""Tests for AgentSpecBundle stage_dispatch fields + build_stage_bundle().

Covers:
  A. AgentSpecBundle — 6 new stage_dispatch fields (default values, explicit set, backward compat)
  B. build_stage_bundle — normal flow (valid bundle, no docs, step_prompt, read_only)
  C. build_stage_bundle — error paths (Change not found, Workspace not found)
  D. build_stage_bundle — edge cases (no SpecWorkspace, title None fallback)

Test strategy: unit tests using mock AsyncSession (no real DB needed).
AgentSpecBundle tests are pure dataclass tests (no fixtures).
build_stage_bundle tests mock session.get / session.execute to simulate DB records.
"""

from __future__ import annotations

import uuid
from unittest.mock import AsyncMock, MagicMock

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import ChangeNotFound, WorkspaceNotFound
from app.modules.agent.base import AgentSpecBundle


# ---------------------------------------------------------------------------
# A. AgentSpecBundle stage_dispatch field tests
# ---------------------------------------------------------------------------


def test_stage_dispatch_default_values() -> None:
    """AgentSpecBundle 不传 stage 字段时，6 个字段全部为默认值。"""
    bundle = AgentSpecBundle(
        change_summary="test change",
        task_key="task-01",
        task_title="test task",
    )
    assert bundle.stage_dispatch is False
    assert bundle.change_key is None
    assert bundle.stage is None
    assert bundle.spec_root is None
    assert bundle.step_prompt is None
    assert bundle.read_only is False


def test_stage_dispatch_fields_explicitly_set() -> None:
    """AgentSpecBundle 传入全部 stage 字段时，值正确存储。"""
    bundle = AgentSpecBundle(
        change_summary="test change",
        task_key="task-01",
        task_title="test task",
        stage_dispatch=True,
        change_key="agent-stage-dispatch",
        stage="propose",
        spec_root="/workspace/.sillyspec",
        step_prompt="Write a proposal for this change",
        read_only=True,
    )
    assert bundle.stage_dispatch is True
    assert bundle.change_key == "agent-stage-dispatch"
    assert bundle.stage == "propose"
    assert bundle.spec_root == "/workspace/.sillyspec"
    assert bundle.step_prompt == "Write a proposal for this change"
    assert bundle.read_only is True


def test_stage_dispatch_false_with_stage_fields_set() -> None:
    """stage_dispatch=False 但 stage 字段有值时，对象正常创建（忽略由 adapter 层负责）。"""
    bundle = AgentSpecBundle(
        change_summary="test change",
        task_key="task-01",
        task_title="test task",
        stage_dispatch=False,
        change_key="some-change",
        stage="plan",
    )
    assert bundle.stage_dispatch is False
    # 值被存储，但 stage_dispatch=False 时 adapter 应忽略
    assert bundle.change_key == "some-change"
    assert bundle.stage == "plan"


def test_existing_bundle_construction_unchanged() -> None:
    """现有代码中 AgentSpecBundle 的最小构造方式不受影响。"""
    # 对应 service.py:695 / context_builder.py:280 的调用方式
    bundle = AgentSpecBundle(
        change_summary="Change stage: propose",
        task_key="stage:propose",
        task_title="Stage dispatch: propose",
    )
    assert bundle.stage_dispatch is False
    assert bundle.proposal is None
    assert bundle.allowed_paths == []
    assert bundle.referenced_workspaces == []


# ---------------------------------------------------------------------------
# B. build_stage_bundle — normal flow
# ---------------------------------------------------------------------------


def _make_mock_session(
    *,
    workspace=None,
    change=None,
    spec_workspace=None,
    change_docs: list | None = None,
) -> AsyncMock:
    """构造一个 mock AsyncSession，按 get/execute 调用返回预设对象。"""
    session = AsyncMock(spec=AsyncSession)

    async def _get(model, pk):  # noqa: ANN001
        if model.__name__ == "Workspace" or str(model) == "<class 'app.modules.workspace.model.Workspace'>":
            return workspace
        if model.__name__ == "Change" or str(model) == "<class 'app.modules.change.model.Change'>":
            return change
        return None

    session.get = AsyncMock(side_effect=_get)

    # 模拟 execute 返回值
    sw_scalar = MagicMock()
    sw_scalar.scalar_one_or_none = MagicMock(return_value=spec_workspace)

    scalars_mock = MagicMock()
    scalars_mock.all = MagicMock(return_value=change_docs or [])
    result_mock = MagicMock()
    result_mock.scalars = MagicMock(return_value=scalars_mock)

    async def _execute(stmt):  # noqa: ANN001
        return result_mock

    session.execute = AsyncMock(side_effect=_execute)
    return session


@pytest.fixture
def fake_workspace_id() -> uuid.UUID:
    return uuid.uuid4()


@pytest.fixture
def fake_change_id() -> uuid.UUID:
    return uuid.uuid4()


@pytest.fixture
def fake_workspace(fake_workspace_id: uuid.UUID) -> MagicMock:
    from app.modules.workspace.model import Workspace
    ws = MagicMock(spec=Workspace)
    ws.id = fake_workspace_id
    ws.name = "test-workspace"
    return ws


@pytest.fixture
def fake_change(fake_change_id: uuid.UUID, fake_workspace_id: uuid.UUID) -> MagicMock:
    from app.modules.change.model import Change
    change = MagicMock(spec=Change)
    change.id = fake_change_id
    change.workspace_id = fake_workspace_id
    change.change_key = "agent-stage-dispatch"
    change.title = "Agent Stage Dispatch"
    return change


@pytest.fixture
def fake_spec_workspace(fake_workspace_id: uuid.UUID) -> MagicMock:
    from app.modules.spec_workspace.model import SpecWorkspace
    sw = MagicMock(spec=SpecWorkspace)
    sw.workspace_id = fake_workspace_id
    sw.spec_root = "/data/workspaces/test/.sillyspec"
    return sw


@pytest.fixture
def fake_change_doc(fake_change_id: uuid.UUID, tmp_path) -> MagicMock:
    from app.modules.change.model import ChangeDocument
    doc = MagicMock(spec=ChangeDocument)
    doc.change_id = fake_change_id
    doc.doc_type = "proposal"
    proposal_file = tmp_path / "proposal.md"
    proposal_file.write_text("# Proposal\n\nTest proposal content", encoding="utf-8")
    doc.path = str(proposal_file)
    doc.exists = True
    return doc


async def test_build_stage_bundle_returns_valid_bundle(
    fake_workspace, fake_change, fake_spec_workspace, fake_change_doc,
    fake_workspace_id, fake_change_id,
) -> None:
    """build_stage_bundle 返回包含正确 stage 字段的完整 bundle。"""
    from app.modules.agent.context_builder import build_stage_bundle

    session = _make_mock_session(
        workspace=fake_workspace,
        change=fake_change,
        spec_workspace=fake_spec_workspace,
        change_docs=[fake_change_doc],
    )
    bundle = await build_stage_bundle(
        session, fake_change_id, "propose", fake_workspace_id,
    )

    assert isinstance(bundle, AgentSpecBundle)
    # Stage dispatch 扩展字段
    assert bundle.stage_dispatch is True
    assert bundle.change_key == "agent-stage-dispatch"
    assert bundle.stage == "propose"
    assert bundle.spec_root == "/data/workspaces/test/.sillyspec"
    assert bundle.read_only is False
    assert bundle.step_prompt is None
    # 文档内容
    assert bundle.proposal is not None
    assert "Test proposal content" in bundle.proposal
    # 核心 context
    assert bundle.change_summary == "Agent Stage Dispatch"
    assert bundle.task_key == "stage:propose"
    assert bundle.task_title == "Stage dispatch: propose"


async def test_build_stage_bundle_no_documents(
    fake_workspace, fake_change, fake_spec_workspace,
    fake_workspace_id, fake_change_id,
) -> None:
    """文档不存在时 bundle 的文档字段全部为 None，不报错。"""
    from app.modules.agent.context_builder import build_stage_bundle

    session = _make_mock_session(
        workspace=fake_workspace,
        change=fake_change,
        spec_workspace=fake_spec_workspace,
        change_docs=[],
    )
    bundle = await build_stage_bundle(
        session, fake_change_id, "plan", fake_workspace_id,
    )

    assert bundle.proposal is None
    assert bundle.requirements is None
    assert bundle.design is None
    assert bundle.plan is None
    assert bundle.task_markdown is None
    assert bundle.stage_dispatch is True


async def test_build_stage_bundle_with_step_prompt(
    fake_workspace, fake_change, fake_spec_workspace,
    fake_workspace_id, fake_change_id,
) -> None:
    """传入 step_prompt 时 bundle 正确包含。"""
    from app.modules.agent.context_builder import build_stage_bundle

    session = _make_mock_session(
        workspace=fake_workspace,
        change=fake_change,
        spec_workspace=fake_spec_workspace,
        change_docs=[],
    )
    bundle = await build_stage_bundle(
        session, fake_change_id, "propose", fake_workspace_id,
        step_prompt="Write the proposal document for this change",
    )

    assert bundle.step_prompt == "Write the proposal document for this change"


async def test_build_stage_bundle_read_only_true(
    fake_workspace, fake_change, fake_spec_workspace,
    fake_workspace_id, fake_change_id,
) -> None:
    """read_only=True 时 bundle 正确标记。"""
    from app.modules.agent.context_builder import build_stage_bundle

    session = _make_mock_session(
        workspace=fake_workspace,
        change=fake_change,
        spec_workspace=fake_spec_workspace,
        change_docs=[],
    )
    bundle = await build_stage_bundle(
        session, fake_change_id, "scan", fake_workspace_id,
        read_only=True,
    )

    assert bundle.read_only is True


# ---------------------------------------------------------------------------
# C. build_stage_bundle — error paths
# ---------------------------------------------------------------------------


async def test_build_stage_bundle_change_not_found(
    fake_workspace, fake_workspace_id, fake_change_id,
) -> None:
    """Change 不存在时抛出 ChangeNotFound。"""
    from app.modules.agent.context_builder import build_stage_bundle

    session = _make_mock_session(
        workspace=fake_workspace,
        change=None,
    )
    with pytest.raises(ChangeNotFound):
        await build_stage_bundle(
            session, fake_change_id, "propose", fake_workspace_id,
        )


async def test_build_stage_bundle_workspace_not_found(
    fake_workspace_id, fake_change_id,
) -> None:
    """Workspace 不存在时抛出 WorkspaceNotFound。"""
    from app.modules.agent.context_builder import build_stage_bundle

    session = _make_mock_session(
        workspace=None,
        change=None,
    )
    with pytest.raises(WorkspaceNotFound):
        await build_stage_bundle(
            session, fake_change_id, "propose", fake_workspace_id,
        )


# ---------------------------------------------------------------------------
# D. build_stage_bundle — edge cases
# ---------------------------------------------------------------------------


async def test_build_stage_bundle_no_spec_workspace(
    fake_workspace, fake_change,
    fake_workspace_id, fake_change_id,
) -> None:
    """SpecWorkspace 不存在时 spec_root 为 None，不报错。"""
    from app.modules.agent.context_builder import build_stage_bundle

    session = _make_mock_session(
        workspace=fake_workspace,
        change=fake_change,
        spec_workspace=None,
        change_docs=[],
    )
    bundle = await build_stage_bundle(
        session, fake_change_id, "propose", fake_workspace_id,
    )

    assert bundle.spec_root is None
    assert bundle.stage_dispatch is True


async def test_build_stage_bundle_title_none_fallback(
    fake_workspace, fake_workspace_id, fake_change_id,
) -> None:
    """change.title 为 None 时 change_summary fallback 到 change.change_key。"""
    from app.modules.agent.context_builder import build_stage_bundle
    from app.modules.change.model import Change

    change = MagicMock(spec=Change)
    change.id = fake_change_id
    change.change_key = "my-change-key"
    change.title = None  # title 为 None

    session = _make_mock_session(
        workspace=fake_workspace,
        change=change,
        spec_workspace=None,
        change_docs=[],
    )
    bundle = await build_stage_bundle(
        session, fake_change_id, "propose", fake_workspace_id,
    )

    assert bundle.change_summary == "my-change-key"
```

## 边界处理（至少5条）

1. **字段默认值验证**：`AgentSpecBundle` 不传 stage 字段时，`stage_dispatch=False`，`change_key`/`stage`/`spec_root`/`step_prompt` 为 `None`，`read_only=False`。保证向后兼容。
2. **Change 不存在**：`session.get(Change, change_id)` 返回 `None` → 抛出 `ChangeNotFound`，包含 change_id 信息。调用方应捕获此异常。
3. **文档目录不存在/文档列表为空**：`ChangeDocument` 查询返回空列表，或 `_read_file_safe()` 文件路径无效 → 对应字段为 `None`，不报错。这是正常场景（变更刚创建时无文档）。
4. **spec_root 无效路径**：`SpecWorkspace` 行不存在 → `spec_root` 为 `None`。不报错，由下游 `SillySpecStageDispatchService` 和 adapter 决定如何处理。
5. **change.title 为 None**：`change_summary` fallback 到 `change.change_key`，保证 `change_summary` 永远非空。
6. **stage_dispatch=False 但其他字段有值**：对象正常创建，字段值被存储但不生效。运行时忽略由 adapter 层负责。
7. **向后兼容**：现有最小构造方式 `AgentSpecBundle(change_summary=..., task_key=..., task_title=...)` 不受影响，无需传新字段。

## 非目标

- 不测试 adapter（task-19 负责）
- 不测试 dispatch 服务（task-20 负责）
- 不测试 `build_spec_bundle()`（已有测试覆盖）
- 不测试 `render_bundle_to_claude_md()`（task-19 负责）
- 不修改任何源代码文件

## 参考

- `design.md` Phase 2 "扩展 AgentSpecBundle" + "构造阶段级 bundle"（第 123-191 行）
- `plan.md` task-18 定义（第 94 行）
- `task-02.md` — AgentSpecBundle 扩展的完整蓝图
- `task-05.md` — build_stage_bundle 的完整蓝图
- `TESTING.md` — 测试框架与约定
- `backend/app/modules/agent/base.py` — AgentSpecBundle dataclass
- `backend/app/modules/agent/context_builder.py` — build_spec_bundle 参考实现
- `backend/app/core/errors.py` — ChangeNotFound / WorkspaceNotFound
- `backend/tests/modules/agent/test_coordinator.py` — 测试风格参考
- `backend/tests/modules/change/test_dispatch.py` — mock 风格参考

## TDD 步骤

纯测试任务，不涉及源码修改。但测试依赖 task-02 和 task-05 的实现：

1. **先完成 task-02**：在 `base.py` 的 `AgentSpecBundle` 中新增 6 个 stage_dispatch 字段
2. **再完成 task-05**：在 `context_builder.py` 中新增 `build_stage_bundle()` 函数
3. **创建测试文件**：将本蓝图的"接口定义"中的完整测试代码写入 `backend/tests/test_agent_bundle.py`
4. **运行 A 区测试**：`pytest backend/tests/test_agent_bundle.py -k "stage_dispatch"` — 验证 bundle 字段
5. **运行 B/C/D 区测试**：`pytest backend/tests/test_agent_bundle.py -k "build_stage_bundle"` — 验证 build_stage_bundle
6. **运行全量测试**：`pytest backend/tests/test_agent_bundle.py` — 确认 12 个测试全部通过
7. **回归验证**：`pytest backend/tests/modules/agent/test_coordinator.py` — 确认现有测试不受影响

## 验收标准

| # | 验证步骤 | 通过标准 |
|---|---------|---------|
| AC-01 | `test_stage_dispatch_default_values` — 6 个字段默认值 | `stage_dispatch=False`, 其他为 `None`/`False` |
| AC-02 | `test_stage_dispatch_fields_explicitly_set` — 显式赋值 | 全部正确存储 |
| AC-03 | `test_build_stage_bundle_returns_valid_bundle` — 完整 bundle | `stage_dispatch=True`, `change_key`/`stage`/`spec_root` 正确，`proposal` 非空 |
| AC-04 | `test_build_stage_bundle_change_not_found` — Change 不存在 | 抛出 `ChangeNotFound` |
| AC-05 | `test_build_stage_bundle_workspace_not_found` — Workspace 不存在 | 抛出 `WorkspaceNotFound` |
| AC-06 | `test_build_stage_bundle_no_documents` — 无文档 | 不报错，文档字段全部为 `None` |
| AC-07 | `test_build_stage_bundle_no_spec_workspace` — 无 SpecWorkspace | `spec_root` 为 `None`，不报错 |
| AC-08 | `test_build_stage_bundle_title_none_fallback` — title 为 None | `change_summary == change.change_key` |
| AC-09 | `pytest backend/tests/test_agent_bundle.py` | 12 个测试全部绿色 |
| AC-10 | `pytest backend/tests/modules/agent/test_coordinator.py` | 现有测试无 breaking change |
