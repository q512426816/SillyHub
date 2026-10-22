"""2026-10-21-agent-profile-slim-default task-02 补充（评审 P2）：群聊影子会话群主默认档案注入。

直测 ``_ensure_shadow_session``：成员未显式选档案 + 群主设了用户级默认档案 →
影子会话与首轮 run 的 ``agent_profile_id`` 落默认档案 id；群主未设默认 → 维持
None（现状零回归）。dispatch 链 mock（RunPlacementService 假实例），不走真实
placement / WS。
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.agent.model import AgentRun
from app.modules.agent.profile.model import AgentProfile, AgentProfileVisibility
from app.modules.auth.model import User
from app.modules.daemon.group.service.shadow import _ensure_shadow_session
from app.modules.daemon.model import DaemonRuntime
from app.modules.workspace.model import Workspace


async def _mk_user(session: AsyncSession, label: str) -> User:
    u = User(
        id=uuid.uuid4(),
        email=f"gdp-{label}-{uuid.uuid4()}@example.com",
        password_hash="x",
        status="active",
    )
    session.add(u)
    await session.flush()
    return u


async def _mk_ws(session: AsyncSession, owner: User) -> Workspace:
    ws = Workspace(
        id=uuid.uuid4(),
        name="群默认档案工作区",
        slug=f"gdp-{uuid.uuid4().hex[:8]}",
        created_by=owner.id,
        root_path="C:/gdp-root",
        status="active",
    )
    session.add(ws)
    await session.flush()
    return ws


async def _mk_group_and_member(
    session: AsyncSession,
    owner: User,
    ws: Workspace,
    *,
    with_profile: bool,
) -> tuple:
    from app.modules.agent.model import AgentGroupChat, AgentGroupMember

    rt = DaemonRuntime(
        id=uuid.uuid4(),
        user_id=owner.id,
        name="Claude Code",
        provider="claude",
        status="online",
        last_heartbeat_at=datetime.now(UTC),
    )
    session.add(rt)
    group = AgentGroupChat(
        id=uuid.uuid4(),
        # 群时间线会话 1:1 载体 id（test_group_consensus 同范式，不建真实会话行）。
        session_id=uuid.uuid4(),
        title="默认档案群",
        workspace_id=ws.id,
        project_id=None,
        created_by=owner.id,
        created_at=datetime.now(UTC),
    )
    session.add(group)
    member = AgentGroupMember(
        id=uuid.uuid4(),
        group_id=group.id,
        member_type="agent",
        display_name="小码",
        runtime_id=rt.id,
        workspace_id=ws.id,
        provider="claude",
        agent_profile_id=(uuid.uuid4() if with_profile else None),
        team_enabled=False,
        shadow_status="none",
        invited_by=owner.id,
        joined_at=datetime.now(UTC),
    )
    session.add(member)
    await session.flush()
    return group, member


@pytest.mark.asyncio
async def test_shadow_without_member_profile_uses_owner_default(db_session):
    """成员未选档案 + 群主默认 → 影子/首轮 run 归属默认档案。"""
    owner = await _mk_user(db_session, "owner")
    ws = await _mk_ws(db_session, owner)
    profile = AgentProfile(
        id=uuid.uuid4(),
        name="群主默认人格",
        owner_user_id=owner.id,
        visibility=AgentProfileVisibility.PRIVATE,
        provider="claude",
        system_prompt="你是群默认助手",
        skill_refs=["s1"],
        mcp_refs=[],
    )
    db_session.add(profile)
    owner.default_agent_profile_id = profile.id
    group, member = await _mk_group_and_member(db_session, owner, ws, with_profile=False)
    await db_session.commit()

    fake_placement = SimpleNamespace(
        notify_interactive_dispatch=AsyncMock(),
        prepare_interactive_dispatch=AsyncMock(
            return_value=SimpleNamespace(
                lease_id=uuid.uuid4(),
                runtime_id=member.runtime_id,
                claim_token="tok",
            )
        ),
    )
    fake_svc = SimpleNamespace(
        _session=db_session,
        _send_shadow_first_inject=AsyncMock(),
    )
    with (
        patch(
            "app.modules.agent.placement.RunPlacementService",
            return_value=fake_placement,
        ),
        patch(
            "app.modules.daemon.group.service.shadow._publish_group_channel_event",
            new=AsyncMock(),
        ),
    ):
        shadow, first_run_id = await _ensure_shadow_session(
            fake_svc,
            group,
            member,
            first_prompt="hi",
            first_turn_metadata={},
        )

    assert shadow.agent_profile_id == profile.id
    run = await db_session.get(AgentRun, first_run_id)
    assert run is not None
    assert run.agent_profile_id == profile.id
    assert run.agent_profile_snapshot is not None
    assert run.agent_profile_snapshot["system_prompt"] == "你是群默认助手"


@pytest.mark.asyncio
async def test_shadow_no_default_keeps_none(db_session):
    """成员未选档案 + 群主未设默认 → 影子归属 None（现状零回归）。"""
    owner = await _mk_user(db_session, "owner2")
    ws = await _mk_ws(db_session, owner)
    group, member = await _mk_group_and_member(db_session, owner, ws, with_profile=False)
    await db_session.commit()

    fake_placement = SimpleNamespace(
        notify_interactive_dispatch=AsyncMock(),
        prepare_interactive_dispatch=AsyncMock(
            return_value=SimpleNamespace(
                lease_id=uuid.uuid4(),
                runtime_id=member.runtime_id,
                claim_token="tok",
            )
        ),
    )
    fake_svc = SimpleNamespace(
        _session=db_session,
        _send_shadow_first_inject=AsyncMock(),
    )
    with (
        patch(
            "app.modules.agent.placement.RunPlacementService",
            return_value=fake_placement,
        ),
        patch(
            "app.modules.daemon.group.service.shadow._publish_group_channel_event",
            new=AsyncMock(),
        ),
    ):
        shadow, _first_run_id = await _ensure_shadow_session(
            fake_svc,
            group,
            member,
            first_prompt="hi",
            first_turn_metadata={},
        )

    assert shadow.agent_profile_id is None
