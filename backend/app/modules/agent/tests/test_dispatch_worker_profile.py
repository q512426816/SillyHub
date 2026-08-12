"""dispatch_worker 档案透传单测（task-08，2026-08-12-dispatch-bind-agent-profile，修 GAP-6）。

验证：``MissionExecutionService.dispatch_worker`` 在 ``run.agent_profile_id`` 非 None 时
补调 ``AgentService._apply_profile_to_lease``，把档案字段写进 worker lease.metadata（GAP-6
核心修复——原 dispatch_worker 从不调 apply_profile，worker 档案的 mcp/skill/凭证进不了 lease）。

- AC-01 绑了档案 → _apply_profile_to_lease 被调用（profile 从 DB 查到）。
- AC-02 没绑档案（run.agent_profile_id=None）→ _apply_profile_to_lease 不调用（零回归）。
- AC-03 档案被删（DB 查不到）→ worker run 标 failed（error_code=worker_profile_not_found），
  dispatch_worker 返回 lease_id（lease 已建，best-effort 不崩，主 agent 决策补派）。
"""

from __future__ import annotations

import uuid
from unittest.mock import AsyncMock, MagicMock

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.agent.execution import MissionExecutionService
from app.modules.agent.model import AgentMission, AgentRun
from app.modules.agent.profile.model import AgentProfile
from app.modules.workspace.model import Workspace


async def _make_workspace(session: AsyncSession) -> tuple[uuid.UUID, Workspace]:
    ws = Workspace(
        id=uuid.uuid4(),
        name="t",
        slug="t",
        root_path="/tmp/repo",
        default_branch="main",
        default_agent="claude_code",
        status="active",
    )
    session.add(ws)
    await session.commit()
    await session.refresh(ws)
    return ws.id, ws


async def _make_worker(
    session: AsyncSession,
    *,
    mission_id: uuid.UUID,
    agent_profile_id: uuid.UUID | None,
) -> AgentRun:
    run = AgentRun(
        mission_id=mission_id,
        agent_type="claude_code",
        status="pending",
        role="impl",
        objective="impl task",
        agent_profile_id=agent_profile_id,
    )
    session.add(run)
    await session.commit()
    await session.refresh(run)
    return run


def _svc_with_mocked_apply(db_session: AsyncSession, *, mock_apply: AsyncMock):
    """构造 MissionExecutionService，AgentService._apply_profile_to_lease 被 mock 拦截。"""
    fake_placement = MagicMock()
    fake_placement.dispatch_to_daemon = AsyncMock(return_value=uuid.uuid4())
    svc = MissionExecutionService(db_session, placement=fake_placement)
    # patch AgentService._apply_profile_to_lease（execution.py 内部 lazy import AgentService）
    return svc, fake_placement


@pytest.mark.asyncio
async def test_dispatch_worker_applies_profile_when_run_has_profile_id(
    db_session: AsyncSession, monkeypatch
) -> None:
    """AC-01：run 绑了档案 → 补调 _apply_profile_to_lease。"""
    ws_id, _ = await _make_workspace(db_session)
    profile = AgentProfile(
        id=uuid.uuid4(),
        name="worker-profile",
        owner_user_id=None,
        visibility="private",
        provider="claude",
        version=1,
    )
    db_session.add(profile)
    mission = AgentMission(workspace_id=ws_id, objective="o")
    db_session.add(mission)
    await db_session.commit()
    run = await _make_worker(db_session, mission_id=mission.id, agent_profile_id=profile.id)

    svc, _ = _svc_with_mocked_apply(db_session, mock_apply=AsyncMock())
    mock_apply = AsyncMock()
    monkeypatch.setattr(
        "app.modules.agent.service.AgentService._apply_profile_to_lease", mock_apply
    )

    lease_id = await svc.dispatch_worker(
        run, workspace_id=ws_id, user_id=uuid.uuid4(), read_only=False
    )

    assert lease_id is not None
    mock_apply.assert_awaited_once()
    # 传入的 lease_id 和 profile 正确
    call_kwargs = mock_apply.call_args
    assert call_kwargs.args[0] == lease_id or call_kwargs.kwargs.get("lease_id") == lease_id


@pytest.mark.asyncio
async def test_dispatch_worker_skips_apply_when_no_profile(
    db_session: AsyncSession, monkeypatch
) -> None:
    """AC-02：run 没绑档案 → _apply_profile_to_lease 不调用（零回归）。"""
    ws_id, _ = await _make_workspace(db_session)
    mission = AgentMission(workspace_id=ws_id, objective="o")
    db_session.add(mission)
    await db_session.commit()
    run = await _make_worker(db_session, mission_id=mission.id, agent_profile_id=None)

    svc, _ = _svc_with_mocked_apply(db_session, mock_apply=AsyncMock())
    mock_apply = AsyncMock()
    monkeypatch.setattr(
        "app.modules.agent.service.AgentService._apply_profile_to_lease", mock_apply
    )

    lease_id = await svc.dispatch_worker(
        run, workspace_id=ws_id, user_id=uuid.uuid4(), read_only=False
    )

    assert lease_id is not None
    mock_apply.assert_not_awaited()


@pytest.mark.asyncio
async def test_dispatch_worker_marks_failed_when_profile_deleted(
    db_session: AsyncSession, monkeypatch
) -> None:
    """AC-03：档案被删（DB 查不到）→ worker run 标 failed，lease 已建返回。"""
    ws_id, _ = await _make_workspace(db_session)
    mission = AgentMission(workspace_id=ws_id, objective="o")
    db_session.add(mission)
    await db_session.commit()
    # 指向一个不存在的 profile id
    run = await _make_worker(
        db_session,
        mission_id=mission.id,
        agent_profile_id=uuid.uuid4(),
    )

    svc, _ = _svc_with_mocked_apply(db_session, mock_apply=AsyncMock())
    mock_apply = AsyncMock()
    monkeypatch.setattr(
        "app.modules.agent.service.AgentService._apply_profile_to_lease", mock_apply
    )

    lease_id = await svc.dispatch_worker(
        run, workspace_id=ws_id, user_id=uuid.uuid4(), read_only=False
    )

    # lease 已建（dispatch_to_daemon 先成功），档案补写失败标 run failed，但 lease_id 仍返回
    assert lease_id is not None
    mock_apply.assert_not_awaited()  # profile 查不到，没走到 apply
    await db_session.refresh(run)
    assert run.status == "failed"
    assert run.error_code == "worker_profile_not_found"
