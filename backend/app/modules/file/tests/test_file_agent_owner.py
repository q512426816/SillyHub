"""file 模块 agent 归属（agent_session/agent_run）_can_access 测试。

2026-08-23-agent-file-upload-mcp task-02 / FR-04 / D-004@v2：
  - 会话归属：成员可见（download/meta/batch-meta 一致），非成员 404；
    AgentSession.workspace_id 为 NULL → deny（哪怕用户在别的 ws 有读权限）；
    owner_id 指向不存在会话 → 同语义 404
  - run 解析链：target_workspace_id 优先 → mission.workspace_id → task.workspace_id，
    三段各自命中且优先级可证；链全空孤儿 run / 不存在 run → deny
  - uploaded_by 本人与 platform_admin 豁免不回归（优先于归属分支）

测试用户 / workspace / 角色直接落 SQLite in-memory，经真实 has_permission
解析（rbac.py），不 mock 权限层（对齐 test_file_idor 风格）。上传者用普通
用户模拟 daemon API-Key 绑定用户（_can_access 只看 owner_type/owner_id 与
uploaded_by 豁免，不区分上传通道）。
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import Any

from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.security import create_access_token, password_hasher
from app.modules.agent.model import AgentMission, AgentRun, AgentSession
from app.modules.auth.model import Role, RolePermission, User, UserWorkspaceRole
from app.modules.auth.permissions import Permission
from app.modules.change.model import Change
from app.modules.file.tests.conftest import make_id
from app.modules.task.model import Task
from app.modules.workspace.model import Workspace


def _token(user: User) -> str:
    token, _ = create_access_token(
        user_id=user.id,
        email=user.email,
        is_admin=user.is_platform_admin,
        settings=get_settings(),
    )
    return token


def _headers(user: User) -> dict[str, str]:
    return {"Authorization": f"Bearer {_token(user)}"}


async def _make_user(db_session: AsyncSession, *, is_admin: bool = False) -> User:
    user = User(
        id=uuid.uuid4(),
        email=f"agent-file-{uuid.uuid4().hex[:8]}@example.com",
        password_hash=password_hasher.hash("Pass123!"),
        display_name="AgentFile",
        status="active",
        is_platform_admin=is_admin,
    )
    db_session.add(user)
    await db_session.commit()
    await db_session.refresh(user)
    return user


async def _make_workspace_with_read_role(db_session: AsyncSession) -> tuple[Workspace, Role]:
    """建 workspace + 带 workspace:read 的角色（测试 DB 无 seed 角色）。"""
    ws_id = uuid.uuid4()
    ws = Workspace(
        id=ws_id,
        name=f"AgentFile WS {ws_id.hex[:6]}",
        slug=f"agent-file-ws-{ws_id.hex[:6]}",
        root_path=f"/tmp/agent-file-{ws_id.hex}",
        status="active",
    )
    db_session.add(ws)
    role = Role(
        id=uuid.uuid4(),
        key=f"agent_file_member_{ws_id.hex[:6]}",
        name="AgentFile Member",
        description="test role with workspace:read",
    )
    db_session.add(role)
    db_session.add(RolePermission(role_id=role.id, permission=Permission.WORKSPACE_READ.value))
    await db_session.commit()
    await db_session.refresh(ws)
    return ws, role


def _bind_member(db_session: AsyncSession, *, user: User, ws: Workspace, role: Role) -> None:
    db_session.add(
        UserWorkspaceRole(
            user_id=user.id,
            workspace_id=ws.id,
            role_id=role.id,
            granted_by=None,
            granted_at=datetime.now(UTC),
        )
    )


async def _upload(
    file_client: AsyncClient,
    user: User,
    *,
    name: str = "report.png",
    data: bytes = b"\x89PNG\r\n\x1a\n-fake",
    owner_type: str = "",
    owner_id: uuid.UUID | None = None,
) -> str:
    """以 user 身份上传一个文件，返回 file id。"""
    params: dict[str, Any] = {"owner_type": owner_type}
    if owner_id is not None:
        params["owner_id"] = str(owner_id)
    resp = await file_client.post(
        "/api/file/upload",
        headers=_headers(user),
        params=params,
        files={"file": (name, data, "image/png")},
    )
    assert resp.status_code == 201, resp.text
    return resp.json()["id"]


# ── 归属锚点模型工厂（主键可寻，字段取各表 NOT NULL 最小集）────────────────


async def _make_agent_session(
    db_session: AsyncSession, *, user_id: uuid.UUID, workspace_id: uuid.UUID | None
) -> AgentSession:
    sess = AgentSession(
        id=uuid.uuid4(),
        user_id=user_id,
        provider="claude",
        workspace_id=workspace_id,
    )
    db_session.add(sess)
    await db_session.commit()
    return sess


async def _make_mission(db_session: AsyncSession, *, workspace_id: uuid.UUID) -> AgentMission:
    mission = AgentMission(
        id=uuid.uuid4(),
        workspace_id=workspace_id,
        objective="agent file upload test mission",
    )
    db_session.add(mission)
    await db_session.commit()
    return mission


async def _make_task(db_session: AsyncSession, *, workspace_id: uuid.UUID) -> Task:
    """Task.change_id NOT NULL → 顺手建最小 Change 行（同 test_execution_context 模式）。"""
    change_id = uuid.uuid4()
    db_session.add(
        Change(
            id=change_id,
            workspace_id=workspace_id,
            change_key=f"agent-file-{change_id.hex[:6]}",
            title="Agent File Change",
            status="in_progress",
            location="active",
            path=f"/tmp/agent-file-change-{change_id.hex}",
        )
    )
    task = Task(
        id=uuid.uuid4(),
        workspace_id=workspace_id,
        change_id=change_id,
        task_key="task-01",
        status="in_progress",
    )
    db_session.add(task)
    await db_session.commit()
    return task


async def _make_agent_run(
    db_session: AsyncSession,
    *,
    target_workspace_id: uuid.UUID | None = None,
    mission_id: uuid.UUID | None = None,
    task_id: uuid.UUID | None = None,
) -> AgentRun:
    run = AgentRun(
        id=uuid.uuid4(),
        agent_type="claude_code",
        target_workspace_id=target_workspace_id,
        mission_id=mission_id,
        task_id=task_id,
    )
    db_session.add(run)
    await db_session.commit()
    return run


# ── agent_session 归属 ─────────────────────────────────────────────────────


async def test_agent_session_member_visibility_consistent(
    file_client: AsyncClient, db_session: AsyncSession
) -> None:
    """会话归属文件：锚 workspace 成员 download/meta/batch-meta 三口径一致可见。"""
    uploader = await _make_user(db_session)
    member = await _make_user(db_session)
    ws, role = await _make_workspace_with_read_role(db_session)
    _bind_member(db_session, user=member, ws=ws, role=role)
    await db_session.commit()
    sess = await _make_agent_session(db_session, user_id=uploader.id, workspace_id=ws.id)
    fid = await _upload(file_client, uploader, owner_type="agent_session", owner_id=sess.id)

    dl = await file_client.get(f"/api/file/{fid}", headers=_headers(member))
    assert dl.status_code == 200, dl.text
    meta = await file_client.get(f"/api/file/{fid}/meta", headers=_headers(member))
    assert meta.status_code == 200, meta.text
    batch = await file_client.post(
        "/api/file/batch-meta", headers=_headers(member), json={"ids": [fid]}
    )
    assert batch.status_code == 200, batch.text
    assert [row["id"] for row in batch.json()] == [fid]


async def test_agent_session_non_member_404(
    file_client: AsyncClient, db_session: AsyncSession
) -> None:
    """非成员（无该 ws 读权限）访问会话归属文件 → 404（与不存在同语义）。"""
    uploader = await _make_user(db_session)
    outsider = await _make_user(db_session)
    ws, _role = await _make_workspace_with_read_role(db_session)
    sess = await _make_agent_session(db_session, user_id=uploader.id, workspace_id=ws.id)
    fid = await _upload(file_client, uploader, owner_type="agent_session", owner_id=sess.id)

    dl = await file_client.get(f"/api/file/{fid}", headers=_headers(outsider))
    assert dl.status_code == 404, dl.text
    meta = await file_client.get(f"/api/file/{fid}/meta", headers=_headers(outsider))
    assert meta.status_code == 404, meta.text


async def test_agent_session_null_workspace_deny(
    file_client: AsyncClient, db_session: AsyncSession
) -> None:
    """AgentSession.workspace_id NULL → 兜底 deny：他 ws 读权限不放行（锚点失效）。"""
    uploader = await _make_user(db_session)
    other_member = await _make_user(db_session)
    other_ws, other_role = await _make_workspace_with_read_role(db_session)
    _bind_member(db_session, user=other_member, ws=other_ws, role=other_role)
    await db_session.commit()
    # runtime 级会话无 workspace 绑定（列 nullable）
    sess = await _make_agent_session(db_session, user_id=uploader.id, workspace_id=None)
    fid = await _upload(file_client, uploader, owner_type="agent_session", owner_id=sess.id)

    resp = await file_client.get(f"/api/file/{fid}", headers=_headers(other_member))
    assert resp.status_code == 404, resp.text


async def test_agent_session_missing_row_404(
    file_client: AsyncClient, db_session: AsyncSession
) -> None:
    """owner_id 指向不存在的会话 → 无权与不存在同语义 404。"""
    uploader = await _make_user(db_session)
    member = await _make_user(db_session)
    ws, role = await _make_workspace_with_read_role(db_session)
    _bind_member(db_session, user=member, ws=ws, role=role)
    await db_session.commit()
    fid = await _upload(file_client, uploader, owner_type="agent_session", owner_id=make_id())

    resp = await file_client.get(f"/api/file/{fid}", headers=_headers(member))
    assert resp.status_code == 404, resp.text


# ── agent_run 归属（D-004@v2 解析链 target ?? mission ?? task）──────────────


async def test_agent_run_anchor_prefers_target_workspace(
    file_client: AsyncClient, db_session: AsyncSession
) -> None:
    """三段齐备时 target_workspace_id 优先：锚 ws 成员可见，mission/task ws 成员不可见。"""
    uploader = await _make_user(db_session)
    ws_target, role_t = await _make_workspace_with_read_role(db_session)
    ws_mission, role_m = await _make_workspace_with_read_role(db_session)
    ws_task, _role_k = await _make_workspace_with_read_role(db_session)
    member_t = await _make_user(db_session)
    member_m = await _make_user(db_session)
    _bind_member(db_session, user=member_t, ws=ws_target, role=role_t)
    _bind_member(db_session, user=member_m, ws=ws_mission, role=role_m)
    await db_session.commit()
    mission = await _make_mission(db_session, workspace_id=ws_mission.id)
    task = await _make_task(db_session, workspace_id=ws_task.id)
    run = await _make_agent_run(
        db_session,
        target_workspace_id=ws_target.id,
        mission_id=mission.id,
        task_id=task.id,
    )
    fid = await _upload(file_client, uploader, owner_type="agent_run", owner_id=run.id)

    ok = await file_client.get(f"/api/file/{fid}", headers=_headers(member_t))
    assert ok.status_code == 200, ok.text
    denied = await file_client.get(f"/api/file/{fid}", headers=_headers(member_m))
    assert denied.status_code == 404, denied.text


async def test_agent_run_anchor_mission_fallback(
    file_client: AsyncClient, db_session: AsyncSession
) -> None:
    """target 为空 → mission.workspace_id 命中：mission ws 成员可见，task ws 成员不可见。"""
    uploader = await _make_user(db_session)
    ws_mission, role_m = await _make_workspace_with_read_role(db_session)
    ws_task, role_k = await _make_workspace_with_read_role(db_session)
    member_m = await _make_user(db_session)
    member_k = await _make_user(db_session)
    _bind_member(db_session, user=member_m, ws=ws_mission, role=role_m)
    _bind_member(db_session, user=member_k, ws=ws_task, role=role_k)
    await db_session.commit()
    mission = await _make_mission(db_session, workspace_id=ws_mission.id)
    task = await _make_task(db_session, workspace_id=ws_task.id)
    run = await _make_agent_run(
        db_session, target_workspace_id=None, mission_id=mission.id, task_id=task.id
    )
    fid = await _upload(file_client, uploader, owner_type="agent_run", owner_id=run.id)

    ok = await file_client.get(f"/api/file/{fid}", headers=_headers(member_m))
    assert ok.status_code == 200, ok.text
    denied = await file_client.get(f"/api/file/{fid}", headers=_headers(member_k))
    assert denied.status_code == 404, denied.text


async def test_agent_run_anchor_task_fallback(
    file_client: AsyncClient, db_session: AsyncSession
) -> None:
    """target/mission 均空 → task.workspace_id 命中：task ws 成员可见（meta/batch 一致）。"""
    uploader = await _make_user(db_session)
    ws_task, role_k = await _make_workspace_with_read_role(db_session)
    member_k = await _make_user(db_session)
    _bind_member(db_session, user=member_k, ws=ws_task, role=role_k)
    await db_session.commit()
    task = await _make_task(db_session, workspace_id=ws_task.id)
    run = await _make_agent_run(
        db_session, target_workspace_id=None, mission_id=None, task_id=task.id
    )
    fid = await _upload(file_client, uploader, owner_type="agent_run", owner_id=run.id)

    dl = await file_client.get(f"/api/file/{fid}", headers=_headers(member_k))
    assert dl.status_code == 200, dl.text
    meta = await file_client.get(f"/api/file/{fid}/meta", headers=_headers(member_k))
    assert meta.status_code == 200, meta.text
    batch = await file_client.post(
        "/api/file/batch-meta", headers=_headers(member_k), json={"ids": [fid]}
    )
    assert batch.status_code == 200, batch.text
    assert [row["id"] for row in batch.json()] == [fid]


async def test_agent_run_orphan_denied(file_client: AsyncClient, db_session: AsyncSession) -> None:
    """三段全空的孤儿 run → 兜底 deny：他 ws 读权限不放行（锚点缺失）。"""
    uploader = await _make_user(db_session)
    other_member = await _make_user(db_session)
    other_ws, other_role = await _make_workspace_with_read_role(db_session)
    _bind_member(db_session, user=other_member, ws=other_ws, role=other_role)
    await db_session.commit()
    run = await _make_agent_run(db_session)  # target/mission/task 全 None
    fid = await _upload(file_client, uploader, owner_type="agent_run", owner_id=run.id)

    resp = await file_client.get(f"/api/file/{fid}", headers=_headers(other_member))
    assert resp.status_code == 404, resp.text


async def test_agent_run_missing_row_404(
    file_client: AsyncClient, db_session: AsyncSession
) -> None:
    """owner_id 指向不存在的 run → 无权与不存在同语义 404。"""
    uploader = await _make_user(db_session)
    member = await _make_user(db_session)
    ws, role = await _make_workspace_with_read_role(db_session)
    _bind_member(db_session, user=member, ws=ws, role=role)
    await db_session.commit()
    fid = await _upload(file_client, uploader, owner_type="agent_run", owner_id=make_id())

    resp = await file_client.get(f"/api/file/{fid}", headers=_headers(member))
    assert resp.status_code == 404, resp.text


# ── 豁免回归：uploaded_by 本人与 platform_admin 优先于归属分支 ───────────────


async def test_uploader_exempt_for_agent_owner_files(
    file_client: AsyncClient, db_session: AsyncSession
) -> None:
    """上传者本人（无任何 ws 成员资格）可访问自己上传的会话/run 归属文件。"""
    uploader = await _make_user(db_session)
    ws, _role = await _make_workspace_with_read_role(db_session)
    sess = await _make_agent_session(db_session, user_id=uploader.id, workspace_id=ws.id)
    run = await _make_agent_run(db_session, target_workspace_id=ws.id)
    fid_s = await _upload(file_client, uploader, owner_type="agent_session", owner_id=sess.id)
    fid_r = await _upload(file_client, uploader, owner_type="agent_run", owner_id=run.id)

    dl_s = await file_client.get(f"/api/file/{fid_s}", headers=_headers(uploader))
    assert dl_s.status_code == 200, dl_s.text
    dl_r = await file_client.get(f"/api/file/{fid_r}", headers=_headers(uploader))
    assert dl_r.status_code == 200, dl_r.text


async def test_platform_admin_exempt_for_agent_owner_files(
    file_client: AsyncClient, db_session: AsyncSession
) -> None:
    """platform_admin 无成员资格也能访问 agent_run 归属文件（rbac 短路豁免）。"""
    uploader = await _make_user(db_session)
    admin = await _make_user(db_session, is_admin=True)
    ws, _role = await _make_workspace_with_read_role(db_session)
    run = await _make_agent_run(db_session, target_workspace_id=ws.id)
    fid = await _upload(file_client, uploader, owner_type="agent_run", owner_id=run.id)

    resp = await file_client.get(f"/api/file/{fid}", headers=_headers(admin))
    assert resp.status_code == 200, resp.text
