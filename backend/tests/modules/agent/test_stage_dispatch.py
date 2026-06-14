"""Tests for stage dispatch — tasks 04, 05, 06."""

import uuid
from unittest.mock import AsyncMock, MagicMock

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import ChangeNotFound, WorkspaceNotFound
from app.modules.agent.base import AgentSpecBundle
from app.modules.change.model import Change, ChangeDocument
from app.modules.spec_workspace.model import SpecWorkspace
from app.modules.workspace.model import Workspace


# ---------------------------------------------------------------------------
# Task-04 tests: _execute_stage_run does NOT directly write CLAUDE.md
# ---------------------------------------------------------------------------
@pytest.fixture
def fake_workspace_id():
    return uuid.uuid4()


@pytest.fixture
def fake_change_id():
    return uuid.uuid4()


@pytest.fixture
def fake_workspace(fake_workspace_id):
    ws = MagicMock(spec=Workspace)
    ws.id = fake_workspace_id
    ws.name = "test-workspace"
    return ws


@pytest.fixture
def fake_change(fake_change_id, fake_workspace_id):
    change = MagicMock(spec=Change)
    change.id = fake_change_id
    change.workspace_id = fake_workspace_id
    change.change_key = "agent-stage-dispatch"
    change.title = "Agent Stage Dispatch"
    return change


@pytest.fixture
def fake_spec_workspace(fake_workspace_id):
    sw = MagicMock(spec=SpecWorkspace)
    sw.workspace_id = fake_workspace_id
    sw.spec_root = "/data/workspaces/test/.sillyspec"
    return sw


@pytest.fixture
def fake_change_doc(fake_change_id, tmp_path):
    doc = MagicMock(spec=ChangeDocument)
    doc.change_id = fake_change_id
    doc.doc_type = "proposal"
    proposal_file = tmp_path / "proposal.md"
    proposal_file.write_text("# Proposal\n\nTest proposal content")
    doc.path = str(proposal_file)
    doc.exists = True
    return doc


async def _mock_session(fake_workspace, fake_change, fake_spec_workspace, fake_change_docs):
    """构造一个 mock session，按 get/query 调用返回预设对象。"""
    session = AsyncMock(spec=AsyncSession)

    async def _get(model, pk):
        if model is Workspace:
            return fake_workspace
        if model is Change:
            return fake_change
        return None

    session.get = AsyncMock(side_effect=_get)

    # ChangeDocument 查询结果
    cd_scalars = MagicMock()
    cd_scalars.all = MagicMock(return_value=fake_change_docs)
    cd_result = MagicMock()
    cd_result.scalars = MagicMock(return_value=cd_scalars)

    # SpecWorkspace 查询结果
    sw_result = MagicMock()
    sw_result.scalar_one_or_none = MagicMock(return_value=fake_spec_workspace)

    # 通过 execute 调用顺序区分
    call_count = [0]

    async def _execute(stmt):
        call_count[0] += 1
        if call_count[0] == 1:
            return cd_result
        return sw_result

    session.execute = AsyncMock(side_effect=_execute)
    return session


@pytest.mark.asyncio
async def test_build_stage_bundle_returns_valid_bundle(
    fake_workspace,
    fake_change,
    fake_spec_workspace,
    fake_change_doc,
):
    """build_stage_bundle 返回包含正确 stage 字段的 bundle。"""
    from app.modules.agent.context_builder import build_stage_bundle

    session = await _mock_session(
        fake_workspace,
        fake_change,
        fake_spec_workspace,
        [fake_change_doc],
    )
    bundle = await build_stage_bundle(
        session,
        fake_change.id,
        "propose",
        fake_workspace.id,
    )

    assert isinstance(bundle, AgentSpecBundle)
    assert bundle.stage_dispatch is True
    assert bundle.change_key == "agent-stage-dispatch"
    assert bundle.stage == "propose"
    assert bundle.spec_root == "/data/workspaces/test/.sillyspec"
    assert bundle.proposal is not None
    assert "Test proposal content" in bundle.proposal
    assert bundle.read_only is False
    assert bundle.step_prompt is None


