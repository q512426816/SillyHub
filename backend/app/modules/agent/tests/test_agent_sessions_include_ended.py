"""agent-sessions 端点 include_ended 参数测试（task-06 / FR-03c / D-002@v1）。

覆盖 ``GET /api/workspaces/{workspace_id}/agent-sessions``：
  - include_ended=false（缺省）：现状——仅 active 会话最小字段 dict（回归护栏，
    既有 approvals 聚合调用方不被破坏）
  - include_ended=true：返回含已结束会话的完整 AgentSessionListItem
    （id/provider/status/turn_count/author/last_active_at/title，对齐 daemon/schema.py:71-84）
  - 排序 coalesce(last_active_at, created_at) desc
  - 标题取该会话最早一条 channel=user_input 的 AgentRunLog 摘要（前 30 字）
  - 权限：成员 200 / 非成员 403；跨 workspace 隔离；软删过滤；mode 过滤仍生效

不 mock service / JOIN——真实建 Workspace/Member/AgentSession/AgentRun/AgentRunLog
行跑真实 SQL（SQLite in-memory，方言无关断言，[[backend-test-sqlite-vs-pg]]）。
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta

from app.core.config import get_settings
from app.core.security import create_access_token, password_hasher
from app.modules.agent.model import AgentRun, AgentRunLog, AgentSession
from app.modules.auth.model import Role, RolePermission, User, UserWorkspaceRole
from app.modules.workspace.model import AgentRunWorkspace, Workspace

EXPECTED_ITEM_FIELDS = {
    "id",
    "provider",
    "status",
    "mode",
    "turn_count",
    "author",
    "last_active_at",
    "title",
}


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def _token(user: User) -> str:
    token, _ = create_access_token(
        user_id=user.id,
        email=user.email,
        is_admin=user.is_platform_admin,
        settings=get_settings(),
    )
    return token


async def _make_user(db_session, *, is_admin: bool = False) -> User:
    user = User(
        id=uuid.uuid4(),
        email=f"sess-{uuid.uuid4().hex[:8]}@example.com",
        password_hash=password_hasher.hash("Pass123!"),
        display_name="会话主人",
        status="active",
        is_platform_admin=is_admin,
    )
    db_session.add(user)
    await db_session.commit()
    await db_session.refresh(user)
    return user


async def _make_workspace(
    db_session,
    tmp_path,
    *,
    name: str = "Sessions WS",
) -> tuple[Workspace, Role]:
    """建 workspace + 一个带 task:read 权限的 owner role（测试 DB 无 seed 角色）。"""
    ws_id = uuid.uuid4()
    root = tmp_path / f"ws-{ws_id.hex[:6]}"
    root.mkdir()
    ws = Workspace(
        id=ws_id,
        name=name,
        slug=f"sess-ws-{ws_id.hex[:6]}",
        root_path=str(root),
        status="active",
    )
    db_session.add(ws)
    role_id = uuid.uuid4()
    role = Role(
        id=role_id,
        key=f"ws_owner_{ws_id.hex[:6]}",
        name="Workspace Owner",
        description="test role",
    )
    db_session.add(role)
    db_session.add(RolePermission(role_id=role_id, permission="task:read"))
    await db_session.commit()
    await db_session.refresh(ws)
    return ws, role


def _add_member(db_session, *, user: User, ws_id: uuid.UUID, role: Role) -> None:
    """把用户加为 workspace 成员（绑定带 task:read 的 role）。"""
    db_session.add(
        UserWorkspaceRole(
            user_id=user.id,
            workspace_id=ws_id,
            role_id=role.id,
            granted_by=None,
            granted_at=datetime.now(UTC),
        )
    )


def _add_session(
    db_session,
    *,
    ws_id: uuid.UUID,
    owner: User,
    status: str = "active",
    mode: str | None = None,
    turn_count: int = 1,
    created_at: datetime | None = None,
    last_active_at: datetime | None = None,
    deleted_at: datetime | None = None,
    user_log: str | None = None,
) -> AgentSession:
    """建一个 workspace 级 AgentSession（对齐 daemon create_session 写 workspace_id）。

    始终附带一个 AgentRun + AgentRunWorkspace 关联——active-only 分支走
    AgentRun→AgentRunWorkspace JOIN，include_ended 分支走 AgentSession.workspace_id
    直列过滤，两者都需要 run 行存在。``user_log`` 非空时写首条
    channel=user_input 日志（标题来源）。
    """
    config: dict = {}
    if mode is not None:
        config["mode"] = mode
    now = datetime.now(UTC)
    sess = AgentSession(
        id=uuid.uuid4(),
        user_id=owner.id,
        provider="claude",
        status=status,
        config=config or None,
        turn_count=turn_count,
        workspace_id=ws_id,
        created_at=created_at or now,
        last_active_at=last_active_at,
        deleted_at=deleted_at,
    )
    db_session.add(sess)
    run = AgentRun(
        id=uuid.uuid4(),
        agent_type="claude_code",
        provider="claude",
        status="completed",
        agent_session_id=sess.id,
    )
    db_session.add(run)
    db_session.add(AgentRunWorkspace(agent_run_id=run.id, workspace_id=ws_id))
    if user_log is not None:
        db_session.add(
            AgentRunLog(
                id=uuid.uuid4(),
                run_id=run.id,
                channel="user_input",
                content_redacted=user_log,
                timestamp=created_at or now,
            )
        )
    return sess


async def _seed_workspace(db_session, tmp_path):
    """建 owner + workspace + 成员，返回 (owner, ws)。"""
    owner = await _make_user(db_session)
    ws, role = await _make_workspace(db_session, tmp_path)
    _add_member(db_session, user=owner, ws_id=ws.id, role=role)
    await db_session.commit()
    return owner, ws


# ---- include_ended=false：现状（回归护栏）----------------------------------


async def test_default_active_only_minimal_fields(client, db_session, tmp_path):
    """缺省（及显式 include_ended=false）：仅 active 会话 + 最小字段 dict。"""
    owner, ws = await _seed_workspace(db_session, tmp_path)
    _add_session(
        db_session,
        ws_id=ws.id,
        owner=owner,
        status="active",
        mode="scan",
        user_log="活跃会话",
    )
    _add_session(db_session, ws_id=ws.id, owner=owner, status="ended", user_log="已结束")
    await db_session.commit()

    resp = await client.get(f"/api/workspaces/{ws.id}/agent-sessions", headers=_auth(_token(owner)))
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert len(body) == 1
    assert set(body[0].keys()) == {"id", "status", "mode", "provider"}
    assert body[0]["status"] == "active"
    assert body[0]["mode"] == "scan"

    resp2 = await client.get(
        f"/api/workspaces/{ws.id}/agent-sessions?include_ended=false",
        headers=_auth(_token(owner)),
    )
    assert resp2.status_code == 200, resp2.text
    assert len(resp2.json()) == 1
    assert resp2.json()[0]["status"] == "active"


# ---- include_ended=true：完整字段 + 含已结束 --------------------------------


async def test_include_ended_returns_full_items_with_ended(client, db_session, tmp_path):
    """include_ended=true：active + ended 都返回，字段对齐 AgentSessionListItem。"""
    owner, ws = await _seed_workspace(db_session, tmp_path)
    now = datetime.now(UTC)
    active = _add_session(
        db_session,
        ws_id=ws.id,
        owner=owner,
        status="active",
        turn_count=3,
        created_at=now - timedelta(minutes=30),
        last_active_at=now - timedelta(minutes=1),
        user_log="帮我推进变更 A",
    )
    ended = _add_session(
        db_session,
        ws_id=ws.id,
        owner=owner,
        status="ended",
        turn_count=5,
        created_at=now - timedelta(days=1),
        last_active_at=now - timedelta(hours=2),
        user_log="结束的会话标题",
    )
    await db_session.commit()

    resp = await client.get(
        f"/api/workspaces/{ws.id}/agent-sessions?include_ended=true",
        headers=_auth(_token(owner)),
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert len(body) == 2
    by_id = {item["id"]: item for item in body}

    item_active = by_id[str(active.id)]
    assert set(item_active.keys()) == EXPECTED_ITEM_FIELDS
    assert item_active["provider"] == "claude"
    assert item_active["status"] == "active"
    assert item_active["turn_count"] == 3
    assert item_active["author"] == {"user_id": str(owner.id), "display_name": "会话主人"}
    assert item_active["title"] == "帮我推进变更 A"
    assert item_active["last_active_at"] is not None

    item_ended = by_id[str(ended.id)]
    assert item_ended["status"] == "ended"
    assert item_ended["turn_count"] == 5
    assert item_ended["title"] == "结束的会话标题"


# ---- 排序：coalesce(last_active_at, created_at) desc ------------------------


async def test_sort_by_coalesce_last_active_at_created_at(client, db_session, tmp_path):
    """有 last_active_at 排前；无 last_active_at 回落 created_at（新的前）。"""
    owner, ws = await _seed_workspace(db_session, tmp_path)
    now = datetime.now(UTC)
    a = _add_session(
        db_session,
        ws_id=ws.id,
        owner=owner,
        status="ended",
        created_at=now - timedelta(days=3),
        last_active_at=now - timedelta(minutes=5),
    )
    b = _add_session(
        db_session,
        ws_id=ws.id,
        owner=owner,
        status="ended",
        created_at=now - timedelta(hours=1),
        last_active_at=None,
    )
    c = _add_session(
        db_session,
        ws_id=ws.id,
        owner=owner,
        status="ended",
        created_at=now - timedelta(days=10),
        last_active_at=None,
    )
    await db_session.commit()

    resp = await client.get(
        f"/api/workspaces/{ws.id}/agent-sessions?include_ended=true",
        headers=_auth(_token(owner)),
    )
    assert resp.status_code == 200, resp.text
    ids = [item["id"] for item in resp.json()]
    assert ids == [str(a.id), str(b.id), str(c.id)]


# ---- 标题：首条 user_input + 30 字截断 --------------------------------------


async def test_title_takes_earliest_user_input(client, db_session, tmp_path):
    """同一会话多条 user_input 日志 → 取最早一条为标题。"""
    owner, ws = await _seed_workspace(db_session, tmp_path)
    now = datetime.now(UTC)
    sess = _add_session(
        db_session,
        ws_id=ws.id,
        owner=owner,
        status="ended",
        created_at=now,
        user_log="较晚的一条",
    )
    run = AgentRun(
        id=uuid.uuid4(),
        agent_type="claude_code",
        provider="claude",
        status="completed",
        agent_session_id=sess.id,
    )
    db_session.add(run)
    db_session.add(AgentRunWorkspace(agent_run_id=run.id, workspace_id=ws.id))
    db_session.add(
        AgentRunLog(
            id=uuid.uuid4(),
            run_id=run.id,
            channel="user_input",
            content_redacted="最早的一句话",
            timestamp=now - timedelta(minutes=10),
        )
    )
    await db_session.commit()

    resp = await client.get(
        f"/api/workspaces/{ws.id}/agent-sessions?include_ended=true",
        headers=_auth(_token(owner)),
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert len(body) == 1
    assert body[0]["title"] == "最早的一句话"


async def test_title_truncated_to_30_chars(client, db_session, tmp_path):
    """超过 30 字的 user_input 标题截断为前 30 字。"""
    owner, ws = await _seed_workspace(db_session, tmp_path)
    long_title = "请帮我全面重构登录模块的鉴权逻辑并补充完整单元测试覆盖关键路径"
    _add_session(
        db_session,
        ws_id=ws.id,
        owner=owner,
        status="ended",
        user_log=long_title,
    )
    await db_session.commit()

    resp = await client.get(
        f"/api/workspaces/{ws.id}/agent-sessions?include_ended=true",
        headers=_auth(_token(owner)),
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert len(body) == 1
    assert len(long_title) > 30
    assert body[0]["title"] == long_title[:30]


async def test_title_none_without_user_input(client, db_session, tmp_path):
    """无 user_input 日志的会话 → title is None。"""
    owner, ws = await _seed_workspace(db_session, tmp_path)
    _add_session(db_session, ws_id=ws.id, owner=owner, status="ended", user_log=None)
    await db_session.commit()

    resp = await client.get(
        f"/api/workspaces/{ws.id}/agent-sessions?include_ended=true",
        headers=_auth(_token(owner)),
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert len(body) == 1
    assert body[0]["title"] is None
    assert body[0]["last_active_at"] is None


# ---- 权限 / 隔离 / 过滤 -----------------------------------------------------


async def test_non_member_403(client, db_session, tmp_path):
    """非成员（无 role，非 admin）→ 403。"""
    owner = await _make_user(db_session)
    outsider = await _make_user(db_session)
    ws, role = await _make_workspace(db_session, tmp_path)
    _add_member(db_session, user=owner, ws_id=ws.id, role=role)
    await db_session.commit()

    resp = await client.get(
        f"/api/workspaces/{ws.id}/agent-sessions?include_ended=true",
        headers=_auth(_token(outsider)),
    )
    assert resp.status_code == 403


async def test_cross_workspace_isolation(client, db_session, tmp_path):
    """两个 workspace 各含已结束会话，查 A 只返回 A 的。"""
    owner = await _make_user(db_session)
    ws_a, role_a = await _make_workspace(db_session, tmp_path, name="WS-A")
    ws_b, role_b = await _make_workspace(db_session, tmp_path, name="WS-B")
    _add_member(db_session, user=owner, ws_id=ws_a.id, role=role_a)
    _add_member(db_session, user=owner, ws_id=ws_b.id, role=role_b)
    sess_a = _add_session(db_session, ws_id=ws_a.id, owner=owner, status="ended", user_log="A 会话")
    _add_session(db_session, ws_id=ws_b.id, owner=owner, status="ended", user_log="B 会话")
    await db_session.commit()

    resp = await client.get(
        f"/api/workspaces/{ws_a.id}/agent-sessions?include_ended=true",
        headers=_auth(_token(owner)),
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert len(body) == 1
    assert body[0]["id"] == str(sess_a.id)


async def test_soft_deleted_session_excluded(client, db_session, tmp_path):
    """deleted_at 非空（软删）的会话不返回（FR-07）。"""
    owner, ws = await _seed_workspace(db_session, tmp_path)
    _add_session(db_session, ws_id=ws.id, owner=owner, status="ended", user_log="可见")
    _add_session(
        db_session,
        ws_id=ws.id,
        owner=owner,
        status="ended",
        user_log="软删",
        deleted_at=datetime.now(UTC),
    )
    await db_session.commit()

    resp = await client.get(
        f"/api/workspaces/{ws.id}/agent-sessions?include_ended=true",
        headers=_auth(_token(owner)),
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert len(body) == 1
    assert body[0]["title"] == "可见"


async def test_mode_filter_applies_with_include_ended(client, db_session, tmp_path):
    """include_ended=true + mode 过滤：只返回 config['mode']==scan 的会话。"""
    owner, ws = await _seed_workspace(db_session, tmp_path)
    _add_session(
        db_session, ws_id=ws.id, owner=owner, status="ended", mode="scan", user_log="扫描会话"
    )
    _add_session(
        db_session, ws_id=ws.id, owner=owner, status="ended", mode="chat", user_log="聊天会话"
    )
    await db_session.commit()

    resp = await client.get(
        f"/api/workspaces/{ws.id}/agent-sessions?include_ended=true&mode=scan",
        headers=_auth(_token(owner)),
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert len(body) == 1
    assert body[0]["title"] == "扫描会话"


async def test_empty_workspace_returns_empty_list(client, db_session, tmp_path):
    """无会话的 workspace → []（非 None）。"""
    owner, ws = await _seed_workspace(db_session, tmp_path)
    await db_session.commit()

    resp = await client.get(
        f"/api/workspaces/{ws.id}/agent-sessions?include_ended=true",
        headers=_auth(_token(owner)),
    )
    assert resp.status_code == 200, resp.text
    assert resp.json() == []


# ---- P5（2026-08-24 会话审查）：include_ended 分支分页 ------------------------


async def test_include_ended_paginated_by_limit_offset(client, db_session, tmp_path):
    """limit/offset 分页：按 coalesce(last_active_at, created_at) desc 截页。"""
    owner, ws = await _seed_workspace(db_session, tmp_path)
    now = datetime.now(UTC)
    sessions = [
        _add_session(
            db_session,
            ws_id=ws.id,
            owner=owner,
            status="ended",
            created_at=now - timedelta(minutes=i),
            user_log=f"会话{i}",
        )
        for i in range(4)  # created_at 递减 → 列表顺序 sess0..sess3
    ]
    await db_session.commit()

    # limit=2 → 最新两条（sess0/sess1）
    resp = await client.get(
        f"/api/workspaces/{ws.id}/agent-sessions?include_ended=true&limit=2",
        headers=_auth(_token(owner)),
    )
    assert resp.status_code == 200
    ids = [item["id"] for item in resp.json()]
    assert ids == [str(sessions[0].id), str(sessions[1].id)]

    # offset=2 → 较旧两条（sess2/sess3）
    resp2 = await client.get(
        f"/api/workspaces/{ws.id}/agent-sessions?include_ended=true&limit=2&offset=2",
        headers=_auth(_token(owner)),
    )
    assert resp2.status_code == 200
    ids2 = [item["id"] for item in resp2.json()]
    assert ids2 == [str(sessions[2].id), str(sessions[3].id)]


async def test_include_ended_default_limit_bounds_query(client, db_session, tmp_path):
    """缺省 limit=200：老 workspace 数千会话不再无界全量返回。"""
    owner, ws = await _seed_workspace(db_session, tmp_path)
    for i in range(3):  # 少量造数验证缺省参数不报错即可（上限 200 由 FastAPI 校验）
        _add_session(
            db_session,
            ws_id=ws.id,
            owner=owner,
            status="ended",
            created_at=datetime.now(UTC) - timedelta(minutes=i),
            user_log=f"s{i}",
        )
    await db_session.commit()

    resp = await client.get(
        f"/api/workspaces/{ws.id}/agent-sessions?include_ended=true",
        headers=_auth(_token(owner)),
    )
    assert resp.status_code == 200
    assert len(resp.json()) == 3
