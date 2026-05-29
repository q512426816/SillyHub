"""Unit tests for IncidentService."""

from __future__ import annotations

import uuid

import pytest

from app.modules.incident.service import (
    IncidentError,
    IncidentNotFound,
    IncidentService,
    PostmortemNotFound,
)


async def _make_workspace(db_session) -> uuid.UUID:
    from app.modules.workspace.model import Workspace

    ws_id = uuid.uuid4()
    ws = Workspace(
        id=ws_id,
        name="Test WS",
        slug=f"test-ws-{ws_id.hex[:8]}",
        root_path="/tmp/test",
        status="active",
    )
    db_session.add(ws)
    await db_session.commit()
    return ws_id


async def _make_user(db_session) -> uuid.UUID:
    from app.core.security import password_hasher
    from app.modules.auth.model import User

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
    return user_id


async def test_create_incident(db_session):
    ws_id = await _make_workspace(db_session)
    user_id = await _make_user(db_session)

    from app.modules.incident.schema import IncidentCreate

    svc = IncidentService(db_session)
    incident = await svc.create(
        ws_id,
        user_id,
        IncidentCreate(title="DB connection timeout", severity="high"),
    )
    assert incident.status == "open"
    assert incident.severity == "high"
    assert incident.reporter_id == user_id
    assert incident.workspace_id == ws_id


async def test_create_incident_invalid_severity(db_session):
    ws_id = await _make_workspace(db_session)
    user_id = await _make_user(db_session)

    from app.modules.incident.schema import IncidentCreate

    svc = IncidentService(db_session)
    with pytest.raises(IncidentError, match="Invalid severity"):
        await svc.create(
            ws_id,
            user_id,
            IncidentCreate(title="Bad", severity="extreme"),
        )


async def test_list_incidents(db_session):
    ws_id = await _make_workspace(db_session)
    user_id = await _make_user(db_session)

    from app.modules.incident.schema import IncidentCreate

    svc = IncidentService(db_session)
    await svc.create(ws_id, user_id, IncidentCreate(title="Inc A"))
    await svc.create(ws_id, user_id, IncidentCreate(title="Inc B"))

    incidents = await svc.list_incidents(ws_id)
    assert len(incidents) == 2


async def test_list_incidents_filter_status(db_session):
    ws_id = await _make_workspace(db_session)
    user_id = await _make_user(db_session)

    from app.modules.incident.schema import IncidentCreate, IncidentUpdate

    svc = IncidentService(db_session)
    inc = await svc.create(ws_id, user_id, IncidentCreate(title="Inc A"))
    await svc.update(inc.id, IncidentUpdate(status="investigating"))

    open_incidents = await svc.list_incidents(ws_id, status="open")
    assert len(open_incidents) == 0
    investigating = await svc.list_incidents(ws_id, status="investigating")
    assert len(investigating) == 1


async def test_get_incident(db_session):
    ws_id = await _make_workspace(db_session)
    user_id = await _make_user(db_session)

    from app.modules.incident.schema import IncidentCreate

    svc = IncidentService(db_session)
    created = await svc.create(ws_id, user_id, IncidentCreate(title="Get me"))

    incident = await svc.get(created.id)
    assert incident.title == "Get me"


async def test_get_incident_not_found(db_session):
    svc = IncidentService(db_session)
    with pytest.raises(IncidentNotFound):
        await svc.get(uuid.uuid4())


async def test_update_status(db_session):
    ws_id = await _make_workspace(db_session)
    user_id = await _make_user(db_session)

    from app.modules.incident.schema import IncidentCreate, IncidentUpdate

    svc = IncidentService(db_session)
    incident = await svc.create(ws_id, user_id, IncidentCreate(title="Updatable"))

    updated = await svc.update(incident.id, IncidentUpdate(status="investigating"))
    assert updated.status == "investigating"


async def test_update_resolve(db_session):
    ws_id = await _make_workspace(db_session)
    user_id = await _make_user(db_session)

    from app.modules.incident.schema import IncidentCreate, IncidentUpdate

    svc = IncidentService(db_session)
    incident = await svc.create(ws_id, user_id, IncidentCreate(title="Resolvable"))

    updated = await svc.update(
        incident.id,
        IncidentUpdate(status="resolved", resolved_by=str(user_id)),
    )
    assert updated.status == "resolved"
    assert updated.resolved_at is not None
    assert updated.resolved_by == user_id


async def test_update_invalid_status(db_session):
    ws_id = await _make_workspace(db_session)
    user_id = await _make_user(db_session)

    from app.modules.incident.schema import IncidentCreate, IncidentUpdate

    svc = IncidentService(db_session)
    incident = await svc.create(ws_id, user_id, IncidentCreate(title="Bad status"))

    with pytest.raises(IncidentError, match="Invalid status"):
        await svc.update(incident.id, IncidentUpdate(status="unknown"))


async def test_create_postmortem(db_session):
    ws_id = await _make_workspace(db_session)
    user_id = await _make_user(db_session)

    from app.modules.incident.schema import IncidentCreate, IncidentUpdate, PostmortemCreate

    svc = IncidentService(db_session)
    incident = await svc.create(ws_id, user_id, IncidentCreate(title="PM incident"))
    await svc.update(incident.id, IncidentUpdate(status="resolved"))

    pm = await svc.create_postmortem(
        incident.id,
        user_id,
        PostmortemCreate(
            timeline="09:00 alert fired",
            impact="10min downtime",
            root_cause_analysis="connection pool exhausted",
            action_items=["increase pool size", "add alerting"],
            lessons_learned="Monitor pool metrics",
        ),
    )
    assert pm.incident_id == incident.id
    assert len(pm.action_items) == 2


async def test_create_postmortem_not_resolved(db_session):
    ws_id = await _make_workspace(db_session)
    user_id = await _make_user(db_session)

    from app.modules.incident.schema import IncidentCreate, PostmortemCreate

    svc = IncidentService(db_session)
    incident = await svc.create(ws_id, user_id, IncidentCreate(title="Open"))

    with pytest.raises(IncidentError, match="only be created for resolved"):
        await svc.create_postmortem(
            incident.id,
            user_id,
            PostmortemCreate(timeline="n/a"),
        )


async def test_create_postmortem_duplicate(db_session):
    ws_id = await _make_workspace(db_session)
    user_id = await _make_user(db_session)

    from app.modules.incident.schema import IncidentCreate, IncidentUpdate, PostmortemCreate

    svc = IncidentService(db_session)
    incident = await svc.create(ws_id, user_id, IncidentCreate(title="Dup PM"))
    await svc.update(incident.id, IncidentUpdate(status="resolved"))

    await svc.create_postmortem(incident.id, user_id, PostmortemCreate(timeline="T"))

    with pytest.raises(IncidentError, match="already exists"):
        await svc.create_postmortem(incident.id, user_id, PostmortemCreate(timeline="T2"))


async def test_get_postmortem_not_found(db_session):
    svc = IncidentService(db_session)
    with pytest.raises(PostmortemNotFound):
        await svc.get_postmortem(uuid.uuid4())
