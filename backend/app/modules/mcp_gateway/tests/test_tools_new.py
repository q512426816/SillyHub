"""task-14 新增 3 个 MCP tool 的单测（list_agent_profiles / create_mission / get_run_logs）。

覆盖点（蓝图 task-14.md ``related_tests`` / acceptance）：

- 3 个 tool 都注册进 task-05 的 :data:`~app.modules.mcp_gateway.server.mcp` 实例
  （``tools/list`` 可见），inputSchema 不含 ``workspace_id``（由 middleware 注入）。
- ``create_mission`` 落 mission + 主 agent run，``created_by=token.created_by``
  （CC-05 / G-4 决议，McpToken 无独立 user）。
- ``get_run_logs`` 返 ``content_redacted`` 不返 ``content``（CC-09 对齐 model.py:401）。
- ``list_agent_profiles`` 返 ``tools_summary``。
- read（list_agent_profiles / get_run_logs）与 dispatch（create_mission）scope 越界
  抛 :class:`~app.core.errors.PermissionDenied`，**不触达 service 层**。

测试不真起 FastMCP HTTP 服务——直接构造 :class:`~mcp.server.fastmcp.Context`，把
``request.state.mcp_auth`` 挂上 :class:`McpAuthContext`（与 task-03 middleware 注入
同键），再直调 tool 函数。DB 走 conftest 的 in-memory SQLite（``get_session_factory``
已被 autouse fixture 重定向到测试引擎）。
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

import pytest
from mcp.server.fastmcp import Context
from mcp.shared.context import RequestContext
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.requests import Request

from app.core.errors import PermissionDenied
from app.core.security import password_hasher
from app.modules.agent.model import AgentMission, AgentRun, AgentRunLog
from app.modules.agent.profile.model import AgentProfile, AgentProfileVisibility
from app.modules.auth.model import User, UserWorkspaceRole
from app.modules.mcp_gateway import tools
from app.modules.mcp_gateway.auth import (
    MCP_AUTH_STATE_KEY,
    MCP_SCOPE_DISPATCH,
    MCP_SCOPE_READ,
    McpAuthContext,
)
from app.modules.mcp_gateway.model import McpTokenORM
from app.modules.mcp_gateway.server import mcp
from app.modules.workspace.model import Workspace

# ── 构造 helpers ─────────────────────────────────────────────────────────────


def _make_ctx(auth: McpAuthContext) -> Context:
    """构造带 mcp_auth 的 FastMCP Context（对齐 task-03 middleware 注入键）。"""
    req = Request({"type": "http", "headers": []})
    setattr(req.state, MCP_AUTH_STATE_KEY, auth)
    # session/lifespan_context 传 None（测试不经真 MCP session）；RequestContext 泛型
    # SessionT 不接受 None 字面，用 Any cast 满足 mypy（运行期 None 合法，spike 实测）。
    from typing import Any, cast

    rc = RequestContext(
        request_id=1,
        meta=None,
        session=cast(Any, None),
        lifespan_context=cast(Any, None),
        request=req,
    )
    return Context(request_context=rc)


async def _make_workspace(session: AsyncSession) -> Workspace:
    ws = Workspace(
        id=uuid.uuid4(),
        name=f"ws-{uuid.uuid4().hex[:6]}",
        slug=f"ws-{uuid.uuid4().hex[:6]}",
        root_path=f"/tmp/ws-{uuid.uuid4().hex[:8]}",
        status="active",
    )
    session.add(ws)
    await session.commit()
    await session.refresh(ws)
    return ws


async def _make_user(session: AsyncSession) -> User:
    user = User(
        id=uuid.uuid4(),
        email=f"user-{uuid.uuid4().hex[:6]}@example.com",
        password_hash=password_hasher.hash("x"),
        status="active",
        is_platform_admin=False,
    )
    session.add(user)
    await session.commit()
    await session.refresh(user)
    return user


async def _make_token(
    session: AsyncSession, *, workspace_id: uuid.UUID, created_by: uuid.UUID, scope: list[str]
) -> McpTokenORM:
    token = McpTokenORM(
        id=uuid.uuid4(),
        workspace_id=workspace_id,
        name="ci",
        token_hash=f"hash-{uuid.uuid4().hex}",
        scope=scope,
        created_by=created_by,
    )
    session.add(token)
    await session.commit()
    await session.refresh(token)
    return token


def _auth(token: McpTokenORM, scope: frozenset[str]) -> McpAuthContext:
    return McpAuthContext(workspace_id=token.workspace_id, scope=scope, token_id=token.id)


async def _make_mission(session: AsyncSession, workspace_id: uuid.UUID) -> AgentMission:
    mission = AgentMission(
        id=uuid.uuid4(),
        workspace_id=workspace_id,
        objective="obj",
    )
    session.add(mission)
    await session.commit()
    await session.refresh(mission)
    return mission


async def _make_run(session: AsyncSession, mission_id: uuid.UUID) -> AgentRun:
    run = AgentRun(
        id=uuid.uuid4(),
        mission_id=mission_id,
        agent_type="claude_code",
        status="running",
        role="worker",
        objective="work",
    )
    session.add(run)
    await session.commit()
    await session.refresh(run)
    return run


# ── 注册可见性 + inputSchema ──────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_three_new_tools_registered_with_expected_schema() -> None:
    registered = {t.name: t for t in await mcp.list_tools()}
    for name in ("list_agent_profiles", "create_mission", "get_run_logs"):
        assert name in registered, f"{name} 未注册进 mcp 实例"

    # workspace_id 一律不进 inputSchema（由 middleware 从 McpToken 注入，design §7.1）。
    for name in ("list_agent_profiles", "create_mission", "get_run_logs"):
        props = registered[name].inputSchema.get("properties", {})
        assert "workspace_id" not in props, f"{name} 不应暴露 workspace_id"

    # create_mission 业务参数进 schema；get_run_logs 带 limit/channel/mission_id/worker_id。
    cm_props = registered["create_mission"].inputSchema["properties"]
    assert "objective" in cm_props
    gl_props = registered["get_run_logs"].inputSchema["properties"]
    for field in ("mission_id", "worker_id", "limit", "channel"):
        assert field in gl_props, f"get_run_logs 缺 {field}"


# ── list_agent_profiles ───────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_list_agent_profiles_returns_tools_summary(db_session: AsyncSession) -> None:
    ws = await _make_workspace(db_session)
    user = await _make_user(db_session)
    # actor 是 workspace 成员，才能看到 workspace 级档。
    db_session.add(UserWorkspaceRole(user_id=user.id, workspace_id=ws.id, role_id=uuid.uuid4()))
    profile = AgentProfile(
        id=uuid.uuid4(),
        name="profile-a",
        owner_user_id=user.id,
        workspace_id=ws.id,
        visibility=AgentProfileVisibility.WORKSPACE,
        provider="claude",
        model="claude-opus",
        system_prompt="你是后端专家。\n第二行忽略。",
        mcp_refs=["fs"],
        skill_refs=["py"],
    )
    db_session.add(profile)
    await db_session.commit()

    token = await _make_token(
        db_session, workspace_id=ws.id, created_by=user.id, scope=[MCP_SCOPE_READ]
    )
    ctx = _make_ctx(_auth(token, frozenset({MCP_SCOPE_READ})))

    result = await tools.list_agent_profiles(ctx=ctx)
    names = [p["name"] for p in result["profiles"]]
    assert "profile-a" in names
    entry = next(p for p in result["profiles"] if p["name"] == "profile-a")
    assert entry["provider"] == "claude"
    assert entry["model"] == "claude-opus"
    assert entry["description"] == "你是后端专家。"
    # tools_summary 透出工具能力字段（mcp_refs/skill_refs/tool_policy_id）。
    assert entry["tools_summary"]["mcp_refs"] == ["fs"]
    assert entry["tools_summary"]["skill_refs"] == ["py"]
    assert entry["tools_summary"]["tool_policy_id"] is None


# ── create_mission ────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_create_mission_created_by_is_token_creator(db_session: AsyncSession) -> None:
    ws = await _make_workspace(db_session)
    user = await _make_user(db_session)
    token = await _make_token(
        db_session,
        workspace_id=ws.id,
        created_by=user.id,
        scope=[MCP_SCOPE_DISPATCH],
    )
    ctx = _make_ctx(_auth(token, frozenset({MCP_SCOPE_DISPATCH})))

    result = await tools.create_mission(objective="做个功能", ctx=ctx)
    assert result["mission_id"]
    assert result["main_run_id"]
    assert result["workers"][0]["role"] == "orchestrator"

    # CC-05 / G-4：mission.created_by = token.created_by（签发 token 的 user），不传 None。
    mission = await db_session.get(AgentMission, uuid.UUID(result["mission_id"]))
    assert mission is not None
    assert mission.created_by == user.id
    assert mission.workspace_id == ws.id


# ── get_run_logs ──────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_get_run_logs_returns_content_redacted_not_content(
    db_session: AsyncSession,
) -> None:
    ws = await _make_workspace(db_session)
    mission = await _make_mission(db_session, ws.id)
    run = await _make_run(db_session, mission.id)
    db_session.add(
        AgentRunLog(
            run_id=run.id,
            timestamp=datetime.now(UTC),
            channel="tool_call",
            content_redacted="[redacted] 调了 Read",
            tool_kind="Read",
        )
    )
    db_session.add(
        AgentRunLog(
            run_id=run.id,
            timestamp=datetime.now(UTC),
            channel="stdout",
            content_redacted="hello",
            tool_kind=None,
        )
    )
    await db_session.commit()

    token = await _make_token(
        db_session, workspace_id=ws.id, created_by=None, scope=[MCP_SCOPE_READ]
    )
    ctx = _make_ctx(_auth(token, frozenset({MCP_SCOPE_READ})))

    result = await tools.get_run_logs(mission_id=mission.id, worker_id=run.id, ctx=ctx)
    assert len(result["logs"]) == 2
    for entry in result["logs"]:
        # CC-09：只返 content_redacted，绝不返 content。
        assert "content_redacted" in entry
        assert "content" not in entry
        assert set(entry) == {"timestamp", "channel", "tool_kind", "content_redacted"}

    # channel 过滤生效。
    filtered = await tools.get_run_logs(
        mission_id=mission.id, worker_id=run.id, channel="tool_call", ctx=ctx
    )
    assert len(filtered["logs"]) == 1
    assert filtered["logs"][0]["channel"] == "tool_call"
    assert filtered["logs"][0]["tool_kind"] == "Read"


# ── scope 越界：抛 PermissionDenied，不触达 service ───────────────────────────


@pytest.mark.asyncio
async def test_read_tools_reject_without_read_scope(db_session: AsyncSession) -> None:
    ws = await _make_workspace(db_session)
    user = await _make_user(db_session)
    mission = await _make_mission(db_session, ws.id)
    run = await _make_run(db_session, mission.id)
    # token 只有 dispatch scope，调 read tool 应被拒。
    token = await _make_token(
        db_session, workspace_id=ws.id, created_by=user.id, scope=[MCP_SCOPE_DISPATCH]
    )
    ctx = _make_ctx(_auth(token, frozenset({MCP_SCOPE_DISPATCH})))

    with pytest.raises(PermissionDenied):
        await tools.list_agent_profiles(ctx=ctx)
    with pytest.raises(PermissionDenied):
        await tools.get_run_logs(mission_id=mission.id, worker_id=run.id, ctx=ctx)


@pytest.mark.asyncio
async def test_create_mission_rejects_without_dispatch_scope(db_session: AsyncSession) -> None:
    ws = await _make_workspace(db_session)
    user = await _make_user(db_session)
    # token 只有 read scope，调 dispatch tool 应被拒。
    token = await _make_token(
        db_session, workspace_id=ws.id, created_by=user.id, scope=[MCP_SCOPE_READ]
    )
    ctx = _make_ctx(_auth(token, frozenset({MCP_SCOPE_READ})))

    with pytest.raises(PermissionDenied):
        await tools.create_mission(objective="x", ctx=ctx)

    # 越界拒绝发生在触达 service 之前——不应落任何 mission。
    from sqlalchemy import select as _select

    rows = (await db_session.execute(_select(AgentMission))).scalars().all()
    assert all(m.workspace_id != ws.id or m.objective != "x" for m in rows)


# ── dispatch_worker 对外链路：FR-04 绑 profile + FR-06 落 read_only ──────────────
#
# QA acceptance 审查发现 FR-04 断裂：agent_profile_id 只落在内部 HTTP endpoint，
# 对外 MCP tool 的 dispatch_worker 缺该入参。本测试固化对外修复——传 profile +
# read_only 时 run 落 agent_profile_id / agent_profile_snapshot(含 version) /
# read_only 三字段（用治理门拒绝路径，避免真起 daemon）。


@pytest.mark.asyncio
async def test_dispatch_worker_binds_profile_and_writes_read_only(
    db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    from sqlalchemy import select as _select

    from app.modules.agent.control import MissionControlService

    ws = await _make_workspace(db_session)
    user = await _make_user(db_session)
    # actor 是 workspace 成员，才能对 workspace 级 profile 通过 visibility 校验。
    db_session.add(UserWorkspaceRole(user_id=user.id, workspace_id=ws.id, role_id=uuid.uuid4()))
    profile = AgentProfile(
        id=uuid.uuid4(),
        name="profile-binder",
        owner_user_id=user.id,
        workspace_id=ws.id,
        visibility=AgentProfileVisibility.WORKSPACE,
        provider="claude",
        model="claude-opus",
        system_prompt="你是后端专家。",
        version=7,
    )
    db_session.add(profile)
    await db_session.commit()
    mission = await _make_mission(db_session, ws.id)

    token = await _make_token(
        db_session, workspace_id=ws.id, created_by=user.id, scope=[MCP_SCOPE_DISPATCH]
    )
    ctx = _make_ctx(_auth(token, frozenset({MCP_SCOPE_DISPATCH})))

    # 避免真起 daemon / worktree：放行治理门（BE-P1-7 后拒绝直接抛 AppError、
    # 不再建 killed run），mock 掉 execution 层——run 构造时 profile + read_only
    # 即落，断言在此。
    async def _allow(self: MissionControlService, mission: AgentMission) -> tuple[bool, str]:
        return True, ""

    monkeypatch.setattr(MissionControlService, "can_dispatch_worker", _allow)

    # 未注解 def 合法（mypy strict=false，不检查未注解函数体）；原
    # `# type: ignore[no-untyped-def]` 永不触发（未开 disallow_untyped_defs），
    # warn_unused_ignores 下反而报 unused-ignore，已删。
    async def _no_exec(self, run, **kwargs):
        return None

    monkeypatch.setattr(
        "app.modules.mcp_gateway.tools.MissionExecutionService.dispatch_worker", _no_exec
    )

    result = await tools.dispatch_worker(
        mission_id=mission.id,
        objective="do",
        read_only=True,
        agent_profile_id=profile.id,
        ctx=ctx,
    )

    run = (
        await db_session.execute(_select(AgentRun).where(AgentRun.id == uuid.UUID(result["id"])))
    ).scalar_one()
    # FR-06：read_only 落审计列。
    assert run.read_only is True
    # FR-04：对外 MCP 链路绑 profile + 冻结快照（含 version）。
    assert run.agent_profile_id == profile.id
    assert run.agent_profile_snapshot is not None
    assert run.agent_profile_snapshot["id"] == str(profile.id)
    assert run.agent_profile_snapshot["version"] == 7
