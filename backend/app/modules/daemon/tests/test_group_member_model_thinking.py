"""群成员 model/thinking_level 存储与影子派发透传（2026-11-02-group-member-footer-config）。

FR-03 后端面：
- 影子创建首 run 携带成员所选具体模型（AgentRun.model 直传）；思考等级经
  prepare_interactive_dispatch(thinking_level=...) 写 lease metadata（同
  session create task-05 FR-03 先例）；
- 未指定（NULL）维持现状兜底（run.model None / thinking_level None），零回归；
- config_snapshot 组装语义修正：model 键存真实所选模型名（未指定不落键）、
  新增 provider_name 承载供应商名（不再以供应商名冒充模型名）。

夹具范式镜像 test_group_default_profile.py（_mk_user/_mk_ws/_mk_group_and_member）。
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.agent.model import AgentRun
from app.modules.auth.model import User
from app.modules.daemon.group.service.helpers import _build_config_snapshot
from app.modules.daemon.group.service.shadow import _ensure_shadow_session
from app.modules.daemon.model import DaemonRuntime
from app.modules.workspace.model import Workspace


async def _mk_user(session: AsyncSession, label: str) -> User:
    u = User(
        id=uuid.uuid4(),
        email=f"gmt-{label}-{uuid.uuid4()}@example.com",
        password_hash="x",
        status="active",
    )
    session.add(u)
    await session.flush()
    return u


async def _mk_ws(session: AsyncSession, owner: User) -> Workspace:
    ws = Workspace(
        id=uuid.uuid4(),
        name="成员模型档位工作区",
        slug=f"gmt-{uuid.uuid4().hex[:8]}",
        created_by=owner.id,
        root_path="C:/gmt-root",
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
    model: str | None,
    thinking_level: str | None,
) -> tuple:
    from app.modules.agent.model import AgentGroupChat, AgentGroupMember

    rt = DaemonRuntime(
        id=uuid.uuid4(),
        user_id=owner.id,
        name="成员模型机器",
        provider="claude",
        status="online",
        last_heartbeat_at=datetime.now(UTC),
    )
    session.add(rt)
    group = AgentGroupChat(
        id=uuid.uuid4(),
        session_id=uuid.uuid4(),
        title="成员模型档位群",
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
        display_name="小模",
        runtime_id=rt.id,
        workspace_id=ws.id,
        provider="claude",
        llm_provider_id=None,
        model=model,
        thinking_level=thinking_level,
        team_enabled=False,
        shadow_status="none",
        invited_by=owner.id,
        joined_at=datetime.now(UTC),
    )
    session.add(member)
    await session.flush()
    return group, member


def _fake_placement(member_runtime_id: uuid.UUID) -> SimpleNamespace:
    return SimpleNamespace(
        notify_interactive_dispatch=AsyncMock(),
        prepare_interactive_dispatch=AsyncMock(
            return_value=SimpleNamespace(
                lease_id=uuid.uuid4(),
                runtime_id=member_runtime_id,
                claim_token="tok",
            )
        ),
    )


def _patch_env(fake_placement: SimpleNamespace):
    return (
        patch(
            "app.modules.agent.placement.RunPlacementService",
            return_value=fake_placement,
        ),
        patch(
            "app.modules.daemon.group.service.shadow._publish_group_channel_event",
            new=AsyncMock(),
        ),
    )


@pytest.mark.asyncio
async def test_shadow_member_model_and_thinking_dispatched(db_session):
    """成员指定 model/thinking_level → 首 run 携模型、派发透传档位（FR-03）。"""
    owner = await _mk_user(db_session, "m1")
    ws = await _mk_ws(db_session, owner)
    group, member = await _mk_group_and_member(
        db_session, owner, ws, model="deepseek-v4.1-flash", thinking_level="max"
    )
    await db_session.commit()

    fake_placement = _fake_placement(member.runtime_id)
    with _patch_env(fake_placement)[0], _patch_env(fake_placement)[1]:
        _shadow, first_run_id = await _ensure_shadow_session(
            SimpleNamespace(_session=db_session, _send_shadow_first_inject=AsyncMock()),
            group,
            member,
            first_prompt="hi",
            first_turn_metadata={},
        )

    run = await db_session.get(AgentRun, first_run_id)
    assert run is not None
    assert run.model == "deepseek-v4.1-flash"
    # 思考等级经 prepare_interactive_dispatch 写 lease metadata（task-05 先例）。
    kwargs = fake_placement.prepare_interactive_dispatch.await_args.kwargs
    assert kwargs.get("thinking_level") == "max"
    assert kwargs.get("model") == "deepseek-v4.1-flash"


@pytest.mark.asyncio
async def test_shadow_member_unset_keeps_fallback(db_session):
    """成员未指定（NULL）→ run.model None、thinking_level None（现状零回归）。"""
    owner = await _mk_user(db_session, "m2")
    ws = await _mk_ws(db_session, owner)
    group, member = await _mk_group_and_member(
        db_session, owner, ws, model=None, thinking_level=None
    )
    await db_session.commit()

    fake_placement = _fake_placement(member.runtime_id)
    with _patch_env(fake_placement)[0], _patch_env(fake_placement)[1]:
        _shadow, first_run_id = await _ensure_shadow_session(
            SimpleNamespace(_session=db_session, _send_shadow_first_inject=AsyncMock()),
            group,
            member,
            first_prompt="hi",
            first_turn_metadata={},
        )

    run = await db_session.get(AgentRun, first_run_id)
    assert run is not None
    assert run.model is None
    kwargs = fake_placement.prepare_interactive_dispatch.await_args.kwargs
    assert kwargs.get("thinking_level") is None
    assert kwargs.get("model") is None


def test_build_config_snapshot_model_semantics():
    """快照语义修正：model=真实所选模型名（未指定不落键）；供应商名走 provider_name。"""
    runtime = SimpleNamespace(id=uuid.uuid4(), name="rt-name")
    instance = SimpleNamespace(display_alias="小码机", hostname="host-1")
    llm = SimpleNamespace(name="OpenCode Go")
    profile = SimpleNamespace(name="极速人格")

    # 指定模型：model 键=真实模型名；provider_name 键=供应商名（语义分离）。
    snap = _build_config_snapshot(
        runtime=runtime,
        instance=instance,
        provider="claude",
        profile=profile,
        llm=llm,
        model="deepseek-v4.1-flash",
        thinking_level="max",
    )
    assert snap["model"] == "deepseek-v4.1-flash"
    assert snap["thinking_level"] == "max"
    assert snap["provider_name"] == "OpenCode Go"
    assert snap["profile_name"] == "极速人格"

    # 未指定：不落 model/thinking_level 键（消费方走兜底），供应商名仍在。
    snap2 = _build_config_snapshot(
        runtime=runtime,
        instance=instance,
        provider="claude",
        profile=None,
        llm=llm,
        model=None,
        thinking_level=None,
    )
    assert "model" not in snap2
    assert "thinking_level" not in snap2
    assert snap2["provider_name"] == "OpenCode Go"
