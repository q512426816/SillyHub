"""mission "external 模式" 闭环单测（task-07 / AC-04 / AC-05 / R-01 / R-02）。

change ``2026-08-08-dispatch-worker-caller-worktree`` task-07：

- **AC-04（service 层）**：``OrchestratorService.team_mission_entry`` 传
  ``orchestration_mode="external"`` → 只建 mission（``constraints`` 落
  ``{"orchestration_mode": "external"}``），**跳过 orchestrator run + daemon lease**，
  返回 ``(mission, None)``。对照默认 ``"team"`` 调用仍 spawn ``role=orchestrator`` 主
  agent run（确认 external 是分叉非回归）。design §7.1 / D-007@v1，解 R-02（僵尸
  orchestrator）。
- **AC-04（mcp_gateway 入口）**：``tools.create_mission(orchestration_mode="external")``
  → 响应 ``main_run_id=None`` / ``workers=[]``，落库 mission.constraints 含 external。
  design §7.1（external 无 main_run）。
- **AC-05（converge 跳过）**：external mission worker 终态触发
  ``converge_mission_for_completed_run`` → 检测 ``constraints.orchestration_mode ==
  "external"`` 短路，**不触达 finalize_execute_mission / finalize_bootstrap_mission /
  cleanup_mission**（不 merge 不清 caller worktree）。对照 team mission converge 仍
  finalize（确认短路是分叉）。design §7.5 / D-003@v2，R-01 根解层①。

fixture 风格复刻 ``test_dispatch_worker_worktree.py``（``_make_workspace`` /
``_make_worker`` / ``db_session``）+ ``test_tools_new.py``（``_make_ctx`` /
``_make_token`` / ``MCP_SCOPE_DISPATCH``）。converge 的 FinalizerService 三方法用
``monkeypatch.setattr`` 换成 :class:`unittest.mock.AsyncMock` spy 断言 not_awaited，
不真起 host_fs_delegate / git merge（DI mock 走协作者 monkeypatch）。
"""

from __future__ import annotations

import uuid
from typing import Any, cast
from unittest.mock import AsyncMock

import pytest
from mcp.server.fastmcp import Context
from mcp.shared.context import RequestContext
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.requests import Request

from app.core.security import password_hasher
from app.modules.agent.finalizer import (
    FinalizerMergeResult,
    FinalizerService,
    converge_mission_for_completed_run,
)
from app.modules.agent.model import AgentMission, AgentRun
from app.modules.agent.orchestrator import OrchestratorService
from app.modules.auth.model import User
from app.modules.mcp_gateway import tools
from app.modules.mcp_gateway.auth import (
    MCP_AUTH_STATE_KEY,
    MCP_SCOPE_DISPATCH,
    McpAuthContext,
)
from app.modules.mcp_gateway.model import McpTokenORM
from app.modules.mcp_gateway.server import mcp
from app.modules.workspace.model import Workspace

# ── 共用 seed helpers（对齐 test_dispatch_worker_worktree / test_tools_new）─────


