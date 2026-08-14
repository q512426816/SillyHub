"""Tests for mission 级 SSE 端点（task-13 / FR-08）。

覆盖：
- GET events 返 ``text/event-stream`` + 正确帧格式（event 行 + data 行 + 空行）；
- worker run 状态变更（pending→running→终态）逐帧推；
- mission 全终态发 ``done`` 收尾帧；
- 连接池短 session 不泄漏（生成器内部走 ``get_session_factory()`` 短 session，
  已由根 conftest ``_redirect_session_factory`` 重定向到内存库，本身即验证
  短 session 路径可用）。

说明：生成器轮询间隔 ``_POLL_INTERVAL`` 默认 2s，测试里 monkeypatch 成 0 让
流快速推进；通过把 worker 置终态让流在有限帧内发 ``done`` 收尾、自然结束。
"""

from __future__ import annotations

import json
import uuid

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.security import create_access_token, password_hasher
from app.modules.agent.model import AgentMission, AgentRun
from app.modules.auth.model import Role, RolePermission, User, UserWorkspaceRole
from app.modules.auth.permissions import Permission
from app.modules.mcp_gateway import sse as sse_module
from app.modules.workspace.model import Workspace


async def _make_user(session: AsyncSession, *, admin: bool) -> tuple[User, str]:
    user = User(
        id=uuid.uuid4(),
        email=f"user-{uuid.uuid4().hex[:6]}@example.com",
        password_hash=password_hasher.hash("x"),
        status="active",
        is_platform_admin=admin,
    )
    session.add(user)
    await session.commit()
    await session.refresh(user)
    token, _ = create_access_token(
        user_id=user.id,
        email=user.email,
        is_admin=user.is_platform_admin,
        settings=get_settings(),
    )
    return user, token


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


async def _make_mission(session: AsyncSession, workspace_id: uuid.UUID) -> AgentMission:
    mission = AgentMission(
        id=uuid.uuid4(),
        workspace_id=workspace_id,
        objective="test objective",
    )
    session.add(mission)
    await session.commit()
    await session.refresh(mission)
    return mission


def _make_worker(
    mission_id: uuid.UUID,
    *,
    status: str = "pending",
    exit_code: int | None = None,
    error_code: str | None = None,
) -> AgentRun:
    return AgentRun(
        id=uuid.uuid4(),
        mission_id=mission_id,
        agent_type="claude_code",
        role="impl",
        status=status,
        exit_code=exit_code,
        error_code=error_code,
    )


def _parse_frames(body: str) -> list[tuple[str, dict]]:
    """把 SSE body 解析成 [(event_type, data_json), ...]，跳过注释帧（``:`` 开头）。"""
    frames: list[tuple[str, dict]] = []
    for block in body.split("\n\n"):
        block = block.strip("\n")
        if not block or block.startswith(":"):
            continue
        event = None
        data = None
        for line in block.splitlines():
            if line.startswith("event:"):
                event = line[len("event:") :].strip()
            elif line.startswith("data:"):
                data = line[len("data:") :].strip()
        if event is not None and data is not None:
            frames.append((event, json.loads(data)))
    return frames


