"""Tests for stage dispatch — tasks 04, 05, 06."""

import uuid
from unittest.mock import AsyncMock, MagicMock, patch

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


@pytest.mark.asyncio
async def test_execute_stage_run_bundle_contains_task_markdown_with_prompt():
    """_execute_stage_run 将 prompt 嵌入 bundle.task_markdown，不直接写 CLAUDE.md。"""
    from app.modules.agent.service import AgentService

    run_id = uuid.uuid4()
    fake_result = MagicMock()
    fake_result.exit_code = 0
    fake_result.stdout = "ok"
    fake_result.stderr = ""
    fake_result.redacted_output = "done"

    captured_bundle = None

    async def mock_run_with_bundle(rid, bundle, lease_path, timeout=600):
        nonlocal captured_bundle
        captured_bundle = bundle
        return fake_result

    # Mock session factory — _execute_stage_run imports get_session_factory locally
    mock_session = AsyncMock(spec=AsyncSession)
    agent_run_mock = MagicMock(
        id=run_id, status="pending", started_at=None,
        finished_at=None, exit_code=None, output_redacted=None,
        diff_summary=None,
    )
    change_mock = MagicMock(stages={})
    get_call_count = [0]

    async def _get(model, pk):
        get_call_count[0] += 1
        if get_call_count[0] <= 1:
            return agent_run_mock
        return change_mock

    mock_session.get = AsyncMock(side_effect=_get)
    mock_session.add = MagicMock()
    mock_session.commit = AsyncMock()
    mock_session.execute = AsyncMock()

    mock_factory = MagicMock()
    mock_factory.return_value.__aenter__ = AsyncMock(return_value=mock_session)
    mock_factory.return_value.__aexit__ = AsyncMock(return_value=False)

    with patch("app.core.db.get_session_factory", return_value=mock_factory):
        with patch(
            "app.modules.agent.adapters.claude_code.ClaudeCodeAdapter.run_with_bundle",
            side_effect=mock_run_with_bundle,
        ):
            with patch("app.modules.agent.service.AgentRunLog"):
                with patch("app.modules.workflow.model.AuditLog"):
                    svc = AgentService(AsyncMock(spec=AsyncSession))
                    await svc._execute_stage_run(
                        run_id=run_id,
                        prompt="你是一个 propose 阶段的执行者。",
                        work_dir=MagicMock(mkdir=MagicMock()),
                        read_only=True,
                        workspace_id=uuid.uuid4(),
                        change_id=uuid.uuid4(),
                        user_id=uuid.uuid4(),
                        stage="propose",
                    )

    # 验证 bundle 包含 task_markdown（含 prompt 和 READ-ONLY 模式标记）
    assert captured_bundle is not None
    assert "你是一个 propose 阶段的执行者。" in captured_bundle.task_markdown
    assert "READ-ONLY" in captured_bundle.task_markdown
    assert "Do NOT modify any files" in captured_bundle.task_markdown

    # 验证 platform_metadata 包含 stage 上下文
    assert captured_bundle.platform_metadata.get("stage_dispatch") is True
    assert captured_bundle.platform_metadata.get("stage") == "propose"
    assert captured_bundle.platform_metadata.get("read_only") is True


