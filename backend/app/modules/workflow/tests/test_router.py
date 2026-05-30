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


# ── Change transition tests ────────────────────────────────────────────────


async def test_change_transition_draft_to_proposed(client, db_session):
    refs = await _setup(db_session)
    await _add_doc(db_session, refs["change_id"], "master")
    resp = await client.post(
        f"/api/workspaces/{refs['ws_id']}/changes/{refs['change_id']}/transition",
        json={"target": "proposed"},
        headers=_auth(refs["token"]),
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["status"] == "proposed"
    assert body["previous_status"] == "draft"


async def test_change_transition_invalid(client, db_session):
    refs = await _setup(db_session)
    resp = await client.post(
        f"/api/workspaces/{refs['ws_id']}/changes/{refs['change_id']}/transition",
        json={"target": "approved"},
        headers=_auth(refs["token"]),
    )
    assert resp.status_code == 409


async def test_change_transition_guard_blocks(client, db_session):
    refs = await _setup(db_session)
    # draft -> proposed without MASTER.md
    resp = await client.post(
        f"/api/workspaces/{refs['ws_id']}/changes/{refs['change_id']}/transition",
        json={"target": "proposed"},
        headers=_auth(refs["token"]),
    )
    assert resp.status_code == 409
    assert "violations" in resp.json()["details"]


async def test_change_transition_no_auth(client, db_session):
    refs = await _setup(db_session)
    resp = await client.post(
        f"/api/workspaces/{refs['ws_id']}/changes/{refs['change_id']}/transition",
        json={"target": "proposed"},
    )
    assert resp.status_code == 401


async def test_change_transition_not_found(client, db_session):
    refs = await _setup(db_session)
    fake_id = uuid.uuid4()
    resp = await client.post(
        f"/api/workspaces/{refs['ws_id']}/changes/{fake_id}/transition",
        json={"target": "proposed"},
        headers=_auth(refs["token"]),
    )
    assert resp.status_code == 404


# ── Review tests ───────────────────────────────────────────────────────────


async def test_submit_review_approve(client, db_session):
    refs = await _setup(db_session)
    resp = await client.post(
        f"/api/workspaces/{refs['ws_id']}/changes/{refs['change_id']}/reviews",
        json={"verdict": "approve", "comment": "Looks good"},
        headers=_auth(refs["token"]),
    )
    assert resp.status_code == 201
    body = resp.json()
    assert body["verdict"] == "approve"
    assert body["comment"] == "Looks good"


async def test_submit_review_reject_transitions(client, db_session):
    refs = await _setup(db_session)
    # First transition to proposed
    await _add_doc(db_session, refs["change_id"], "master")
    await client.post(
        f"/api/workspaces/{refs['ws_id']}/changes/{refs['change_id']}/transition",
        json={"target": "proposed"},
        headers=_auth(refs["token"]),
    )
    # Reject
    resp = await client.post(
        f"/api/workspaces/{refs['ws_id']}/changes/{refs['change_id']}/reviews",
        json={"verdict": "reject", "comment": "Not ready"},
        headers=_auth(refs["token"]),
    )
    assert resp.status_code == 201
    assert resp.json()["verdict"] == "reject"

    # Verify change was rejected
    from sqlalchemy import select
    from sqlmodel import col

    from app.modules.change.model import Change

    stmt = select(Change).where(col(Change.id) == refs["change_id"])
    change = (await db_session.execute(stmt)).scalars().first()
    assert change.status == "rejected"


async def test_list_reviews(client, db_session):
    refs = await _setup(db_session)
    for verdict in ("approve", "reject"):
        await client.post(
            f"/api/workspaces/{refs['ws_id']}/changes/{refs['change_id']}/reviews",
            json={"verdict": verdict},
            headers=_auth(refs["token"]),
        )
    resp = await client.get(
        f"/api/workspaces/{refs['ws_id']}/changes/{refs['change_id']}/reviews",
        headers=_auth(refs["token"]),
    )
    assert resp.status_code == 200
    assert len(resp.json()) == 2


async def test_review_no_auth(client, db_session):
    refs = await _setup(db_session)
    resp = await client.post(
        f"/api/workspaces/{refs['ws_id']}/changes/{refs['change_id']}/reviews",
        json={"verdict": "approve"},
    )
    assert resp.status_code == 401


# ── Audit log tests ────────────────────────────────────────────────────────


async def test_audit_log_written_on_transition(client, db_session):
    refs = await _setup(db_session)
    await _add_doc(db_session, refs["change_id"], "master")
    await client.post(
        f"/api/workspaces/{refs['ws_id']}/changes/{refs['change_id']}/transition",
        json={"target": "proposed"},
        headers=_auth(refs["token"]),
    )
    resp = await client.get(
        f"/api/workspaces/{refs['ws_id']}/audit",
        headers=_auth(refs["token"]),
    )
    assert resp.status_code == 200
    logs = resp.json()
    assert len(logs) >= 1
    assert logs[0]["action"] == "change.transition"
    assert logs[0]["resource_type"] == "change"


async def test_audit_log_filter_by_resource_type(client, db_session):
    refs = await _setup(db_session)
    await _add_doc(db_session, refs["change_id"], "master")
    await client.post(
        f"/api/workspaces/{refs['ws_id']}/changes/{refs['change_id']}/transition",
        json={"target": "proposed"},
        headers=_auth(refs["token"]),
    )
    resp = await client.get(
        f"/api/workspaces/{refs['ws_id']}/audit?resource_type=task",
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
