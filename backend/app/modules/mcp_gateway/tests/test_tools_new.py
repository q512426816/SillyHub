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


# ── get_daemon_status（spike P1-3，2026-09-10）：派发前在线性轻量查询 ────────────


class _StubWsHub:
    """ws_hub 替身：只实现 is_connected（tool 消费面），按预置集合返回。"""

    def __init__(self, connected: set[uuid.UUID]) -> None:
        self._connected = connected

    def is_connected(self, daemon_id: uuid.UUID) -> bool:
        return daemon_id in self._connected


async def _make_binding(
    session: AsyncSession,
    *,
    workspace_id: uuid.UUID,
    user_id: uuid.UUID,
    daemon_id: uuid.UUID,
) -> None:
    from app.modules.workspace.member_runtimes.model import WorkspaceMemberRuntime

    session.add(
        WorkspaceMemberRuntime(
            workspace_id=workspace_id,
            user_id=user_id,
            daemon_id=daemon_id,
            root_path="/tmp/ws",
            path_source="manual",
        )
    )
    await session.commit()


async def _make_daemon(
    session: AsyncSession,
    *,
    user_id: uuid.UUID,
    status: str = "online",
    last_heartbeat_at: datetime | None = None,
) -> uuid.UUID:
    from app.modules.daemon.model import DaemonInstance

    daemon_id = uuid.uuid4()
    session.add(
        DaemonInstance(
            id=daemon_id,
            user_id=user_id,
            hostname="dev-box",
            display_alias="开发机",
            server_url="http://127.0.0.1:8001",
            status=status,
            last_heartbeat_at=last_heartbeat_at,
        )
    )
    await session.commit()
    return daemon_id


async def _make_runtime(
    session: AsyncSession,
    *,
    user_id: uuid.UUID,
    daemon_instance_id: uuid.UUID,
    provider: str,
    status: str = "online",
    version: str | None = None,
) -> None:
    """task-06（2026-09-10-review-dispatch-platform-fixes）：daemon 下挂一条 runtime 行。

    DaemonRuntime 一行 = 某 daemon 实体下的一种 provider（model.py:200）；
    get_daemon_status 的 ``providers`` 聚合只收 ``status=='online'`` 的行。
    """
    from app.modules.daemon.model import DaemonRuntime

    session.add(
        DaemonRuntime(
            user_id=user_id,
            daemon_instance_id=daemon_instance_id,
            provider=provider,
            status=status,
            version=version,
        )
    )
    await session.commit()


@pytest.mark.asyncio
async def test_get_daemon_status_registered_without_workspace_id() -> None:
    registered = {t.name: t for t in await mcp.list_tools()}
    assert "get_daemon_status" in registered, "get_daemon_status 未注册进 mcp 实例"
    assert "workspace_id" not in registered["get_daemon_status"].inputSchema.get("properties", {})


@pytest.mark.asyncio
async def test_get_daemon_status_no_bindings_reports_offline(db_session: AsyncSession) -> None:
    ws = await _make_workspace(db_session)
    user = await _make_user(db_session)
    token = await _make_token(
        db_session, workspace_id=ws.id, created_by=user.id, scope=[MCP_SCOPE_READ]
    )
    ctx = _make_ctx(_auth(token, frozenset({MCP_SCOPE_READ})))

    result = await tools.get_daemon_status(ctx=ctx)
    assert result["workspace_id"] == str(ws.id)
    assert result["daemon_online"] is False
    assert result["daemons"] == []
    assert result["daemon_name"] is None
    # task-06（FR-04 / D-003@v1）：无 binding → 无 daemon 也无 provider 可判。
    assert result["default_agent"] is None
    assert result["effective_agent"] is None