@pytest.mark.asyncio
async def test_execute_stage_run_bundle_write_mode():
    """_execute_stage_run 在 write 模式下 bundle.task_markdown 包含 WRITE 标记。"""
    from app.modules.agent.service import AgentService

    run_id = uuid.uuid4()
    fake_result = MagicMock()
    fake_result.exit_code = 0
    fake_result.stdout = "ok"
    fake_result.stderr = ""
    fake_result.redacted_output = "done"

    captured_bundle = None

    async def mock_run_with_bundle(rid, bundle, lease_path, timeout=600):
        nonlocal captured_bundle
        captured_bundle = bundle
        return fake_result

    mock_session = AsyncMock(spec=AsyncSession)
    agent_run_mock = MagicMock(
        id=run_id, status="pending", started_at=None,
        finished_at=None, exit_code=None, output_redacted=None,
        diff_summary=None,
    )
    change_mock = MagicMock(stages={})
    get_call_count = [0]

    async def _get(model, pk):
        get_call_count[0] += 1
        if get_call_count[0] <= 1:
            return agent_run_mock
        return change_mock

    mock_session.get = AsyncMock(side_effect=_get)
    mock_session.add = MagicMock()
    mock_session.commit = AsyncMock()
    mock_session.execute = AsyncMock()

    mock_factory = MagicMock()
    mock_factory.return_value.__aenter__ = AsyncMock(return_value=mock_session)
    mock_factory.return_value.__aexit__ = AsyncMock(return_value=False)

    with patch("app.core.db.get_session_factory", return_value=mock_factory):
        with patch(
            "app.modules.agent.adapters.claude_code.ClaudeCodeAdapter.run_with_bundle",
            side_effect=mock_run_with_bundle,
        ):
            with patch("app.modules.agent.service.AgentRunLog"):
                with patch("app.modules.workflow.model.AuditLog"):
                    svc = AgentService(AsyncMock(spec=AsyncSession))
                    await svc._execute_stage_run(
                        run_id=run_id,
                        prompt="Execute the plan phase.",
                        work_dir=MagicMock(mkdir=MagicMock()),
                        read_only=False,
                        workspace_id=uuid.uuid4(),
                        change_id=uuid.uuid4(),
                        user_id=uuid.uuid4(),
                        stage="plan",
                    )

    assert captured_bundle is not None
    assert "Execute the plan phase." in captured_bundle.task_markdown
    assert "WRITE" in captured_bundle.task_markdown
    assert "You may modify files" in captured_bundle.task_markdown


# ---------------------------------------------------------------------------
# Task-05 tests: build_stage_bundle()
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
    fake_workspace, fake_change, fake_spec_workspace, fake_change_doc,
):
    """build_stage_bundle 返回包含正确 stage 字段的 bundle。"""
    from app.modules.agent.context_builder import build_stage_bundle

    session = await _mock_session(
        fake_workspace, fake_change, fake_spec_workspace, [fake_change_doc],
    )
    bundle = await build_stage_bundle(
        session, fake_change.id, "propose", fake_workspace.id,
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
            session, uuid.uuid4(), "propose", fake_workspace.id,
        )


@pytest.mark.asyncio
async def test_build_stage_bundle_workspace_not_found():
    """Workspace 不存在时抛出 WorkspaceNotFound。"""
    from app.modules.agent.context_builder import build_stage_bundle

    session = AsyncMock(spec=AsyncSession)
    session.get = AsyncMock(return_value=None)

    with pytest.raises(WorkspaceNotFound):
        await build_stage_bundle(
            session, uuid.uuid4(), "propose", uuid.uuid4(),
        )


@pytest.mark.asyncio
async def test_build_stage_bundle_no_documents(
    fake_workspace, fake_change, fake_spec_workspace,
):
    """文档不存在时 bundle 的文档字段为 None，不报错。"""
    from app.modules.agent.context_builder import build_stage_bundle

    session = await _mock_session(
        fake_workspace, fake_change, fake_spec_workspace, [],
    )
    bundle = await build_stage_bundle(
        session, fake_change.id, "plan", fake_workspace.id,
    )

    assert bundle.proposal is None
    assert bundle.requirements is None
    assert bundle.design is None
    assert bundle.plan is None
    assert bundle.task_markdown is None
    assert bundle.stage_dispatch is True


@pytest.mark.asyncio
async def test_build_stage_bundle_no_spec_workspace(
    fake_workspace, fake_change,
):
    """SpecWorkspace 不存在时 spec_root 为 None，不报错。"""
    from app.modules.agent.context_builder import build_stage_bundle

    session = await _mock_session(
        fake_workspace, fake_change, None, [],
    )
    bundle = await build_stage_bundle(
        session, fake_change.id, "propose", fake_workspace.id,
    )

    assert bundle.spec_root is None
    assert bundle.stage_dispatch is True


@pytest.mark.asyncio
async def test_build_stage_bundle_with_step_prompt(
    fake_workspace, fake_change, fake_spec_workspace,
):
    """传入 step_prompt 时 bundle 正确包含。"""
    from app.modules.agent.context_builder import build_stage_bundle

    session = await _mock_session(
        fake_workspace, fake_change, fake_spec_workspace, [],
    )
    bundle = await build_stage_bundle(
        session, fake_change.id, "propose", fake_workspace.id,
        step_prompt="Write the proposal document for this change",
    )

    assert bundle.step_prompt == "Write the proposal document for this change"