async def _make_workspace(session: AsyncSession) -> Workspace:
    ws = Workspace(
        id=uuid.uuid4(),
        name=f"ws-{uuid.uuid4().hex[:6]}",
        slug=f"ws-{uuid.uuid4().hex[:6]}",
        root_path=f"/tmp/ws-{uuid.uuid4().hex[:8]}",
        default_branch="main",
        default_agent="claude_code",
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
    session: AsyncSession,
    *,
    workspace_id: uuid.UUID,
    created_by: uuid.UUID,
    scope: list[str],
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


def _make_ctx(auth: McpAuthContext) -> Context:
    """构造带 mcp_auth 的 FastMCP Context（对齐 test_tools_new middleware 注入键）。"""
    req = Request({"type": "http", "headers": []})
    setattr(req.state, MCP_AUTH_STATE_KEY, auth)
    rc = RequestContext(
        request_id=1,
        meta=None,
        # session/lifespan_context 传 None（测试不经真 MCP session）；用 Any cast
        # 满足 RequestContext 泛型 SessionT（运行期 None 合法，test_tools_new 同款）。
        session=cast(Any, None),
        lifespan_context=cast(Any, None),
        request=req,
    )
    return Context(request_context=rc)


def _auth(token: McpTokenORM, scope: frozenset[str]) -> McpAuthContext:
    return McpAuthContext(workspace_id=token.workspace_id, scope=scope, token_id=token.id)


async def _make_worker(
    session: AsyncSession,
    mission_id: uuid.UUID,
    *,
    status: str = "completed",
    role: str = "worker",
    output: str | None = "worker 结构化摘要",
) -> AgentRun:
    run = AgentRun(
        mission_id=mission_id,
        agent_type="claude_code",
        provider="claude",
        status=status,
        role=role,
        objective=f"{role} objective",
        spec_strategy="oneshot",
        output_redacted=output,
    )
    session.add(run)
    await session.commit()
    await session.refresh(run)
    return run


# ════════════════════════════════════════════════════════════════════════════
# AC-04 service 层：team_mission_entry(external) 跳过 orchestrator spawn
# ════════════════════════════════════════════════════════════════════════════


@pytest.mark.asyncio
async def test_team_mission_entry_external_skips_orchestrator_run(
    db_session: AsyncSession,
) -> None:
    """``orchestration_mode="external"`` → 返回 ``(mission, None)`` + constraints 落 mode +
    DB 无 orchestrator run（design §7.1 / D-007@v1，解 R-02）。"""
    ws = await _make_workspace(db_session)
    svc = OrchestratorService(db_session)

    mission, main_run = await svc.team_mission_entry(
        workspace_id=ws.id,
        objective="o",
        created_by=None,
        change_id=None,
        constraints=None,
        budget_usd=None,
        worker_preset=None,
        main_agent_config=None,
        orchestration_mode="external",
    )

    # external → team_mission_entry 跳过 orchestrator spawn，返回 main_run=None
    assert main_run is None
    # mission 已落库
    assert mission.id is not None
    assert mission.workspace_id == ws.id
    # constraints 落 orchestration_mode（供 converge 检测，AC-05 命中依据）
    assert mission.constraints == {"orchestration_mode": "external"}

    # 该 mission 下绝无 role=orchestrator 的 run（external 不 spawn 僵尸 orchestrator）
    runs = (
        (await db_session.execute(select(AgentRun).where(AgentRun.mission_id == mission.id)))
        .scalars()
        .all()
    )
    assert all(r.role != "orchestrator" for r in runs)
    assert runs == []


@pytest.mark.asyncio
async def test_team_mission_entry_team_default_spawns_orchestrator(
    db_session: AsyncSession,
) -> None:
    """对照：默认 ``orchestration_mode="team"`` 仍 spawn ``role=orchestrator`` 主 agent run
    （external 是分叉非回归，design §9 零回归）。"""
    ws = await _make_workspace(db_session)
    svc = OrchestratorService(db_session)

    mission, main_run = await svc.team_mission_entry(
        workspace_id=ws.id,
        objective="o",
        created_by=uuid.uuid4(),
        change_id=None,
        constraints=None,
        budget_usd=None,
        worker_preset=None,
        main_agent_config=None,
        # orchestration_mode 默认 "team"
    )

    # team → spawn 主 agent run（daemon 离线时仍建 run，标 error_code 待重派，
    # 重点是 run 存在且 role=orchestrator，与 external 的 None 形成对照）。
    assert main_run is not None
    assert main_run.role == "orchestrator"
    assert main_run.mission_id == mission.id
    # team mission constraints 不落 orchestration_mode（converge 不命中 external 短路）
    assert (mission.constraints or {}).get("orchestration_mode") != "external"


# ════════════════════════════════════════════════════════════════════════════
# AC-04 mcp_gateway 入口：create_mission(external) → main_run_id=None + workers=[]
# ════════════════════════════════════════════════════════════════════════════


@pytest.mark.asyncio
async def test_create_mission_external_returns_no_main_run_no_workers(
    db_session: AsyncSession,
) -> None:
    """``tools.create_mission(orchestration_mode="external")`` → 响应 main_run_id=None /
    workers=[]，落库 mission.constraints 含 external（design §7.1）。"""
    ws = await _make_workspace(db_session)
    user = await _make_user(db_session)
    token = await _make_token(
        db_session, workspace_id=ws.id, created_by=user.id, scope=[MCP_SCOPE_DISPATCH]
    )
    ctx = _make_ctx(_auth(token, frozenset({MCP_SCOPE_DISPATCH})))

    result = await tools.create_mission(objective="o", orchestration_mode="external", ctx=ctx)

    # external 无 main_run / 无 worker（design §7.1：external mission 由 caller 后续
    # dispatch_worker 派，create_mission 只建 mission 骨架）。
    assert result["mission_id"]
    assert result["main_run_id"] is None
    assert result["workers"] == []

    # 落库 mission.constraints 含 external（converge 短路命中依据）。
    mission = await db_session.get(AgentMission, uuid.UUID(result["mission_id"]))
    assert mission is not None
    assert mission.constraints == {"orchestration_mode": "external"}
    # 该 mission 下无 orchestrator run
    runs = (
        (await db_session.execute(select(AgentRun).where(AgentRun.mission_id == mission.id)))
        .scalars()
        .all()
    )
    assert runs == []


@pytest.mark.asyncio
async def test_create_mission_external_param_registered_in_schema() -> None:
    """``orchestration_mode`` 进 create_mission inputSchema（链路B 透传，FR-08 可达性）。"""
    registered = {t.name: t for t in await mcp.list_tools()}
    assert "create_mission" in registered
    props = registered["create_mission"].inputSchema.get("properties", {})
    assert "orchestration_mode" in props


# ════════════════════════════════════════════════════════════════════════════
# AC-05 converge external 短路：跳过 finalize/cleanup，不 merge caller worktree
# ════════════════════════════════════════════════════════════════════════════


@pytest.mark.asyncio
async def test_converge_external_mission_skips_finalize_and_cleanup(
    db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    """external mission worker 终态 → ``converge_mission_for_completed_run`` 检测
    ``constraints.orchestration_mode=="external"`` 短路，三 finalize/cleanup 方法
    均 **not_awaited**（design §7.5 / D-003@v2，R-01 根解层①）。

    FinalizerService 三方法 monkeypatch 成 AsyncMock spy 断言 not_awaited——
    不真起 host_fs_delegate / git merge（DI mock 走协作者 monkeypatch）。
    """
    mission = AgentMission(
        workspace_id=uuid.uuid4(),
        objective="o",
        constraints={"orchestration_mode": "external"},
    )
    db_session.add(mission)
    await db_session.commit()
    await db_session.refresh(mission)
    worker = await _make_worker(db_session, mission.id, status="completed")

    spy_exec = AsyncMock(return_value=FinalizerMergeResult())
    spy_bootstrap = AsyncMock(return_value=None)
    spy_cleanup = AsyncMock(return_value={"cleaned": [], "patch_artifact_id": None})
    monkeypatch.setattr(FinalizerService, "finalize_execute_mission", spy_exec)
    monkeypatch.setattr(FinalizerService, "finalize_bootstrap_mission", spy_bootstrap)
    monkeypatch.setattr(FinalizerService, "cleanup_mission", spy_cleanup)

    status = await converge_mission_for_completed_run(db_session, worker.id)

    # external 短路：collect_completed_artifacts 幂等回灌后直接 return status，
    # FinalizerService 压根不构造，三方法绝不被 await（不 merge 不清 caller worktree）。
    spy_exec.assert_not_awaited()
    spy_bootstrap.assert_not_awaited()
    spy_cleanup.assert_not_awaited()
    # converge 正常返回（worker 全终态 derive 出 done），mission 不残留中间态。
    assert status == "done"


@pytest.mark.asyncio
async def test_converge_team_mission_still_triggers_finalize(
    db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    """对照：默认 team mission（constraints 无 orchestration_mode）worker 终态 →
    converge 仍 ``await finalize_execute_mission``（external 短路是分叉，design §9
    零回归）。finalize_bootstrap_mission 因 execute 路径不触发。"""
    mission = AgentMission(
        workspace_id=uuid.uuid4(),
        objective="o",
        # 无 constraints → converge 默认不命中 external 短路，走原 finalize 逻辑
    )
    db_session.add(mission)
    await db_session.commit()
    await db_session.refresh(mission)
    worker = await _make_worker(db_session, mission.id, status="completed")

    spy_exec = AsyncMock(return_value=FinalizerMergeResult(merged_branches=["sillyspec/x"]))
    spy_bootstrap = AsyncMock(return_value=None)
    monkeypatch.setattr(FinalizerService, "finalize_execute_mission", spy_exec)
    monkeypatch.setattr(FinalizerService, "finalize_bootstrap_mission", spy_bootstrap)

    status = await converge_mission_for_completed_run(db_session, worker.id)

    # team mission → finalize_execute_mission 被调一次（与 external 短路形成对照）。
    spy_exec.assert_awaited_once()
    # merge_result.merged_branches 非空 → is_execute_mission=True → 不走 bootstrap 分支。
    spy_bootstrap.assert_not_awaited()
    assert status == "done"
