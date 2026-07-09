"""工作区级对话查询端点测试（task-04 / design AC-7 全分支）。

覆盖 ``GET /api/workspaces/{workspace_id}/dialogs``（task-03 挂载、task-02 实现）：
  - 权限：非成员 403 / 成员 200
  - JOIN 隔离：跨 workspace 的 pending dialog 不串
  - 跨 session 聚合：同 workspace 多 session 的 dialog 都返回
  - session_type 三类：stage / scan / chat（D-003）
  - run_summary：scan/stage 取 lease.prompt；chat 取首条 user 日志；取不到 None
  - status 过滤：只返回 pending

不 mock service / JOIN（[[scan-generate-failure-chain]] 教训）——真实建
Workspace/Member/AgentSession/AgentRun/AgentRunWorkspace/SessionDialogRequest 行
跑真实 JOIN SQL。SQLite in-memory，方言无关断言（[[backend-test-sqlite-vs-pg]]）。
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta

from app.core.config import get_settings
from app.core.security import create_access_token, password_hasher
from app.modules.agent.model import AgentRun, AgentRunLog, AgentSession
from app.modules.auth.model import Role, RolePermission, User, UserWorkspaceRole
from app.modules.daemon.model import DaemonRuntime, DaemonTaskLease, SessionDialogRequest
from app.modules.workspace.model import AgentRunWorkspace, Workspace


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
        email=f"dlg-{uuid.uuid4().hex[:8]}@example.com",
        password_hash=password_hasher.hash("Pass123!"),
        display_name="Dlg",
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
    name: str = "Dialog WS",
) -> tuple[Workspace, Role]:
    """建 workspace + 一个带 task:read 权限的 owner role（测试 DB 无 seed 角色）。

    ``root_path`` 用唯一子目录避免 workspaces.root_path 唯一约束冲突
    （跨 workspace 测试会建多个 ws）。
    """
    ws_id = uuid.uuid4()
    root = tmp_path / f"ws-{ws_id.hex[:6]}"
    root.mkdir()
    ws = Workspace(
        id=ws_id,
        name=name,
        slug=f"dlg-ws-{ws_id.hex[:6]}",
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


def _add_session_run(
    db_session,
    *,
    ws_id: uuid.UUID,
    owner: User,
    mode: str | None,
    change_id: uuid.UUID | None,
    lease_prompt: str | None = None,
    user_log: str | None = None,
    runtime: DaemonRuntime | None = None,
) -> tuple[AgentSession, AgentRun]:
    """建一个 interactive AgentSession + AgentRun + AgentRunWorkspace 关联。

    - ``mode`` 写入 AgentSession.config["mode"]（scan/chat）；stage 由 change_id 非空标记。
    - ``lease_prompt``：scan/stage run 的 DaemonTaskLease.metadata_["prompt"]。
    - ``user_log``：chat run 的首条 channel=="user" 日志（content_redacted）。
    """
    rt = runtime or DaemonRuntime(
        id=uuid.uuid4(),
        user_id=owner.id,
        provider="claude_code",
        status="online",
    )
    if runtime is None:
        db_session.add(rt)

    lease_id = uuid.uuid4()
    session_id = uuid.uuid4()
    run_id = uuid.uuid4()
    config: dict = {"manual_approval": True}
    if mode is not None:
        config["mode"] = mode
    sess = AgentSession(
        id=session_id,
        user_id=owner.id,
        provider="claude",
        status="active",
        config=config,
        turn_count=1,
        runtime_id=rt.id,
        lease_id=lease_id,
        created_at=datetime.now(UTC),
    )
    db_session.add(sess)

    # DaemonTaskLease（interactive，承载 metadata_.prompt）
    lease_meta: dict = {}
    if lease_prompt is not None:
        lease_meta["prompt"] = lease_prompt
    db_session.add(
        DaemonTaskLease(
            id=lease_id,
            runtime_id=rt.id,
            agent_run_id=run_id,
            kind="interactive",
            status="claimed",
            claimed_at=datetime.now(UTC),
            metadata_=lease_meta or None,
        )
    )

    run = AgentRun(
        id=run_id,
        agent_type="claude_code",
        provider="claude",
        status="running",
        change_id=change_id,
        agent_session_id=session_id,
        lease_id=lease_id,
    )
    db_session.add(run)
    db_session.add(AgentRunWorkspace(agent_run_id=run_id, workspace_id=ws_id))

    if user_log is not None:
        db_session.add(
            AgentRunLog(
                id=uuid.uuid4(),
                run_id=run_id,
                channel="user",
                content_redacted=user_log,
                timestamp=datetime.now(UTC),
            )
        )
    return sess, run


def _add_dialog(
    db_session,
    *,
    sess: AgentSession,
    run: AgentRun,
    request_id: str | None = None,
    status: str = "pending",
    tool_name: str = "AskUserQuestion",
) -> SessionDialogRequest:
    row = SessionDialogRequest(
        id=uuid.uuid4(),
        session_id=sess.id,
        run_id=run.id,
        request_id=request_id or f"req-{uuid.uuid4().hex[:8]}",
        tool_name=tool_name,
        dialog_kind="AskUserQuestion",
        dialog_payload={"question": "选哪个?", "options": []},
        status=status,
        created_at=datetime.now(UTC),
    )
    db_session.add(row)
    return row


# ---- 权限：成员 200 / 非成员 403 --------------------------------------------


async def test_member_gets_200_non_member_403(client, db_session, tmp_path):
    """成员（带 task:read role）→ 200；非成员（无 role，非 admin）→ 403。"""
    owner = await _make_user(db_session, is_admin=False)
    outsider = await _make_user(db_session, is_admin=False)
    ws, role = await _make_workspace(db_session, tmp_path)
    _add_member(db_session, user=owner, ws_id=ws.id, role=role)
    sess, run = _add_session_run(db_session, ws_id=ws.id, owner=owner, mode="chat", change_id=None)
    _add_dialog(db_session, sess=sess, run=run)
    await db_session.commit()

    resp_member = await client.get(f"/api/workspaces/{ws.id}/dialogs", headers=_auth(_token(owner)))
    assert resp_member.status_code == 200, resp_member.text
    assert isinstance(resp_member.json(), list)
    assert len(resp_member.json()) == 1

    resp_outsider = await client.get(
        f"/api/workspaces/{ws.id}/dialogs", headers=_auth(_token(outsider))
    )
    assert resp_outsider.status_code == 403


async def test_no_auth_returns_401(client, db_session, tmp_path):
    """未带 token → 401。"""
    owner = await _make_user(db_session, is_admin=False)
    ws, role = await _make_workspace(db_session, tmp_path)
    _add_member(db_session, user=owner, ws_id=ws.id, role=role)
    await db_session.commit()
    resp = await client.get(f"/api/workspaces/{ws.id}/dialogs")
    assert resp.status_code == 401


# ---- JOIN 隔离：跨 workspace 不串 ------------------------------------------


async def test_cross_workspace_isolation(client, db_session, tmp_path):
    """两个 workspace 各一个 pending dialog，查 A 只返回 A 的。"""
    owner = await _make_user(db_session, is_admin=False)
    ws_a, role_a = await _make_workspace(db_session, tmp_path, name="WS-A")
    ws_b, role_b = await _make_workspace(db_session, tmp_path, name="WS-B")
    _add_member(db_session, user=owner, ws_id=ws_a.id, role=role_a)
    _add_member(db_session, user=owner, ws_id=ws_b.id, role=role_b)

    sess_a, run_a = _add_session_run(
        db_session, ws_id=ws_a.id, owner=owner, mode="chat", change_id=None
    )
    sess_b, run_b = _add_session_run(
        db_session, ws_id=ws_b.id, owner=owner, mode="chat", change_id=None
    )
    _add_dialog(db_session, sess=sess_a, run=run_a, request_id="req-a")
    _add_dialog(db_session, sess=sess_b, run=run_b, request_id="req-b")
    await db_session.commit()

    resp = await client.get(f"/api/workspaces/{ws_a.id}/dialogs", headers=_auth(_token(owner)))
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert len(body) == 1
    assert body[0]["request_id"] == "req-a"
    assert body[0]["workspace_name"] == "WS-A"


# ---- 跨 session 聚合 -------------------------------------------------------


async def test_aggregates_across_sessions(client, db_session, tmp_path):
    """同 workspace 下两个不同 session 各一个 pending dialog → 返回 2 条。"""
    owner = await _make_user(db_session, is_admin=False)
    ws, role = await _make_workspace(db_session, tmp_path)
    _add_member(db_session, user=owner, ws_id=ws.id, role=role)
    sess1, run1 = _add_session_run(
        db_session, ws_id=ws.id, owner=owner, mode="chat", change_id=None
    )
    sess2, run2 = _add_session_run(
        db_session, ws_id=ws.id, owner=owner, mode="chat", change_id=None
    )
    _add_dialog(db_session, sess=sess1, run=run1, request_id="req-1")
    _add_dialog(db_session, sess=sess2, run=run2, request_id="req-2")
    await db_session.commit()

    resp = await client.get(f"/api/workspaces/{ws.id}/dialogs", headers=_auth(_token(owner)))
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert len(body) == 2
    ids = {d["request_id"] for d in body}
    assert ids == {"req-1", "req-2"}


# ---- session_type 三类（D-003）--------------------------------------------


async def test_session_type_stage_scan_chat(client, db_session, tmp_path):
    """stage(change_id 非空) / scan(mode==scan,change_id 空) / chat 三类推导。"""
    owner = await _make_user(db_session, is_admin=False)
    ws, role = await _make_workspace(db_session, tmp_path)
    _add_member(db_session, user=owner, ws_id=ws.id, role=role)

    # stage：change_id 非空
    sess_stage, run_stage = _add_session_run(
        db_session,
        ws_id=ws.id,
        owner=owner,
        mode="chat",
        change_id=uuid.uuid4(),
        lease_prompt="生成计划",
    )
    # scan：mode==scan 且 change_id 空
    sess_scan, run_scan = _add_session_run(
        db_session,
        ws_id=ws.id,
        owner=owner,
        mode="scan",
        change_id=None,
        lease_prompt="扫描项目",
    )
    # chat：mode!=scan 且 change_id 空
    sess_chat, run_chat = _add_session_run(
        db_session,
        ws_id=ws.id,
        owner=owner,
        mode="chat",
        change_id=None,
        user_log="帮我改一下登录",
    )
    _add_dialog(db_session, sess=sess_stage, run=run_stage, request_id="req-stage")
    _add_dialog(db_session, sess=sess_scan, run=run_scan, request_id="req-scan")
    _add_dialog(db_session, sess=sess_chat, run=run_chat, request_id="req-chat")
    await db_session.commit()

    resp = await client.get(f"/api/workspaces/{ws.id}/dialogs", headers=_auth(_token(owner)))
    assert resp.status_code == 200, resp.text
    by_req = {d["request_id"]: d for d in resp.json()}
    assert by_req["req-stage"]["session_type"] == "stage"
    assert by_req["req-scan"]["session_type"] == "scan"
    assert by_req["req-chat"]["session_type"] == "chat"

    # run_summary：stage/scan 取 lease.prompt；chat 取首条 user 日志
    assert by_req["req-stage"]["run_summary"] == "生成计划"
    assert by_req["req-scan"]["run_summary"] == "扫描项目"
    assert by_req["req-chat"]["run_summary"] == "帮我改一下登录"


# ---- run_summary 空占位（取不到 → None）-----------------------------------


async def test_run_summary_null_when_no_source(client, db_session, tmp_path):
    """scan run 的 lease 无 prompt + chat run 无 user 日志 → run_summary is None。"""
    owner = await _make_user(db_session, is_admin=False)
    ws, role = await _make_workspace(db_session, tmp_path)
    _add_member(db_session, user=owner, ws_id=ws.id, role=role)

    # scan：无 lease.prompt
    sess_scan, run_scan = _add_session_run(
        db_session, ws_id=ws.id, owner=owner, mode="scan", change_id=None
    )
    # chat：无 user 日志
    sess_chat, run_chat = _add_session_run(
        db_session, ws_id=ws.id, owner=owner, mode="chat", change_id=None
    )
    _add_dialog(db_session, sess=sess_scan, run=run_scan, request_id="req-scan-empty")
    _add_dialog(db_session, sess=sess_chat, run=run_chat, request_id="req-chat-empty")
    await db_session.commit()

    resp = await client.get(f"/api/workspaces/{ws.id}/dialogs", headers=_auth(_token(owner)))
    assert resp.status_code == 200, resp.text
    by_req = {d["request_id"]: d for d in resp.json()}
    assert by_req["req-scan-empty"]["run_summary"] is None
    assert by_req["req-chat-empty"]["run_summary"] is None


async def test_chat_run_summary_takes_latest_user_log(client, db_session, tmp_path):
    """chat run 取最新一条 channel=='user' 日志（多条时取 timestamp 最新）。"""
    owner = await _make_user(db_session, is_admin=False)
    ws, role = await _make_workspace(db_session, tmp_path)
    _add_member(db_session, user=owner, ws_id=ws.id, role=role)
    sess, run = _add_session_run(db_session, ws_id=ws.id, owner=owner, mode="chat", change_id=None)
    base = datetime.now(UTC)
    # 两条 user 日志，第二条更晚 → 应取它
    db_session.add(
        AgentRunLog(
            id=uuid.uuid4(),
            run_id=run.id,
            channel="user",
            content_redacted="旧消息",
            timestamp=base,
        )
    )
    db_session.add(
        AgentRunLog(
            id=uuid.uuid4(),
            run_id=run.id,
            channel="user",
            content_redacted="最新消息",
            timestamp=base + timedelta(seconds=5),
        )
    )
    _add_dialog(db_session, sess=sess, run=run, request_id="req-multi-log")
    await db_session.commit()

    resp = await client.get(f"/api/workspaces/{ws.id}/dialogs", headers=_auth(_token(owner)))
    assert resp.status_code == 200, resp.text
    by_req = {d["request_id"]: d for d in resp.json()}
    assert by_req["req-multi-log"]["run_summary"] == "最新消息"


# ---- status 过滤：只 pending ----------------------------------------------


async def test_only_pending_returned(client, db_session, tmp_path):
    """一个 answered + 一个 pending → 只返回 pending。"""
    owner = await _make_user(db_session, is_admin=False)
    ws, role = await _make_workspace(db_session, tmp_path)
    _add_member(db_session, user=owner, ws_id=ws.id, role=role)
    sess, run = _add_session_run(db_session, ws_id=ws.id, owner=owner, mode="chat", change_id=None)
    _add_dialog(db_session, sess=sess, run=run, request_id="req-pending", status="pending")
    _add_dialog(db_session, sess=sess, run=run, request_id="req-answered", status="answered")
    await db_session.commit()

    resp = await client.get(f"/api/workspaces/{ws.id}/dialogs", headers=_auth(_token(owner)))
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert len(body) == 1
    assert body[0]["request_id"] == "req-pending"


# ---- 空 workspace 返回 [] -------------------------------------------------


async def test_empty_workspace_returns_empty_list(client, db_session, tmp_path):
    """无 pending dialog 的 workspace → []（非 None）。"""
    owner = await _make_user(db_session, is_admin=False)
    ws, role = await _make_workspace(db_session, tmp_path)
    _add_member(db_session, user=owner, ws_id=ws.id, role=role)
    await db_session.commit()

    resp = await client.get(f"/api/workspaces/{ws.id}/dialogs", headers=_auth(_token(owner)))
    assert resp.status_code == 200, resp.text
    assert resp.json() == []