@pytest.mark.asyncio
async def test_build_stage_bundle_read_only_true(
    fake_workspace, fake_change, fake_spec_workspace,
):
    """read_only=True 时 bundle 正确标记。"""
    from app.modules.agent.context_builder import build_stage_bundle

    session = await _mock_session(
        fake_workspace, fake_change, fake_spec_workspace, [],
    )
    bundle = await build_stage_bundle(
        session, fake_change.id, "scan", fake_workspace.id,
        read_only=True,
    )

    assert bundle.read_only is True


# ---------------------------------------------------------------------------
# Task-06 tests: _build_stage_dispatch_prompt
# ---------------------------------------------------------------------------


def test_stage_dispatch_prompt_contains_sillyspec_run_command():
    """stage_dispatch=True 时 prompt 包含 sillyspec run 命令。"""
    from app.modules.agent.adapters.claude_code import _build_stage_dispatch_prompt

    bundle = AgentSpecBundle(
        change_summary="test",
        task_key="stage:propose",
        task_title="Stage dispatch: propose",
        stage_dispatch=True,
        stage="propose",
        change_key="my-change",
    )
    result = _build_stage_dispatch_prompt(bundle)
    assert "sillyspec run propose --change my-change" in result


def test_stage_dispatch_prompt_contains_execution_steps():
    """prompt 包含执行步骤和 --done。"""
    from app.modules.agent.adapters.claude_code import _build_stage_dispatch_prompt

    bundle = AgentSpecBundle(
        change_summary="test",
        task_key="stage:plan",
        task_title="Stage dispatch: plan",
        stage_dispatch=True,
        stage="plan",
        change_key="x",
    )
    result = _build_stage_dispatch_prompt(bundle)
    assert "--done" in result
    assert "执行步骤" in result


def test_stage_dispatch_prompt_read_only_mode():
    """read_only=True 时 prompt 包含 READ-ONLY 模式说明。"""
    from app.modules.agent.adapters.claude_code import _build_stage_dispatch_prompt

    bundle = AgentSpecBundle(
        change_summary="test",
        task_key="stage:scan",
        task_title="Stage dispatch: scan",
        stage_dispatch=True,
        stage="scan",
        change_key="x",
        read_only=True,
    )
    result = _build_stage_dispatch_prompt(bundle)
    assert "READ-ONLY" in result
    assert "Do NOT modify any files" in result


def test_stage_dispatch_prompt_with_step_prompt():
    """step_prompt 不为 None 时 prompt 包含当前步骤 Prompt。"""
    from app.modules.agent.adapters.claude_code import _build_stage_dispatch_prompt

    bundle = AgentSpecBundle(
        change_summary="test",
        task_key="stage:propose",
        task_title="Stage dispatch: propose",
        stage_dispatch=True,
        stage="propose",
        change_key="x",
        step_prompt="请完成需求分析",
    )
    result = _build_stage_dispatch_prompt(bundle)
    assert "当前步骤 Prompt" in result
    assert "请完成需求分析" in result


def test_stage_dispatch_prompt_no_step_prompt():
    """step_prompt 为 None 时不包含当前步骤 Prompt 段落。"""
    from app.modules.agent.adapters.claude_code import _build_stage_dispatch_prompt

    bundle = AgentSpecBundle(
        change_summary="test",
        task_key="stage:propose",
        task_title="Stage dispatch: propose",
        stage_dispatch=True,
        stage="propose",
        change_key="x",
        step_prompt=None,
    )
    result = _build_stage_dispatch_prompt(bundle)
    assert "当前步骤 Prompt" not in result


def test_stage_dispatch_prompt_stage_none_fallback():
    """stage 为 None 时使用 unknown fallback。"""
    from app.modules.agent.adapters.claude_code import _build_stage_dispatch_prompt

    bundle = AgentSpecBundle(
        change_summary="test",
        task_key="stage:unknown",
        task_title="Stage dispatch: unknown",
        stage_dispatch=True,
        stage=None,
        change_key="x",
    )
    result = _build_stage_dispatch_prompt(bundle)
    assert "sillyspec run unknown --change x" in result
