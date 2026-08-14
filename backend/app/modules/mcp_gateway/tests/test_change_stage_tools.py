"""task-15：change 阶层 4 个 MCP tool 的单测（FR-04）。

覆盖 ``backend/app/modules/mcp_gateway/tools.py`` 形态A 的 4 个 change 阶层 tool
（design §6.1 / §6.2），验证 tool 层的分流 / 路由 / 三态 / 只读语义：

- ``advance_change_stage``（scope=dispatch）：包装 ``ChangeService.transition_with_dispatch``
  的 single / team 分流。team_mode=True 时确认 ``team_mode`` / ``worker_preset`` /
  ``main_agent_config`` 透传给 service（由 service 落 change.stages 供 ``_dispatch_execute_team``
  建 mission）；single 分流不连轴（只调一次 transition_with_dispatch）。返回
  ``{change, current_stage, agent_dispatch}``。
- ``submit_stage_review``（scope=dispatch）：``stage`` 路由 proposal/plan/human_test/
  archive_confirm 四方法 + 异常 stage 400。``archive_confirm`` 不透传 decision
  （service.py 无 decision 入参）。D-004（task-03/04）：审批不派发 agent，返回
  agent_dispatch 恒空；D-006@v2：notify_session 透传 + notified_session/notify_error
  随响应返回。
- ``run_verify_gate``（scope=read）：三态 source=gate_result / gate_cmd / unavailable，
  均不硬阻塞（exit_code 交调用方，unavailable 时 None）。
- ``get_change_stage``（scope=read）：返回 ``{change_id, current_stage, stages,
  pending_review}``，纯只读不落库。

测试不真起 FastMCP HTTP 服务（对齐 test_tools_new.py）：构造带 mcp_auth 的 Context
直调 tool 函数。边界 mock（tool 内部 lazily import，patch 源模块）：

- ``app.modules.change.service.ChangeService``：transition_with_dispatch / 四 review
  方法 / get —— 不切真 sillyspec 状态机 / 不真 dispatch。
- ``app.modules.change.dispatch._read_latest_gate_result`` / ``_run_gate_via_delegate``
  —— 不真调 sillyspec gate 子命令 / 不经 HostFsDelegate RPC。
- ``app.modules.daemon.run_sync.service.RunSyncService._resolve_gate_spec_root``
  —— 不真解 SpecWorkspace。
- ``app.modules.change.projection.StageProjectionService.compute_pending_review``
  —— 不真读 sillyspec.db 投影。

``_change_read_dict`` 走真 ``ChangeRead.model_validate``（轻量、纯投影），change 用真
Change ORM 对象（不插入 DB），确保返回 dict 是 JSON-safe。
"""

from __future__ import annotations

import uuid
from typing import Any, cast
from unittest.mock import AsyncMock

import pytest
from mcp.server.fastmcp import Context
from mcp.shared.context import RequestContext
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.requests import Request

from app.core.errors import AppError, PermissionDenied
from app.modules.change.model import Change
from app.modules.change.schema import PendingReview
from app.modules.mcp_gateway import tools
from app.modules.mcp_gateway.auth import (
    MCP_AUTH_STATE_KEY,
    MCP_SCOPE_DISPATCH,
    MCP_SCOPE_READ,
    McpAuthContext,
)
from app.modules.mcp_gateway.model import McpTokenORM
from app.modules.workspace.model import Workspace

# ── 构造 helpers（对齐 test_tools_new.py 风格）─────────────────────────────────


def _make_ctx(auth: McpAuthContext) -> Context:
    """构造带 mcp_auth 的 FastMCP Context（对齐 task-03 middleware 注入键）。"""
    req = Request({"type": "http", "headers": []})
    setattr(req.state, MCP_AUTH_STATE_KEY, auth)
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


async def _make_token(
    session: AsyncSession, *, workspace_id: uuid.UUID, scope: list[str]
) -> McpTokenORM:
    token = McpTokenORM(
        id=uuid.uuid4(),
        workspace_id=workspace_id,
        name="ci",
        token_hash=f"hash-{uuid.uuid4().hex}",
        scope=scope,
        created_by=uuid.uuid4(),
    )
    session.add(token)
    await session.commit()
    await session.refresh(token)
    return token