@pytest.mark.asyncio
async def test_build_stage_bundle_change_not_found(fake_workspace):
    """Change 不存在时抛出 ChangeNotFound。"""
    from app.modules.agent.context_builder import build_stage_bundle

    session = AsyncMock(spec=AsyncSession)

    async def _get(model, pk):
        if model is Workspace:
            return fake_workspace
        return None

    session.get = AsyncMock(side_effect=_get)

    with pytest.raises(ChangeNotFound):
        await build_stage_bundle(
            session,
            uuid.uuid4(),
            "propose",
            fake_workspace.id,
        )


@pytest.mark.asyncio
async def test_build_stage_bundle_workspace_not_found():
    """Workspace 不存在时抛出 WorkspaceNotFound。"""
    from app.modules.agent.context_builder import build_stage_bundle

    session = AsyncMock(spec=AsyncSession)
    session.get = AsyncMock(return_value=None)

    with pytest.raises(WorkspaceNotFound):
        await build_stage_bundle(
            session,
            uuid.uuid4(),
            "propose",
            uuid.uuid4(),
        )


@pytest.mark.asyncio
async def test_build_stage_bundle_no_documents(
    fake_workspace,
    fake_change,
    fake_spec_workspace,
):
    """文档不存在时 bundle 的文档字段为 None，不报错。"""
    from app.modules.agent.context_builder import build_stage_bundle

    session = await _mock_session(
        fake_workspace,
        fake_change,
        fake_spec_workspace,
        [],
    )
    bundle = await build_stage_bundle(
        session,
        fake_change.id,
        "plan",
        fake_workspace.id,
    )

    assert bundle.proposal is None
    assert bundle.requirements is None
    assert bundle.design is None
    assert bundle.plan is None
    assert bundle.task_markdown is None
    assert bundle.stage_dispatch is True


@pytest.mark.asyncio
async def test_build_stage_bundle_no_spec_workspace(
    fake_workspace,
    fake_change,
):
    """SpecWorkspace 不存在时 spec_root 为 None，不报错。"""
    from app.modules.agent.context_builder import build_stage_bundle

    session = await _mock_session(
        fake_workspace,
        fake_change,
        None,
        [],
    )
    bundle = await build_stage_bundle(
        session,
        fake_change.id,
        "propose",
        fake_workspace.id,
    )

    assert bundle.spec_root is None
    assert bundle.stage_dispatch is True


@pytest.mark.asyncio
async def test_build_stage_bundle_with_step_prompt(
    fake_workspace,
    fake_change,
    fake_spec_workspace,
):
    """传入 step_prompt 时 bundle 正确包含。"""
    from app.modules.agent.context_builder import build_stage_bundle

    session = await _mock_session(
        fake_workspace,
        fake_change,
        fake_spec_workspace,
        [],
    )
    bundle = await build_stage_bundle(
        session,
        fake_change.id,
        "propose",
        fake_workspace.id,
        step_prompt="Write the proposal document for this change",
    )

    assert bundle.step_prompt == "Write the proposal document for this change"


@pytest.mark.asyncio
async def test_build_stage_bundle_read_only_true(
    fake_workspace,
    fake_change,
    fake_spec_workspace,
):
    """read_only=True 时 bundle 正确标记。"""
    from app.modules.agent.context_builder import build_stage_bundle

    session = await _mock_session(
        fake_workspace,
        fake_change,
        fake_spec_workspace,
        [],
    )
    bundle = await build_stage_bundle(
        session,
        fake_change.id,
        "scan",
        fake_workspace.id,
        read_only=True,
    )

    assert bundle.read_only is True


# ---------------------------------------------------------------------------
# Task-06 tests: _build_stage_dispatch_prompt
# ---------------------------------------------------------------------------
