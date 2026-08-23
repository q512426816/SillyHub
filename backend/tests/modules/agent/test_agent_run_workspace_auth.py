"""workspace 级 run 端点的对象级授权（2026-08-24 会话功能审查 P1）。

get / kill / logs / stream 四个端点在修复前只校验「调用者在路径 workspace
有权限」，run 查找全局进行 → 任意 workspace 成员用自己的 workspace_id
即可越权读/杀其它工作区的 run（IDOR）。auth_headers 是平台管理员（权限
恒通过），因此本文件的 403 全部来自 run↔workspace 归属守卫本身。

覆盖：
  1. run 关联其它 workspace 时 get/kill/logs/stream 全部 403；
  2. run 关联路径 workspace 时四端点正常（200）；
  3. kill 被拒后 run 状态不被改动（越权不产生副作用）；
  4. 无任何 workspace 关联的 run（quick-chat 形态）→ 403。
"""

from __future__ import annotations

import uuid

from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.agent.model import AgentRun, AgentRunLog
from app.modules.workspace.model import AgentRunWorkspace, Workspace


async def _make_workspace(db_session: AsyncSession, slug: str) -> Workspace:
    # root_path 有唯一约束，每个测试 workspace 独立路径
    ws = Workspace(id=uuid.uuid4(), name=slug, slug=slug, root_path=f"/tmp/{slug}", status="active")
    db_session.add(ws)
    await db_session.flush()
    return ws


async def _make_run_linked(
    db_session: AsyncSession,
    *,
    workspace_ids: list[uuid.UUID],
    status_: str = "running",
    with_log: bool = False,
) -> AgentRun:
    run = AgentRun(agent_type="claude_code", status=status_)
    db_session.add(run)
    await db_session.flush()
    for ws_id in workspace_ids:
        db_session.add(AgentRunWorkspace(agent_run_id=run.id, workspace_id=ws_id))
    if with_log:
        db_session.add(
            AgentRunLog(run_id=run.id, channel="stdout", content_redacted="[ASSISTANT] hi")
        )
    await db_session.commit()
    await db_session.refresh(run)
    return run


async def _setup_two_workspaces(
    db_session: AsyncSession,
) -> tuple[Workspace, Workspace, AgentRun]:
    """own_ws = run 真实所属；other_ws = 攻击者传入的无关 workspace。"""
    own_ws = await _make_workspace(db_session, "own-ws")
    other_ws = await _make_workspace(db_session, "other-ws")
    run = await _make_run_linked(db_session, workspace_ids=[own_ws.id], with_log=True)
    return own_ws, other_ws, run


# ---------------------------------------------------------------------------
# 1. 越权（run 不属于路径 workspace）→ 403
# ---------------------------------------------------------------------------


async def test_get_run_other_workspace_forbidden(
    client: AsyncClient, auth_headers: dict[str, str], db_session: AsyncSession
) -> None:
    _own_ws, other_ws, run = await _setup_two_workspaces(db_session)
    resp = await client.get(
        f"/api/workspaces/{other_ws.id}/agent/runs/{run.id}", headers=auth_headers
    )
    assert resp.status_code == 403


async def test_kill_run_other_workspace_forbidden(
    client: AsyncClient, auth_headers: dict[str, str], db_session: AsyncSession
) -> None:
    _own_ws, other_ws, run = await _setup_two_workspaces(db_session)
    resp = await client.post(
        f"/api/workspaces/{other_ws.id}/agent/runs/{run.id}/kill", headers=auth_headers
    )
    assert resp.status_code == 403
    # 越权 kill 不产生副作用：run 状态原样
    await db_session.refresh(run)
    assert run.status == "running"


async def test_logs_other_workspace_forbidden(
    client: AsyncClient, auth_headers: dict[str, str], db_session: AsyncSession
) -> None:
    _own_ws, other_ws, run = await _setup_two_workspaces(db_session)
    resp = await client.get(
        f"/api/workspaces/{other_ws.id}/agent/runs/{run.id}/logs", headers=auth_headers
    )
    assert resp.status_code == 403


async def test_stream_other_workspace_forbidden(
    client: AsyncClient, auth_headers: dict[str, str], db_session: AsyncSession
) -> None:
    _own_ws, other_ws, run = await _setup_two_workspaces(db_session)
    resp = await client.get(
        f"/api/workspaces/{other_ws.id}/agent/runs/{run.id}/stream", headers=auth_headers
    )
    assert resp.status_code == 403


# ---------------------------------------------------------------------------
# 2. 正常访问（run 属于路径 workspace）→ 200
# ---------------------------------------------------------------------------


async def test_get_run_own_workspace_ok(
    client: AsyncClient, auth_headers: dict[str, str], db_session: AsyncSession
) -> None:
    own_ws, _, run = await _setup_two_workspaces(db_session)
    resp = await client.get(
        f"/api/workspaces/{own_ws.id}/agent/runs/{run.id}", headers=auth_headers
    )
    assert resp.status_code == 200
    assert resp.json()["id"] == str(run.id)


async def test_logs_own_workspace_ok(
    client: AsyncClient, auth_headers: dict[str, str], db_session: AsyncSession
) -> None:
    own_ws, _, run = await _setup_two_workspaces(db_session)
    resp = await client.get(
        f"/api/workspaces/{own_ws.id}/agent/runs/{run.id}/logs", headers=auth_headers
    )
    assert resp.status_code == 200
    assert len(resp.json()) == 1


async def test_kill_run_own_workspace_ok(
    client: AsyncClient, auth_headers: dict[str, str], db_session: AsyncSession
) -> None:
    """无活跃 lease 时 kill 兜底直接置 killed（service.kill_run 语义）。"""
    own_ws, _, run = await _setup_two_workspaces(db_session)
    resp = await client.post(
        f"/api/workspaces/{own_ws.id}/agent/runs/{run.id}/kill", headers=auth_headers
    )
    assert resp.status_code == 200
    await db_session.refresh(run)
    assert run.status == "killed"


async def test_stream_own_workspace_terminal_run_ok(
    client: AsyncClient, auth_headers: dict[str, str], db_session: AsyncSession
) -> None:
    """终态 run 走 stream → 立即回 done 事件（不进生成器，测试不会挂起）。"""
    own_ws = await _make_workspace(db_session, "own-ws-2")
    run = await _make_run_linked(db_session, workspace_ids=[own_ws.id], status_="completed")
    resp = await client.get(
        f"/api/workspaces/{own_ws.id}/agent/runs/{run.id}/stream", headers=auth_headers
    )
    assert resp.status_code == 200
    assert "event: done" in resp.text


# ---------------------------------------------------------------------------
# 3. 无 workspace 关联的 run（quick-chat 形态）→ 403
# ---------------------------------------------------------------------------


async def test_unlinked_run_forbidden(
    client: AsyncClient, auth_headers: dict[str, str], db_session: AsyncSession
) -> None:
    """quick-chat run 无 AgentRunWorkspace 关联 → workspace 路径一律 403
    （quick-chat 走 /api/daemon-chat 专属归属链，不在此暴露）。"""
    any_ws = await _make_workspace(db_session, "any-ws")
    run = AgentRun(agent_type="claude_code", status="pending")
    db_session.add(run)
    await db_session.commit()
    await db_session.refresh(run)

    resp = await client.get(
        f"/api/workspaces/{any_ws.id}/agent/runs/{run.id}", headers=auth_headers
    )
    assert resp.status_code == 403