def _auth(token: McpTokenORM, scope: frozenset[str]) -> McpAuthContext:
    return McpAuthContext(workspace_id=token.workspace_id, scope=scope, token_id=token.id)


def _make_change(workspace_id: uuid.UUID, *, current_stage: str = "execute") -> Change:
    """构造真 Change ORM 对象（不插入 DB），供 ``ChangeRead.model_validate`` 投影。

    非空必填字段：workspace_id / change_key / location / path（model.py:114-127）。
    """
    return Change(
        id=uuid.uuid4(),
        workspace_id=workspace_id,
        change_key=f"ch-{uuid.uuid4().hex[:8]}",
        title="测试 change",
        status="active",
        location="active",
        path=f"/tmp/.sillyspec/changes/{uuid.uuid4().hex[:8]}",
        current_stage=current_stage,
        stages={"team_mode": True},
    )


def _patch_change_service_method(
    monkeypatch: pytest.MonkeyPatch, method: str, return_value: dict
) -> AsyncMock:
    """把 ``ChangeService.<method>`` 换成 AsyncMock（tool 内 lazily import，patch 源模块）。"""
    from app.modules.change.service import ChangeService

    mock = AsyncMock(return_value=return_value)
    monkeypatch.setattr(ChangeService, method, mock)
    return mock


# ── advance_change_stage ──────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_advance_change_stage_single_dispatch(
    db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    """single 分流：透传 target_stage / provider / model，team_mode 默认 False，不连轴。"""
    ws = await _make_workspace(db_session)
    change = _make_change(ws.id, current_stage="execute")
    dispatch_raw = {
        "dispatched": True,
        "agent_run_id": uuid.uuid4(),
        "stage": "execute",
        "mode": "single",
    }
    mock = _patch_change_service_method(
        monkeypatch, "transition_with_dispatch", {"change": change, "agent_dispatch": dispatch_raw}
    )

    token = await _make_token(db_session, workspace_id=ws.id, scope=[MCP_SCOPE_DISPATCH])
    ctx = _make_ctx(_auth(token, frozenset({MCP_SCOPE_DISPATCH})))

    result = await tools.advance_change_stage(
        change_id=change.id,
        target_stage="execute",
        provider="claude",
        model="claude-opus",
        ctx=ctx,
    )

    # 单步显式推进：transition_with_dispatch 只被调一次（不自动连轴）。
    assert mock.await_count == 1
    kwargs = mock.await_args.kwargs
    assert kwargs["workspace_id"] == ws.id
    assert kwargs["change_id"] == change.id
    assert kwargs["target_stage"] == "execute"
    assert kwargs["provider"] == "claude"
    assert kwargs["model"] == "claude-opus"
    assert kwargs["team_mode"] is False  # 默认 single 分流
    # admin 角色 + actor=token.created_by（CC-05 同款）。
    assert kwargs["user_role"] == "admin"
    assert kwargs["user_id"] == token.created_by

    # 返回 {change, current_stage, agent_dispatch}，agent_dispatch 规整为全字段。
    assert result["current_stage"] == "execute"
    assert result["change"]["id"] == str(change.id)
    ad = result["agent_dispatch"]
    assert ad["dispatched"] is True
    assert ad["agent_run_id"] == str(dispatch_raw["agent_run_id"])
    assert ad["mode"] == "single"
    assert ad["stage"] == "execute"
    # 缺失字段补 None（_shape_agent_dispatch 契约）。
    assert ad["mission_id"] is None
    assert ad["reason"] is None
    assert ad["error"] is None