@pytest.mark.asyncio
async def test_get_daemon_status_online_binding_aggregates_true(
    db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    ws = await _make_workspace(db_session)
    user = await _make_user(db_session)
    daemon_id = await _make_daemon(db_session, user_id=user.id, last_heartbeat_at=datetime.now(UTC))
    await _make_binding(db_session, workspace_id=ws.id, user_id=user.id, daemon_id=daemon_id)
    monkeypatch.setattr(
        "app.modules.daemon.ws_hub.get_daemon_ws_hub", lambda: _StubWsHub({daemon_id})
    )

    token = await _make_token(
        db_session, workspace_id=ws.id, created_by=user.id, scope=[MCP_SCOPE_READ]
    )
    ctx = _make_ctx(_auth(token, frozenset({MCP_SCOPE_READ})))

    result = await tools.get_daemon_status(ctx=ctx)
    assert result["daemon_online"] is True
    assert result["daemon_name"] == "开发机"
    assert result["stale_threshold_seconds"] == 45
    entry = result["daemons"][0]
    assert entry["online"] is True
    assert entry["ws_connected"] is True
    assert entry["status"] == "online"
    assert entry["heartbeat_age_seconds"] is not None and entry["heartbeat_age_seconds"] <= 45
    # task-06 纯增量键：default_agent 原值透传（未配置 None）；daemon 在线但无
    # runtime 行 → providers 空、effective_agent 无 provider 可判回 None。
    assert result["default_agent"] is None
    assert entry["providers"] == []
    assert result["effective_agent"] is None


@pytest.mark.asyncio
async def test_get_daemon_status_stale_or_offline_not_online(db_session: AsyncSession) -> None:
    from datetime import timedelta

    ws = await _make_workspace(db_session)
    user = await _make_user(db_session)
    user2 = await _make_user(db_session)
    # 心跳过期（status 仍 online）：DB 假在线窗口，online 判 False。
    stale_id = await _make_daemon(
        db_session,
        user_id=user.id,
        last_heartbeat_at=datetime.now(UTC) - timedelta(minutes=5),
    )
    await _make_binding(db_session, workspace_id=ws.id, user_id=user.id, daemon_id=stale_id)
    # status=offline：明确离线（binding PK 是 (ws,user)，用第二个成员挂第二条）。
    offline_id = await _make_daemon(db_session, user_id=user2.id, status="offline")
    await _make_binding(db_session, workspace_id=ws.id, user_id=user2.id, daemon_id=offline_id)

    token = await _make_token(
        db_session, workspace_id=ws.id, created_by=user.id, scope=[MCP_SCOPE_READ]
    )
    ctx = _make_ctx(_auth(token, frozenset({MCP_SCOPE_READ})))

    result = await tools.get_daemon_status(ctx=ctx)
    assert result["daemon_online"] is False
    assert all(e["online"] is False for e in result["daemons"])
    # 明细仍透出（调用方可看 status / heartbeat_age 自判）。
    assert {e["status"] for e in result["daemons"]} == {"online", "offline"}
    # task-06 纯增量键：无 online 项 → effective_agent None（default_agent 未配置）。
    assert result["default_agent"] is None
    assert result["effective_agent"] is None
    assert all(e["providers"] == [] for e in result["daemons"])


@pytest.mark.asyncio
async def test_get_daemon_status_rejects_without_read_scope(db_session: AsyncSession) -> None:
    ws = await _make_workspace(db_session)
    user = await _make_user(db_session)
    token = await _make_token(
        db_session, workspace_id=ws.id, created_by=user.id, scope=[MCP_SCOPE_DISPATCH]
    )
    ctx = _make_ctx(_auth(token, frozenset({MCP_SCOPE_DISPATCH})))

    with pytest.raises(PermissionDenied):
        await tools.get_daemon_status(ctx=ctx)


# ── get_daemon_status task-06 新键：default_agent / effective_agent / providers ─
#
# change 2026-09-10-review-dispatch-platform-fixes（FR-04 / D-003@v1）：派发前一次
# 查询即可判「会用哪个执行器、哪些机器在线」。三键口径见 tools.py docstring——
# providers 仅聚合 online runtime；effective_agent 是「调用方可判」信号非权威解析
# （权威以派发时 placement 实算为准），顺序 = daemons 返回序（无额外 ORDER BY）。


@pytest.mark.asyncio
async def test_get_daemon_status_default_agent_set_passthrough(
    db_session: AsyncSession,
) -> None:
    """workspace.default_agent 已设：原值透传，effective_agent 直取它（不回退）。"""
    ws = await _make_workspace(db_session)
    ws.default_agent = "pi"
    user = await _make_user(db_session)
    daemon_id = await _make_daemon(db_session, user_id=user.id, last_heartbeat_at=datetime.now(UTC))
    await _make_binding(db_session, workspace_id=ws.id, user_id=user.id, daemon_id=daemon_id)
    # 即便首个 online provider 是 claude，default_agent 已设即直传（口径：非空即它）。
    await _make_runtime(
        db_session, user_id=user.id, daemon_instance_id=daemon_id, provider="claude"
    )

    token = await _make_token(
        db_session, workspace_id=ws.id, created_by=user.id, scope=[MCP_SCOPE_READ]
    )
    ctx = _make_ctx(_auth(token, frozenset({MCP_SCOPE_READ})))

    result = await tools.get_daemon_status(ctx=ctx)
    assert result["default_agent"] == "pi"
    assert result["effective_agent"] == "pi"


@pytest.mark.asyncio
async def test_get_daemon_status_effective_agent_first_online_provider(
    db_session: AsyncSession,
) -> None:
    """default_agent 为空：effective_agent 取返回序首个 online 项的首个 provider。

    两台 daemon 都 online：首个绑定（SQLite rowid 序 = 插入序）挂 pi 在前，
    effective_agent 必须是 pi 而非第二台的 claude——固化「首个 online 项」口径。
    """
    ws = await _make_workspace(db_session)
    user = await _make_user(db_session)
    daemon1 = await _make_daemon(db_session, user_id=user.id, last_heartbeat_at=datetime.now(UTC))
    await _make_runtime(db_session, user_id=user.id, daemon_instance_id=daemon1, provider="pi")
    await _make_runtime(db_session, user_id=user.id, daemon_instance_id=daemon1, provider="claude")
    await _make_binding(db_session, workspace_id=ws.id, user_id=user.id, daemon_id=daemon1)

    user2 = await _make_user(db_session)
    daemon2 = await _make_daemon(db_session, user_id=user2.id, last_heartbeat_at=datetime.now(UTC))
    await _make_runtime(db_session, user_id=user2.id, daemon_instance_id=daemon2, provider="claude")
    await _make_binding(db_session, workspace_id=ws.id, user_id=user2.id, daemon_id=daemon2)

    token = await _make_token(
        db_session, workspace_id=ws.id, created_by=user.id, scope=[MCP_SCOPE_READ]
    )
    ctx = _make_ctx(_auth(token, frozenset({MCP_SCOPE_READ})))

    result = await tools.get_daemon_status(ctx=ctx)
    assert result["default_agent"] is None
    assert result["effective_agent"] == "pi"
    # 首个 online 项两 provider 都透出（providers[0] 即 effective 来源）。
    first_entry = result["daemons"][0]
    assert [p["provider"] for p in first_entry["providers"]] == ["pi", "claude"]


@pytest.mark.asyncio
async def test_get_daemon_status_providers_grouped_and_online_only(
    db_session: AsyncSession,
) -> None:
    """providers 按 daemon 分组、只含 online runtime；version 透传（可 None）。

    daemon1 挂 pi(online)+codex(offline)：offline 被过滤；daemon2 挂
    claude(online, version None)：跨 daemon 不串组。
    """
    ws = await _make_workspace(db_session)
    user = await _make_user(db_session)
    daemon1 = await _make_daemon(db_session, user_id=user.id, last_heartbeat_at=datetime.now(UTC))
    await _make_runtime(
        db_session,
        user_id=user.id,
        daemon_instance_id=daemon1,
        provider="pi",
        version="1.42.0",
    )
    await _make_runtime(
        db_session,
        user_id=user.id,
        daemon_instance_id=daemon1,
        provider="codex",
        status="offline",
        version="0.9.0",
    )
    await _make_binding(db_session, workspace_id=ws.id, user_id=user.id, daemon_id=daemon1)

    user2 = await _make_user(db_session)
    daemon2 = await _make_daemon(db_session, user_id=user2.id, last_heartbeat_at=datetime.now(UTC))
    await _make_runtime(db_session, user_id=user2.id, daemon_instance_id=daemon2, provider="claude")
    await _make_binding(db_session, workspace_id=ws.id, user_id=user2.id, daemon_id=daemon2)

    token = await _make_token(
        db_session, workspace_id=ws.id, created_by=user.id, scope=[MCP_SCOPE_READ]
    )
    ctx = _make_ctx(_auth(token, frozenset({MCP_SCOPE_READ})))

    result = await tools.get_daemon_status(ctx=ctx)
    entries = {e["daemon_id"]: e for e in result["daemons"]}
    entry1 = entries[str(daemon1)]
    entry2 = entries[str(daemon2)]
    # 分组正确：各 daemon 只含自己的 runtime；offline codex 被过滤；元素三键齐全。
    assert [p["provider"] for p in entry1["providers"]] == ["pi"]
    assert entry1["providers"][0]["status"] == "online"
    assert entry1["providers"][0]["version"] == "1.42.0"
    assert [p["provider"] for p in entry2["providers"]] == ["claude"]
    assert entry2["providers"][0]["version"] is None
    assert set(entry1["providers"][0]) == {"provider", "status", "version"}


@pytest.mark.asyncio
async def test_get_daemon_status_online_daemon_without_online_runtimes(
    db_session: AsyncSession,
) -> None:
    """daemon 实体 online 但无 online runtime：providers 空、effective_agent None。

    固化口径（task-06 acceptance）：effective_agent 取「首个 online 项 providers[0]
    的 provider」——该 online 项 providers 为空即 None（不扫后续 online 项，
    非权威解析见 docstring）。
    """
    ws = await _make_workspace(db_session)
    user = await _make_user(db_session)
    daemon_id = await _make_daemon(db_session, user_id=user.id, last_heartbeat_at=datetime.now(UTC))
    # runtime 行 status=offline：daemon 实体 online 但无可用 provider。
    await _make_runtime(
        db_session, user_id=user.id, daemon_instance_id=daemon_id, provider="pi", status="offline"
    )
    await _make_binding(db_session, workspace_id=ws.id, user_id=user.id, daemon_id=daemon_id)

    token = await _make_token(
        db_session, workspace_id=ws.id, created_by=user.id, scope=[MCP_SCOPE_READ]
    )
    ctx = _make_ctx(_auth(token, frozenset({MCP_SCOPE_READ})))

    result = await tools.get_daemon_status(ctx=ctx)
    assert result["daemons"][0]["online"] is True
    assert result["daemons"][0]["providers"] == []
    assert result["default_agent"] is None
    assert result["effective_agent"] is None


# ── no-creator 报错（spike P1-4）：文案必须自带修复动作 ────────────────────────


@pytest.mark.asyncio
async def test_no_creator_error_message_includes_remediation(db_session: AsyncSession) -> None:
    from app.core.errors import AppError

    ws = await _make_workspace(db_session)
    token = await _make_token(
        db_session, workspace_id=ws.id, created_by=None, scope=[MCP_SCOPE_DISPATCH]
    )
    auth = _auth(token, frozenset({MCP_SCOPE_DISPATCH}))

    with pytest.raises(AppError) as exc_info:
        await tools._resolve_actor_user_id(db_session, auth)
    # 文案指明修复动作：经签发 API 重签（带用户归属）或补 created_by。
    assert "POST /api/workspaces" in str(exc_info.value.message)
    assert "created_by" in str(exc_info.value.message)
    assert "hint" in (exc_info.value.details or {})


# ── agent_type 默认（spike P2-6）：不传时跟随 workspace.default_agent ──────────


@pytest.mark.asyncio
async def test_dispatch_worker_agent_type_defaults_to_workspace_default(
    db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    from sqlalchemy import select as _select

    from app.modules.agent.control import MissionControlService

    # 部署配置驱动：workspace.default_agent=pi（实际执行器），不传 agent_type 时
    # 标签应跟随 pi 而非硬编码 claude_code。
    ws = await _make_workspace(db_session)
    ws.default_agent = "pi"
    user = await _make_user(db_session)
    await db_session.commit()
    mission = await _make_mission(db_session, ws.id)

    token = await _make_token(
        db_session, workspace_id=ws.id, created_by=user.id, scope=[MCP_SCOPE_DISPATCH]
    )
    ctx = _make_ctx(_auth(token, frozenset({MCP_SCOPE_DISPATCH})))

    async def _allow(self: MissionControlService, mission: AgentMission) -> tuple[bool, str]:
        return True, ""

    monkeypatch.setattr(MissionControlService, "can_dispatch_worker", _allow)

    async def _no_exec(self, run, **kwargs):
        return None

    monkeypatch.setattr(
        "app.modules.mcp_gateway.tools.MissionExecutionService.dispatch_worker", _no_exec
    )

    # ① 不传 → workspace 默认 pi。
    r1 = await tools.dispatch_worker(mission_id=mission.id, objective="a", ctx=ctx)
    run1 = (
        await db_session.execute(_select(AgentRun).where(AgentRun.id == uuid.UUID(r1["id"])))
    ).scalar_one()
    assert run1.agent_type == "pi"

    # ② 显式传值优先于 workspace 默认。
    r2 = await tools.dispatch_worker(
        mission_id=mission.id, objective="b", agent_type="codex", ctx=ctx
    )
    run2 = (
        await db_session.execute(_select(AgentRun).where(AgentRun.id == uuid.UUID(r2["id"])))
    ).scalar_one()
    assert run2.agent_type == "codex"

    # ③ workspace 未配置 default_agent → 回退 claude_code（零回归）。
    ws.default_agent = None
    await db_session.commit()
    r3 = await tools.dispatch_worker(mission_id=mission.id, objective="c", ctx=ctx)
    run3 = (
        await db_session.execute(_select(AgentRun).where(AgentRun.id == uuid.UUID(r3["id"])))
    ).scalar_one()
    assert run3.agent_type == "claude_code"


# ── DNS rebinding Host 白名单（spike P0-1 坑 6：反代域名 421 修复）─────────────


def test_transport_security_default_keeps_localhost_trio(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """未配公网 origin / 额外 host：白名单仍是 localhost 三件套（本地 dev 零回归）。"""
    from app.core.config import get_settings
    from app.modules.mcp_gateway.server import _build_transport_security

    monkeypatch.setattr(get_settings(), "mcp_gateway_public_base_url", "")
    monkeypatch.setattr(get_settings(), "mcp_allowed_hosts", "")
    sec = _build_transport_security()
    assert sec.enable_dns_rebinding_protection is True
    for host in ("127.0.0.1", "localhost", "[::1]"):
        assert host in sec.allowed_hosts


def test_transport_security_public_base_url_whitelists_host(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """配了公网 origin：其 host 进白名单（裸 host + 端口通配双形态）。"""
    from app.core.config import get_settings
    from app.modules.mcp_gateway.server import _build_transport_security

    monkeypatch.setattr(get_settings(), "mcp_gateway_public_base_url", "https://crrcdt.ppdmq.top")
    sec = _build_transport_security()
    # 443 反代域名的 Host 头不带端口（精确匹配），必须登记裸 host；
    # :* 形态覆盖非标准端口入口。
    assert "crrcdt.ppdmq.top" in sec.allowed_hosts
    assert "crrcdt.ppdmq.top:*" in sec.allowed_hosts


def test_transport_security_extra_allowed_hosts_parsed(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """MCP_ALLOWED_HOSTS 逗号分隔条目按形态归一（裸 host / 通配 / 显式端口）。"""
    from app.core.config import get_settings
    from app.modules.mcp_gateway.server import _build_transport_security

    monkeypatch.setattr(get_settings(), "mcp_gateway_public_base_url", "")
    monkeypatch.setattr(get_settings(), "mcp_allowed_hosts", "alias.example.com,10.0.0.5:8001")
    sec = _build_transport_security()
    assert "alias.example.com" in sec.allowed_hosts
    assert "alias.example.com:*" in sec.allowed_hosts
    assert "10.0.0.5:8001" in sec.allowed_hosts
