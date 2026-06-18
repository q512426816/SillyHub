"""Tests for ``GET /agent-runs/{run_id}/execution-context`` path_source 分支。

覆盖 ``2026-06-18-workspace-client-path`` task-07（grill X-001 修正）：

- AC-03/04：``workspace_id`` 作为顶层响应字段透传（server-local / daemon-client）。
- AC-05：``path_source == "daemon-client"`` 时 ``spec_root`` 硬约束为 ``None``
  （即使 lease_meta 含 backend 机器 spec_root 也不透传）—— grill X-001 核心。
- AC-06：``path_source == "server-local"`` 且 scan run 时 ``spec_root`` 来自
  ``lease_meta["spec_root"]``（现状字节级兼容）。
- AC-07：server-local task/stage run ``spec_root`` 为 None（task/stage 无 spec_root 概念）。
- AC-08：quick-chat run（无 workspace 关联）两字段均 None。
- AC-09：lease_meta 缺 spec_root key 时回退 None（不报错、不返回空串）。
- AC-10：scan bundle 渲染（claude_md 含 "sillyspec run scan"）不回归。
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

from app.core.config import get_settings
from app.core.security import create_access_token, password_hasher
from app.modules.agent.model import AgentRun
from app.modules.auth.model import User
from app.modules.change.model import Change
from app.modules.daemon.model import DaemonRuntime, DaemonTaskLease
from app.modules.task.model import Task
from app.modules.workspace.model import AgentRunWorkspace, Workspace


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


async def _make_user(db_session, *, is_admin: bool = True) -> User:
    user = User(
        id=uuid.uuid4(),
        email=f"ps-{uuid.uuid4().hex[:8]}@example.com",
        password_hash=password_hasher.hash("Pass123!"),
        display_name="PS",
        status="active",
        is_platform_admin=is_admin,
    )
    db_session.add(user)
    await db_session.commit()
    await db_session.refresh(user)
    return user


def _token(user: User) -> str:
    token, _ = create_access_token(
        user_id=user.id,
        email=user.email,
        is_admin=user.is_platform_admin,
        settings=get_settings(),
    )
    return token


async def _make_run(
    db_session,
    tmp_path,
    owner: User,
    *,
    run_type: str = "task",
    lease_meta: dict | None = None,
    path_source: str = "server-local",
) -> tuple[uuid.UUID, uuid.UUID | None]:
    """构造 task / stage / scan run + workspace + change + lease。

    与 ``test_execution_context._make_run`` 同构，但允许指定 ``path_source``，
    并在 daemon-client 时绑定 ``daemon_runtime_id``（task-01 schema 要求）。
    返回 ``(run_id, workspace_id)`` —— workspace_id 为 None 表示 quick-chat run。

    owner 同时被加为 workspace 成员（与生产路径一致；admin owner 自动放行）。
    """
    from app.modules.auth.model import Role, UserWorkspaceRole

    ws_id = uuid.uuid4()
    daemon_runtime_id: uuid.UUID | None = None
    if path_source == "daemon-client":
        daemon_runtime_id = uuid.uuid4()
        db_session.add(
            DaemonRuntime(
                id=daemon_runtime_id,
                user_id=owner.id,
                name=f"ps-daemon-{daemon_runtime_id.hex[:6]}",
                provider="claude_code",
                status="online",
                last_heartbeat_at=datetime.now(UTC),
            )
        )

    db_session.add(
        Workspace(
            id=ws_id,
            name=f"PS WS {ws_id.hex[:6]}",
            slug=f"ps-ws-{ws_id.hex[:6]}",
            root_path=str(tmp_path),
            path_source=path_source,
            daemon_runtime_id=daemon_runtime_id,
            status="active",
            created_by=owner.id,
        )
    )

    owner_role_id = uuid.uuid4()
    db_session.add(
        Role(
            id=owner_role_id,
            key="workspace_owner",
            name="Workspace Owner",
            description="test role",
        )
    )
    db_session.add(
        UserWorkspaceRole(
            user_id=owner.id,
            workspace_id=ws_id,
            role_id=owner_role_id,
            granted_by=None,
            granted_at=datetime.now(UTC),
        )
    )

    change_id = uuid.uuid4()
    db_session.add(
        Change(
            id=change_id,
            workspace_id=ws_id,
            change_key=f"ps-{change_id.hex[:6]}",
            title="PS Change",
            status="in_progress",
            location="change",
            path=str(tmp_path / "change"),
        )
    )

    task_id = uuid.uuid4() if run_type == "task" else None
    if task_id is not None:
        db_session.add(
            Task(
                id=task_id,
                workspace_id=ws_id,
                change_id=change_id,
                task_key="task-01",
                title="PS Task",
                status="in_progress",
                allowed_paths=["src/"],
            )
        )

    agent_type = {
        "task": "claude_code",
        "stage": "stage_dispatch",
        "scan": "scan",
    }[run_type]
    run_id = uuid.uuid4()
    db_session.add(
        AgentRun(
            id=run_id,
            task_id=task_id,
            change_id=change_id,
            agent_type=agent_type,
            status="pending",
        )
    )
    db_session.add(AgentRunWorkspace(agent_run_id=run_id, workspace_id=ws_id))

    # server-local 也需要一个 DaemonRuntime 来挂 lease（_fetch_active_lease_meta 查询）。
    if daemon_runtime_id is None:
        daemon_runtime_id = uuid.uuid4()
        db_session.add(
            DaemonRuntime(
                id=daemon_runtime_id,
                user_id=owner.id,
                name=f"ps-daemon-{daemon_runtime_id.hex[:6]}",
                provider="claude_code",
                status="online",
                last_heartbeat_at=datetime.now(UTC),
            )
        )
    db_session.add(
        DaemonTaskLease(
            id=uuid.uuid4(),
            runtime_id=daemon_runtime_id,
            agent_run_id=run_id,
            status="pending",
            metadata_=lease_meta or {},
        )
    )
    await db_session.commit()
    return run_id, ws_id


async def _make_quick_chat_run(
    db_session,
    tmp_path,
    owner: User,
    *,
    lease_meta: dict | None = None,
) -> uuid.UUID:
    """构造无 workspace 关联的 quick-chat run（workspace_id 为 None）。

    quick-chat 在 V1 简化模型下不建 AgentRunWorkspace 关联。
    Change / Task 的 workspace_id 是 NOT NULL，所以挂一个临时 workspace 给它们，
    但 AgentRun 本身故意不建 AgentRunWorkspace 关联 →
    ``_resolve_workspace_id`` 返回 None → ws_row 为 None → path_source 兜底
    server-local → response 落 task/stage 分支 → spec_root=None（AC-08）。
    """
    rt_id = uuid.uuid4()
    db_session.add(
        DaemonRuntime(
            id=rt_id,
            user_id=owner.id,
            name=f"qc-daemon-{rt_id.hex[:6]}",
            provider="claude_code",
            status="online",
            last_heartbeat_at=datetime.now(UTC),
        )
    )
    # 临时 workspace 仅用于挂 change/task（满足 NOT NULL），run 本身不绑它。
    tmp_ws_id = uuid.uuid4()
    db_session.add(
        Workspace(
            id=tmp_ws_id,
            name=f"QC tmp WS {tmp_ws_id.hex[:6]}",
            slug=f"qc-tmp-ws-{tmp_ws_id.hex[:6]}",
            root_path=str(tmp_path / "qc-tmp"),
            path_source="server-local",
            status="active",
            created_by=owner.id,
        )
    )
    change_id = uuid.uuid4()
    task_id = uuid.uuid4()
    db_session.add(
        Change(
            id=change_id,
            workspace_id=tmp_ws_id,
            change_key=f"qc-{change_id.hex[:6]}",
            title="QC Change",
            status="in_progress",
            location="change",
            path=str(tmp_path / "qc-change"),
        )
    )
    db_session.add(
        Task(
            id=task_id,
            workspace_id=tmp_ws_id,
            change_id=change_id,
            task_key="qc-task",
            title="QC Task",
            status="in_progress",
            allowed_paths=["src/"],
        )
    )
    run_id = uuid.uuid4()
    db_session.add(
        AgentRun(
            id=run_id,
            task_id=task_id,
            change_id=change_id,
            agent_type="claude_code",
            status="pending",
        )
    )
    # 故意不建 AgentRunWorkspace —— 这是 quick-chat 的定义特征。
    db_session.add(
        DaemonTaskLease(
            id=uuid.uuid4(),
            runtime_id=rt_id,
            agent_run_id=run_id,
            status="pending",
            metadata_=lease_meta or {"prompt": "quick"},
        )
    )
    await db_session.commit()
    return run_id


# ---- AC-03 / AC-04：workspace_id 顶层透传 ---------------------------------


async def test_response_includes_workspace_id_server_local(client, db_session, tmp_path):
    """AC-03：server-local workspace + task run → workspace_id 透传到顶层字段。"""
    owner = await _make_user(db_session)
    run_id, ws_id = await _make_run(
        db_session,
        tmp_path,
        owner,
        run_type="task",
        path_source="server-local",
        lease_meta={"prompt": "x"},
    )
    resp = await client.get(
        f"/api/agent-runs/{run_id}/execution-context",
        headers=_auth(_token(owner)),
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["workspace_id"] == str(ws_id)


async def test_response_includes_workspace_id_daemon_client(client, db_session, tmp_path):
    """AC-04：daemon-client workspace（带 daemon_runtime_id）+ task run → workspace_id 透传。"""
    owner = await _make_user(db_session)
    run_id, ws_id = await _make_run(
        db_session,
        tmp_path,
        owner,
        run_type="task",
        path_source="daemon-client",
        lease_meta={"prompt": "x"},
    )
    resp = await client.get(
        f"/api/agent-runs/{run_id}/execution-context",
        headers=_auth(_token(owner)),
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["workspace_id"] == str(ws_id)


# ---- AC-05：daemon-client spec_root 硬约束 None（grill X-001）---------------


async def test_spec_root_none_for_daemon_client(client, db_session, tmp_path):
    """AC-05：daemon-client workspace + scan run（lease_meta 含 backend spec_root）
    → response.spec_root 一定为 None（grill X-001 硬约束）。

    注意：claude_md 内仍渲染 backend spec_root（scan bundle 内不变），
    但顶层 response.spec_root 必须为 None。
    """
    owner = await _make_user(db_session)
    backend_spec_root = str(tmp_path / "spec_backend")
    run_id, _ws_id = await _make_run(
        db_session,
        tmp_path,
        owner,
        run_type="scan",
        path_source="daemon-client",
        lease_meta={
            "root_path": str(tmp_path),
            "spec_root": backend_spec_root,
            "runtime_root": str(tmp_path / "rt"),
        },
    )
    resp = await client.get(
        f"/api/agent-runs/{run_id}/execution-context",
        headers=_auth(_token(owner)),
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["spec_root"] is None, (
        f"daemon-client spec_root must be None (grill X-001), got: {body['spec_root']!r}"
    )


# ---- AC-06：server-local scan 时 spec_root 来自 lease_meta（现状兼容）------


async def test_spec_root_from_lease_meta_for_server_local_scan(client, db_session, tmp_path):
    """AC-06：server-local + scan run（lease_meta spec_root）→ response.spec_root == lease_meta 值。"""
    owner = await _make_user(db_session)
    spec_root = "/srv/specs/x"
    run_id, _ws_id = await _make_run(
        db_session,
        tmp_path,
        owner,
        run_type="scan",
        path_source="server-local",
        lease_meta={
            "root_path": str(tmp_path),
            "spec_root": spec_root,
            "runtime_root": str(tmp_path / "rt"),
        },
    )
    resp = await client.get(
        f"/api/agent-runs/{run_id}/execution-context",
        headers=_auth(_token(owner)),
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["spec_root"] == spec_root


# ---- AC-07：server-local task/stage spec_root None -----------------------


async def test_spec_root_none_for_server_local_task(client, db_session, tmp_path):
    """AC-07：server-local + task run → spec_root 为 None（task/stage 无 spec_root 概念）。"""
    owner = await _make_user(db_session)
    run_id, _ws_id = await _make_run(
        db_session,
        tmp_path,
        owner,
        run_type="task",
        path_source="server-local",
        lease_meta={"prompt": "x"},
    )
    resp = await client.get(
        f"/api/agent-runs/{run_id}/execution-context",
        headers=_auth(_token(owner)),
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["spec_root"] is None


# ---- AC-08：quick-chat run（无 workspace）两字段均 None -------------------


async def test_spec_root_none_for_quick_chat_no_workspace(client, db_session, tmp_path):
    """AC-08：quick-chat run（无 AgentRunWorkspace 关联）→ workspace_id is None 且
    spec_root is None。

    注意：本用例构造的 run 有 task_id（满足 _determine_run_type），
    但故意不建 AgentRunWorkspace → _resolve_workspace_id 返回 None。
    """
    owner = await _make_user(db_session)
    run_id = await _make_quick_chat_run(db_session, tmp_path, owner, lease_meta={"prompt": "qc"})
    resp = await client.get(
        f"/api/agent-runs/{run_id}/execution-context",
        headers=_auth(_token(owner)),
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["workspace_id"] is None
    assert body["spec_root"] is None


# ---- AC-09：lease_meta 缺 spec_root key 时回退 None -----------------------


async def test_spec_root_none_when_lease_meta_missing_spec_root(client, db_session, tmp_path):
    """AC-09：server-local + scan run 但 lease_meta 无 spec_root key
    → response.spec_root is None（``lease_meta.get("spec_root") or None`` 回退）。

    注意：_determine_run_type 需要 root_path 或 agent_type=="scan" 才能判定 scan。
    这里 lease_meta 故意只给 root_path 不给 spec_root。
    """
    owner = await _make_user(db_session)
    run_id, _ws_id = await _make_run(
        db_session,
        tmp_path,
        owner,
        run_type="scan",
        path_source="server-local",
        lease_meta={
            "root_path": str(tmp_path),
            # 故意不传 spec_root
            "runtime_root": str(tmp_path / "rt"),
        },
    )
    resp = await client.get(
        f"/api/agent-runs/{run_id}/execution-context",
        headers=_auth(_token(owner)),
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["spec_root"] is None


# ---- AC-10：scan claude_md 渲染不回归（含 sillyspec run scan）-------------


async def test_existing_scan_claude_md_unchanged(client, db_session, tmp_path):
    """AC-10：daemon-client scan run 的 claude_md 仍含 "sillyspec run scan"
    （bundle 渲染不受 response 顶层字段影响；scan bundle 内 spec_root 仍来自 lease_meta）。"""
    owner = await _make_user(db_session)
    backend_spec_root = str(tmp_path / "spec_backend")
    run_id, _ws_id = await _make_run(
        db_session,
        tmp_path,
        owner,
        run_type="scan",
        path_source="daemon-client",
        lease_meta={
            "root_path": str(tmp_path),
            "spec_root": backend_spec_root,
            "runtime_root": str(tmp_path / "rt"),
        },
    )
    resp = await client.get(
        f"/api/agent-runs/{run_id}/execution-context",
        headers=_auth(_token(owner)),
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert "sillyspec run scan" in body["claude_md"]
