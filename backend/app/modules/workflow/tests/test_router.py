"""HTTP-level tests for the workflow router."""

from __future__ import annotations

import uuid

from app.core.security import password_hasher
from app.modules.auth.model import User
from app.modules.change.model import Change, ChangeDocument
from app.modules.workspace.model import Workspace


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


async def _setup(db_session) -> dict:
    """Create workspace, change, user + token."""
    ws_id = uuid.uuid4()
    ws = Workspace(
        id=ws_id,
        name="Test WS",
        slug=f"test-ws-{ws_id.hex[:8]}",
        root_path="/tmp/test",
        status="active",
    )
    db_session.add(ws)

    await db_session.flush()  # ensure FK target exists before referencing it

    change_id = uuid.uuid4()
    change = Change(
        id=change_id,
        workspace_id=ws_id,
        change_key="test-change",
        title="Test Change",
        status="draft",
        location="change",
        path=".sillyspec/changes/change/test-change",
    )
    db_session.add(change)

    user_id = uuid.uuid4()
    user = User(
        id=user_id,
        email=f"test-{user_id.hex[:8]}@example.com",
        password_hash=password_hasher.hash("Pass123!"),
        display_name="Test",
        status="active",
        is_platform_admin=True,
    )
    db_session.add(user)
    await db_session.commit()

    from app.core.config import get_settings
    from app.core.security import create_access_token

    settings = get_settings()
    token, _ = create_access_token(
        user_id=user.id,
        email=user.email,
        is_admin=True,
        settings=settings,
    )

    return {
        "ws_id": ws_id,
        "change_id": change_id,
        "user_id": user_id,
        "token": token,
    }


async def _add_doc(session, change_id: uuid.UUID, doc_type: str) -> None:
    doc = ChangeDocument(
        id=uuid.uuid4(),
        change_id=change_id,
        doc_type=doc_type,
        path=f"test/{doc_type}.md",
        exists=True,
    )
    session.add(doc)
    await session.commit()


# ── Audit log tests ────────────────────────────────────────────────────────


async def test_audit_log_written_on_task_transition(client, db_session):
    refs = await _setup(db_session)
    from app.modules.task.model import Task

    task_id = uuid.uuid4()
    task = Task(
        id=task_id,
        workspace_id=refs["ws_id"],
        change_id=refs["change_id"],
        task_key="task-01",
        title="Test Task",
        status="draft",
    )
    db_session.add(task)
    await db_session.commit()

    await client.post(
        f"/api/workspaces/{refs['ws_id']}/tasks/{task_id}/transition",
        json={"target": "ready"},
        headers=_auth(refs["token"]),
    )
    resp = await client.get(
        f"/api/workspaces/{refs['ws_id']}/audit",
        headers=_auth(refs["token"]),
    )
    assert resp.status_code == 200
    logs = resp.json()
    assert len(logs) >= 1
    assert logs[0]["action"] == "task.transition"
    assert logs[0]["resource_type"] == "task"


async def test_audit_log_filter_by_resource_type(client, db_session):
    refs = await _setup(db_session)
    from app.modules.task.model import Task

    task_id = uuid.uuid4()
    task = Task(
        id=task_id,
        workspace_id=refs["ws_id"],
        change_id=refs["change_id"],
        task_key="task-02",
        title="Test Task",
        status="draft",
    )
    db_session.add(task)
    await db_session.commit()

    await client.post(
        f"/api/workspaces/{refs['ws_id']}/tasks/{task_id}/transition",
        json={"target": "ready"},
        headers=_auth(refs["token"]),
    )
    resp = await client.get(
        f"/api/workspaces/{refs['ws_id']}/audit?resource_type=change",
        headers=_auth(refs["token"]),
    )
    assert resp.status_code == 200
    assert len(resp.json()) == 0


# ── Task transition tests ──────────────────────────────────────────────────


async def test_task_transition(client, db_session):
    refs = await _setup(db_session)
    from app.modules.task.model import Task

    task_id = uuid.uuid4()
    task = Task(
        id=task_id,
        workspace_id=refs["ws_id"],
        change_id=refs["change_id"],
        task_key="task-01",
        title="Test Task",
        status="draft",
    )
    db_session.add(task)
    await db_session.commit()

    resp = await client.post(
        f"/api/workspaces/{refs['ws_id']}/tasks/{task_id}/transition",
        json={"target": "ready"},
        headers=_auth(refs["token"]),
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["status"] == "ready"
    assert body["previous_status"] == "draft"


async def test_task_transition_invalid(client, db_session):
    refs = await _setup(db_session)
    from app.modules.task.model import Task

    task_id = uuid.uuid4()
    task = Task(
        id=task_id,
        workspace_id=refs["ws_id"],
        change_id=refs["change_id"],
        task_key="task-02",
        title="Test Task",
        status="draft",
    )
    db_session.add(task)
    await db_session.commit()

    resp = await client.post(
        f"/api/workspaces/{refs['ws_id']}/tasks/{task_id}/transition",
        json={"target": "done"},
        headers=_auth(refs["token"]),
    )
    assert resp.status_code == 409


async def test_task_transition_no_auth(client, db_session):
    refs = await _setup(db_session)
    fake_id = uuid.uuid4()
    resp = await client.post(
        f"/api/workspaces/{refs['ws_id']}/tasks/{fake_id}/transition",
        json={"target": "ready"},
    )
    assert resp.status_code == 401