@pytest.mark.asyncio
async def test_events_returns_event_stream_and_done_when_all_terminal(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    """全 worker 已终态 → 首轮回放 worker_status 帧，随后 done 收尾，媒体类型正确。"""
    ws = await _make_workspace(db_session)
    mission = await _make_mission(db_session, ws.id)
    _, token = await _make_user(db_session, admin=True)
    w = _make_worker(mission.id, status="completed", exit_code=0)
    db_session.add(w)
    await db_session.commit()

    resp = await client.get(
        f"/api/workspaces/{ws.id}/missions/{mission.id}/events",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 200, resp.text
    assert resp.headers["content-type"].startswith("text/event-stream")
    assert resp.headers["cache-control"] == "no-cache, no-transform"

    frames = _parse_frames(resp.text)
    # 首帧：worker_status（completed 回放）；末帧：done。
    assert frames[0][0] == "worker_status"
    assert frames[0][1]["worker_id"] == str(w.id)
    assert frames[0][1]["status"] == "completed"
    assert frames[0][1]["exit_code"] == 0
    assert frames[-1][0] == "done"


@pytest.mark.asyncio
async def test_events_404_for_unknown_mission(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    ws = await _make_workspace(db_session)
    _, token = await _make_user(db_session, admin=True)
    resp = await client.get(
        f"/api/workspaces/{ws.id}/missions/{uuid.uuid4()}/events",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_events_403_for_non_member(client: AsyncClient, db_session: AsyncSession) -> None:
    """非平台 admin 且无 workspace 角色 → require_permission_any(TASK_READ) 403。"""
    ws = await _make_workspace(db_session)
    mission = await _make_mission(db_session, ws.id)
    _, token = await _make_user(db_session, admin=False)
    resp = await client.get(
        f"/api/workspaces/{ws.id}/missions/{mission.id}/events",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 403


@pytest.mark.asyncio
async def test_events_403_for_member_of_other_workspace(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    """task-09（security-audit-remediation）：any 级有 TASK_READ、目标 workspace 无角色 → 403。

    用户在 W2 持有带 ``task:read`` 的角色，请求 W1 的 mission events。收紧前
    ``require_permission_any(TASK_READ)`` 跨 workspace 并集判定放行（越权读 W1
    worker 状态）；收紧为 workspace-scoped ``require_permission(TASK_READ)`` 后
    必须拒绝（403 权限拒绝，非 404 资源隐藏——mission 真实存在于 W1）。
    """
    from datetime import UTC, datetime

    ws1 = await _make_workspace(db_session)
    mission = await _make_mission(db_session, ws1.id)
    ws2 = await _make_workspace(db_session)
    user, token = await _make_user(db_session, admin=False)
    # W1 有一个已终态 worker：收紧前越权用户能拿到它的状态帧（200）；收紧后 403。
    w = _make_worker(mission.id, status="completed", exit_code=0)
    db_session.add(w)

    # W2 的角色带 task:read（合法成员），但用户对 W1 无任何角色。
    role = Role(
        id=uuid.uuid4(),
        key=f"ws_member_{ws2.id.hex[:6]}",
        name="Workspace Member",
        description="test role",
    )
    db_session.add(role)
    db_session.add(RolePermission(role_id=role.id, permission=Permission.TASK_READ.value))
    db_session.add(
        UserWorkspaceRole(
            user_id=user.id,
            workspace_id=ws2.id,
            role_id=role.id,
            granted_by=None,
            granted_at=datetime.now(UTC),
        )
    )
    await db_session.commit()

    resp = await client.get(
        f"/api/workspaces/{ws1.id}/missions/{mission.id}/events",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 403, resp.text


@pytest.mark.asyncio
async def test_events_200_for_workspace_member_with_task_read(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    """task-09 回归：目标 workspace 成员（带 task:read 角色）仍可订阅，帧序列不变。"""
    from datetime import UTC, datetime

    ws = await _make_workspace(db_session)
    mission = await _make_mission(db_session, ws.id)
    user, token = await _make_user(db_session, admin=False)
    w = _make_worker(mission.id, status="completed", exit_code=0)
    db_session.add(w)

    role = Role(
        id=uuid.uuid4(),
        key=f"ws_member_{ws.id.hex[:6]}",
        name="Workspace Member",
        description="test role",
    )
    db_session.add(role)
    db_session.add(RolePermission(role_id=role.id, permission=Permission.TASK_READ.value))
    db_session.add(
        UserWorkspaceRole(
            user_id=user.id,
            workspace_id=ws.id,
            role_id=role.id,
            granted_by=None,
            granted_at=datetime.now(UTC),
        )
    )
    await db_session.commit()

    resp = await client.get(
        f"/api/workspaces/{ws.id}/missions/{mission.id}/events",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 200, resp.text
    frames = _parse_frames(resp.text)
    assert frames[0][0] == "worker_status"
    assert frames[-1][0] == "done"


@pytest.mark.asyncio
async def test_generator_pushes_status_transitions_then_done(
    db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    """直接驱动事件生成器：worker 状态 pending→running→completed 逐帧推，最后 done。

    逐帧拉取（``anext``），每观测到一态就写下一态进库，验证差分发帧逻辑：
    只有状态变化才发帧，全终态后发 done 收尾。用 1ms 轮询间隔让事件循环正常
    轮转（sleep(0) 紧循环对独立 await 调度不可靠）。
    """
    import asyncio

    monkeypatch.setattr(sse_module, "_POLL_INTERVAL", 0.01)

    ws = await _make_workspace(db_session)
    mission = await _make_mission(db_session, ws.id)
    worker = _make_worker(mission.id, status="pending")
    db_session.add(worker)
    await db_session.commit()

    async def _set_status(status: str, exit_code: int | None = None) -> None:
        async with sse_module.get_session_factory()() as s:
            run = await s.get(AgentRun, worker.id)
            run.status = status
            run.exit_code = exit_code
            await s.commit()

    gen = sse_module._mission_event_stream(mission.id)

    async def _next_status_frame() -> tuple[str, dict]:
        """取下一帧非注释帧；返回 (event, data)。"""
        async for raw in gen:
            if raw.startswith(":"):
                continue
            parsed = _parse_frames(raw)
            if parsed:
                return parsed[0]
        raise AssertionError("stream ended before a status frame")

    try:
        # 第 1 帧：pending 回放。
        event, data = await asyncio.wait_for(_next_status_frame(), timeout=5)
        assert (event, data["status"]) == ("worker_status", "pending")

        # 推进 running → 下一帧应观测到 running。
        await _set_status("running")
        event, data = await asyncio.wait_for(_next_status_frame(), timeout=5)
        assert (event, data["status"]) == ("worker_status", "running")

        # 推进 completed → 先发 worker_status(completed)，随后 done 收尾。
        await _set_status("completed", exit_code=0)
        event, data = await asyncio.wait_for(_next_status_frame(), timeout=5)
        assert (event, data["status"]) == ("worker_status", "completed")
        event, data = await asyncio.wait_for(_next_status_frame(), timeout=5)
        assert event == "done"
        assert data["mission_id"] == str(mission.id)
    finally:
        await gen.aclose()