@pytest.mark.asyncio
async def test_advance_change_stage_team_dispatch(
    db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    """team 分流：team_mode=True 时 worker_preset / main_agent_config 一并透传给 service。

    service 落 change.stages 供 ``_dispatch_execute_team`` 读（建 verify/archive team
    mission，service.py:762）。tool 层职责是把三参无损透传 + 规整 team 形态的
    agent_dispatch（含 mission_id / mode=team）。
    """
    ws = await _make_workspace(db_session)
    change = _make_change(ws.id, current_stage="verify")
    mission_id = uuid.uuid4()
    dispatch_raw = {
        "dispatched": True,
        "agent_run_id": uuid.uuid4(),
        "stage": "verify",
        "mission_id": mission_id,
        "mode": "team",
    }
    mock = _patch_change_service_method(
        monkeypatch, "transition_with_dispatch", {"change": change, "agent_dispatch": dispatch_raw}
    )

    token = await _make_token(db_session, workspace_id=ws.id, scope=[MCP_SCOPE_DISPATCH])
    ctx = _make_ctx(_auth(token, frozenset({MCP_SCOPE_DISPATCH})))

    worker_preset = [{"role": "worker", "objective": "跑测试"}]
    main_agent_config = {"provider": "claude"}
    result = await tools.advance_change_stage(
        change_id=change.id,
        target_stage="verify",
        team_mode=True,
        worker_preset=worker_preset,
        main_agent_config=main_agent_config,
        ctx=ctx,
    )

    assert mock.await_count == 1
    kwargs = mock.await_args.kwargs
    # team 分流三参无损透传 → service 据此落 stages 触发 _dispatch_execute_team。
    assert kwargs["team_mode"] is True
    assert kwargs["worker_preset"] == worker_preset
    assert kwargs["main_agent_config"] == main_agent_config

    ad = result["agent_dispatch"]
    assert ad["dispatched"] is True
    assert ad["mode"] == "team"
    assert ad["mission_id"] == str(mission_id)


@pytest.mark.asyncio
async def test_advance_change_stage_rejects_without_dispatch_scope(
    db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    """越界：只有 read scope 调 dispatch tool 抛 PermissionDenied，不触达 service。"""
    ws = await _make_workspace(db_session)
    change = _make_change(ws.id)
    mock = _patch_change_service_method(
        monkeypatch, "transition_with_dispatch", {"change": change, "agent_dispatch": {}}
    )
    token = await _make_token(db_session, workspace_id=ws.id, scope=[MCP_SCOPE_READ])
    ctx = _make_ctx(_auth(token, frozenset({MCP_SCOPE_READ})))

    with pytest.raises(PermissionDenied):
        await tools.advance_change_stage(change_id=change.id, target_stage="execute", ctx=ctx)
    assert mock.await_count == 0


# ── submit_stage_review ───────────────────────────────────────────────────────


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("stage", "service_method", "decision"),
    [
        ("proposal", "proposal_review", "approve"),
        ("proposal", "proposal_review", "revise"),
        ("plan", "plan_review", "approve"),
        ("plan", "plan_review", "replan"),
        ("human_test", "human_test", "pass"),
        ("human_test", "human_test", "bug"),
    ],
)
async def test_submit_stage_review_routes_to_service_method(
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
    stage: str,
    service_method: str,
    decision: str,
) -> None:
    """四分支路由：stage → 对应 review 方法，decision + comment + actor 透传。

    D-004（task-03/04）：service 返回 agent_dispatch=None + notify 字段；工具恒空
    agent_dispatch、透传 notify_session（默认 True）与 notify 结果。
    """
    ws = await _make_workspace(db_session)
    change = _make_change(ws.id)
    mock = _patch_change_service_method(
        monkeypatch,
        service_method,
        {
            "change": change,
            "agent_dispatch": None,
            "notified_session": True,
            "notify_error": None,
        },
    )

    token = await _make_token(db_session, workspace_id=ws.id, scope=[MCP_SCOPE_DISPATCH])
    ctx = _make_ctx(_auth(token, frozenset({MCP_SCOPE_DISPATCH})))

    result = await tools.submit_stage_review(
        change_id=change.id, stage=stage, decision=decision, comment="备注", ctx=ctx
    )

    assert mock.await_count == 1
    # review 方法是位置参数调用（tools.py:1058-1075）。
    args = mock.await_args.args
    assert args[0] == ws.id
    assert args[1] == change.id
    assert args[2] == decision  # human_test 第三参 service 命名为 result，语义即 decision
    assert args[3] == "备注"
    assert args[4] == token.created_by
    # D-006@v2：notify_session 默认 True 透传为关键字参数。
    assert mock.await_args.kwargs["notify_session"] is True

    assert result["change"]["id"] == str(change.id)
    # D-004：不派发 → agent_dispatch 恒空（dispatched False、其余字段 None）。
    ad = result["agent_dispatch"]
    assert ad["dispatched"] is False
    assert ad["agent_run_id"] is None
    assert ad["stage"] is None
    assert ad["mission_id"] is None
    assert ad["mode"] is None
    assert ad["reason"] is None
    assert ad["error"] is None
    # D-006@v2：notify 结果随审批响应透传。
    assert result["notified_session"] is True
    assert result["notify_error"] is None


@pytest.mark.asyncio
async def test_submit_stage_review_archive_confirm_ignores_decision(
    db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    """archive_confirm 分支：不透传 decision（service.py 无该入参），仅 comment + actor。

    D-004：agent_dispatch 恒空；D-006@v2：notify_session 透传 + notify 结果返回。
    """
    ws = await _make_workspace(db_session)
    change = _make_change(ws.id, current_stage="archive")
    mock = _patch_change_service_method(
        monkeypatch,
        "archive_confirm",
        {
            "change": change,
            "agent_dispatch": None,
            "notified_session": True,
            "notify_error": None,
        },
    )

    token = await _make_token(db_session, workspace_id=ws.id, scope=[MCP_SCOPE_DISPATCH])
    ctx = _make_ctx(_auth(token, frozenset({MCP_SCOPE_DISPATCH})))

    result = await tools.submit_stage_review(
        change_id=change.id,
        stage="archive_confirm",
        decision="confirm",
        comment="确认归档",
        ctx=ctx,
    )

    assert mock.await_count == 1
    args = mock.await_args.args
    # archive_confirm(workspace_id, change_id, comment, user_id)：无 decision 位置。
    assert args[0] == ws.id
    assert args[1] == change.id
    assert args[2] == "确认归档"
    assert args[3] == token.created_by
    assert mock.await_args.kwargs["notify_session"] is True
    # 恒空 agent_dispatch（不派发）+ notify 结果透传。
    assert result["agent_dispatch"]["dispatched"] is False
    assert result["agent_dispatch"]["reason"] is None
    assert result["notified_session"] is True
    assert result["notify_error"] is None


@pytest.mark.asyncio
async def test_submit_stage_review_no_dispatch_constant_empty(
    db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    """不派发契约（D-004）：即使 service 返回旧版 dispatched dict，工具仍恒空。

    审批语义（task-03/04）是权威：submit_stage_review 只落审批记录+阶段状态，不派发
    agent。工具返回 agent_dispatch 恒为 ``dispatched: False``、其余字段 None——不把
    service 返回的 dispatch 信息透出（防旧 service 版本误透真派发）。
    """
    ws = await _make_workspace(db_session)
    change = _make_change(ws.id, current_stage="execute")
    stale_dispatch = {
        "dispatched": True,
        "agent_run_id": uuid.uuid4(),
        "stage": "execute",
        "mode": "single",
    }
    mock = _patch_change_service_method(
        monkeypatch,
        "proposal_review",
        {
            "change": change,
            "agent_dispatch": stale_dispatch,
            "notified_session": True,
            "notify_error": None,
        },
    )
    token = await _make_token(db_session, workspace_id=ws.id, scope=[MCP_SCOPE_DISPATCH])
    ctx = _make_ctx(_auth(token, frozenset({MCP_SCOPE_DISPATCH})))

    result = await tools.submit_stage_review(
        change_id=change.id, stage="proposal", decision="approve", comment="备注", ctx=ctx
    )

    # service 虽返回 dispatched=True（旧版契约残留），工具强制恒空。
    assert mock.await_count == 1
    ad = result["agent_dispatch"]
    assert ad["dispatched"] is False
    assert ad["agent_run_id"] is None
    assert ad["stage"] is None
    assert ad["mission_id"] is None
    assert ad["mode"] is None
    assert ad["reason"] is None
    assert ad["error"] is None
    assert result["notified_session"] is True
    assert result["notify_error"] is None


@pytest.mark.asyncio
async def test_submit_stage_review_notify_session_pass_through(
    db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    """notify_session 透传（D-006@v2）：显式 False 按 kwargs 传 service，结果透传。

    注入失败（turn_conflict 等）不回滚审批，notify_error 随审批响应返回（对齐 HTTP
    ReviewResponse / R-03 三类降级）。
    """
    ws = await _make_workspace(db_session)
    change = _make_change(ws.id, current_stage="plan")
    mock = _patch_change_service_method(
        monkeypatch,
        "plan_review",
        {
            "change": change,
            "agent_dispatch": None,
            "notified_session": False,
            "notify_error": "turn_conflict",
        },
    )
    token = await _make_token(db_session, workspace_id=ws.id, scope=[MCP_SCOPE_DISPATCH])
    ctx = _make_ctx(_auth(token, frozenset({MCP_SCOPE_DISPATCH})))

    result = await tools.submit_stage_review(
        change_id=change.id,
        stage="plan",
        decision="approve",
        comment="ok",
        notify_session=False,
        ctx=ctx,
    )

    assert mock.await_args.kwargs["notify_session"] is False
    assert result["agent_dispatch"]["dispatched"] is False
    assert result["notified_session"] is False
    assert result["notify_error"] == "turn_conflict"


@pytest.mark.asyncio
async def test_submit_stage_review_invalid_stage_raises_400(
    db_session: AsyncSession,
) -> None:
    """异常 stage → 400 AppError（MCP_400_INVALID_REVIEW_STAGE），不触达 service。"""
    ws = await _make_workspace(db_session)
    token = await _make_token(db_session, workspace_id=ws.id, scope=[MCP_SCOPE_DISPATCH])
    ctx = _make_ctx(_auth(token, frozenset({MCP_SCOPE_DISPATCH})))

    with pytest.raises(AppError) as exc_info:
        await tools.submit_stage_review(
            change_id=uuid.uuid4(), stage="bogus", decision="approve", ctx=ctx
        )
    assert exc_info.value.code == "MCP_400_INVALID_REVIEW_STAGE"
    assert exc_info.value.http_status == 400


# ── run_verify_gate ───────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_run_verify_gate_source_gate_result(
    db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    """第一态 gate_result：已落库的 gate_result 直接返回，不调 gate cmd（不硬阻塞）。"""
    ws = await _make_workspace(db_session)
    change_id = uuid.uuid4()
    run_id = uuid.uuid4()

    read_gate = AsyncMock(return_value=({"exit_code": 0, "errors": []}, run_id))
    run_gate = AsyncMock()
    import app.modules.change.dispatch as dispatch_mod

    monkeypatch.setattr(dispatch_mod, "_read_latest_gate_result", read_gate)
    monkeypatch.setattr(dispatch_mod, "_run_gate_via_delegate", run_gate)

    token = await _make_token(db_session, workspace_id=ws.id, scope=[MCP_SCOPE_READ])
    ctx = _make_ctx(_auth(token, frozenset({MCP_SCOPE_READ})))

    result = await tools.run_verify_gate(change_id=change_id, ctx=ctx)

    assert result["change_id"] == str(change_id)
    assert result["source"] == "gate_result"
    assert result["exit_code"] == 0
    assert result["errors"] == []
    assert result["run_id"] == str(run_id)
    # gate_result 命中即短路：不软调 gate cmd。
    assert run_gate.await_count == 0


@pytest.mark.asyncio
async def test_run_verify_gate_source_gate_cmd(
    db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    """第二态 gate_cmd：gate_result 缺 → 软调 sillyspec gate（mock RPC 边界）。"""
    ws = await _make_workspace(db_session)
    change = _make_change(ws.id, current_stage="verify")

    import app.modules.change.dispatch as dispatch_mod
    from app.modules.change.service import ChangeService
    from app.modules.daemon.run_sync.service import RunSyncService

    monkeypatch.setattr(
        dispatch_mod, "_read_latest_gate_result", AsyncMock(return_value=(None, None))
    )
    get_mock = AsyncMock(return_value=change)
    monkeypatch.setattr(ChangeService, "get", get_mock)
    resolve_mock = AsyncMock(return_value=("/code/root", "/spec/dir"))
    monkeypatch.setattr(RunSyncService, "_resolve_gate_spec_root", resolve_mock)
    run_gate = AsyncMock(return_value={"exit_code": 1, "errors": ["测试失败"], "raw_envelope": {}})
    monkeypatch.setattr(dispatch_mod, "_run_gate_via_delegate", run_gate)

    token = await _make_token(db_session, workspace_id=ws.id, scope=[MCP_SCOPE_READ])
    ctx = _make_ctx(_auth(token, frozenset({MCP_SCOPE_READ})))

    result = await tools.run_verify_gate(change_id=change.id, ctx=ctx)

    # 软调 gate：传入 workspace / change_key / code_root / spec_dir，stage=verify。
    assert run_gate.await_count == 1
    gate_args = run_gate.await_args.args
    assert gate_args[2] == change.change_key
    assert gate_args[3] == "/code/root"
    assert gate_args[4] == "/spec/dir"
    assert run_gate.await_args.kwargs["stage"] == "verify"

    assert result["source"] == "gate_cmd"
    assert result["exit_code"] == 1
    assert result["errors"] == ["测试失败"]
    assert result["run_id"] is None


@pytest.mark.asyncio
async def test_run_verify_gate_source_unavailable_when_no_code_root(
    db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    """第三态 unavailable：code_root 解不出（workspace.root_path 缺）→ exit_code=None 不阻塞。"""
    ws = await _make_workspace(db_session)
    change = _make_change(ws.id, current_stage="verify")

    import app.modules.change.dispatch as dispatch_mod
    from app.modules.change.service import ChangeService
    from app.modules.daemon.run_sync.service import RunSyncService

    monkeypatch.setattr(
        dispatch_mod, "_read_latest_gate_result", AsyncMock(return_value=(None, None))
    )
    monkeypatch.setattr(ChangeService, "get", AsyncMock(return_value=change))
    # code_root=None → unavailable。
    monkeypatch.setattr(
        RunSyncService, "_resolve_gate_spec_root", AsyncMock(return_value=(None, None))
    )
    run_gate = AsyncMock()
    monkeypatch.setattr(dispatch_mod, "_run_gate_via_delegate", run_gate)

    token = await _make_token(db_session, workspace_id=ws.id, scope=[MCP_SCOPE_READ])
    ctx = _make_ctx(_auth(token, frozenset({MCP_SCOPE_READ})))

    result = await tools.run_verify_gate(change_id=change.id, ctx=ctx)

    assert result["source"] == "unavailable"
    # 不硬阻塞、不伪造 verdict：exit_code=None 交调用方决策，reason 记诊断。
    assert result["exit_code"] is None
    assert result["run_id"] is None
    assert len(result["errors"]) == 1
    assert "code_root" in result["errors"][0]
    # prerequisites 失败短路：不调 gate cmd。
    assert run_gate.await_count == 0


@pytest.mark.asyncio
async def test_run_verify_gate_unavailable_when_delegate_unreachable(
    db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    """unavailable 兜底：_run_gate_via_delegate 构造期抛 HostFsDelegateUnavailable → 不阻塞。"""
    from app.modules.daemon.host_fs.delegate import HostFsDelegateUnavailable

    ws = await _make_workspace(db_session)
    change = _make_change(ws.id, current_stage="verify")

    import app.modules.change.dispatch as dispatch_mod
    from app.modules.change.service import ChangeService
    from app.modules.daemon.run_sync.service import RunSyncService

    monkeypatch.setattr(
        dispatch_mod, "_read_latest_gate_result", AsyncMock(return_value=(None, None))
    )
    monkeypatch.setattr(ChangeService, "get", AsyncMock(return_value=change))
    monkeypatch.setattr(
        RunSyncService, "_resolve_gate_spec_root", AsyncMock(return_value=("/code/root", None))
    )
    monkeypatch.setattr(
        dispatch_mod,
        "_run_gate_via_delegate",
        AsyncMock(side_effect=HostFsDelegateUnavailable("no bound daemon")),
    )

    token = await _make_token(db_session, workspace_id=ws.id, scope=[MCP_SCOPE_READ])
    ctx = _make_ctx(_auth(token, frozenset({MCP_SCOPE_READ})))

    result = await tools.run_verify_gate(change_id=change.id, ctx=ctx)

    assert result["source"] == "unavailable"
    assert result["exit_code"] is None
    assert "delegate unavailable" in result["errors"][0]


@pytest.mark.asyncio
async def test_run_verify_gate_rejects_without_read_scope(db_session: AsyncSession) -> None:
    """越界：只有 dispatch scope 调 read tool 抛 PermissionDenied。"""
    ws = await _make_workspace(db_session)
    token = await _make_token(db_session, workspace_id=ws.id, scope=[MCP_SCOPE_DISPATCH])
    ctx = _make_ctx(_auth(token, frozenset({MCP_SCOPE_DISPATCH})))

    with pytest.raises(PermissionDenied):
        await tools.run_verify_gate(change_id=uuid.uuid4(), ctx=ctx)


# ── get_change_stage ──────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_get_change_stage_returns_view_with_pending_review(
    db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    """只读视图：返回 change + stages + pending_review（投影值），无副作用。"""
    ws = await _make_workspace(db_session)
    change = _make_change(ws.id, current_stage="execute")
    change.stages = {"team_mode": True, "last_dispatch": {"stage": "execute"}}

    from app.modules.change.projection import StageProjectionService
    from app.modules.change.service import ChangeService

    monkeypatch.setattr(ChangeService, "get", AsyncMock(return_value=change))
    pending_mock = AsyncMock(return_value=PendingReview.HUMAN_TEST)
    monkeypatch.setattr(StageProjectionService, "compute_pending_review", pending_mock)

    token = await _make_token(db_session, workspace_id=ws.id, scope=[MCP_SCOPE_READ])
    ctx = _make_ctx(_auth(token, frozenset({MCP_SCOPE_READ})))

    result = await tools.get_change_stage(change_id=change.id, ctx=ctx)

    assert result["change_id"] == str(change.id)
    assert result["current_stage"] == "execute"
    # stages JSON 原样透出。
    assert result["stages"]["team_mode"] is True
    assert result["stages"]["last_dispatch"] == {"stage": "execute"}
    # pending_review 投影值（enum.value）。
    assert result["pending_review"] == "human_test"
    assert pending_mock.await_count == 1


@pytest.mark.asyncio
async def test_get_change_stage_pending_review_none_and_empty_stages(
    db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    """无等待审核 + stages 缺省：pending_review=None，stages 降级为 {}。"""
    ws = await _make_workspace(db_session)
    change = _make_change(ws.id, current_stage="brainstorm")
    change.stages = None  # 缺省场景（model 默认 dict，这里模拟 None）

    from app.modules.change.projection import StageProjectionService
    from app.modules.change.service import ChangeService

    monkeypatch.setattr(ChangeService, "get", AsyncMock(return_value=change))
    monkeypatch.setattr(
        StageProjectionService, "compute_pending_review", AsyncMock(return_value=None)
    )

    token = await _make_token(db_session, workspace_id=ws.id, scope=[MCP_SCOPE_READ])
    ctx = _make_ctx(_auth(token, frozenset({MCP_SCOPE_READ})))

    result = await tools.get_change_stage(change_id=change.id, ctx=ctx)

    assert result["pending_review"] is None
    assert result["stages"] == {}


@pytest.mark.asyncio
async def test_get_change_stage_rejects_without_read_scope(db_session: AsyncSession) -> None:
    """越界：只有 dispatch scope 调 read tool 抛 PermissionDenied。"""
    ws = await _make_workspace(db_session)
    token = await _make_token(db_session, workspace_id=ws.id, scope=[MCP_SCOPE_DISPATCH])
    ctx = _make_ctx(_auth(token, frozenset({MCP_SCOPE_DISPATCH})))

    with pytest.raises(PermissionDenied):
        await tools.get_change_stage(change_id=uuid.uuid4(), ctx=ctx)
