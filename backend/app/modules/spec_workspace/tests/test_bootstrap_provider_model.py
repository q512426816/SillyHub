"""Tests for spec-bootstrap provider/model propagation."""

from __future__ import annotations

import uuid
from pathlib import Path

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.agent.model import AgentRun
from app.modules.auth.model import User
from app.modules.spec_workspace import bootstrap as bootstrap_module
from app.modules.spec_workspace.model import SpecWorkspace
from app.modules.workspace.model import Workspace


async def _create_user(session: AsyncSession) -> User:
    uid = uuid.uuid4()
    user = User(
        id=uid,
        email=f"bootstrap-{uid}@example.com",
        password_hash="irrelevant",
        display_name="Bootstrap Test",
        status="active",
    )
    session.add(user)
    await session.commit()
    await session.refresh(user)
    return user


async def _create_workspace_with_spec(
    session: AsyncSession,
    tmp_path: Path,
    *,
    default_agent: str | None = None,
    default_model: str | None = None,
) -> tuple[Workspace, SpecWorkspace]:
    root_path = tmp_path / f"repo-{uuid.uuid4().hex[:8]}"
    root_path.mkdir(parents=True)
    (root_path / "package.json").write_text("{}", encoding="utf-8")

    workspace = Workspace(
        id=uuid.uuid4(),
        name="Bootstrap Workspace",
        slug=f"bootstrap-{uuid.uuid4().hex[:8]}",
        root_path=str(root_path),
        status="active",
        default_agent=default_agent,
        default_model=default_model,
    )
    session.add(workspace)
    await session.commit()
    await session.refresh(workspace)

    spec_workspace = SpecWorkspace(
        id=uuid.uuid4(),
        workspace_id=workspace.id,
        spec_root=str(tmp_path / f"spec-{workspace.id}"),
        strategy="platform-managed",
        profile_version="0.1.0",
        sync_status="clean",
    )
    session.add(spec_workspace)
    await session.commit()
    await session.refresh(spec_workspace)

    return workspace, spec_workspace


@pytest.mark.asyncio
async def test_bootstrap_persists_workspace_default_provider_model(
    db_session: AsyncSession,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    user = await _create_user(db_session)
    workspace, _ = await _create_workspace_with_spec(
        db_session,
        tmp_path,
        default_agent="codex",
        default_model="gpt-5-codex",
    )

    scheduled = []

    def _fake_create_task(coro):
        scheduled.append(coro)
        coro.close()
        return object()

    monkeypatch.setattr(bootstrap_module.asyncio, "create_task", _fake_create_task)

    result = await bootstrap_module.SpecBootstrapService(db_session).bootstrap(
        workspace.id,
        user_id=user.id,
    )

    run = await db_session.get(AgentRun, result["agent_run_id"])
    assert run is not None
    assert run.provider == "codex"
    assert run.model == "gpt-5-codex"
    assert len(scheduled) == 1


@pytest.mark.asyncio
async def test_bootstrap_dispatch_uses_run_provider_model(
    db_session: AsyncSession,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    user = await _create_user(db_session)
    workspace, spec_workspace = await _create_workspace_with_spec(
        db_session,
        tmp_path,
        default_agent="claude",
        default_model="claude-sonnet-4",
    )
    run = AgentRun(
        id=uuid.uuid4(),
        task_id=None,
        lease_id=None,
        agent_type="claude_code",
        provider="codex",
        model="gpt-5-codex",
        status="pending",
        spec_strategy=spec_workspace.strategy,
        profile_version=spec_workspace.profile_version,
    )
    db_session.add(run)
    await db_session.commit()
    await db_session.refresh(run)

    def _mock_factory():
        class _Ctx:
            async def __aenter__(self):
                return db_session

            async def __aexit__(self, *args):
                return None

        return _Ctx()

    captured: dict[str, object] = {}

    class _FakePlacement:
        def __init__(self, session: AsyncSession) -> None:
            self.session = session

        async def decide_backend(self, **kwargs):
            captured["decide"] = kwargs

        async def dispatch_to_daemon(self, agent_run_id, user_id, **kwargs):
            captured["agent_run_id"] = agent_run_id
            captured["user_id"] = user_id
            captured["dispatch"] = kwargs
            return uuid.uuid4()

    monkeypatch.setattr("app.core.db.get_session_factory", lambda: _mock_factory)
    monkeypatch.setattr("app.modules.agent.placement.RunPlacementService", _FakePlacement)
    monkeypatch.setattr(bootstrap_module, "_run_preflight", lambda _path: None)

    await bootstrap_module._execute_bootstrap_agent_run(
        run_id=run.id,
        workspace_id=workspace.id,
        user_id=user.id,
        spec_root=spec_workspace.spec_root,
        code_root=workspace.root_path,
    )

    dispatch = captured["dispatch"]
    assert isinstance(dispatch, dict)
    assert dispatch["provider"] == "codex"
    assert dispatch["model"] == "gpt-5-codex"
    assert dispatch["root_path"] == workspace.root_path
    assert dispatch["spec_root"] == spec_workspace.spec_root
